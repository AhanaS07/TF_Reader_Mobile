// Owner: Encryption (Abhinav). Hand-off artifact for Ahana (ContentProvider/Reader).
//
// Implements the frozen `ContentStore` contract (src/shared/contracts/content-provider.ts):
// whole-book AES-256-GCM decrypt into RAM, GCM tag verified by the real native module (aesGcm.ts),
// plaintext NEVER written to disk. Ciphertext + licence metadata persist to the filesystem —
// Subscription only. Elite (licence.canPersist === false) stays in-memory for the process
// lifetime only, per the contract's "Elite writes nothing."
//
// NOTE on the task that produced this file: it was framed as "decryptWindow(chapterIndex)", but
// the frozen contract has no chapter windowing — BuildPlan.md's own 2026-08-11 amendment replaced
// windowed/chunked decrypt with whole-file decrypt, and content-provider.ts's header says so
// explicitly ("No chunking, no partial decryption... do not re-litigate"). This file implements
// the actual frozen method, `decryptBook(bookId)`, rather than reintroducing chapter addressing.
//
// UPDATE 2026-08-11: RSA-OAEP-256 unwrap (deviceKeypair.ts's `unwrapBek`) is REAL now
// (react-native-quick-crypto) — decryptBook() below calls it directly, no stub in the path
// anymore. A book whose raw BEK isn't already cached (via keyStorage.ts) now genuinely unwraps
// via RSA-OAEP-256 instead of always rejecting; see contentStore.test.ts's
// "end-to-end via the real device keypair" block for the proof (generateDeviceKeypair -> wrapBek
// -> store -> decryptBook, no shortcuts). ContentFailure(KEYSTORE_UNAVAILABLE) still fires for
// the genuinely-unavailable cases: no device keypair generated yet, or a wrappedBek that doesn't
// decrypt under this device's key (wrong device, corrupted value).
//
// STILL NOT implemented here: licence SIGNATURE verification (RS256) — expiry is checked for
// real below, signature is not (no RS256-verify library wired in yet). Don't mistake "expiry
// checked" for "licence verified."
//
// RAM budget: MAX_DECRYPTED_BYTES is a hard, enforced cap (checked before AND after decrypt), per
// this task's "<25MB" directive. BuildPlan.md Phase 9.3 already flags 25MB as possibly
// unrealistic for real whole-book payloads long-term (see docs/build-status.md) — kept as the
// stated target here, not silently widened.

import { Directory, File, Paths } from 'expo-file-system';
import type { BookId, ContentStore, EncryptedPackage, SessionHandle } from '@/shared/contracts';
import { ContentError, ContentFailure } from '@/shared/contracts';
import { decrypt, decryptBook as decryptRaw } from './aesGcm';
import { NONCE_BYTES, GCM_TAG_BYTES } from './cipherLayout';
import { deleteBek, getBek, storeBek } from './keyStorage';
import { unwrapBek } from './deviceKeypair';

export const MAX_DECRYPTED_BYTES = 25 * 1024 * 1024; // 25 MB whole-book RAM budget (frozen for this task)

const STORE_DIR = new Directory(Paths.document, 'tf-reader-content');

function contentFile(bookId: BookId): File {
  return new File(STORE_DIR, `${encodeURIComponent(bookId)}.content.bin`);
}
function indexFile(bookId: BookId): File {
  return new File(STORE_DIR, `${encodeURIComponent(bookId)}.index.bin`);
}
function metaFile(bookId: BookId): File {
  return new File(STORE_DIR, `${encodeURIComponent(bookId)}.meta.json`);
}

// Everything in EncryptedPackage except the raw bytes (content/index), which are written as
// their own binary files instead of base64-inflated inside JSON.
interface PersistedMeta {
  bookId: BookId;
  format: EncryptedPackage['format'];
  encryption: EncryptedPackage['encryption'];
  licence: EncryptedPackage['licence'];
  cipherLength: number;
  originalLength: number;
  mimeType: string;
  hasIndex: boolean;
}

function writeFile(file: File, content: string | Uint8Array): void {
  if (!file.parentDirectory.exists) {
    file.parentDirectory.create({ intermediates: true });
  }
  if (file.exists) {
    file.delete();
  }
  file.create();
  file.write(content);
}

