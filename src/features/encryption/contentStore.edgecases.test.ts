// Adversarial edge-case probes for contentStore.ts, written AFTER reading the existing
// contentStore.test.ts (which already covers the happy paths + the documented gaps: unwrapBek
// stub -> KEYSTORE_UNAVAILABLE, and licence.signature not verified). This file hunts for bugs
// the existing suite doesn't exercise: double-store, double-open, boundary sizes, weird bookIds,
// concurrency, cross-session independence, and type-legal-but-contract-weird field combos.
//
// Same mocking setup as contentStore.test.ts: real AES-256-GCM (Node crypto) via
// __mocks__/react-native-aes-gcm-crypto.js, real file I/O (Node fs, temp dir) via
// __mocks__/expo-file-system.js, in-memory Map via __mocks__/react-native-keychain.js.

import * as crypto from 'crypto';
import * as Keychain from 'react-native-keychain';
import { File, Directory, Paths } from 'expo-file-system';
import { encrypt } from './aesGcm';
import { getBek, storeBek } from './keyStorage';
import { generateDeviceKeypair, wrapBek } from './deviceKeypair';
import { contentStore, MAX_DECRYPTED_BYTES } from './contentStore';
import { ContentError } from '@/shared/contracts';
import type { EncryptedPackage, SignedLicence } from '@/shared/contracts';

// Matches deviceKeypair.ts's internal constant — duplicated here only for the scoped keychain
// cleanup in the stale-cached-BEK block below (deviceKeypair.ts exposes no reset of its own).
const DEVICE_PRIVATE_KEY_SERVICE = 'tf-reader-device-private-key';

// Mirrors contentStore.ts's own private path helper so this test file can check disk state
// directly (whether a stale file was left behind), without contentStore.ts exporting internals.
const STORE_DIR = new Directory(Paths.document, 'tf-reader-content');
function indexFilePath(bookId: string): File {
  return new File(STORE_DIR, `${encodeURIComponent(bookId)}.index.bin`);
}

function randomKey(): Uint8Array {
  return new Uint8Array(crypto.randomBytes(32));
}

function plaintextOf(sizeBytes: number, seed: string): Uint8Array {
  const buf = Buffer.alloc(sizeBytes);
  Buffer.from(seed, 'utf8').copy(buf);
  return new Uint8Array(buf);
}

function licenceFor(bookId: string, overrides: Partial<SignedLicence> = {}): SignedLicence {
  return {
    licenceId: `lic-${bookId}`,
    itemId: bookId,
    keyFingerprint: 'sha256:test-fingerprint',
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    canPersist: true,
    rights: { print: false },
    signature: { alg: 'RS256', kid: 'k1', value: 'unverified-in-this-test' },
    ...overrides,
  };
}

async function buildEncryptedPackage(
  bookId: string,
  plaintext: Uint8Array,
  key: Uint8Array,
  licenceOverrides: Partial<SignedLicence> = {},
  opts: { withLicence?: boolean; index?: Uint8Array } = {}
): Promise<EncryptedPackage> {
  const payload = await encrypt(plaintext, key);
  const withLicence = opts.withLicence !== false;
  return {
    bookId,
    format: 'EPUB',
    content: payload.content,
    index: opts.index,
    encryption: {
      algorithm: 'AES-256-GCM',
      layout: 'nonce(12) || ciphertext || tag(16)',
      wrappedBek: 'not-a-real-wrap-in-this-test',
      wrapAlgorithm: 'RSA-OAEP-256',
      keyId: 'master-v1',
      keyFingerprint: 'sha256:test-fingerprint',
    },
    licence: withLicence ? licenceFor(bookId, licenceOverrides) : null,
    cipherLength: payload.cipherLength,
    originalLength: payload.originalLength,
    mimeType: 'application/epub+zip',
  };
}

function openAccessPackage(bookId: string, plaintext: Uint8Array): EncryptedPackage {
  return {
    bookId,
    format: 'AUDIO',
    content: plaintext,
    encryption: null,
    licence: null,
    cipherLength: plaintext.length,
    originalLength: plaintext.length,
    mimeType: 'audio/mpeg',
  };
}

