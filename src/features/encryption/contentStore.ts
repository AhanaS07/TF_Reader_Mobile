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
// STILL NOT implemented here: licence SIGNATURE verification (RS256) — that's B4
// (CONTRACT_ALIGNMENT.md), still open, and no RS256-verify library is wired in. What IS
// implemented: decryptBook() checks expiry against a copy of the licence sealed with the book's
// own BEK at store() time (licenceSeal.ts), not against the plaintext licence fields in meta.json
// directly — those are hand-editable with a text editor and nothing before this checked them.
// Don't mistake either check for the other: the seal proves the licence hasn't changed since THIS
// DEVICE stored it; it does not prove flambeau issued it, which is what a real signature would.
//
// RAM budget: a hard, enforced cap, checked at store() time, on the cold-read path, and before
// AND after decrypt. It is PER-FORMAT — MAX_DECRYPTED_BYTES (25 MB, this task's "<25MB"
// directive) for EPUB/PDF, MAX_AUDIO_DECRYPTED_BYTES (20 MB, the OPDS team's prototype storage
// limit) for AUDIO. Go through maxDecryptedBytesFor(); see its own comment for why audio is
// bounded by the catalogue rather than by RAM. BuildPlan.md Phase 9.3 already flags 25MB as
// possibly unrealistic for real whole-book payloads long-term (see docs/build-status.md) — kept
// as the stated target here, not silently widened.

import { Directory, File, Paths } from 'expo-file-system';
import type {
  BookId,
  ContentFormat,
  ContentStore,
  EncryptedPackage,
  SessionHandle,
  LocalLicenceRecord,
} from '@/shared/contracts';
import {
  ContentError,
  ContentFailure,
  EVENT_CHANNELS,
  OFFLINE_LOCK_EVENTS,
} from '@/shared/contracts';
import { eventBus } from '@/shared/eventBus';
import { decrypt, decryptBook as decryptRaw } from './aesGcm';
import { NONCE_BYTES, GCM_TAG_BYTES } from './cipherLayout';
import { deleteBek, getBek, storeBek } from './keyStorage';
import { unwrapBek } from './deviceKeypair';
import { sealLicence, openSealedLicence, type SealedLicence } from './licenceSeal';

export const MAX_DECRYPTED_BYTES = 25 * 1024 * 1024; // 25 MB whole-book RAM budget (frozen for this task)

// AUDIO is capped LOWER than everything else, and the reason is the catalogue, not this device:
// the OPDS team stores prototype audio at 20 MB or under, so a larger audiobook cannot arrive
// from the only source that serves one. Enforcing it here makes that agreement checkable at the
// boundary instead of assumed — a 40 MB audiobook is a catalogue bug, and this is where it says
// so rather than sailing through to a 25 MB check that was only ever about RAM.
//
// It is NOT a claim that 20 MB is the right size for audio in general — it is ~21 minutes at
// 128 kbps against 8–15 hours for a real audiobook. Full-length audio is out of reach at ANY cap
// this constant could hold, because the cap bounds a whole-book-into-a-Uint8Array operation and a
// 10-hour audiobook is ~500 MB; so RAISING THIS NUMBER IS NOT HOW FULL-LENGTH AUDIO GETS SUPPORTED,
// and a change that reads "just bump the audio cap" is a misreading of the problem. Shipping real
// audiobooks needs a path-based accessor and a decision that was deliberately deferred — see
// reader/audio/AUDIO_PLAYER_DECISION.md Part 2, and B11 in CONTRACT_ALIGNMENT.md.
export const MAX_AUDIO_DECRYPTED_BYTES = 20 * 1024 * 1024; // 20 MB, agreed with the OPDS/catalogue team

/**
 * The whole-book byte budget for `format`. Every book-sized check in this file goes through here
 * so the two caps cannot drift apart — the search-index checks deliberately do not, since
 * `BookSearchIndex.format` (search.ts) excludes AUDIO outright and no audio index can exist.
 */