// "false ⇒ Elite, memory-only, no keystore write" (SignedLicence.canPersist). No licence at all
// is open access, which DOES persist — there is no key material to protect by keeping it memory-only.
function isElite(pkg: EncryptedPackage): boolean {
  return pkg.licence !== null && pkg.licence.canPersist === false;
}

function isLicenceExpired(pkg: EncryptedPackage): boolean {
  if (!pkg.licence) return false;
  return Date.now() >= new Date(pkg.licence.expiresAt).getTime();
}

function assertLengthInvariant(pkg: EncryptedPackage): void {
  const hasCipher = pkg.encryption !== null;
  // Open access / audio: `content` IS the plaintext (never AES-GCM'd), so there is no
  // nonce/tag overhead to account for.
  const expected = hasCipher ? NONCE_BYTES + pkg.originalLength + GCM_TAG_BYTES : pkg.originalLength;

  if (pkg.content.length !== pkg.cipherLength || pkg.cipherLength !== expected) {
    throw new ContentFailure(
      ContentError.INTEGRITY_FAILED,
      pkg.bookId,
      new Error(
        `length invariant violated: content.length=${pkg.content.length}, cipherLength=${pkg.cipherLength}, ` +
          `expected ${expected} (encrypted=${hasCipher})`
      )
    );
  }
}

function assertLicenceMatchesPackage(pkg: EncryptedPackage): void {
  // An encrypted package with NO licence at all would never have an expiry (or anything else)
  // enforced: isLicenceExpired() short-circuits to "not expired" when pkg.licence is null, so
  // this combination — type-legal, since `licence` and `encryption` are independently nullable —
  // would let crypto material live forever with no rights attached. SignedLicence's own doc says
  // "null ⇒ open access (no licence)"; a package that IS encrypted is not open access, so it must
  // ship a licence. Reject loudly rather than silently accept it.
  if (pkg.encryption && !pkg.licence) {
    throw new ContentFailure(
      ContentError.LICENCE_INVALID,
      pkg.bookId,
      new Error('encrypted package has no licence — an encrypted book must ship a SignedLicence')
    );
  }
  if (!pkg.licence) return;
  // `new Date(x).getTime()` is NaN for an unparseable/missing expiresAt, and `Date.now() >= NaN`
  // is always false — isLicenceExpired() would silently treat a malformed expiry as "never
  // expires" (unlimited access) rather than denying it, violating errors.ts's fail-closed rule.
  // Reject at store() time rather than let it decrypt forever.
  if (Number.isNaN(new Date(pkg.licence.expiresAt).getTime())) {
    throw new ContentFailure(
      ContentError.LICENCE_INVALID,
      pkg.bookId,
      new Error(`licence.expiresAt "${pkg.licence.expiresAt}" is not a valid date`)
    );
  }
  if (pkg.licence.itemId !== pkg.bookId) {
    throw new ContentFailure(
      ContentError.LICENCE_INVALID,
      pkg.bookId,
      new Error(`licence.itemId "${pkg.licence.itemId}" does not match package bookId "${pkg.bookId}"`)
    );
  }
  if (pkg.encryption && pkg.licence.keyFingerprint !== pkg.encryption.keyFingerprint) {
    throw new ContentFailure(
      ContentError.LICENCE_INVALID,
      pkg.bookId,
      new Error('licence.keyFingerprint does not match encryption.keyFingerprint')
    );
  }
}

// In-memory session/package state. Populated by store(); cleared by destroy(). This is what lets
// Elite ("writes nothing") and Subscription (persists, reopenable across process restarts) share
// the same openSession/decryptBook/close code path.
interface OpenSession {
  handle: SessionHandle;
  plaintext: Uint8Array | null;
  // Decrypted search index, once decryptSearchIndex() has actually run and pkg.index existed.
  // Deliberately an INDEPENDENT decrypt pass from `plaintext` above, not bundled into
  // decryptBook()'s own run() — a corrupted/tampered index must not block reading the book
  // itself (an index-only failure has a much smaller, more appropriate blast radius than "the
  // book won't open"). They still share the same resolved BEK, per search.ts's contract.
  indexPlaintext: Uint8Array | null;
  rawKey: Uint8Array | null; // Elite only — never touches the keychain
  // In-flight decryptBook() promise, if one is currently running for this session. Two calls to
  // decryptBook(bookId) issued before the first resolves must share ONE decrypt, not each race
  // their own: if they raced independently, only the buffer that happened to win the assignment
  // to `plaintext` would get zeroed by close() — the other caller's buffer would silently keep
  // live plaintext in RAM after "close". Sharing one promise means both callers hold the SAME
  // buffer reference, so close() zeroing session.plaintext zeroes the only copy that exists.
  pending: Promise<Uint8Array> | null;
  // Same concurrency-safety pattern as `pending`, for decryptSearchIndex()'s own independent
  // pass — two concurrent callers must share one decrypt, not race two separate buffers that
  // close() can only zero one of.
  indexPending: Promise<Uint8Array | null> | null;
}

