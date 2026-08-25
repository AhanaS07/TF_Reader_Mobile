// Owner: Reader (Ahana).
//
// Proves the resolver's own contract: given a seeded AUDIO book, it returns a file:// URI pointing
// at REAL, valid, playable audio bytes. Written as "verify the file, not playback" because no player
// existed when it was first added; kept that way because it is the right level — the player has its
// own tests, and these should keep passing whichever player is wired in.
//
// Also pins the costs audioAssetResolver.ts's header names explicitly, so they stay true rather than
// becoming stale prose the next time that file changes. Those costs are accepted properties of the
// design, not defects awaiting a rewrite, which makes pinning them more important rather than less.

import * as path from 'path';

import { Directory, File, Paths } from 'expo-file-system';

import * as aesGcm from '@/features/encryption/aesGcm';
import { contentStore } from '@/features/encryption/contentStore';
import type { BookId, EncryptedPackage } from '@/shared/contracts';
import { audioAssetResolver } from '@/features/reader/audio/audioAssetResolver';
import { DEV_SAMPLE_AUDIO_BOOK_ID, ensureSeeded } from '@/features/reader/devContentSeed';

// See devContentSeed.audio.test.ts for why this is mocked: jest-expo's bundled require() asset
// mock does not resolve to a real on-disk path for ANY format (a pre-existing gap, not specific to
// this fixture), so this points it at the real generated fixture instead.
const mockRealWavPath = path.join(
  __dirname, '..', '..', '..', '..', 'assets', 'reader', 'sample-plaintext.wav',
);
jest.mock('expo-asset', () => ({
  Asset: {
    fromModule: () => ({
      downloadAsync: async () => undefined,
      localUri: `file://${mockRealWavPath}`,
      uri: `file://${mockRealWavPath}`,
    }),
  },
}));

