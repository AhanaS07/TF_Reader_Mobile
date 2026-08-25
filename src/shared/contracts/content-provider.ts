// src/shared/contracts/content-provider.ts
// Content provider — the Encryption → Reader seam. CAP-7 (Team t4targaryen)
//
// Owner: Reader (Ahana) consumes; Encryption (Abhinav) implements the store.
// Field names for the encryption/licence blocks are taken verbatim from the
// wokay source-of-truth (§10, §11 Seam 2 `Encryption`, Flow B licence.json).
// Whole-book AES-256-GCM, decrypted whole into RAM, never to disk. No chunking,
// no partial decryption.
//
// WHY THESE RETURN Promise (frozen — do not re-litigate):
//   "Whole book in one shot in RAM" removes CHUNKING and PARTIAL DECRYPTION.
//   It does NOT make anything synchronous. store / decryptBook cross async
//   boundaries regardless: filesystem read, keystore BEK unwrap, and
//   crypto.subtle.decrypt (Promise-returning in the WebView). A sync decrypt
//   would force a blocking JSI crypto path and stall the JS thread on ~20MB.
//
// FAILURE SHAPE (frozen): every method below rejects with `ContentFailure`
// (errors.ts), NOT a bare ContentError enum. Carries .code, .bookId, .cause.

import type { BookId, Bytes, Timestamp, ContentFormat } from '../types/primitives';

// The `encryption` block from the grant (source-of-truth §10/§11). Names EXACT.
// null for open access and ALL audio (plain file, no key). PROVISIONAL —
// co-freeze with Abhinav on Day 3.
export interface EncryptionDescriptor {
  algorithm: 'AES-256-GCM';
  layout: 'nonce(12) || ciphertext || tag(16)';
  wrappedBek: string; // base64, RSA-OAEP-256 to the DEVICE public key
  wrapAlgorithm: 'RSA-OAEP-256';
  /** OPTIONAL on wokay's published schema — "which master key wrapped it; exists so a second one
   * can be added later" — and relaxed here to match, on the same "a null field is omitted rather
   * than sent as null, test for presence" convention that `SignedUrl`/`IndexUrl` already follow
   * (reading-session.ts). Required here was a type lie: a real grant that omits it would have
   * carried `undefined` behind a `string`. Nothing in this repo READS it — `contentStore.ts`
   * deliberately keys BEK-change detection off `wrappedBek`, not `keyId`/`keyFingerprint` — so
   * relaxing it is inert today. Keep it that way: it names a SERVER key, not the device key, and
   * is not an identity to branch on. */
  keyId?: string; // e.g. "master-v1"
  keyFingerprint: string; // "sha256:..." of the device public key we sent
}

// A DEVICE-SIDE licence record. No endpoint in either published contract returns anything shaped
// like this: wokay's `ContentGrant` has exactly `content` / `index` / `encryption`, and flambeau's
// `ReadingSessionResponse` adds only session fields. `downloadManager.ts` therefore SYNTHESIZES
// one per download, from `Loan.canPersist` + `Loan.dueAt`, so that `ContentStore.store()` has the
// Subscription-vs-Elite signal it is built around.
//
// Consequently `signature` is a placeholder (`value: ''`) and is verified nowhere — the earlier
// claim here that it is "REQUIRED and verified before expiry is trusted" described a design that
// was never built and that neither contract carries. `rights` has no contract source either.
// EXPIRY IS THE ONLY FIELD DOING REAL WORK, and it does it correctly (see `expiresAt` below).
//
// Whether this type should exist at all — renamed to something honest and moved out of
// shared/contracts/, since a device-side record is not an inter-team wire contract — is an open
// cohort question: B4 in `CONTRACT_ALIGNMENT.md` (this directory). It is a Week-1 frozen file, so
// that is a Gate conversation, not a quiet edit. Read that entry before adding a field here.
export interface SignedLicence {
  licenceId: string;
  // INVARIANT: itemId names the SAME book as the EncryptedPackage.bookId it
  // ships with (backend calls it itemId, the reader calls it bookId — see
  // primitives.ts). The store MUST reject if licence.itemId !== pkg.bookId.
  itemId: string;
  /** MUST equal `EncryptionDescriptor.keyFingerprint`, and that equality is a SECURITY CONTROL,
   * not bookkeeping: this side is derived locally from the device's own public key
   * (`deviceKeypair.ts`'s `publicKeyFingerprint()`), the other side is the server's claim about
   * which key it wrapped the BEK for, so comparing them is what proves nobody in the chain
   * substituted a key. `contentStore.ts` enforces it in `assertLicenceMatchesPackage()`.
   * Assigning this from `session.encryption.keyFingerprint` would make the comparison a value
   * against itself and silently delete the guarantee — it used to, and that was the bug. */
  keyFingerprint: string;
  expiresAt: string; // ISO-8601 UTC (wire), NOT Timestamp
  canPersist: boolean; // false ⇒ Elite, memory-only, no keystore write
  rights: { print: boolean };
  signature: { alg: 'RS256'; kid: string; value: string };
}