const packageCache = new Map<BookId, EncryptedPackage>();
const sessions = new Map<BookId, OpenSession>();

/**
 * Persist an EncryptedPackage exactly as received (Subscription) or cache it in memory only
 * (Elite). Asserts the content-length and licence/bookId invariants the frozen contract requires
 * — a violation is a loud ContentFailure(INTEGRITY_FAILED | LICENCE_INVALID), never silent.
 */
async function store(pkg: EncryptedPackage): Promise<void> {
  assertLengthInvariant(pkg);
  assertLicenceMatchesPackage(pkg);

  packageCache.set(pkg.bookId, pkg);

  if (isElite(pkg)) {
    return; // Elite: in-memory only, nothing written to disk.
  }

  writeFile(contentFile(pkg.bookId), pkg.content);
  const idxFile = indexFile(pkg.bookId);
  if (pkg.index) {
    writeFile(idxFile, pkg.index);
  } else if (idxFile.exists) {
    // This bookId previously had an index (a prior store() wrote one) and this update doesn't —
    // delete the stale file rather than leaving an orphan that disagrees with hasIndex:false
    // below (a disk-space leak, and a landmine for any future code that reads index files by
    // path instead of trusting the meta flag).
    idxFile.delete();
  }
  const meta: PersistedMeta = {
    bookId: pkg.bookId,
    format: pkg.format,
    encryption: pkg.encryption,
    licence: pkg.licence,
    cipherLength: pkg.cipherLength,
    originalLength: pkg.originalLength,
    mimeType: pkg.mimeType,
    hasIndex: !!pkg.index,
  };
  writeFile(metaFile(pkg.bookId), JSON.stringify(meta));
}

function loadPersisted(bookId: BookId): EncryptedPackage | null {
  const meta = metaFile(bookId);
  if (!meta.exists) return null;

  const parsed = JSON.parse(meta.textSync()) as PersistedMeta;

  // Check the RAM budget against the SMALL metadata read before touching the (potentially huge)
  // content file at all. Without this, a cold read (openSession() with nothing cached yet — the
  // normal "app was closed and reopened" path) would unconditionally load an oversized file's
  // full bytes into a JS Uint8Array before decryptBook()'s own budget check ever runs, defeating
  // the "checked before decrypt" claim in this file's own header. Found via an adversarial
  // cross-file review, 2026-08-12 — not a hypothetical.
  if (parsed.originalLength > MAX_DECRYPTED_BYTES) {
    throw new ContentFailure(
      ContentError.DECRYPTION_FAILED,
      bookId,
      new Error(
        `book is ${parsed.originalLength} bytes, exceeds the ${MAX_DECRYPTED_BYTES}-byte RAM budget — refusing to read it into memory`
      )
    );
  }

  const content = contentFile(bookId).bytesSync();
  const index = parsed.hasIndex ? indexFile(bookId).bytesSync() : undefined;

  return {
    bookId: parsed.bookId,
    format: parsed.format,
    content,
    index,
    encryption: parsed.encryption,
    licence: parsed.licence,
    cipherLength: parsed.cipherLength,
    originalLength: parsed.originalLength,
    mimeType: parsed.mimeType,
  };
}

function resolvePackage(bookId: BookId): EncryptedPackage | null {
  return packageCache.get(bookId) ?? loadPersisted(bookId);
}

