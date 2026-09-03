// Exercises contentStore.ts (the frozen ContentStore contract) against REAL AES-256-GCM crypto
// via the Jest manual mock of the native module (__mocks__/react-native-aes-gcm-crypto.js) and
// REAL file I/O via the Jest manual mock of expo-file-system (__mocks__/expo-file-system.js,
// backed by Node's real `fs` under a temp dir) — not fakes standing in for the logic under test,
// only for the two native modules Jest can't load directly.
//
// deviceKeypair.ts's RSA-OAEP-256 unwrap is REAL now (see that file's header for the library
// choice) — most tests below still pre-seed a raw BEK via keyStorage.storeBek directly (the
// "cached from a previous unwrap" fast path decryptBook() already prefers), since that's the
// common-case behavior once a book has been opened once. The dedicated
// 'end-to-end via the real device keypair' describe block below instead exercises the FULL real
// path — generateDeviceKeypair -> wrapBek -> store -> decryptBook — with no pre-seeded key at
// all, proving the real integration works, not just the fast-path cache.

import * as crypto from 'crypto';
import * as Keychain from 'react-native-keychain';
import { encrypt } from './aesGcm';
import { NONCE_BYTES } from './cipherLayout';
import { getBek, storeBek } from './keyStorage';
import { generateDeviceKeypair, wrapBek } from './deviceKeypair';
import {
  contentStore,
  invalidateLicence,
  getPersistedLicenceStatus,
  MAX_DECRYPTED_BYTES,
  MAX_AUDIO_DECRYPTED_BYTES,
} from './contentStore';
import {
  ContentError,
  ContentFailure,
  EVENT_CHANNELS,
  OFFLINE_LOCK_EVENTS,
} from '@/shared/contracts';
import type { EncryptedPackage, LocalLicenceRecord } from '@/shared/contracts';
import { eventBus } from '@/shared/eventBus';

// Matches deviceKeypair.ts's internal constant — duplicated here only for the scoped keychain
// cleanup in the end-to-end describe block below (deviceKeypair.ts exposes no reset of its own).
const DEVICE_PRIVATE_KEY_SERVICE = 'tf-reader-device-private-key';

function randomKey(): Uint8Array {
  return new Uint8Array(crypto.randomBytes(32));
}

function plaintextOf(sizeBytes: number, seed: string): Uint8Array {
  const buf = Buffer.alloc(sizeBytes);
  Buffer.from(seed, 'utf8').copy(buf);
  return new Uint8Array(buf);
}

function licenceFor(bookId: string, overrides: Partial<LocalLicenceRecord> = {}): LocalLicenceRecord {
  return {
    licenceId: `lic-${bookId}`,
    itemId: bookId,
    keyFingerprint: 'sha256:test-fingerprint',
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(), // +1 day
    canPersist: true,
    rights: { print: false },
    ...overrides,
  };
}

async function buildEncryptedPackage(
  bookId: string,
  plaintext: Uint8Array,
  key: Uint8Array,
  licenceOverrides: Partial<LocalLicenceRecord> = {}
): Promise<EncryptedPackage> {
  const payload = await encrypt(plaintext, key);
  return {
    bookId,
    format: 'EPUB',
    content: payload.content,
    encryption: {
      algorithm: 'AES-256-GCM',
      layout: 'nonce(12) || ciphertext || tag(16)',
      wrappedBek: 'not-a-real-wrap-in-this-test',
      wrapAlgorithm: 'RSA-OAEP-256',
      keyId: 'master-v1',
      keyFingerprint: 'sha256:test-fingerprint',
    },
    licence: licenceFor(bookId, licenceOverrides),
    cipherLength: payload.cipherLength,
    originalLength: payload.originalLength,
    mimeType: 'application/epub+zip',
  };
}

// `format` is a parameter because the RAM budget is per-format (maxDecryptedBytesFor) — the
// AUDIO-cap block at the bottom of this file needs an unencrypted EPUB to prove the 20 MB bound
// applies to audio ALONE, and building one any other way would mean paying real AES-GCM over
// 20 MB just to exercise a length check.
function openAccessPackage(
  bookId: string,
  plaintext: Uint8Array,
  format: EncryptedPackage['format'] = 'AUDIO'
): EncryptedPackage {
  return {
    bookId,
    format,
    content: plaintext,
    encryption: null,
    licence: null,
    cipherLength: plaintext.length,
    originalLength: plaintext.length,
    mimeType: format === 'AUDIO' ? 'audio/mpeg' : 'application/epub+zip',
  };
}