export function maxDecryptedBytesFor(format: ContentFormat): number {
  return format === 'AUDIO' ? MAX_AUDIO_DECRYPTED_BYTES : MAX_DECRYPTED_BYTES;
}

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
  /** Timestamp (ISO string) when `invalidateLicence()` stripped the licence + BEK. Present ONLY
   *  for the post-revocation shape: ciphertext on disk, but no rights attached. Absent for both
   *  genuine open-access (never had a licence) and regular persisted books (licence present). */
  revokedAt?: string;
  /** On-device tamper seal over `licence` (see licenceSeal.ts) — absent for open access (no
   *  licence to seal) and for anything persisted before this field existed. decryptBook() treats
   *  a licence with no seal as ContentError.LICENCE_INVALID for anything that should have one. */
  licenceSeal?: SealedLicence;
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

/**
 * Safe JSON.parse for meta.json — returns null instead of crashing on corruption.
 * iOS can interrupt file writes during app suspension, leaving truncated meta.json files.
 * Without this, a corrupted meta.json creates a crash loop: every subsequent open throws
 * an uncaught SyntaxError from JSON.parse, and no recovery path clears the bad file.
 */
function parseMetaSafe(bookId: BookId): PersistedMeta | null {
  const meta = metaFile(bookId);
  if (!meta.exists) return null;
  try {
    return JSON.parse(meta.textSync()) as PersistedMeta;
  } catch (err) {
    console.error(
      `[contentStore] corrupted meta.json for ${bookId} — deleting to break crash loop:`,
      err,
    );
    try {
      meta.delete();
    } catch {
      // Best-effort cleanup
    }
    return null;
  }
}


// "false ⇒ Elite, memory-only, no keystore write" (LocalLicenceRecord.canPersist). No licence at all
// is open access, which DOES persist — there is no key material to protect by keeping it memory-only.
function isElite(pkg: EncryptedPackage): boolean {
  return pkg.licence !== null && pkg.licence.canPersist === false;
}

// Pure value check, extracted so decryptBook() can evaluate expiry against the SEAL-VERIFIED
// licence (licenceSeal.ts) instead of the possibly-hand-edited copy sitting in pkg.licence — see
// decryptBook()'s "trustedLicence" below.
function isLicenceValueExpired(licence: LocalLicenceRecord | null): boolean {
  if (!licence) return false;
  const expiresAtMs = new Date(licence.expiresAt).getTime();
  // `new Date(x).getTime()` is NaN for an unparseable/missing expiresAt, and `Date.now() >= NaN`
  // is always false — treat that as EXPIRED (fail closed), not "never expires". store()'s own
  // assertLicenceMatchesPackage rejects a malformed expiresAt at ingestion time, but that gate
  // only covers packages that went through the CURRENT store() — a meta.json already persisted
  // by an older build (before that gate existed) reaches this function directly on every cold
  // read via loadPersisted(), bypassing the ingestion-time check entirely. This function must not
  // rely on store() having already validated its input.
  if (Number.isNaN(expiresAtMs)) return true;
  return Date.now() >= expiresAtMs;
}

function isLicenceExpired(pkg: EncryptedPackage): boolean {
  return isLicenceValueExpired(pkg.licence);
}