describe('EDGE: openSession idempotency', () => {
  it('calling openSession twice returns the same handle, and decryptBook after both calls still decrypts once (cached)', async () => {
    const bookId = 'edge-opensession-twice';
    const key = randomKey();
    const plaintext = plaintextOf(300, 'open twice');
    const pkg = await buildEncryptedPackage(bookId, plaintext, key);
    await storeBek(bookId, key);
    await contentStore.store(pkg);

    const h1 = await contentStore.openSession(bookId);
    const h2 = await contentStore.openSession(bookId);
    expect(h2).toBe(h1); // same handle object — genuinely idempotent, not just equal
    expect(h2.openedAt).toBe(h1.openedAt);

    const d1 = await contentStore.decryptBook(bookId);
    const d2 = await contentStore.decryptBook(bookId);
    expect(d2).toBe(d1); // cached — repeat calls do not re-decrypt
    expect(Buffer.from(d1).equals(Buffer.from(plaintext))).toBe(true);
  });
});

describe('EDGE: store() called twice (re-download / update)', () => {
  it('second store() overwrites ciphertext on disk; decryptBook (fresh session) gets the NEW content', async () => {
    const bookId = 'edge-double-store';
    const key1 = randomKey();
    const key2 = randomKey();
    const plaintextA = plaintextOf(200, 'version A');
    const plaintextB = plaintextOf(400, 'version B, longer this time');

    const pkgA = await buildEncryptedPackage(bookId, plaintextA, key1);
    await storeBek(bookId, key1);
    await contentStore.store(pkgA);

    // Re-download: new ciphertext, new key.
    const pkgB = await buildEncryptedPackage(bookId, plaintextB, key2);
    await storeBek(bookId, key2);
    await contentStore.store(pkgB);

    await contentStore.openSession(bookId);
    const decrypted = await contentStore.decryptBook(bookId);
    expect(Buffer.from(decrypted).equals(Buffer.from(plaintextB))).toBe(true);
  });

  it('an ALREADY-OPEN session keeps decrypting the version that was current when decryptBook first ran (session-cached), even after a later store()', async () => {
    const bookId = 'edge-double-store-open-session';
    const key1 = randomKey();
    const key2 = randomKey();
    const plaintextA = plaintextOf(200, 'first version');
    const plaintextB = plaintextOf(200, 'second version');

    const pkgA = await buildEncryptedPackage(bookId, plaintextA, key1);
    await storeBek(bookId, key1);
    await contentStore.store(pkgA);

    await contentStore.openSession(bookId);
    const firstDecrypt = await contentStore.decryptBook(bookId);
    expect(Buffer.from(firstDecrypt).equals(Buffer.from(plaintextA))).toBe(true);

    // Update arrives while the session is open.
    const pkgB = await buildEncryptedPackage(bookId, plaintextB, key2);
    await storeBek(bookId, key2);
    await contentStore.store(pkgB);

    // decryptBook on the SAME (already-open, already-decrypted) session returns the cached
    // plaintext from before the update — documented behavior (session caches on first decrypt),
    // not a bug, but worth pinning down explicitly.
    const stillFirst = await contentStore.decryptBook(bookId);
    expect(Buffer.from(stillFirst).equals(Buffer.from(plaintextA))).toBe(true);

    // A brand new session (post-update) does see the new version.
    await contentStore.close(bookId);
    await contentStore.openSession(bookId);
    const newDecrypt = await contentStore.decryptBook(bookId);
    expect(Buffer.from(newDecrypt).equals(Buffer.from(plaintextB))).toBe(true);
  });

  it('re-storing WITHOUT an index after previously storing WITH one does not leave a stale index file readable by a later loadPersisted', async () => {
    const bookId = 'edge-stale-index';
    const key = randomKey();
    const plaintext = plaintextOf(200, 'has index then loses it');
    const index = plaintextOf(50, 'search index bytes');

    const pkgWithIndex = await buildEncryptedPackage(bookId, plaintext, key, {}, { index });
    await storeBek(bookId, key);
    await contentStore.store(pkgWithIndex);
    expect(await contentStore.isAvailableOffline(bookId)).toBe(true);
    expect(indexFilePath(bookId).exists).toBe(true);

    const key2 = randomKey();
    const pkgNoIndex = await buildEncryptedPackage(bookId, plaintext, key2, {}, { index: undefined });
    await storeBek(bookId, key2);
    await contentStore.store(pkgNoIndex);

    // The book no longer has an index (pkg.index is undefined this time). store() must not leave
    // the PREVIOUS store()'s index file sitting on disk — that would be a stale-file / disk-space
    // leak: the metadata says hasIndex:false but a `<bookId>.index.bin` orphan still exists.
    expect(indexFilePath(bookId).exists).toBe(false);

    // destroy() should also still clean up correctly regardless.
    await contentStore.destroy(bookId);
    expect(await contentStore.isAvailableOffline(bookId)).toBe(false);
    expect(indexFilePath(bookId).exists).toBe(false);
  });
});