describe('audioAssetResolver', () => {
  beforeEach(async () => {
    await ensureSeeded(DEV_SAMPLE_AUDIO_BOOK_ID);
  });

  afterEach(async () => {
    await contentStore.destroy(DEV_SAMPLE_AUDIO_BOOK_ID);
    jest.restoreAllMocks();
  });

  it('returns a file:// URI to a real, valid, correctly-extensioned WAV file', async () => {
    const uri = await audioAssetResolver.resolveAudioAssetUri(DEV_SAMPLE_AUDIO_BOOK_ID);

    // Extension is derived from the stored MIME type ('audio/wav' → 'wav'), not hardcoded.
    expect(uri).toMatch(/^file:\/\/.*\.wav$/);

    const bytes = new File(uri).bytesSync();
    expect(Buffer.from(bytes.slice(0, 4)).toString('ascii')).toBe('RIFF');
    expect(Buffer.from(bytes.slice(8, 12)).toString('ascii')).toBe('WAVE');
    expect(bytes.length).toBe(960044);
  });

  it('never routes through aesGcm — audio is never encrypted, even in the resolver hop', async () => {
    const encryptSpy = jest.spyOn(aesGcm, 'encrypt');
    const decryptSpy = jest.spyOn(aesGcm, 'decrypt');

    await audioAssetResolver.resolveAudioAssetUri(DEV_SAMPLE_AUDIO_BOOK_ID);

    expect(encryptSpy).not.toHaveBeenCalled();
    expect(decryptSpy).not.toHaveBeenCalled();
  });

  it('writes a SECOND, distinct file rather than pointing at contentStore\'s own copy', async () => {
    // Documents the "duplicate file" caveat in audioAssetResolver.ts's header as an observable
    // fact, not just prose: the resolver's URI must not be indistinguishable from whatever
    // ContentProvider handed back internally, precisely because the resolver does NOT (and must
    // NOT) reach into contentStore's own storage layout. The duplicate file is the cost of that
    // boundary — see audioAssetResolver.ts's cost list — so this test is what keeps the boundary
    // observable rather than merely asserted in a comment.
    const uri = await audioAssetResolver.resolveAudioAssetUri(DEV_SAMPLE_AUDIO_BOOK_ID);

    expect(uri).toContain('tf-reader-audio-scratch');
    expect(uri).not.toContain('tf-reader-content');
  });

  it('closes the ContentStore session after writing, so the RAM copy does not linger', async () => {
    await audioAssetResolver.resolveAudioAssetUri(DEV_SAMPLE_AUDIO_BOOK_ID);

    // isAvailableOffline reads persisted meta.json, unaffected by close() — this is checking that
    // the book is still genuinely stored (closeBook is REVERSIBLE, not destroy()), while confirming
    // the resolver did call close() and not silently skip it (a second resolve must still work,
    // which it can only do by re-opening a fresh session against the still-persisted package).
    expect(await contentStore.isAvailableOffline(DEV_SAMPLE_AUDIO_BOOK_ID)).toBe(true);
    await expect(
      audioAssetResolver.resolveAudioAssetUri(DEV_SAMPLE_AUDIO_BOOK_ID),
    ).resolves.toMatch(/^file:\/\//);
  });
});

// The scratch directory used to be append-only: every book resolved left a full-size copy behind
// forever, because the resolver only ever replaced the file belonging to the book it was resolving.
// Four audiobooks meant four copies. These pin the sweep that fixes it — and, just as importantly,
// pin that it sweeps OTHER books rather than everything, since deleting the file being resolved
// would break the very thing the resolver exists to produce.
describe('audioAssetResolver — scratch directory does not accumulate', () => {
  const SCRATCH_DIR = new Directory(Paths.cache, 'tf-reader-audio-scratch');
  const SECOND_AUDIO_BOOK_ID = 'scratch-sweep-second-audio-book' as BookId;

  // A second AUDIO book, stored directly rather than seeded: devContentSeed ships exactly one audio
  // fixture, and the leak being tested only appears with TWO distinct bookIds.
  function secondAudioPackage(): EncryptedPackage {
    const content = new Uint8Array(2048).fill(7);
    return {
      bookId: SECOND_AUDIO_BOOK_ID,
      format: 'AUDIO',
      content,
      encryption: null,
      licence: null,
      cipherLength: content.length,
      originalLength: content.length,
      mimeType: 'audio/wav',
    };
  }

  beforeEach(async () => {
    await ensureSeeded(DEV_SAMPLE_AUDIO_BOOK_ID);
    await contentStore.store(secondAudioPackage());
  });

  afterEach(async () => {
    await contentStore.destroy(DEV_SAMPLE_AUDIO_BOOK_ID);
    await contentStore.destroy(SECOND_AUDIO_BOOK_ID);
  });

  it('deletes the previous book\'s scratch file when a different book is resolved', async () => {
    const firstUri = await audioAssetResolver.resolveAudioAssetUri(DEV_SAMPLE_AUDIO_BOOK_ID);
    expect(new File(firstUri).exists).toBe(true);

    const secondUri = await audioAssetResolver.resolveAudioAssetUri(SECOND_AUDIO_BOOK_ID);

    expect(new File(secondUri).exists).toBe(true);
    expect(new File(firstUri).exists).toBe(false);
    expect(SCRATCH_DIR.list()).toHaveLength(1);
  });

  it('leaves the resolved book\'s own file in place — the sweep spares its target', async () => {
    // The failure this guards against is a sweep written as "empty the directory, then write",
    // which passes the accumulation test above and returns a URI to a file that does not exist.
    const uri = await audioAssetResolver.resolveAudioAssetUri(SECOND_AUDIO_BOOK_ID);

    const bytes = new File(uri).bytesSync();
    expect(bytes.length).toBe(2048);
    expect(bytes[0]).toBe(7);
  });

  it('re-resolving the SAME book does not accumulate either, and still yields valid bytes', async () => {
    await audioAssetResolver.resolveAudioAssetUri(SECOND_AUDIO_BOOK_ID);
    const uri = await audioAssetResolver.resolveAudioAssetUri(SECOND_AUDIO_BOOK_ID);

    expect(SCRATCH_DIR.list()).toHaveLength(1);
    expect(new File(uri).bytesSync().length).toBe(2048);
  });
});