describe('contentStore — open access (no encryption)', () => {
  it('round-trips a plaintext book with no crypto involved', async () => {
    const bookId = 'oa-book-1';
    const plaintext = plaintextOf(2048, 'open access audio');

    await contentStore.store(openAccessPackage(bookId, plaintext));
    await contentStore.openSession(bookId);
    const decrypted = await contentStore.decryptBook(bookId);

    expect(Buffer.from(decrypted).equals(Buffer.from(plaintext))).toBe(true);
  });
});

// The audio cap is 20 MB where every other format gets 25 MB, and the difference is a CATALOGUE
// agreement (the OPDS team stores prototype audio at 20 MB or under), not a RAM measurement —
// see MAX_AUDIO_DECRYPTED_BYTES' own comment in contentStore.ts. These tests pin the two caps
// apart: without the middle case, dropping the whole budget to 20 MB would pass just as well,
// and that is a different, much wider change.
describe('contentStore — the 20 MB AUDIO cap', () => {
  it('refuses an AUDIO book over 20 MB at store(), before anything is persisted', async () => {
    const bookId = 'audio-over-cap';
    const plaintext = plaintextOf(MAX_AUDIO_DECRYPTED_BYTES + 1, 'one byte over the audio cap');

    await expect(contentStore.store(openAccessPackage(bookId, plaintext))).rejects.toMatchObject({
      code: ContentError.DECRYPTION_FAILED,
    });
    expect(await contentStore.isAvailableOffline(bookId)).toBe(false);
  }, 60_000);

  it('accepts a non-AUDIO book of the SAME size — the cap is audio-only, not a global tightening', async () => {
    const bookId = 'epub-between-the-caps';
    const plaintext = plaintextOf(MAX_AUDIO_DECRYPTED_BYTES + 1, 'over 20 MB but under 25 MB');

    await contentStore.store(openAccessPackage(bookId, plaintext, 'EPUB'));
    await contentStore.openSession(bookId);
    const decrypted = await contentStore.decryptBook(bookId);

    expect(decrypted.length).toBe(MAX_AUDIO_DECRYPTED_BYTES + 1);
    await contentStore.destroy(bookId);
  }, 60_000);

  it('accepts an AUDIO book exactly AT 20 MB (off-by-one check: > not >=)', async () => {
    const bookId = 'audio-at-cap';
    const plaintext = plaintextOf(MAX_AUDIO_DECRYPTED_BYTES, 'exactly at the audio cap');

    await contentStore.store(openAccessPackage(bookId, plaintext));
    await contentStore.openSession(bookId);
    const decrypted = await contentStore.decryptBook(bookId);

    expect(decrypted.length).toBe(MAX_AUDIO_DECRYPTED_BYTES);
    await contentStore.destroy(bookId);
  }, 60_000);
});