// Both double-store tests above call storeBek(bookId, key2) by hand before the second store(),
// which quietly repairs the BEK cache and so never exercises what a REAL re-download does: hand
// contentStore a new wrappedBek and let resolveRawKey() work it out. This block removes that
// crutch and pins down what actually happens.
//
// Found on device (iOS simulator, 2026-08-12) while probing the licence-expiry gate: an expired
// licence makes isAvailableOffline() false, devContentSeed's ensureSeeded() re-seeds with a fresh
// random BEK, and the book then failed INTEGRITY_FAILED permanently.
describe('EDGE: re-store with a NEW BEK, no manual storeBek — the stale-cached-BEK trap', () => {
  // deviceKeypair.ts's keychain entry is a single global service, not scoped per bookId like the
  // BEK cache — same scoped cleanup contentStore.test.ts's real-keypair block uses.
  afterEach(async () => {
    await Keychain.resetGenericPassword({ service: DEVICE_PRIVATE_KEY_SERVICE });
  });

  it('DOCUMENTS A DEFECT: the stale cached BEK wins over the new wrappedBek, so the re-stored book fails INTEGRITY_FAILED — destroy() before store() is the only way through', async () => {
    const bookId = 'edge-restore-stale-cached-bek';
    const bekA = randomKey();
    const bekB = randomKey();
    const plaintextA = plaintextOf(256, 'version A, first download');
    const plaintextB = plaintextOf(256, 'version B, re-download with a new BEK');

    const { publicKey } = await generateDeviceKeypair();

    const pkgA = await buildEncryptedPackage(bookId, plaintextA, bekA);
    pkgA.encryption = { ...pkgA.encryption!, wrappedBek: await wrapBek(bekA, publicKey) };
    await contentStore.store(pkgA);
    await contentStore.openSession(bookId);
    expect(Buffer.from(await contentStore.decryptBook(bookId)).equals(Buffer.from(plaintextA))).toBe(
      true
    );

    // That successful unwrap wrote bekA into the keychain (resolveRawKey's documented caching for
    // non-Elite tiers). The trap is now armed.
    expect(Buffer.from(await getBek(bookId)).equals(Buffer.from(bekA))).toBe(true);
    await contentStore.close(bookId);

    // A genuine re-download: new ciphertext under bekB, new wrappedBek, nothing pre-cached.
    const pkgB = await buildEncryptedPackage(bookId, plaintextB, bekB);
    pkgB.encryption = { ...pkgB.encryption!, wrappedBek: await wrapBek(bekB, publicKey) };
    await contentStore.store(pkgB);
    await contentStore.openSession(bookId);

    // THE DEFECT. store() does not invalidate the cached BEK, and resolveRawKey() prefers the
    // cache over unwrapping — so bekA decrypts bekB's ciphertext, the GCM tag fails, and the book
    // is unreadable from here on. Not a transient error: every later session repeats it, because
    // nothing in the read path ever falls back to the wrappedBek that would have worked.
    await expect(contentStore.decryptBook(bookId)).rejects.toMatchObject({
      code: ContentError.INTEGRITY_FAILED,
    });

    // The only escape, and what devContentSeed.ts's ensureSeeded() therefore does: destroy()
    // BEFORE store(). destroy() calls deleteBek, which clears the cache, so the very same package
    // now unwraps bekB for real and decrypts.
    await contentStore.destroy(bookId);
    await contentStore.store(pkgB);
    await contentStore.openSession(bookId);
    expect(Buffer.from(await contentStore.decryptBook(bookId)).equals(Buffer.from(plaintextB))).toBe(
      true
    );
  });
});