// What Abhinav's download pass produces and hands to the store. "Ciphertext
// exactly as received" — the reader does no second encryption. MINIMAL &
// PROVISIONAL (frozen Day 3 with Encryption + Sync).
export interface EncryptedPackage {
  // INVARIANT: same book as licence.itemId above (when licence is present).
  bookId: BookId;
  format: ContentFormat;
  content: Bytes; // nonce(12)||ct||tag(16), as received. Never decrypted to disk.
  index?: Bytes; // bundled search index ciphertext (same BEK, its OWN nonce)
  // null ⇒ open access (plaintext). AUDIO can be either: the backend's default is unencrypted
  // (whole-file encryption cannot seek — see tf_reader_backend_temp's shared.md), overridden for
  // one dev-only fixture (2026-08-25) so encrypted audio exercises the same whole-file RAM-decrypt
  // path as EPUB/PDF, under the same MAX_DECRYPTED_BYTES cap — short-form only, not a streaming
  // design. contentStore.ts's decrypt branch is already format-blind, so this needed no code
  // change here, only this comment no longer being wrong.
  encryption: EncryptionDescriptor | null;
  licence: SignedLicence | null; // null ⇒ open access (no licence)

  // BOTH length fields ship — option (b), decided by Abhinav, who owns the
  // producing side (Encryption + Download). cipherLength mirrors the wire/grant
  // 1:1 instead of being recomputed, and is available for download progress
  // checks before any decrypt has happened.
  //
  // They are REDUNDANT BY DESIGN, so the redundancy is made safe rather than
  // removed: `content` is authoritative, the two scalars are advisory
  // cross-checks, and the store MUST assert on store():
  //
  //     content.length === cipherLength === 12 + originalLength + 16
  //
  // A mismatch is a loud ContentFailure(INTEGRITY_FAILED), never silent. That
  // assertion is the whole reason keeping three encodings of one fact is safe;
  // without it this is exactly the silent-drift risk that argued for dropping
  // cipherLength. originalLength is the PLAINTEXT length and is NOT derivable
  // from the ciphertext without decrypting, so it is kept regardless.
  cipherLength: number; // == content.length == 12 + originalLength + 16
  originalLength: number; // plaintext length after decrypt

  mimeType: string; // e.g. "application/pdf", "application/epub+zip"
}

// An open decrypt session, keyed by bookId. The decrypted buffer lives ONLY
// while the session is open; close(bookId) zeroes it (and, for Elite, the
// in-memory key). Sessions are independent — more than one book can be open at
// once (background prefetch, a compare view), each closed on its own. PROVISIONAL.
export interface SessionHandle {
  bookId: BookId;
  format: ContentFormat;
  openedAt: Timestamp;
}

// On-device store owned by Encryption (Abhinav). Persists ciphertext + wrapped
// key + licence; unwrap → whole-book decrypt into RAM on demand. Any failure
// REJECTS with a ContentFailure (fail-closed) — never a partial or plaintext
// buffer. Every method is keyed by bookId (zero-or-more concurrent sessions).
export interface ContentStore {
  // Persist an EncryptedPackage exactly as received. Subscription only; Elite
  // writes nothing. Void: async because it writes to disk, but the caller holds
  // the bookId it downloaded and reads back via getBook / isAvailableOffline —
  // no receipt to return. store() is where the length + itemId/bookId invariants
  // are asserted (loud ContentFailure on mismatch).
  store(pkg: EncryptedPackage): Promise<void>;

  // Begin a read session for a stored (or in-memory Elite) book.
  openSession(bookId: BookId): Promise<SessionHandle>;

  // Unwrap the BEK and AES-256-GCM-decrypt the WHOLE book into RAM. Same Bytes
  // as ContentProvider.getBook. ASYNC (fs + keystore + subtle.decrypt). Rejects
  // ContentFailure on tag failure / bad key / expired-or-invalid licence.
  decryptBook(bookId: BookId): Promise<Bytes>;

  // End THIS book's session: zero its buffer (and, for Elite, its in-memory
  // key). Other sessions untouched. REVERSIBLE — ciphertext + wrappedBek stay on
  // device (Subscription), reopenable offline. Idempotent: closing a book with
  // no open session is a no-op, not an error.
  close(bookId: BookId): Promise<void>;

  // Destroy key material at expiry / return. Deleting the wrapped BEK turns
  // ciphertext + index into noise instantly, offline, size-independent
  // (source-of-truth Flow B step 10). TERMINAL — cannot be undone without a
  // fresh borrow. Fail-closed teardown.
  destroy(bookId: BookId): Promise<void>;

  // True iff ciphertext + a currently-valid wrapped key are on device
  // (Subscription). Always false for Elite (nothing is written).
  isAvailableOffline(bookId: BookId): Promise<boolean>;
}

// The seam the Reader (epub.js / pdf.js) codes against. ONE call, whole book.
export interface ContentProvider {
  // Whole decrypted book, in memory. Same Bytes as decryptBook. Async front-door:
  // decrypts-if-needed, then returns. For EPUB, pass `(await getBook(id)).buffer`
  // to epub.js `book.open(arrayBuffer)`. For a SYNC in-RAM read (valid only AFTER
  // warm-up), add a separate `peekBook(bookId): Bytes` that throws ContentFailure
  // when not yet decrypted — don't make this one synchronous.
  getBook(bookId: BookId): Promise<Bytes>;
}