describe('contentStore — Subscription (persisted, real AES-256-GCM)', () => {
  it('store -> openSession -> decryptBook reproduces the book, byte-for-byte, tag verified', async () => {
    const bookId = 'sub-book-1';
    const key = randomKey();
    const plaintext = plaintextOf(4096, 'subscription book contents');
    const pkg = await buildEncryptedPackage(bookId, plaintext, key);

    // Simulate "BEK already unwrapped in a previous session" — the real cache path
    // decryptBook() checks before ever calling the (currently-stubbed) unwrapBek.
    await storeBek(bookId, key);

    await contentStore.store(pkg);
    await contentStore.openSession(bookId);
    const decrypted = await contentStore.decryptBook(bookId);

    expect(Buffer.from(decrypted).equals(Buffer.from(plaintext))).toBe(true);
  });

  it('is available offline after store(), and not before', async () => {
    const bookId = 'sub-book-2';
    const key = randomKey();
    const pkg = await buildEncryptedPackage(bookId, plaintextOf(512, 'x'), key);

    expect(await contentStore.isAvailableOffline(bookId)).toBe(false);
    await contentStore.store(pkg);
    expect(await contentStore.isAvailableOffline(bookId)).toBe(true);
  });

  it('survives a cold start: a fresh openSession()/decryptBook() after the in-memory cache is gone', async () => {
    const bookId = 'sub-book-cold-start';
    const key = randomKey();
    const plaintext = plaintextOf(1024, 'reopened after restart');
    const pkg = await buildEncryptedPackage(bookId, plaintext, key);
    await storeBek(bookId, key);
    await contentStore.store(pkg);

    // No explicit "clear the in-memory cache" hook exists (by design — that's process restart,
    // not a public API) so this proves the DISK path specifically by asserting the file is what
    // isAvailableOffline actually inspects, then re-opening a brand-new bookId-scoped session.
    await contentStore.openSession(bookId);
    const decrypted = await contentStore.decryptBook(bookId);
    expect(Buffer.from(decrypted).equals(Buffer.from(plaintext))).toBe(true);
  });

  it('rejects with ContentFailure(INTEGRITY_FAILED) when the ciphertext is tampered', async () => {
    const bookId = 'sub-book-tampered';
    const key = randomKey();
    const pkg = await buildEncryptedPackage(bookId, plaintextOf(1500, 'tamper me'), key);
    await storeBek(bookId, key);

    // Flip a byte inside the ciphertext region before storing — the GCM tag must catch this.
    const tampered = new Uint8Array(pkg.content);
    const target = NONCE_BYTES + 10;
    tampered[target] ^= 0xff;

    await contentStore.store({ ...pkg, content: tampered });
    await contentStore.openSession(bookId);

    await expect(contentStore.decryptBook(bookId)).rejects.toThrow(ContentFailure);
    try {
      await contentStore.decryptBook(bookId);
      throw new Error('expected decryptBook to reject');
    } catch (e) {
      expect(e).toBeInstanceOf(ContentFailure);
      expect((e as ContentFailure).code).toBe(ContentError.INTEGRITY_FAILED);
    }
  });

  it('rejects with ContentFailure(LICENCE_EXPIRED) when the licence has expired', async () => {
    const bookId = 'sub-book-expired';
    const key = randomKey();
    const pkg = await buildEncryptedPackage(bookId, plaintextOf(256, 'expired'), key, {
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    await storeBek(bookId, key);

    await contentStore.store(pkg);
    await contentStore.openSession(bookId);

    try {
      await contentStore.decryptBook(bookId);
      throw new Error('expected decryptBook to reject');
    } catch (e) {
      expect(e).toBeInstanceOf(ContentFailure);
      expect((e as ContentFailure).code).toBe(ContentError.LICENCE_EXPIRED);
    }
  });

  it('rejects with ContentFailure(KEYSTORE_UNAVAILABLE) when no raw key is cached and wrappedBek is not a real wrap', async () => {
    const bookId = 'sub-book-no-key';
    const key = randomKey();
    const pkg = await buildEncryptedPackage(bookId, plaintextOf(256, 'no key cached'), key);
    // Deliberately do NOT call storeBek — forces the real unwrapBek path, which then fails for
    // one of two real reasons depending on suite state: no device keypair registered yet, or (if
    // another test in this file already generated one) a real RSA-OAEP decrypt failure against
    // this fixture's placeholder wrappedBek string. Either way it's a genuine failure, not a stub.

    await contentStore.store(pkg);
    await contentStore.openSession(bookId);

    try {
      await contentStore.decryptBook(bookId);
      throw new Error('expected decryptBook to reject');
    } catch (e) {
      expect(e).toBeInstanceOf(ContentFailure);
      expect((e as ContentFailure).code).toBe(ContentError.KEYSTORE_UNAVAILABLE);
    }
  });

  it('rejects store() itself when the book exceeds the RAM budget, before anything is persisted', async () => {
    // Genuinely over budget — not a lied-about length field, an actually oversized plaintext, so
    // this proves the check against real data rather than a fixture that's inconsistent with
    // itself (store()'s own length-invariant check would otherwise catch that first, for the
    // right reason but the wrong test).
    //
    // This pins the write/read asymmetry fix: store() used to ACCEPT this package (writing 25MB+
    // to disk, reporting isAvailableOffline() === true) and only decryptBook() would ever reject
    // it — a silent-until-tapped failure. AUDIO_MEMORY_REPORT.md measured exactly this gap against
    // a 150MB audio package. store() must now fail closed at write time instead.
    const bookId = 'sub-book-too-big';
    const key = randomKey();
    const plaintext = plaintextOf(MAX_DECRYPTED_BYTES + 1, 'too big for the RAM budget');
    const pkg = await buildEncryptedPackage(bookId, plaintext, key);
    await storeBek(bookId, key);

    await expect(contentStore.store(pkg)).rejects.toMatchObject({
      code: ContentError.DECRYPTION_FAILED,
    });
    expect(await contentStore.isAvailableOffline(bookId)).toBe(false);
  });

  it('rejects store() with ContentFailure(INTEGRITY_FAILED) on a cipherLength mismatch', async () => {
    const bookId = 'sub-book-bad-length';
    const key = randomKey();
    const pkg = await buildEncryptedPackage(bookId, plaintextOf(100, 'y'), key);

    await expect(contentStore.store({ ...pkg, cipherLength: pkg.cipherLength + 1 })).rejects.toMatchObject({
      code: ContentError.INTEGRITY_FAILED,
    });
  });

  it('rejects store() with ContentFailure(LICENCE_INVALID) when licence.itemId does not match bookId', async () => {
    const bookId = 'sub-book-wrong-licence';
    const key = randomKey();
    const pkg = await buildEncryptedPackage(bookId, plaintextOf(100, 'z'), key);
    const mismatched: EncryptedPackage = {
      ...pkg,
      licence: { ...pkg.licence!, itemId: 'some-other-book' },
    };

    await expect(contentStore.store(mismatched)).rejects.toMatchObject({
      code: ContentError.LICENCE_INVALID,
    });
  });
});

describe('contentStore — end-to-end via the real device keypair (no pre-seeded key)', () => {
  // Scoped cleanup so this block's device keypair doesn't leak into other describe blocks in
  // this file regardless of execution order — deviceKeypair.ts's keychain entry is a single
  // global service, not scoped per bookId like the BEK cache is.
  afterEach(async () => {
    await Keychain.resetGenericPassword({ service: DEVICE_PRIVATE_KEY_SERVICE });
  });

  it('generateDeviceKeypair -> wrapBek -> store -> openSession -> decryptBook, with NO keyStorage.storeBek shortcut', async () => {
    const bookId = 'sub-book-real-e2e';
    const bek = randomKey();
    const plaintext = plaintextOf(4096, 'wrapped for real, decrypted for real');

    const { publicKey } = await generateDeviceKeypair();
    const realWrappedBek = await wrapBek(bek, publicKey);

    const pkg = await buildEncryptedPackage(bookId, plaintext, bek);
    pkg.encryption = { ...pkg.encryption!, wrappedBek: realWrappedBek };
    // Deliberately no storeBek(bookId, bek) call — this proves the actual unwrapBek path, not
    // the "already cached from a previous session" fast path every other test above uses.

    await contentStore.store(pkg);
    await contentStore.openSession(bookId);
    const decrypted = await contentStore.decryptBook(bookId);

    expect(Buffer.from(decrypted).equals(Buffer.from(plaintext))).toBe(true);

    // And the successful unwrap should have cached the raw BEK in the keychain for next time
    // (resolveRawKey's documented behavior for non-Elite tiers).
    const cached = await getBek(bookId);
    expect(Buffer.from(cached).equals(Buffer.from(bek))).toBe(true);
  });

  it('rejects with ContentFailure(INTEGRITY_FAILED) if the ciphertext is tampered, even via the real unwrap path', async () => {
    const bookId = 'sub-book-real-e2e-tampered';
    const bek = randomKey();

    const { publicKey } = await generateDeviceKeypair();
    const realWrappedBek = await wrapBek(bek, publicKey);

    const pkg = await buildEncryptedPackage(bookId, plaintextOf(1024, 'tamper after real wrap'), bek);
    pkg.encryption = { ...pkg.encryption!, wrappedBek: realWrappedBek };

    const tampered = new Uint8Array(pkg.content);
    tampered[NONCE_BYTES + 5] ^= 0xff;

    await contentStore.store({ ...pkg, content: tampered });
    await contentStore.openSession(bookId);

    await expect(contentStore.decryptBook(bookId)).rejects.toMatchObject({
      code: ContentError.INTEGRITY_FAILED,
    });
  });
});

describe('contentStore — session lifecycle: close/destroy', () => {
  it('close() zeroes the decrypted buffer in place and is idempotent', async () => {
    const bookId = 'lifecycle-close';
    const key = randomKey();
    const plaintext = plaintextOf(512, 'zero me on close');
    const pkg = await buildEncryptedPackage(bookId, plaintext, key);
    await storeBek(bookId, key);
    await contentStore.store(pkg);

    await contentStore.openSession(bookId);
    const decrypted = await contentStore.decryptBook(bookId);
    expect(decrypted.some((b) => b !== 0)).toBe(true); // sanity: not already all zero

    await contentStore.close(bookId);
    expect(decrypted.every((b) => b === 0)).toBe(true); // same buffer reference, zeroed in place

    await expect(contentStore.close(bookId)).resolves.toBeUndefined(); // idempotent no-op
  });

  it('close() then decryptBook() requires a fresh openSession() (no open session -> rejects)', async () => {
    const bookId = 'lifecycle-reopen';
    const key = randomKey();
    const pkg = await buildEncryptedPackage(bookId, plaintextOf(256, 'reopen'), key);
    await storeBek(bookId, key);
    await contentStore.store(pkg);

    await contentStore.openSession(bookId);
    await contentStore.decryptBook(bookId);
    await contentStore.close(bookId);

    await expect(contentStore.decryptBook(bookId)).rejects.toMatchObject({
      code: ContentError.DECRYPTION_FAILED,
    });

    // REVERSIBLE: ciphertext survives close(), so a fresh session decrypts again fine.
    await contentStore.openSession(bookId);
    const decrypted = await contentStore.decryptBook(bookId);
    expect(decrypted.length).toBe(256);
  });

  it('destroy() is terminal: wipes persisted state so isAvailableOffline() and openSession() both fail after', async () => {
    const bookId = 'lifecycle-destroy';
    const key = randomKey();
    const pkg = await buildEncryptedPackage(bookId, plaintextOf(256, 'destroy me'), key);
    await storeBek(bookId, key);
    await contentStore.store(pkg);
    expect(await contentStore.isAvailableOffline(bookId)).toBe(true);

    await contentStore.destroy(bookId);

    expect(await contentStore.isAvailableOffline(bookId)).toBe(false);
    await expect(contentStore.openSession(bookId)).rejects.toMatchObject({
      code: ContentError.DECRYPTION_FAILED,
    });
  });
});

describe('contentStore — Elite (memory-only, canPersist: false)', () => {
  it('store() writes nothing to disk: isAvailableOffline() is always false', async () => {
    const bookId = 'elite-book-1';
    const key = randomKey();
    const pkg = await buildEncryptedPackage(bookId, plaintextOf(512, 'elite, in memory only'), key, {
      canPersist: false,
    });

    await contentStore.store(pkg);
    expect(await contentStore.isAvailableOffline(bookId)).toBe(false);
  });

  it('never touches the keychain: decryptBook() goes straight to unwrapBek, not getBek', async () => {
    const bookId = 'elite-book-2';
    const key = randomKey();
    const pkg = await buildEncryptedPackage(bookId, plaintextOf(512, 'elite, keystore off-limits'), key, {
      canPersist: false,
    });
    // Deliberately do NOT seed keyStorage — a Subscription book might have this bookId's BEK
    // cached from a past session; Elite must ignore that entirely rather than reading it.

    await contentStore.store(pkg);
    await contentStore.openSession(bookId);

    // unwrapBek (deviceKeypair.ts) is still a genuine stub (blocked on an RSA-OAEP library
    // choice — see that file's header), so this rejects for real, the same honest way the
    // Subscription "no key cached" test does above. What THIS test proves is narrower and
    // Elite-specific: the failure comes from unwrapBek, not from a keychain miss, confirming
    // Elite's code path never calls getBek() at all.
    try {
      await contentStore.decryptBook(bookId);
      throw new Error('expected decryptBook to reject');
    } catch (e) {
      expect(e).toBeInstanceOf(ContentFailure);
      expect((e as ContentFailure).code).toBe(ContentError.KEYSTORE_UNAVAILABLE);
    }

    // And confirms no write side effect either: still nothing in the keychain for this book.
    await expect(getBek(bookId)).rejects.toThrow();
  });
});

describe('contentStore — close() is REVERSIBLE for every tier, destroy() is the terminal one', () => {
  // `close()` used to drop the packageCache entry unconditionally. For Subscription that is just a
  // cache eviction — the ciphertext is on disk and loadPersisted() reloads it. For Elite it was
  // DELETION: store() returns before its writeFile calls, so the cache entry is the only copy, and
  // the next openSession() failed DECRYPTION_FAILED ("no stored package") forever after. That made
  // close() terminal for Elite, which content-provider.ts reserves for destroy().
  //
  // Live in production the moment openBook() started forcing canPersist:false on every streamed
  // book: audioAssetResolver closes after each resolve, so a streamed audiobook opened once and
  // then refused to reopen. These tests pin the lifecycle, not the cache.
  afterEach(async () => {
    await Keychain.resetGenericPassword({ service: DEVICE_PRIVATE_KEY_SERVICE });
  });

  async function storeEliteBook(bookId: string, plaintext: Uint8Array): Promise<void> {
    const bek = randomKey();
    const { publicKey } = await generateDeviceKeypair();
    const pkg = await buildEncryptedPackage(bookId, plaintext, bek, { canPersist: false });
    pkg.encryption = { ...pkg.encryption!, wrappedBek: await wrapBek(bek, publicKey) };
    await contentStore.store(pkg);
  }

  it('ELITE: close() then reopen still decrypts — the in-memory package survives', async () => {
    const bookId = 'elite-close-reopen';
    const plaintext = plaintextOf(2048, 'streamed once, reopened after close');
    await storeEliteBook(bookId, plaintext);

    await contentStore.openSession(bookId);
    expect(Buffer.from(await contentStore.decryptBook(bookId)).equals(Buffer.from(plaintext))).toBe(true);

    await contentStore.close(bookId);

    // The reopen is the whole point — this is what threw DECRYPTION_FAILED before.
    await contentStore.openSession(bookId);
    expect(Buffer.from(await contentStore.decryptBook(bookId)).equals(Buffer.from(plaintext))).toBe(true);
  });

  it('ELITE: destroy() IS still terminal — the exemption is scoped to close()', async () => {
    const bookId = 'elite-destroy-terminal';
    await storeEliteBook(bookId, plaintextOf(512, 'destroyed for good'));

    await contentStore.openSession(bookId);
    await contentStore.decryptBook(bookId);
    await contentStore.destroy(bookId);

    await expect(contentStore.openSession(bookId)).rejects.toMatchObject({
      code: ContentError.DECRYPTION_FAILED,
    });
  });

  it('ELITE: close() still zeroes the decrypted plaintext — only the ciphertext is kept', async () => {
    const bookId = 'elite-close-zeroes';
    await storeEliteBook(bookId, plaintextOf(256, 'plaintext must not survive close'));

    await contentStore.openSession(bookId);
    const plaintext = await contentStore.decryptBook(bookId);
    expect(plaintext.some((b) => b !== 0)).toBe(true);

    await contentStore.close(bookId);
    expect(plaintext.every((b) => b === 0)).toBe(true);
  });

  it('SUBSCRIPTION: close() still evicts the cached package — the RAM saving is unchanged', async () => {
    const bookId = 'sub-close-evicts';
    const bek = randomKey();
    const plaintext = plaintextOf(2048, 'persisted, so the cache can go');
    const pkg = await buildEncryptedPackage(bookId, plaintext, bek);
    await storeBek(bookId, bek);
    await contentStore.store(pkg);

    await contentStore.openSession(bookId);
    await contentStore.decryptBook(bookId);
    await contentStore.close(bookId);

    // Proves the reopen came off DISK rather than the cache: decryptBook() empties pkg.content for
    // non-Elite packages, so the cached object could not have served this read.
    await contentStore.openSession(bookId);
    expect(Buffer.from(await contentStore.decryptBook(bookId)).equals(Buffer.from(plaintext))).toBe(true);
  });
});

describe('offline lock revocation signal', () => {
  it('invalidates the local licence and BEK when content.lock fires with reason revoked', async () => {
    const bookId = 'lock-revoked-event';
    const key = randomKey();
    const plaintext = plaintextOf(512, 'revoked via offline lock signal');
    const pkg = await buildEncryptedPackage(bookId, plaintext, key);
    await storeBek(bookId, key);
    await contentStore.store(pkg);

    eventBus.emit(EVENT_CHANNELS.CONTENT_LOCK, {
      type: OFFLINE_LOCK_EVENTS.LOCK,
      bookId,
      reason: 'revoked',
      observedAt: Date.now(),
    });

    await new Promise((resolve) => setImmediate(resolve));
    await expect(getBek(bookId)).rejects.toThrow();
    await expect(getPersistedLicenceStatus(bookId)).resolves.toMatchObject({
      downloaded: true,
      revoked: true,
      licence: null,
    });
  });
});

describe('contentStore — invalidateLicence (revocation without full destroy)', () => {
  it('strips the licence and BEK but leaves ciphertext on disk', async () => {
    const bookId = 'revoke-basic';
    const key = randomKey();
    const plaintext = plaintextOf(512, 'revocable content');
    const pkg = await buildEncryptedPackage(bookId, plaintext, key);
    await storeBek(bookId, key);
    await contentStore.store(pkg);

    expect(await contentStore.isAvailableOffline(bookId)).toBe(true);

    await invalidateLicence(bookId);

    // Ciphertext is still on disk — only the rights layer was stripped.
    expect(await contentStore.isAvailableOffline(bookId)).toBe(false);

    // BEK is gone from the keychain.
    await expect(getBek(bookId)).rejects.toThrow();
  });

  it('getPersistedLicenceStatus returns revoked:true after invalidation', async () => {
    const bookId = 'revoke-status';
    const key = randomKey();
    const pkg = await buildEncryptedPackage(bookId, plaintextOf(256, 'status check'), key);
    await storeBek(bookId, key);
    await contentStore.store(pkg);

    await invalidateLicence(bookId);

    const status = await getPersistedLicenceStatus(bookId);
    expect(status.downloaded).toBe(true);
    expect(status.revoked).toBe(true);
    expect(status.licence).toBeNull();
  });

  it('isAvailableOffline returns false for a revoked book', async () => {
    const bookId = 'revoke-not-available';
    const key = randomKey();
    const pkg = await buildEncryptedPackage(bookId, plaintextOf(256, 'not available'), key);
    await storeBek(bookId, key);
    await contentStore.store(pkg);

    await invalidateLicence(bookId);

    expect(await contentStore.isAvailableOffline(bookId)).toBe(false);
  });

  it('is idempotent — invalidating twice does not throw', async () => {
    const bookId = 'revoke-idempotent';
    const key = randomKey();
    const pkg = await buildEncryptedPackage(bookId, plaintextOf(256, 'idempotent'), key);
    await storeBek(bookId, key);
    await contentStore.store(pkg);

    await invalidateLicence(bookId);
    await expect(invalidateLicence(bookId)).resolves.toBeUndefined();
  });

  it('does not affect a different book', async () => {
    const bookA = 'revoke-isolated-a';
    const bookB = 'revoke-isolated-b';
    const key = randomKey();
    const pkgA = await buildEncryptedPackage(bookA, plaintextOf(256, 'book A'), key);
    const pkgB = await buildEncryptedPackage(bookB, plaintextOf(256, 'book B'), key);
    await storeBek(bookA, key);
    await storeBek(bookB, key);
    await contentStore.store(pkgA);
    await contentStore.store(pkgB);

    await invalidateLicence(bookA);

    expect(await contentStore.isAvailableOffline(bookA)).toBe(false);
    expect(await contentStore.isAvailableOffline(bookB)).toBe(true);
  });

  it('does not strip licence for a genuinely open-access book (no encryption)', async () => {
    const bookId = 'revoke-open-access';
    const plaintext = plaintextOf(256, 'open access, no licence to revoke');
    await contentStore.store(openAccessPackage(bookId, plaintext));

    const statusBefore = await getPersistedLicenceStatus(bookId);
    expect(statusBefore.downloaded).toBe(true);
    expect(statusBefore.revoked).toBe(false);
    expect(statusBefore.licence).toBeNull();

    // invalidateLicence on a book with no meta.licence is a no-op (no BEK to delete, no
    // licence to strip) — but it must not corrupt the persisted metadata.
    await invalidateLicence(bookId);

    const statusAfter = await getPersistedLicenceStatus(bookId);
    expect(statusAfter.downloaded).toBe(true);
    expect(statusAfter.revoked).toBe(false);
    expect(statusAfter.licence).toBeNull();
  });

  it('decryptBook() after invalidateLicence() rejects with KEYSTORE_UNAVAILABLE', async () => {
    const bookId = 'revoke-decrypt-fails';
    const key = randomKey();
    const plaintext = plaintextOf(512, 'cannot decrypt after revoke');
    const pkg = await buildEncryptedPackage(bookId, plaintext, key);
    await storeBek(bookId, key);
    await contentStore.store(pkg);

    await invalidateLicence(bookId);

    await contentStore.openSession(bookId);
    await expect(contentStore.decryptBook(bookId)).rejects.toMatchObject({
      code: ContentError.KEYSTORE_UNAVAILABLE,
    });
  });
});