describe('EDGE: destroy/close idempotency on never-stored or already-closed books', () => {
  it('destroy() on a book that was never stored resolves cleanly (no throw)', async () => {
    await expect(contentStore.destroy('never-stored-book')).resolves.toBeUndefined();
  });

  it('close() on a book that was never opened resolves cleanly (no throw)', async () => {
    await expect(contentStore.close('never-opened-book')).resolves.toBeUndefined();
  });

  it('destroy() called twice in a row is idempotent', async () => {
    const bookId = 'edge-double-destroy';
    const key = randomKey();
    const pkg = await buildEncryptedPackage(bookId, plaintextOf(100, 'destroy twice'), key);
    await storeBek(bookId, key);
    await contentStore.store(pkg);

    await contentStore.destroy(bookId);
    await expect(contentStore.destroy(bookId)).resolves.toBeUndefined();
    expect(await contentStore.isAvailableOffline(bookId)).toBe(false);
  });

  it('close() called twice in a row after an active decrypt is idempotent', async () => {
    const bookId = 'edge-double-close';
    const key = randomKey();
    const pkg = await buildEncryptedPackage(bookId, plaintextOf(100, 'close twice'), key);
    await storeBek(bookId, key);
    await contentStore.store(pkg);
    await contentStore.openSession(bookId);
    await contentStore.decryptBook(bookId);

    await contentStore.close(bookId);
    await expect(contentStore.close(bookId)).resolves.toBeUndefined();
  });
});

describe('EDGE: zero-length and boundary sizes', () => {
  it('an empty (originalLength === 0) encrypted book round-trips correctly', async () => {
    const bookId = 'edge-empty-encrypted';
    const key = randomKey();
    const plaintext = plaintextOf(0, '');
    const pkg = await buildEncryptedPackage(bookId, plaintext, key);
    await storeBek(bookId, key);

    await contentStore.store(pkg);
    await contentStore.openSession(bookId);
    const decrypted = await contentStore.decryptBook(bookId);
    expect(decrypted.length).toBe(0);
  });

  it('an empty (originalLength === 0) open-access book round-trips correctly', async () => {
    const bookId = 'edge-empty-open-access';
    const plaintext = plaintextOf(0, '');
    await contentStore.store(openAccessPackage(bookId, plaintext));
    await contentStore.openSession(bookId);
    const decrypted = await contentStore.decryptBook(bookId);
    expect(decrypted.length).toBe(0);
  });

  it('a book exactly AT MAX_DECRYPTED_BYTES succeeds (off-by-one check: > not >=)', async () => {
    const bookId = 'edge-exactly-max';
    const key = randomKey();
    const plaintext = plaintextOf(MAX_DECRYPTED_BYTES, 'exactly at the budget boundary');
    const pkg = await buildEncryptedPackage(bookId, plaintext, key);
    await storeBek(bookId, key);

    await contentStore.store(pkg);
    await contentStore.openSession(bookId);
    const decrypted = await contentStore.decryptBook(bookId);
    expect(decrypted.length).toBe(MAX_DECRYPTED_BYTES);
  }, 30_000);
});

describe('EDGE: unusual bookId values (filename safety)', () => {
  const weirdIds = ['', 'has/a/slash', 'dots..here', '../../etc/passwd', 'unicode-👍-书', 'has spaces here', 'a%2Fb'];

  it.each(weirdIds)('round-trips a book stored under bookId=%j without corrupting other books', async (bookId) => {
    const key = randomKey();
    const plaintext = plaintextOf(64, `weird id: ${bookId}`);
    const pkg = await buildEncryptedPackage(bookId, plaintext, key);
    await storeBek(bookId, key);

    await contentStore.store(pkg);
    expect(await contentStore.isAvailableOffline(bookId)).toBe(true);
    await contentStore.openSession(bookId);
    const decrypted = await contentStore.decryptBook(bookId);
    expect(Buffer.from(decrypted).equals(Buffer.from(plaintext))).toBe(true);
  });

  it('two different weird bookIds that could theoretically collide after encoding do NOT share a file', async () => {
    // NOTE: these must be bookIds NOT used by the it.each above (whose sessions are still open in
    // the module-level `sessions` map — that map is never reset between tests in this file, so
    // reusing one of those ids would read back an already-cached session/plaintext from the
    // earlier test, not a fresh collision check).
    const idA = 'collide-a/b';
    const idB = 'collide-a%2Fb'; // idA encodes to "collide-a%2Fb.content.bin"; idB is the LITERAL string "collide-a%2Fb"
    const keyA = randomKey();
    const keyB = randomKey();
    const plaintextA = plaintextOf(50, 'book A contents');
    const plaintextB = plaintextOf(50, 'book B contents');

    const pkgA = await buildEncryptedPackage(idA, plaintextA, keyA);
    const pkgB = await buildEncryptedPackage(idB, plaintextB, keyB);
    await storeBek(idA, keyA);
    await storeBek(idB, keyB);

    await contentStore.store(pkgA);
    await contentStore.store(pkgB);

    await contentStore.openSession(idA);
    await contentStore.openSession(idB);
    const decA = await contentStore.decryptBook(idA);
    const decB = await contentStore.decryptBook(idB);

    expect(Buffer.from(decA).equals(Buffer.from(plaintextA))).toBe(true);
    expect(Buffer.from(decB).equals(Buffer.from(plaintextB))).toBe(true);
  });
});

