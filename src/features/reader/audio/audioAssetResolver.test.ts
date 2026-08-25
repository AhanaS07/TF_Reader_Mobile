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
import { closeBook } from '@/features/encryption/contentProvider';
import { audioAssetResolver, clearAudioScratch } from '@/features/reader/audio/audioAssetResolver';
import type { BookId } from '@/shared/contracts';

jest.mock('@/features/download/openBook', () => ({ openBook: jest.fn() }));
jest.mock('@/features/encryption/contentProvider', () => ({ closeBook: jest.fn() }));

const mockOpenBook = openBook as jest.MockedFunction<typeof openBook>;
const mockCloseBook = closeBook as jest.MockedFunction<typeof closeBook>;

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
    // closeBook() below is TERMINAL for a streamed (ephemeral) package — it drops the only copy
    // that ever existed. Re-entering the player must therefore re-run the gate rather than expect a
    // session to still be open. If this ever regresses to caching, a second visit to a streamed
    // audiobook fails DECRYPTION_FAILED forever.
    await audioAssetResolver.resolveAudioAssetUri(BOOK);
    await audioAssetResolver.resolveAudioAssetUri(BOOK);

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
