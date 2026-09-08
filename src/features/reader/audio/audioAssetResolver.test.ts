// Owner: Reader (Ahana).
//
// Proves the resolver's contract: given a bookId, it returns a file:// URI pointing at real,
// playable audio bytes, having acquired them through the licence gate rather than assuming someone
// else stored them first.
//
// `openBook` is mocked, and that is the point rather than a shortcut: the real one needs a live
// backend and a device keypair, while what this file has to pin is that the resolver ASKS FOR the
// bytes the right way — once per resolve, with format 'AUDIO' — and does the right things with what
// it gets back. Whether openBook itself streams or reads from disk is licenseCheck.test.ts's and
// openBook.test.ts's job, and both already cover it.

import { Directory, File, Paths } from 'expo-file-system';

import { openBook } from '@/features/download/openBook';
import { closeBook, getMimeType } from '@/features/encryption/contentProvider';
import { audioAssetResolver, clearAudioScratch } from '@/features/reader/audio/audioAssetResolver';
import type { BookId } from '@/shared/contracts';

jest.mock('@/features/download/openBook', () => ({ openBook: jest.fn() }));
jest.mock('@/features/encryption/contentProvider', () => ({
  closeBook: jest.fn(),
  getMimeType: jest.fn(),
}));

const mockOpenBook = openBook as jest.MockedFunction<typeof openBook>;
const mockCloseBook = closeBook as jest.MockedFunction<typeof closeBook>;
const mockGetMimeType = getMimeType as jest.MockedFunction<typeof getMimeType>;

const BOOK = 'dev-sample-audio-encrypted' as BookId;
const OTHER_BOOK = 'some-other-audiobook' as BookId;

// A RIFF/WAVE header followed by filler — enough that a test asserting "real audio bytes reached
// the file" is asserting something, without shipping a fixture now that the bundled WAV is gone.
function wavBytes(byteLength = 128): Uint8Array {
  const bytes = new Uint8Array(byteLength);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  bytes.set([0x57, 0x41, 0x56, 0x45], 8); // "WAVE"
  bytes.fill(0xab, 12);
  return bytes;
}

const SCRATCH_DIR = new Directory(Paths.cache, 'tf-reader-audio-scratch');