describe('EDGE: concurrent decryptBook calls on the same session', () => {
  it('two concurrent decryptBook() calls both resolve to correct, equal-content buffers', async () => {
    const bookId = 'edge-concurrent-decrypt';
    const key = randomKey();
    const plaintext = plaintextOf(2048, 'concurrent decrypt race');
    const pkg = await buildEncryptedPackage(bookId, plaintext, key);
    await storeBek(bookId, key);
    await contentStore.store(pkg);
    await contentStore.openSession(bookId);

    const [d1, d2] = await Promise.all([contentStore.decryptBook(bookId), contentStore.decryptBook(bookId)]);

    expect(Buffer.from(d1).equals(Buffer.from(plaintext))).toBe(true);
    expect(Buffer.from(d2).equals(Buffer.from(plaintext))).toBe(true);
  });

  it('after close(), NEITHER buffer returned by a concurrent decryptBook() race still holds live plaintext', async () => {
    const bookId = 'edge-concurrent-decrypt-close';
    const key = randomKey();
    const plaintext = plaintextOf(2048, 'concurrent then close');
    const pkg = await buildEncryptedPackage(bookId, plaintext, key);
    await storeBek(bookId, key);
    await contentStore.store(pkg);
    await contentStore.openSession(bookId);

    const [d1, d2] = await Promise.all([contentStore.decryptBook(bookId), contentStore.decryptBook(bookId)]);
    await contentStore.close(bookId);

    // Both buffers returned to callers during the race must be zeroed by close() — if the store
    // only zeroes whichever buffer happened to win the race and got assigned to session.plaintext,
    // the LOSING buffer (still held by whichever caller received it) would silently keep live
    // plaintext in RAM after "close". That would violate close()'s "zero its buffer" contract for
    // one of the two concurrent callers.
    const d1Zeroed = d1.every((b) => b === 0);
    const d2Zeroed = d2.every((b) => b === 0);
    expect(d1Zeroed).toBe(true);
    expect(d2Zeroed).toBe(true);
  });
});

describe('EDGE: multiple independent sessions', () => {
  it('closing/destroying one book does not affect a second, independently-open book', async () => {
    const bookIdA = 'edge-multi-a';
    const bookIdB = 'edge-multi-b';
    const keyA = randomKey();
    const keyB = randomKey();
    const plaintextA = plaintextOf(100, 'book A');
    const plaintextB = plaintextOf(100, 'book B');

    const pkgA = await buildEncryptedPackage(bookIdA, plaintextA, keyA);
    const pkgB = await buildEncryptedPackage(bookIdB, plaintextB, keyB);
    await storeBek(bookIdA, keyA);
    await storeBek(bookIdB, keyB);
    await contentStore.store(pkgA);
    await contentStore.store(pkgB);

    await contentStore.openSession(bookIdA);
    await contentStore.openSession(bookIdB);
    const decA = await contentStore.decryptBook(bookIdA);
    const decB = await contentStore.decryptBook(bookIdB);

    await contentStore.destroy(bookIdA);

    expect(await contentStore.isAvailableOffline(bookIdA)).toBe(false);
    expect(await contentStore.isAvailableOffline(bookIdB)).toBe(true);

    // Book B's session and its already-decrypted buffer are untouched by A's destroy().
    expect(decB.every((b) => b === 0)).toBe(false);
    expect(Buffer.from(decB).equals(Buffer.from(plaintextB))).toBe(true);
    // (decA is not asserted zeroed here — destroy() closes A's session, which does zero it; that
    // is covered by the close() tests. This test's point is isolation, not re-testing zeroing.)
    void decA;
  });
});