/** Begin a read session for a stored (or in-memory Elite) book. Idempotent per bookId. */
async function openSession(bookId: BookId): Promise<SessionHandle> {
  const existing = sessions.get(bookId);
  if (existing) return existing.handle;

  const pkg = resolvePackage(bookId);
  if (!pkg) {
    throw new ContentFailure(
      ContentError.DECRYPTION_FAILED,
      bookId,
      new Error('no stored package for this book — call store() first')
    );
  }
  packageCache.set(bookId, pkg); // lazily repopulate the in-memory cache on a cold start

  const handle: SessionHandle = { bookId, format: pkg.format, openedAt: Date.now() };
  sessions.set(bookId, {
    handle,
    plaintext: null,
    indexPlaintext: null,
    rawKey: null,
    pending: null,
    indexPending: null,
  });
  return handle;
}

async function resolveRawKey(pkg: EncryptedPackage, session: OpenSession): Promise<Uint8Array> {
  if (session.rawKey) return session.rawKey;
  if (!pkg.encryption) {
    throw new ContentFailure(ContentError.DECRYPTION_FAILED, pkg.bookId, new Error('no encryption descriptor'));
  }

  const elite = isElite(pkg);

  // Elite MUST NOT touch the keychain at all — not even to read — "memory-only, no keystore
  // write" means the keychain is off-limits for this tier, full stop.
  if (!elite) {
    try {
      return await getBek(pkg.bookId); // cached from a previous unwrap on this device
    } catch {
      // Not cached yet — fall through to a real unwrap below.
    }
  }

  let rawKey: Uint8Array;
  try {
    rawKey = await unwrapBek(pkg.encryption.wrappedBek);
  } catch (cause) {
    throw new ContentFailure(ContentError.KEYSTORE_UNAVAILABLE, pkg.bookId, cause);
  }

  if (elite) {
    session.rawKey = rawKey; // memory-only, never touches the keychain
  } else {
    await storeBek(pkg.bookId, rawKey); // cache for next session, this device
  }
  return rawKey;
}

/**
 * Unwrap the BEK and AES-256-GCM-decrypt the WHOLE book into RAM. Rejects ContentFailure on tag
 * failure / bad key / expired licence / over the RAM budget — never a partial or plaintext-on-
 * disk fallback. Requires an open session (call openSession(bookId) first); caches the result on
 * that session so repeat calls don't re-decrypt.
 */