describe('audioAssetResolver', () => {
  beforeEach(() => {
    mockOpenBook.mockResolvedValue(wavBytes());
    mockCloseBook.mockResolvedValue(undefined);
    mockGetMimeType.mockResolvedValue('audio/wav');
    clearAudioScratch(null);
  });

  afterEach(() => {
    clearAudioScratch(null);
    jest.clearAllMocks();
  });

  it('returns a file:// URI to a real, correctly-extensioned file holding the acquired bytes', async () => {
    const uri = await audioAssetResolver.resolveAudioAssetUri(BOOK);

    // Extension is derived from the stored MIME type ('audio/wav' → 'wav'), not hardcoded.
    expect(uri).toMatch(/^file:\/\/.*\.wav$/);
    const written = new File(uri).bytesSync();
    expect(Buffer.from(written.slice(0, 4)).toString('ascii')).toBe('RIFF');
    expect(Buffer.from(written.slice(8, 12)).toString('ascii')).toBe('WAVE');
    expect(written.length).toBe(128);
  });

  it('acquires through openBook with format AUDIO — the licence gate, not a bare getBook', async () => {
    // The distinction this pins: getBook() assumes a package is already stored and checks no
    // entitlement. Since the audio dev seed was deleted, that would fail for a streamed book and
    // silently skip the licence check for a downloaded one.
    await audioAssetResolver.resolveAudioAssetUri(BOOK);

    expect(mockOpenBook).toHaveBeenCalledTimes(1);
    expect(mockOpenBook).toHaveBeenCalledWith(BOOK, 'AUDIO');
  });

  it('RE-ACQUIRES on every resolve, which is what makes re-entry work after closeBook', async () => {
    // closeBook() ends the session and zeroes the plaintext, so re-entering the player must re-run
    // the gate rather than expect a session to still be open. The in-flight dedupe below must not
    // drift into a URI cache: these two resolves do not overlap, and the scratch file may have been
    // swept between them, so each has to acquire for itself.
    await audioAssetResolver.resolveAudioAssetUri(BOOK);
    await audioAssetResolver.resolveAudioAssetUri(BOOK);

    expect(mockOpenBook).toHaveBeenCalledTimes(2);
  });

  // ── overlapping resolves ────────────────────────────────────────────────────────────────────
  //
  // contentStore sessions are keyed by bookId with NO reference counting: one session per book,
  // not one per caller. So two concurrent resolves of the same book used to tear each other down —
  // the first to finish called closeBook(), which zeroed the shared plaintext buffer the second was
  // about to write (a scratch file of pure zeros, silently) and dropped the package, so the
  // second's getMimeType() threw DECRYPTION_FAILED.
  //
  // AudioPlayerScreen is the caller that overlaps: its load effect's `cancelled` flag suppresses a
  // stale setUri but does not abort the in-flight promise, so leaving the screen mid-load and
  // re-entering leaves two acquires running against one session.

  it('shares ONE acquire between overlapping resolves of the same book', async () => {
    let release!: (bytes: Uint8Array) => void;
    mockOpenBook.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));

    const first = audioAssetResolver.resolveAudioAssetUri(BOOK);
    const second = audioAssetResolver.resolveAudioAssetUri(BOOK);
    release(wavBytes());

    expect(await first).toBe(await second);
    expect(mockOpenBook).toHaveBeenCalledTimes(1);
    expect(mockCloseBook).toHaveBeenCalledTimes(1);
  });

  it('gives an overlapping resolve bytes that were not zeroed underneath it', async () => {
    let release!: (bytes: Uint8Array) => void;
    mockOpenBook.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    // closeBook() zeroes the decrypted buffer in place — the real contentStore.close() does this,
    // and it is the half of the hazard that fails SILENTLY rather than throwing.
    const bytes = wavBytes();
    mockCloseBook.mockImplementation(async () => { bytes.fill(0); });

    const first = audioAssetResolver.resolveAudioAssetUri(BOOK);
    const second = audioAssetResolver.resolveAudioAssetUri(BOOK);
    release(bytes);
    await Promise.all([first, second]);

    const written = new File(await second).bytesSync();
    expect(written.some((b) => b !== 0)).toBe(true);
  });

  it('does not dedupe DIFFERENT books onto one acquire', async () => {
    await Promise.all([
      audioAssetResolver.resolveAudioAssetUri(BOOK),
      audioAssetResolver.resolveAudioAssetUri(OTHER_BOOK),
    ]);

    expect(mockOpenBook).toHaveBeenCalledTimes(2);
  });

  it('clears the in-flight entry on failure, so a retry is not stuck with the rejection', async () => {
    mockOpenBook.mockRejectedValueOnce(new Error('LICENSE_DENIED'));
    await expect(audioAssetResolver.resolveAudioAssetUri(BOOK)).rejects.toThrow('LICENSE_DENIED');

    await expect(audioAssetResolver.resolveAudioAssetUri(BOOK)).resolves.toContain('file://');
    expect(mockOpenBook).toHaveBeenCalledTimes(2);
  });

  it('closes the session after writing, so the decrypted copy does not linger in RAM', async () => {
    await audioAssetResolver.resolveAudioAssetUri(BOOK);

    expect(mockCloseBook).toHaveBeenCalledWith(BOOK);
  });

  it('writes into its own scratch directory, never contentStore\'s', async () => {
    // The resolver must not reconstruct contentStore's private storage layout — see its header's
    // guards. This keeps that boundary observable rather than merely asserted in a comment.
    const uri = await audioAssetResolver.resolveAudioAssetUri(BOOK);

    expect(uri).toContain('tf-reader-audio-scratch');
    expect(uri).not.toContain('tf-reader-content');
  });

  it('derives the extension from the stored MIME type, not a hardcoded one', async () => {
    mockGetMimeType.mockResolvedValue('audio/mpeg');

    const uri = await audioAssetResolver.resolveAudioAssetUri(BOOK);

    expect(uri).toMatch(/\.mp3$/);
  });

  it('falls back to .bin for a MIME type it does not recognise, rather than guessing', async () => {
    mockGetMimeType.mockResolvedValue('audio/some-future-codec');

    const uri = await audioAssetResolver.resolveAudioAssetUri(BOOK);

    expect(uri).toMatch(/\.bin$/);
  });

  it('reads the MIME type AFTER acquiring, since a streamed book has no meta.json before that', async () => {
    // The accessor's first call site issued both together with Promise.all. That races on the
    // ONLINE path: getMimeType reads the persisted meta.json, which for an ephemeral package does
    // not exist until openBook() has stored it.
    await audioAssetResolver.resolveAudioAssetUri(BOOK);

    expect(mockOpenBook.mock.invocationCallOrder[0]).toBeLessThan(
      mockGetMimeType.mock.invocationCallOrder[0],
    );
  });

  it('sweeps a book\'s previous file even when the extension changed between resolves', async () => {
    // The sweep matches on the bookId prefix, not the filename, precisely so a book re-stored under
    // a different MIME type does not leave its old file behind. Reachable for real: the backend's
    // catalogue says audio/wav while its grant says audio/mpeg for the same asset.
    mockGetMimeType.mockResolvedValue('audio/wav');
    const wavUri = await audioAssetResolver.resolveAudioAssetUri(BOOK);
    expect(new File(wavUri).exists).toBe(true);

    mockGetMimeType.mockResolvedValue('audio/mpeg');
    const mp3Uri = await audioAssetResolver.resolveAudioAssetUri(BOOK);

    expect(new File(mp3Uri).exists).toBe(true);
    expect(new File(wavUri).exists).toBe(false);
    expect(SCRATCH_DIR.list()).toHaveLength(1);
  });

  it('propagates a licence failure instead of writing a file', async () => {
    mockOpenBook.mockRejectedValueOnce(new Error('LICENSE_DENIED'));

    await expect(audioAssetResolver.resolveAudioAssetUri(BOOK)).rejects.toThrow('LICENSE_DENIED');
    expect(SCRATCH_DIR.exists ? SCRATCH_DIR.list() : []).toHaveLength(0);
  });
});

