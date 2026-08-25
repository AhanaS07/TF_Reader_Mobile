// Owner: Reader (Ahana).
//
// AUDIO PHASE 1 (see /AUDIO_PHASE0_FINDINGS.md, one directory above this repo). Pins that seeding
// the AUDIO dev fixture exercises the REAL, already-tested contentStore acquisition path
// (buildAudioPackage -> contentStore.store()'s "open access / audio: already plaintext" branch —
// the same branch contentStore.test.ts's own openAccessPackage() helper exercises), not a
// hand-waved shortcut, and that it never routes through aesGcm — audio must never be encrypted.
//
// TEMPORARY, with devContentSeed.ts — see that file's header and CLAUDE.md's scaffolding table.
// This file dies with it, the same way devSearchIndex.test.ts and devFixturePath.test.ts do.

import * as path from 'path';

import * as aesGcm from '@/features/encryption/aesGcm';
import { closeBook, getBook, getFormat } from '@/features/encryption/contentProvider';
import { contentStore } from '@/features/encryption/contentStore';
import { DEV_SAMPLE_AUDIO_BOOK_ID, ensureSeeded } from '@/features/reader/devContentSeed';

// jest-expo's asset-module mock for a bundled require() (any format — this is pre-existing and
// not specific to WAV: the same gap reproduces for the already-shipped PDF/EPUB fixtures too) does
// not resolve to a real on-disk path, so `Asset.fromModule(...).localUri` comes back unusable
// ('uri', not a real file). Scoped to this file only: point it at the REAL generated fixture on
// disk instead, so `ensureSeeded` exercises its actual production code path end to end rather than
// stubbing that path out.
const mockRealWavPath = path.join(__dirname, '..', '..', '..', 'assets', 'reader', 'sample-plaintext.wav');
jest.mock('expo-asset', () => ({
  Asset: {
    fromModule: () => ({
      downloadAsync: async () => undefined,
      localUri: `file://${mockRealWavPath}`,
      uri: `file://${mockRealWavPath}`,
    }),
  },
}));

describe('devContentSeed — AUDIO fixture', () => {
  afterEach(async () => {
    await contentStore.destroy(DEV_SAMPLE_AUDIO_BOOK_ID);
    jest.restoreAllMocks();
  });

  it('seeds real WAV bytes, genuinely on disk, with no encryption involved', async () => {
    // The only way to PROVE "never encrypted" from outside contentStore: decryptBook() returns
    // identical plaintext bytes whether or not encryption ran (that is the whole point of the
    // frozen ContentProvider seam — see content-provider.ts), so byte content alone cannot show
    // this. Spying on aesGcm.encrypt is the one seam that can.
    const encryptSpy = jest.spyOn(aesGcm, 'encrypt');

    await ensureSeeded(DEV_SAMPLE_AUDIO_BOOK_ID);

    expect(encryptSpy).not.toHaveBeenCalled();

    expect(await contentStore.isAvailableOffline(DEV_SAMPLE_AUDIO_BOOK_ID)).toBe(true);
    expect(await getFormat(DEV_SAMPLE_AUDIO_BOOK_ID)).toBe('AUDIO');

    // close() clears the in-memory packageCache/session entirely (contentStore.ts). A getBook()
    // after this MUST cold-read from disk via loadPersisted() — there is nothing left in memory
    // to serve it from — which is what actually proves the bytes are persisted, not just held in
    // RAM from the store() call above. Same technique contentStore.test.ts's own cold-read tests
    // use.
    await closeBook(DEV_SAMPLE_AUDIO_BOOK_ID);
    const bytes = await getBook(DEV_SAMPLE_AUDIO_BOOK_ID);

    expect(Buffer.from(bytes.slice(0, 4)).toString('ascii')).toBe('RIFF');
    expect(Buffer.from(bytes.slice(8, 12)).toString('ascii')).toBe('WAVE');
    // Exactly the plaintext length, with no GCM nonce/tag overhead (12 + 16 bytes) added anywhere
    // in the round trip — a second, structural confirmation alongside the encrypt() spy above.
    expect(bytes.length).toBe(960044);
  });

  it('re-seeds an AUDIO fixture idempotently, same as the EPUB/PDF fixtures do', async () => {
    await ensureSeeded(DEV_SAMPLE_AUDIO_BOOK_ID);
    await expect(ensureSeeded(DEV_SAMPLE_AUDIO_BOOK_ID)).resolves.toBeUndefined();
    expect(await contentStore.isAvailableOffline(DEV_SAMPLE_AUDIO_BOOK_ID)).toBe(true);
  });
});