function assertLengthInvariant(pkg: EncryptedPackage): void {
  const hasCipher = pkg.encryption !== null;
  // Open access: `content` IS the plaintext (never AES-GCM'd), so there is no nonce/tag
  // overhead to account for. Audio is encrypted (2026-08-25) so it follows the encrypted path.
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

// Mirrors the read-side check at loadPersisted()/decryptBook() (MAX_DECRYPTED_BYTES), on the
// write side instead. Without this, store() would accept a book the read path can never open:
// isAvailableOffline() reports true, the caller believes the download succeeded, and the failure
// only surfaces the first time something calls getBook() on it — a silent-until-tapped failure.
// AUDIO_MEMORY_REPORT.md measured this exact gap (a 150 MB package accepted by store(), then
// DECRYPTION_FAILED on every read) before this check existed. Same error code as the read-side
// checks — this is not actually a decryption failure, but neither is theirs, and the frozen
// ContentError enum has no dedicated "too large" code to add without a Gate conversation.
function assertWithinRamBudget(pkg: EncryptedPackage): void {
  const budget = maxDecryptedBytesFor(pkg.format);
  if (pkg.originalLength > budget) {
    throw new ContentFailure(
      ContentError.DECRYPTION_FAILED,
      pkg.bookId,
      new Error(
        `book is ${pkg.originalLength} bytes, exceeds the ${budget}-byte budget for ${pkg.format} — refusing to store it`
      )
    );
  }
}

function assertLicenceMatchesPackage(pkg: EncryptedPackage): void {
  // An encrypted package with NO licence at all would never have an expiry (or anything else)
  // enforced: isLicenceExpired() short-circuits to "not expired" when pkg.licence is null, so
  // this combination — type-legal, since `licence` and `encryption` are independently nullable —
  // would let crypto material live forever with no rights attached. LocalLicenceRecord's own doc says
  // "null ⇒ open access (no licence)"; a package that IS encrypted is not open access, so it must
  // ship a licence. Reject loudly rather than silently accept it.
  if (pkg.encryption && !pkg.licence) {
    throw new ContentFailure(
      ContentError.LICENCE_INVALID,
      pkg.bookId,
      new Error('encrypted package has no licence — an encrypted book must ship a LocalLicenceRecord')
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

// Kept OUT of EncryptedPackage/PersistedMeta's in-memory shape deliberately — SealedLicence is
// not part of the frozen `EncryptedPackage` contract (content-provider.ts), and adding a field to
// a Week-1 frozen type is its own Gate conversation (see that file's LocalLicenceRecord comment). This
// side table carries the same lifecycle as packageCache (populated by store()/loadPersisted(),
// consulted by decryptBook()) without touching the frozen shape.
const licenceSealCache = new Map<BookId, SealedLicence | undefined>();

/** Rewrite ONLY the `licenceSeal` field of an already-persisted meta.json — used when
 *  decryptBook() creates a seal lazily (see its own comment) and needs to persist it for future
 *  cold reads. No-op if the book has no meta.json (Elite, or store() never ran) — nothing to
 *  attach a seal to. */
function persistLicenceSeal(bookId: BookId, seal: SealedLicence): void {
  const parsed = parseMetaSafe(bookId);
  if (!parsed) return;
  writeFile(metaFile(bookId), JSON.stringify({ ...parsed, licenceSeal: seal }));
}

// A re-download of an already-persisted book under a DIFFERENT wrapped key (key rotation or
// re-licensing — confirmed as a real backend behavior, not hypothetical: flambeau's contract
// mints a new `encryption.keyId`/`wrappedBek` per rotation period) must not let resolveRawKey()
// keep returning the OLD raw BEK from the keychain cache. resolveRawKey() prefers that cache
// over ever re-unwrapping (see its own comment) — without this, the newly-stored ciphertext
// would be permanently undecryptable (ContentFailure(INTEGRITY_FAILED)), with no recovery path
// exposed anywhere in the download/read flow. This was a real, confirmed gap: previously the
// only escape was devContentSeed.ts's dev-only destroy()-before-store() workaround; the real
// production caller (downloadManager.ts's re-download path) never does that.
//
// Compares `wrappedBek` itself, NOT `keyFingerprint`/`keyId`: keyFingerprint identifies the
// DEVICE key used to wrap (content-provider.ts: "sha256:... of the device public key we sent"),
// so two different BEKs wrapped to the same device produce the SAME fingerprint — comparing it
// would miss a genuine rotation. wrappedBek is the one field that actually changes when the BEK
// does. RSA-OAEP's randomized padding means wrappedBek can also legitimately differ across two
// calls that wrapped the SAME BEK (a false-positive "rotation") — that costs one extra, harmless
// RSA unwrap on the next read (still decrypts correctly, just skips the cache once), which is a
// safe trade-off for guaranteeing a genuine rotation is never missed.
async function invalidateStaleCachedKeyIfRotated(pkg: EncryptedPackage): Promise<void> {
  const previous = parseMetaSafe(pkg.bookId);
  if (!previous) return; // first store or corrupted meta — nothing cached yet to invalidate

  const previousWrappedBek = previous.encryption?.wrappedBek ?? null;
  const nextWrappedBek = pkg.encryption?.wrappedBek ?? null;
  if (previousWrappedBek !== nextWrappedBek) {
    await deleteBek(pkg.bookId);
  }
}

/**
 * Persist an EncryptedPackage exactly as received (Subscription) or cache it in memory only
 * (Elite). Asserts the content-length, RAM-budget and licence/bookId invariants the frozen
 * contract requires — a violation is a loud ContentFailure(INTEGRITY_FAILED | DECRYPTION_FAILED |
 * LICENCE_INVALID), never silent.
 */
async function store(pkg: EncryptedPackage): Promise<void> {
  assertLengthInvariant(pkg);
  assertWithinRamBudget(pkg);
  assertLicenceMatchesPackage(pkg);

  // Elite never touches the keychain (see resolveRawKey) — nothing there to invalidate, and
  // checking would be pointless work on every Elite store().
  if (!isElite(pkg)) {
    await invalidateStaleCachedKeyIfRotated(pkg);
  }

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
  // NOT sealed here — store() deliberately never touches the keystore (contentProvider.test.ts
  // pins getFormat() working with no BEK available at all, and several contentStore tests store()
  // a package with a wrappedBek that can never unwrap, expecting the failure only at decrypt
  // time). licenceSealCache carries whatever seal a previous store() for this bookId already had;
  // decryptBook() lazily creates one on this book's first genuine key access if none exists yet —
  // see that function and licenceSeal.ts's header for the trust-on-first-use window this accepts.
  const meta: PersistedMeta = {
    bookId: pkg.bookId,
    format: pkg.format,
    encryption: pkg.encryption,
    licence: pkg.licence,
    cipherLength: pkg.cipherLength,
    originalLength: pkg.originalLength,
    mimeType: pkg.mimeType,
    hasIndex: !!pkg.index,
    licenceSeal: undefined, // a re-download/re-licence invalidates any previous seal (see below)
  };
  writeFile(metaFile(pkg.bookId), JSON.stringify(meta));
  // A fresh store() means a fresh licence (possibly a fresh BEK too) — do not let a STALE seal
  // from a previous download outlive it. Re-sealed lazily on next decrypt, same as a first store().
  licenceSealCache.set(pkg.bookId, undefined);
}

function loadPersisted(bookId: BookId): EncryptedPackage | null {
  const parsed = parseMetaSafe(bookId);
  if (!parsed) return null;

  // Check the RAM budget against the SMALL metadata read before touching the (potentially huge)
  // content file at all. Without this, a cold read (openSession() with nothing cached yet — the
  // normal "app was closed and reopened" path) would unconditionally load an oversized file's
  // full bytes into a JS Uint8Array before decryptBook()'s own budget check ever runs, defeating
  // the "checked before decrypt" claim in this file's own header. Found via an adversarial
  // cross-file review, 2026-08-12 — not a hypothetical.
  const budget = maxDecryptedBytesFor(parsed.format);
  if (parsed.originalLength > budget) {
    throw new ContentFailure(
      ContentError.DECRYPTION_FAILED,
      bookId,
      new Error(
        `book is ${parsed.originalLength} bytes, exceeds the ${budget}-byte budget for ${parsed.format} — refusing to read it into memory`
      )
    );
  }

  const content = contentFile(bookId).bytesSync();
  const index = parsed.hasIndex ? indexFile(bookId).bytesSync() : undefined;

  // Repopulate the seal side-cache on every cold read (app restart, or packageCache evicted by
  // close()) — decryptBook() below reads from here, not from `parsed` directly (see
  // licenceSealCache's own comment for why the seal isn't just a field on the returned package).
  licenceSealCache.set(bookId, parsed.licenceSeal);

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

    const budget = maxDecryptedBytesFor(pkg.format);
    if (pkg.originalLength > budget) {
      throw new ContentFailure(
        ContentError.DECRYPTION_FAILED,
        bookId,
        new Error(`book is ${pkg.originalLength} bytes, exceeds the ${budget}-byte budget for ${pkg.format}`)
      );
    }

    // Resolved once, up front, for two reasons this order needs: (1) the seal check below needs
    // it before expiry can be trusted, (2) the actual decrypt at the bottom reuses the SAME key
    // rather than paying resolveRawKey's keychain round-trip twice.
    const rawKey = pkg.encryption ? await resolveRawKey(pkg, session) : null;

    // Elite never reaches here with a seal (isElite guard — store() never wrote one for that
    // tier) — nothing to verify. For anything else with a licence, trust a SEALED copy for the
    // expiry check below, not pkg.licence itself: pkg.licence is whatever is sitting in meta.json
    // right now, hand-editable with a text editor; the seal can only be reproduced by a device
    // that can unwrap this book's real BEK (licenceSeal.ts).
    let trustedLicence = pkg.licence;
    if (pkg.encryption && pkg.licence && !isElite(pkg) && rawKey) {
      const seal = licenceSealCache.get(bookId);
      if (seal) {
        const sealed = await openSealedLicence(seal, rawKey);
        if (!sealed) {
          throw new ContentFailure(
            ContentError.LICENCE_INVALID,
            bookId,
            new Error('licence seal did not verify — persisted licence may have been tampered with')
          );
        }
        trustedLicence = sealed;
      } else {
        // First genuine access to this book's key material since it was (re-)stored — no seal
        // exists yet to check against, so this trusts pkg.licence AS OF THIS MOMENT and seals it
        // for every future read. Narrower than sealing at store() time (a tamper landing in the
        // gap between download and this book's first open would go uncaught), accepted because
        // store() itself must stay keystore-free (see this file's other tests/comments) — see
        // licenceSeal.ts's header for the full trade-off.
        const newSeal = await sealLicence(pkg.licence, rawKey);
        licenceSealCache.set(bookId, newSeal);
        persistLicenceSeal(bookId, newSeal);
      }
    }

    if (isLicenceValueExpired(trustedLicence)) {
      throw new ContentFailure(ContentError.LICENCE_EXPIRED, bookId);
    }
    // NOTE: licence.signature (RS256) is still NOT verified — that's B4, a different, still-open
    // question (CONTRACT_ALIGNMENT.md). The check above is a DIFFERENT guarantee: it does not
    // establish the licence came from flambeau, only that IT HASN'T CHANGED since this device
    // first sealed it. See licenceSeal.ts's header for the distinction and its ceiling.

    let plaintext: Uint8Array;
    if (!pkg.encryption) {
      // Open access (plaintext): COPY it rather than aliasing pkg.content directly: close()
      // zeroes session.plaintext IN PLACE, and pkg.content is the same object held by
      // packageCache (and handed back by loadPersisted on a fresh read) — aliasing it would mean
      // close()-ing this session corrupts the package for every future session of this same book.
      plaintext = new Uint8Array(pkg.content);
    } else {
      try {
        plaintext = await decrypt(
          { content: pkg.content, cipherLength: pkg.cipherLength, originalLength: pkg.originalLength },
          rawKey! // non-null: pkg.encryption is truthy in this branch, so rawKey was resolved above
        );
      } catch (cause) {
        // GCM tag failed to verify (tamper/corruption) or key/nonce mismatch — fail LOUDLY, never
        // render whatever came out (errors.ts rule 3).
        throw new ContentFailure(ContentError.INTEGRITY_FAILED, bookId, cause);
      }
    }

    if (plaintext.length > budget) {
      throw new ContentFailure(
        ContentError.DECRYPTION_FAILED,
        bookId,
        new Error(`decrypted book is ${plaintext.length} bytes, exceeds the ${budget}-byte budget for ${pkg.format}`)
      );
    }

    // Drop the redundant in-memory ciphertext (added 2026-08-18 — one of CLAUDE.md's "roughly six"
    // full-size copies). `pkg` is the SAME object packageCache holds, so this mutates the cache
    // entry in place. Safe ONLY for non-Elite: Subscription/OA ciphertext is safely on DISK
    // (written by store(), above) and `loadPersisted()` reloads it on any future cold read after
    // close() clears this cache entry — so nothing is lost. Every other reader of `pkg.content`
    // in this file (assertLengthInvariant, the open-access copy and the decrypt() call just above)
    // has already run by this point; a live session never re-enters this function once
    // session.plaintext is set (see the early return at the top of decryptBook), so nothing reads
    // this emptied field again for the rest of this session's life.
    //
    // ELITE IS EXCLUDED, not an oversight: isElite() packages never reach disk (store() returns
    // before its writeFile calls), so the in-memory copy here is the ONLY copy — emptying it would
    // make the book permanently undecryptable until a fresh store(), for no RAM saved (Elite's
    // ciphertext was never going to be held twice in the first place).
    if (!isElite(pkg)) {
      pkg.content = new Uint8Array(0);
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
 *
 * ALSO drops `bookId` from `packageCache` (added 2026-08-18 — previously only `destroy()` did
 * this, so a closed-but-not-destroyed book's whole ciphertext, 20MB+ for a real book, stayed
 * resident in RAM indefinitely). The trade-off this makes deliberately: the NEXT `openSession()`
 * for this book is a cold read — `loadPersisted()`'s synchronous `bytesSync()` off the JS thread
 * — instead of an in-memory hit. That is the correct side to take it on: a reader who closed a
 * book is not mid-read, so paying a one-time re-read cost on the next open is a fair price for
 * not holding every finished book's ciphertext in RAM for the rest of the app's life. Ciphertext
 * on DISK is untouched — this only affects the RAM cache, same as the ciphertext-persistence
 * guarantee `close()` already documented.
 *
 * ELITE IS EXEMPT FROM THAT DROP, and the exemption is what keeps this function REVERSIBLE.
 * Elite never reaches disk (`store()` returns before its `writeFile` calls), so its `packageCache`
 * entry is the ONLY copy: dropping it made `close()` TERMINAL, which `content-provider.ts`
 * reserves for `destroy()`. The next `openSession()` would miss the cache, `loadPersisted()` would
 * find no meta.json, and the read failed `DECRYPTION_FAILED` ("no stored package for this book")
 * forever after. That was CLAUDE.md's "known open item #1", invisible while nothing shipped Elite
 * content and live the moment `openBook()` started forcing `canPersist: false` on every streamed
 * book — the symptom was an audiobook that opened once and then refused to reopen.
 *
 * No RAM is given up by the exemption: Elite ciphertext was never held twice (`decryptBook()`
 * skips its `pkg.content` release for exactly the same reason), so there is no second copy to
 * reclaim here. The decrypted plaintext, which is the large transient, is still zeroed below.
 * `destroy()` is what finally evicts an Elite package.
 */
async function close(bookId: BookId): Promise<void> {
  const session = sessions.get(bookId);
  const pkg = packageCache.get(bookId);
  if (!pkg || !isElite(pkg)) {
    packageCache.delete(bookId);
  }
  if (!session) return;

  session.plaintext?.fill(0);
  session.indexPlaintext?.fill(0);
  session.rawKey?.fill(0);
  sessions.delete(bookId);
}

/**
 * Destroy key material and persisted ciphertext at expiry / return. TERMINAL — cannot be undone
 * without a fresh borrow (a new store() call). Emits CONTENT_DESTROYED after deletion succeeds,
 * so subscribers (e.g. the licence-expiry handler) can clean up derived state.
 */
async function destroy(bookId: BookId): Promise<void> {
  await close(bookId);

  for (const file of [contentFile(bookId), indexFile(bookId), metaFile(bookId)]) {
    if (file.exists) file.delete();
  }
  await deleteBek(bookId);
  packageCache.delete(bookId);
  licenceSealCache.delete(bookId);

  eventBus.emit(EVENT_CHANNELS.CONTENT_DESTROYED, { bookId, at: Date.now() });
}

/**
 * Strip the licence and BEK for a previously-downloaded book, leaving the ciphertext on disk.
 * REVERSIBLE — a fresh `store()` with a new `LocalLicenceRecord` re-attaches rights and the BEK can
 * be re-unwrapped on the next open. Used by the offline fallback's revocation path: the server
 * has signalled `is_valid = false`, so the local copy's rights are void, but the ciphertext
 * stays so a later online open can re-attach a valid licence without re-downloading.
 *
 * This is NOT `destroy()` — destroy wipes everything (content + metadata + key), which is the
 * terminal "book deleted" action. `invalidateLicence()` only strips the rights layer, leaving
 * the encrypted payload for potential reuse.
 */
async function invalidateLicence(bookId: BookId): Promise<void> {
  await close(bookId);

  await deleteBek(bookId);

  // Update meta.json to record the post-revocation shape: ciphertext still on disk, licence
  // stripped. This lets getPersistedLicenceStatus() and isAvailableOffline() distinguish a
  // revoked book (encrypted + no licence + revokedAt set) from genuine open-access (unencrypted
  // + no licence + no revokedAt).
  //
  // No-op for genuinely open-access books (no encryption, no licence): there is nothing to
  // revoke. Setting revokedAt on an open-access book would make getPersistedLicenceStatus()
  // incorrectly report it as revoked, breaking the offline fallback's open-access branch.
  const meta = metaFile(bookId);
  if (meta.exists) {
    const parsed = parseMetaSafe(bookId);
    if (!parsed || (!parsed.licence && !parsed.encryption)) return; // open-access or corrupted — nothing to revoke
    const updated: PersistedMeta = {
      ...parsed,
      licence: null,
      revokedAt: new Date().toISOString(),
      licenceSeal: undefined,
    };
    writeFile(meta, JSON.stringify(updated));
  }

  packageCache.delete(bookId);
  licenceSealCache.delete(bookId);
}

/**
 * Return the persisted licence and its expiry/revocation status for a previously-downloaded book.
 * Used by the unified license gate's offline fallback: when the network is unreachable, the
 * caller needs to know whether there is a valid local licence to read against, without fetching
 * or decrypting anything.
 *
 * Three distinct shapes:
 * - `downloaded: false` — never downloaded (no meta.json)
 * - `licence: null, downloaded: true, revoked: false` — genuine open-access (no encryption, no
 *   licence needed; the content IS plaintext)
 * - `licence: null, downloaded: true, revoked: true` — post-revocation: ciphertext on disk but
 *   the licence + BEK were stripped by `invalidateLicence()`. Not readable.
 * - `licence: present, expired: bool` — subscription/elite book with a real licence
 */
export async function getPersistedLicenceStatus(
  bookId: BookId,
): Promise<{ licence: LocalLicenceRecord | null; expired: boolean; downloaded: boolean; revoked: boolean }> {
  const parsed = parseMetaSafe(bookId);
  if (!parsed) return { licence: null, expired: false, downloaded: false, revoked: false };

  // Post-revocation: licence was stripped by invalidateLicence(), ciphertext still on disk.
  // Distinct from genuine open-access: this book WAS encrypted and had a licence, but the
  // rights were revoked server-side.
  if (parsed.revokedAt) {
    return { licence: null, expired: false, downloaded: true, revoked: true };
  }

  if (!parsed.licence) {
    return { licence: null, expired: false, downloaded: true, revoked: false };
  }

  const expiresAtMs = new Date(parsed.licence.expiresAt).getTime();
  const expired = Number.isNaN(expiresAtMs) || Date.now() >= expiresAtMs;
  return { licence: parsed.licence, expired, downloaded: true, revoked: false };
}

/**
 * Return the persisted MIME type for a stored book. Read from PersistedMeta.mimeType, set at
 * store() time by the download pass (or devContentSeed). Used by audio callers to derive a file
 * extension for the scratch URI instead of hardcoding one. Throws ContentFailure if the book has
 * never been stored (no meta.json exists).
 */
export async function getMimeType(bookId: BookId): Promise<string> {
  const cached = packageCache.get(bookId);
  if (cached) {
    return cached.mimeType;
  }
  const parsed = parseMetaSafe(bookId);
  if (!parsed) {
    throw new ContentFailure(
      ContentError.DECRYPTION_FAILED,
      bookId,
      new Error('no stored package for this book — call store() first')
    );
  }
  return parsed.mimeType;
}

/**
 * True iff ciphertext + a currently-valid wrapped key are ON DISK. Always false for Elite —
 * Elite never persists, so its metadata file never exists. Also false for the post-revocation
 * shape (licence stripped by invalidateLicence(), ciphertext still on disk) — the book has
 * content but no rights to open it, so it is NOT "available offline" in any useful sense.
 */
async function isAvailableOffline(bookId: BookId): Promise<boolean> {
  const parsed = parseMetaSafe(bookId);
  if (!parsed) return false;

  // Post-revocation: licence stripped, ciphertext still on disk. Not available — the BEK is
  // gone and there is no rights material to decrypt with.
  if (parsed.revokedAt) return false;

  // Same fail-closed reasoning as isLicenceExpired() above (and the same reason this can't just
  // trust store() to have already validated the date): NaN must count as expired, not as
  // "never expires".
  if (parsed.licence) {
    const expiresAtMs = new Date(parsed.licence.expiresAt).getTime();
    if (Number.isNaN(expiresAtMs) || Date.now() >= expiresAtMs) {
      return false;
    }
  }
  return contentFile(bookId).exists;
}

eventBus.on(EVENT_CHANNELS.CONTENT_LOCK, (signal) => {
  if (signal.type !== OFFLINE_LOCK_EVENTS.LOCK) return;
  if (signal.reason !== 'revoked') return;

  void invalidateLicence(signal.bookId).catch((error) => {
    console.error(`[contentStore] failed to invalidate revoked book ${signal.bookId}`, error);
  });
});

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

// Exported separately from the frozen `ContentStore` interface — see invalidateLicence's own
// doc comment. Used by licenseCheck.ts's offline revocation path.
export { invalidateLicence };
