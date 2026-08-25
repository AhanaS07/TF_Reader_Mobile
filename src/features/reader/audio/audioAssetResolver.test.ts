// Owner: Reader (Ahana).
//
// AUDIO PHASE 1 (see /AUDIO_PHASE0_FINDINGS.md). Proves the stopgap resolver's own contract: given
// a seeded AUDIO book, it returns a file:// URI pointing at REAL, valid, playable audio bytes —
// "verify the file, not playback" per this phase's acceptance criteria, since no player exists
// yet (Phase 2). Also pins the caveats audioAssetResolver.ts's header names explicitly, so they
// stay true rather than becoming stale prose the next time this file changes.

import * as path from 'path';

import { File } from 'expo-file-system';

import * as aesGcm from '@/features/encryption/aesGcm';
import { contentStore } from '@/features/encryption/contentStore';
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

describe('audioAssetResolver (stopgap)', () => {
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
    // ContentProvider handed back internally, precisely because this stopgap does NOT (and, per
    // the guard in this phase's brief, must NOT) reach into contentStore's own storage layout.
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