// The scratch directory used to be append-only: every book resolved left a full-size copy behind
// forever. These pin the sweep that fixes it — and, just as importantly, pin that it sweeps OTHER
// books rather than everything, since deleting the file being resolved would break the very thing
// the resolver exists to produce.
describe('audioAssetResolver — scratch directory does not accumulate', () => {
  beforeEach(() => {
    mockOpenBook.mockResolvedValue(wavBytes());
    mockCloseBook.mockResolvedValue(undefined);
    mockGetMimeType.mockResolvedValue('audio/wav');
    clearAudioScratch(null);
  });

  afterEach(() => {
    clearAudioScratch(null);
    jest.clearAllMocks();
  });

  it('deletes the previous book\'s scratch file when a different book is resolved', async () => {
    const firstUri = await audioAssetResolver.resolveAudioAssetUri(BOOK);
    expect(new File(firstUri).exists).toBe(true);

    const secondUri = await audioAssetResolver.resolveAudioAssetUri(OTHER_BOOK);

    expect(new File(secondUri).exists).toBe(true);
    expect(new File(firstUri).exists).toBe(false);
    expect(SCRATCH_DIR.list()).toHaveLength(1);
  });

  it('leaves the resolved book\'s own file in place — the sweep spares its target', async () => {
    // The failure this guards against is a sweep written as "empty the directory, then write",
    // which passes the accumulation test above and returns a URI to a file that does not exist.
    const uri = await audioAssetResolver.resolveAudioAssetUri(BOOK);

    expect(new File(uri).bytesSync().length).toBe(128);
  });

  it('re-resolving the SAME book does not accumulate either, and still yields valid bytes', async () => {
    await audioAssetResolver.resolveAudioAssetUri(BOOK);
    const uri = await audioAssetResolver.resolveAudioAssetUri(BOOK);

    expect(SCRATCH_DIR.list()).toHaveLength(1);
    expect(new File(uri).bytesSync().length).toBe(128);
  });
});