async function decryptBook(bookId: BookId): Promise<Uint8Array> {
  const session = sessions.get(bookId);
  if (!session) {
    throw new ContentFailure(
      ContentError.DECRYPTION_FAILED,
      bookId,
      new Error('no open session — call openSession(bookId) first')
    );
  }
  if (session.plaintext) return session.plaintext;
  // A decrypt for this session is already in flight (e.g. two callers awaited decryptBook(id)
  // before the first resolved) — share it. See the `pending` field's comment on OpenSession for
  // why sharing one promise (one buffer) instead of each racing its own decrypt matters for
  // close()'s zeroing guarantee.
  if (session.pending) return session.pending;

  const run = async (): Promise<Uint8Array> => {
    const pkg = packageCache.get(bookId);
    if (!pkg) {
      throw new ContentFailure(ContentError.DECRYPTION_FAILED, bookId, new Error('session outlived its package'));
    }

    // Re-check the length invariant at DECRYPT time, not just at store() time. For encrypted
    // packages this is redundant with assertCipherLayout inside aesGcm.decrypt() below, but for
    // OPEN-ACCESS packages (pkg.encryption === null) nothing else on this path re-validates that
    // pkg.content still matches the length recorded in meta.json — decrypt just does
    // `new Uint8Array(pkg.content)` with no cipher/tag to catch drift. Without this, a book
    // correctly store()'d, then truncated/extended on disk before the next cold read, would
    // "successfully" decrypt to silently wrong-length data instead of failing loudly (errors.ts
    // rule 2). Found via an adversarial cross-file review, 2026-08-12 — not a hypothetical.
    assertLengthInvariant(pkg);

    if (isLicenceExpired(pkg)) {
      throw new ContentFailure(ContentError.LICENCE_EXPIRED, bookId);
    }
    // NOTE: licence.signature (RS256) is NOT verified here — see file header. Expiry above is
    // real; signature is not, yet.

    if (pkg.originalLength > MAX_DECRYPTED_BYTES) {
      throw new ContentFailure(
        ContentError.DECRYPTION_FAILED,
        bookId,
        new Error(`book is ${pkg.originalLength} bytes, exceeds the ${MAX_DECRYPTED_BYTES}-byte RAM budget`)
      );
    }

    let plaintext: Uint8Array;
    if (!pkg.encryption) {
      // open access / audio: already plaintext. COPY it rather than aliasing pkg.content
      // directly: close() zeroes session.plaintext IN PLACE, and pkg.content is the same object
      // held by packageCache (and handed back by loadPersisted on a fresh read) — aliasing it
      // would mean close()-ing this session corrupts the package for every future session of
      // this same book.
      plaintext = new Uint8Array(pkg.content);
    } else {
      const rawKey = await resolveRawKey(pkg, session);
      try {
        plaintext = await decrypt(
          { content: pkg.content, cipherLength: pkg.cipherLength, originalLength: pkg.originalLength },
          rawKey
        );
      } catch (cause) {
        // GCM tag failed to verify (tamper/corruption) or key/nonce mismatch — fail LOUDLY, never
        // render whatever came out (errors.ts rule 3).
        throw new ContentFailure(ContentError.INTEGRITY_FAILED, bookId, cause);
      }
    }

    if (plaintext.length > MAX_DECRYPTED_BYTES) {
      throw new ContentFailure(
        ContentError.DECRYPTION_FAILED,
        bookId,
        new Error(`decrypted book is ${plaintext.length} bytes, exceeds the ${MAX_DECRYPTED_BYTES}-byte RAM budget`)
      );
    }

    session.plaintext = plaintext;
    return plaintext;
  };

  const pending = run().finally(() => {
    // Clear regardless of outcome: on success session.plaintext is now set (short-circuits future
    // calls above); on failure this allows a later decryptBook() call to retry from scratch
    // instead of replaying a cached rejection forever.
    session.pending = null;
  });
  session.pending = pending;
  return pending;
}

/**
 * Return the decrypted search index bundled with this book, or null if it has none. NOT part of
 * the frozen `ContentStore` interface (that only defines `decryptBook`) — exported separately
 * from this module, same pattern as `MAX_DECRYPTED_BYTES`.
 *
 * Deliberately an INDEPENDENT decrypt pass from decryptBook() — does NOT require decryptBook() to
 * have been called first, and a corrupted/tampered index rejects on its OWN without touching the
 * book content's session state. search.ts's contract says the index is encrypted "under the SAME
 * BEK as the book" and decrypted "in one go" alongside it — read as "same key, same download
 * session," not "one failure must take down the other." An index-only integrity failure has no
 * business making the book unreadable too.
 *
 * Requires an open session (call openSession(bookId) first), same as decryptBook. Caches the
 * result on the session so repeat calls don't re-decrypt, and shares one in-flight promise across
 * concurrent callers (same reasoning as decryptBook's `pending`, applied to `indexPending`).
 */