describe('EDGE: re-opening a second, independent session for the same book after close()', () => {
  it('the newly decrypted buffer is independent of the first (already-zeroed) one — no aliasing', async () => {
    const bookId = 'edge-reopen-no-alias';
    const key = randomKey();
    const plaintext = plaintextOf(512, 'reopen independence check');
    const pkg = await buildEncryptedPackage(bookId, plaintext, key);
    await storeBek(bookId, key);
    await contentStore.store(pkg);

    await contentStore.openSession(bookId);
    const first = await contentStore.decryptBook(bookId);
    await contentStore.close(bookId); // zeroes `first` in place

    expect(first.every((b) => b === 0)).toBe(true);

    await contentStore.openSession(bookId);
    const second = await contentStore.decryptBook(bookId);

    expect(second).not.toBe(first);
    expect(Buffer.from(second).equals(Buffer.from(plaintext))).toBe(true);
    // Zeroing `first` must not have corrupted `second` (would happen if they shared a buffer, or
    // if `second` aliased the same underlying ciphertext/plaintext object as `first`).
    expect(second.every((b) => b === 0)).toBe(false);
  });

  it('OPEN ACCESS: closing a session must not zero the persisted/cached package content, corrupting a later re-open of the SAME book', async () => {
    const bookId = 'edge-open-access-reopen-no-corruption';
    const original = plaintextOf(512, 'open access must survive close()');
    // Defensive copy: `openAccessPackage` stores `original` BY REFERENCE as pkg.content, and if
    // decryptBook() aliases session.plaintext to that same array (rather than copying), close()
    // would zero `original` too — comparing against `original` after that point would then be a
    // vacuous zeros-equal-zeros check. `expected` is a separate array, immune to that aliasing.
    const expected = new Uint8Array(original);

    await contentStore.store(openAccessPackage(bookId, original));

    await contentStore.openSession(bookId);
    const first = await contentStore.decryptBook(bookId);
    expect(Buffer.from(first).equals(Buffer.from(expected))).toBe(true);

    await contentStore.close(bookId); // must zero ONLY the session's own buffer

    await contentStore.openSession(bookId);
    const second = await contentStore.decryptBook(bookId);

    // If decryptBook() for open-access books aliases session.plaintext directly to pkg.content
    // (rather than copying), then close()'s `session.plaintext.fill(0)` zeroes the SAME array
    // object that packageCache still holds as pkg.content, and this second decrypt would come
    // back all zeros instead of the real content.
    expect(Buffer.from(second).equals(Buffer.from(expected))).toBe(true);
  });
});

describe('EDGE: type-legal but contract-inconsistent field combinations', () => {
  it('encryption present but licence null: store() rejects — an encrypted package with no licence would never have its expiry enforced', async () => {
    const bookId = 'edge-encryption-no-licence';
    const key = randomKey();
    const plaintext = plaintextOf(128, 'encrypted with no licence at all');
    const pkg = await buildEncryptedPackage(bookId, plaintext, key, {}, { withLicence: false });
    await storeBek(bookId, key);

    // Without a licence, isLicenceExpired() trivially returns false forever (it short-circuits
    // on `!pkg.licence`), so a package like this would decrypt with NO expiry check, ever. That
    // contradicts the contract's SignedLicence doc ("null ⇒ open access (no licence)") for a
    // package that is NOT open access (encryption is non-null here). store() must reject this
    // combination rather than silently accept crypto material with no rights/expiry attached.
    await expect(contentStore.store(pkg)).rejects.toMatchObject({
      code: ContentError.LICENCE_INVALID,
    });
  });
});

