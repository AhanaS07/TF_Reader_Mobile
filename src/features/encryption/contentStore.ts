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
// KNOWN GAP, stated loudly rather than faked: RSA-OAEP-256 unwrap (deviceKeypair.ts's
// `unwrapBek`) is still a stub that throws by design (blocked on an RSA library choice — see
// that file's header). decryptBook() below calls the REAL unwrapBek, so the wiring is correct
// end-to-end the moment that lands; until then, a book whose raw BEK isn't already cached (via
// keyStorage.ts, itself confirmed on-device) rejects with ContentFailure(KEYSTORE_UNAVAILABLE) —
// not a fake success. Also NOT implemented here: licence SIGNATURE verification (RS256) — expiry
// is checked for real below, signature is not (no RS256-verify library wired in yet). Don't
// mistake "expiry checked" for "licence verified."
//
// RAM budget: MAX_DECRYPTED_BYTES is a hard, enforced cap (checked before AND after decrypt), per
// this task's "<25MB" directive. BuildPlan.md Phase 9.3 already flags 25MB as possibly
// unrealistic for real whole-book payloads long-term (see docs/build-status.md) — kept as the
// stated target here, not silently widened.

import { Directory, File, Paths } from 'expo-file-system';
import type { BookId, ContentStore, EncryptedPackage, SessionHandle } from '@/shared/contracts';
import { ContentError, ContentFailure } from '@/shared/contracts';
import { decrypt } from './aesGcm';
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
  rawKey: Uint8Array | null; // Elite only — never touches the keychain
  // In-flight decryptBook() promise, if one is currently running for this session. Two calls to
  // decryptBook(bookId) issued before the first resolves must share ONE decrypt, not each race
  // their own: if they raced independently, only the buffer that happened to win the assignment
  // to `plaintext` would get zeroed by close() — the other caller's buffer would silently keep
  // live plaintext in RAM after "close". Sharing one promise means both callers hold the SAME
  // buffer reference, so close() zeroing session.plaintext zeroes the only copy that exists.
  pending: Promise<Uint8Array> | null;
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
  sessions.set(bookId, { handle, plaintext: null, rawKey: null, pending: null });
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
 * End THIS book's session: zero its decrypted buffer (and, for Elite, its in-memory-only key).
 * REVERSIBLE — ciphertext + wrappedBek stay on device (Subscription), reopenable offline.
 * Idempotent: closing a book with no open session is a no-op.
 */
async function close(bookId: BookId): Promise<void> {
  const session = sessions.get(bookId);
  if (!session) return;

  session.plaintext?.fill(0);
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