async function decryptSearchIndex(bookId: BookId): Promise<Uint8Array | null> {
  const session = sessions.get(bookId);
  if (!session) {
    throw new ContentFailure(
      ContentError.DECRYPTION_FAILED,
      bookId,
      new Error('no open session — call openSession(bookId) first')
    );
  }
  if (session.indexPlaintext) return session.indexPlaintext;
  if (session.indexPending) return session.indexPending;

  const run = async (): Promise<Uint8Array | null> => {
    const pkg = packageCache.get(bookId);
    if (!pkg) {
      throw new ContentFailure(ContentError.DECRYPTION_FAILED, bookId, new Error('session outlived its package'));
    }
    if (!pkg.index) return null; // legitimately no index — not an error, nothing to decrypt

    if (isLicenceExpired(pkg)) {
      throw new ContentFailure(ContentError.LICENCE_EXPIRED, bookId);
    }

    // Same RAM-budget guard as decryptBook (checked before AND after decrypt) — an index has no
    // separately-recorded "original length" the way book content does (see the encrypted branch's
    // own comment), so the ciphertext length is used as the pre-decrypt upper-bound proxy
    // (plaintext is always <= ciphertext length for this layout: nonce+tag overhead only adds to
    // it). Without this, a maliciously or accidentally huge search index would decrypt straight
    // into RAM with zero guard, unlike the book content path.
    if (pkg.index.length > MAX_DECRYPTED_BYTES) {
      throw new ContentFailure(
        ContentError.DECRYPTION_FAILED,
        bookId,
        new Error(`search index is ${pkg.index.length} bytes, exceeds the ${MAX_DECRYPTED_BYTES}-byte RAM budget`)
      );
    }

    let indexPlaintext: Uint8Array;
    if (!pkg.encryption) {
      // No BEK for an open-access book, so an index shipped alongside it ships plaintext too,
      // same as the content. Copied, not aliased — same close()-corrupts-the-cache reasoning as
      // decryptBook's open-access branch.
      indexPlaintext = new Uint8Array(pkg.index);
    } else {
      // Same BEK as the book (resolveRawKey is idempotent — cheap no-op if decryptBook already
      // resolved it this session), OWN nonce. No recorded cipherLength/originalLength exists for
      // the index the way it does for content, so this uses the raw
      // decryptBook(ciphertextWithTag, nonce, key) primitive directly — the same
      // nonce(12) || ciphertext || tag(16) layout as content, self-describing from the buffer.
      const rawKey = await resolveRawKey(pkg, session);
      try {
        const indexNonce = pkg.index.subarray(0, NONCE_BYTES);
        const indexCiphertextWithTag = pkg.index.subarray(NONCE_BYTES);
        indexPlaintext = await decryptRaw(indexCiphertextWithTag, indexNonce, rawKey);
      } catch (cause) {
        // Tag failure on the index is exactly as loud as tag failure on the book — errors.ts
        // rule 3 doesn't carve out an exception for "just the index" — it just doesn't take the
        // book down with it (see this function's own doc comment).
        throw new ContentFailure(ContentError.INTEGRITY_FAILED, bookId, cause);
      }
    }

    if (indexPlaintext.length > MAX_DECRYPTED_BYTES) {
      throw new ContentFailure(
        ContentError.DECRYPTION_FAILED,
        bookId,
        new Error(
          `decrypted search index is ${indexPlaintext.length} bytes, exceeds the ${MAX_DECRYPTED_BYTES}-byte RAM budget`
        )
      );
    }

    session.indexPlaintext = indexPlaintext;
    return indexPlaintext;
  };

  const pending = run().finally(() => {
    session.indexPending = null;
  });
  session.indexPending = pending;
  return pending;
}

/**
 * End THIS book's session: zero its decrypted buffer (and search index, and, for Elite, its
 * in-memory-only key). REVERSIBLE — ciphertext + wrappedBek stay on device (Subscription),
 * reopenable offline. Idempotent: closing a book with no open session is a no-op.
 */
async function close(bookId: BookId): Promise<void> {
  const session = sessions.get(bookId);
  if (!session) return;

  session.plaintext?.fill(0);
  session.indexPlaintext?.fill(0);
  session.rawKey?.fill(0);
  sessions.delete(bookId);
}

/**
 * Destroy key material and persisted ciphertext at expiry / return. TERMINAL — cannot be undone
 * without a fresh borrow (a new store() call).
 */
async function destroy(bookId: BookId): Promise<void> {
  await close(bookId);

  for (const file of [contentFile(bookId), indexFile(bookId), metaFile(bookId)]) {
    if (file.exists) file.delete();
  }
  await deleteBek(bookId);
  packageCache.delete(bookId);
}

/**
 * True iff ciphertext + a currently-valid wrapped key are ON DISK. Always false for Elite —
 * Elite never persists, so its metadata file never exists.
 */
async function isAvailableOffline(bookId: BookId): Promise<boolean> {
  const meta = metaFile(bookId);
  if (!meta.exists) return false;

  const parsed = JSON.parse(meta.textSync()) as PersistedMeta;
  if (parsed.licence && Date.now() >= new Date(parsed.licence.expiresAt).getTime()) {
    return false;
  }
  return contentFile(bookId).exists;
}

export const contentStore: ContentStore = {
  store,
  openSession,
  decryptBook,
  close,
  destroy,
  isAvailableOffline,
};

// Not part of the frozen ContentStore interface — see decryptSearchIndex's own doc comment.
export { decryptSearchIndex };