describe('EDGE: licence.expiresAt boundary conditions', () => {
  it('exactly-at-expiry (Date.now() === expiresAt) is treated as expired, not a one-instant-early pass', async () => {
    const bookId = 'edge-licence-exact-boundary';
    const key = randomKey();
    const now = Date.now();
    const pkg = await buildEncryptedPackage(bookId, plaintextOf(64, 'exact boundary'), key, {
      expiresAt: new Date(now).toISOString(),
    });
    await storeBek(bookId, key);
    await contentStore.store(pkg);
    await contentStore.openSession(bookId);

    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    try {
      await expect(contentStore.decryptBook(bookId)).rejects.toMatchObject({
        code: ContentError.LICENCE_EXPIRED,
      });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('a malformed (unparseable) licence.expiresAt string must NOT be treated as "never expires" — fail closed, not open', async () => {
    const bookId = 'edge-licence-malformed-expiresat';
    const key = randomKey();
    // new Date('not-a-real-date').getTime() is NaN, and `Date.now() >= NaN` is always false, so
    // isLicenceExpired()'s naive comparison would let this book decrypt FOREVER, on every future
    // call, no matter how far in the future "now" is. A corrupted/malformed expiry field must
    // deny (fail closed, per errors.ts's own rule), not silently grant unlimited access.
    const pkg = await buildEncryptedPackage(bookId, plaintextOf(64, 'malformed expiry'), key, {
      expiresAt: 'not-a-real-date',
    });
    await storeBek(bookId, key);

    await expect(contentStore.store(pkg)).rejects.toMatchObject({
      code: ContentError.LICENCE_INVALID,
    });
  });

  it('an empty-string licence.expiresAt is rejected the same way (also NaN under Date parsing)', async () => {
    const bookId = 'edge-licence-empty-expiresat';
    const key = randomKey();
    const pkg = await buildEncryptedPackage(bookId, plaintextOf(64, 'empty expiry'), key, {
      expiresAt: '',
    });
    await storeBek(bookId, key);

    await expect(contentStore.store(pkg)).rejects.toMatchObject({
      code: ContentError.LICENCE_INVALID,
    });
  });
});

describe('EDGE: Elite tier — persistence really does not survive a process restart', () => {
  it('after jest.resetModules() (simulating a fresh process), an Elite book is unrecoverable: isAvailableOffline false AND openSession rejects', async () => {
    jest.resetModules();
    // Re-import everything fresh so this test's contentStore module has brand-new, empty
    // module-level Maps — the closest thing to "process restart" achievable inside one Jest file.
    /* eslint-disable @typescript-eslint/no-require-imports */
    const freshAesGcm = require('./aesGcm');
    const freshKeyStorage = require('./keyStorage');
    const freshContentStore = require('./contentStore');
    /* eslint-enable @typescript-eslint/no-require-imports */

    const bookId = 'edge-elite-restart';
    const key = randomKey();
    const plaintext = plaintextOf(256, 'elite must not survive restart');
    const payload = await freshAesGcm.encrypt(plaintext, key);
    const pkg = {
      bookId,
      format: 'EPUB',
      content: payload.content,
      encryption: {
        algorithm: 'AES-256-GCM',
        layout: 'nonce(12) || ciphertext || tag(16)',
        wrappedBek: 'not-a-real-wrap',
        wrapAlgorithm: 'RSA-OAEP-256',
        keyId: 'master-v1',
        keyFingerprint: 'sha256:test-fingerprint',
      },
      licence: licenceFor(bookId, { canPersist: false }),
      cipherLength: payload.cipherLength,
      originalLength: payload.originalLength,
      mimeType: 'application/epub+zip',
    };
    await freshKeyStorage.storeBek(bookId, key);
    await freshContentStore.contentStore.store(pkg);

    // Before "restart": works fine in-memory.
    expect(await freshContentStore.contentStore.isAvailableOffline(bookId)).toBe(false);

    jest.resetModules();
    /* eslint-disable @typescript-eslint/no-require-imports */
    const restartedContentStore = require('./contentStore');
    /* eslint-enable @typescript-eslint/no-require-imports */

    expect(await restartedContentStore.contentStore.isAvailableOffline(bookId)).toBe(false);
    await expect(restartedContentStore.contentStore.openSession(bookId)).rejects.toMatchObject({
      code: ContentError.DECRYPTION_FAILED,
    });
  });
});

// Sanity re-import so later files in the same worker aren't left on a resetModules()'d
// contentStore instance (jest.resetModules() above only affects require() cache, not this
// file's already-bound top-level `contentStore` import, but keep this explicit for clarity).
describe('EDGE: sanity — this file’s own top-level contentStore import still works after resetModules() elsewhere', () => {
  it('smoke test', async () => {
    const bookId = 'edge-post-reset-smoke';
    await contentStore.store(openAccessPackage(bookId, plaintextOf(16, 'ok')));
    expect(await contentStore.isAvailableOffline(bookId)).toBe(true);
  });
});
