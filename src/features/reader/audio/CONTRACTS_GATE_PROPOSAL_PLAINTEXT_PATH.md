# Contracts-Gate proposal: a plaintext-path accessor for never-encrypted content

**Status: DRAFT, UNCOMMITTED.** This is the artifact Task 1c asked for — something to take to
Abhinav and Contracts-Gate, not something already agreed. Nothing in `src/shared/contracts/` has
been touched to produce this; the diffs below are proposed, not applied.

**Author:** Ahana (Reader), AUDIO_PHASE0_FINDINGS.md / Phase 1.
**Touches:** `src/shared/contracts/content-provider.ts` (frozen), `src/shared/contracts/errors.ts`
(frozen, co-owned Reader+Encryption already), `src/shared/contracts/__typecheck__.ts` (canary),
and — once the contract shape is agreed — `src/features/encryption/contentStore.ts` and
`src/features/encryption/contentProvider.ts` (Abhinav's implementation, not part of this Gate ask).

---

## 1. Problem

Phase 0 (`AUDIO_PHASE0_FINDINGS.md`, §2) established: `ContentProvider` exposes exactly one method,
`getBook(bookId): Promise<Bytes>` — whole-book bytes in RAM. `contentStore.ts` DOES write a real
plaintext file to disk for never-encrypted content (`contentFile(bookId)`, in its own directory),
but nothing in the frozen contract exposes that path. A native audio player needs a `file://` URI,
not a `Uint8Array`.

Phase 1's stopgap (`src/features/reader/audio/audioAssetResolver.ts`) works around this entirely
within Reader's own scope: call `getBook()`, write a second copy to a Reader-owned scratch file,
return its URI. It works, but it is explicitly a bridge, not the design — it duplicates a file that
already exists on disk and pays a whole-file RAM copy for a format that never needed one. This
proposal is the fix that removes both costs.

## 2. What's being asked for

One new method, on a **new, separate interface** — not added to `ContentProvider` itself — that
returns the existing on-disk path directly instead of copying bytes through RAM:

```ts
export interface PlaintextAssetProvider {
  /**
   * Absolute file path (not `file://`-prefixed; callers that need a URI prepend it, same as
   * `expo-file-system`'s own `File.uri` convention elsewhere in this repo) to this book's
   * plaintext content, ALREADY on disk. No decrypt, no RAM copy of the book — this is a metadata
   * + fs-existence operation, same cost class as `getFormat`.
   *
   * REJECTS with `ContentFailure(NOT_PLAINTEXT)` (errors.ts) for ANY package that is encrypted —
   * see this method's own doc below for why "AUDIO-only" is the wrong test and "encryption ===
   * null" is the right one. Also rejects on the SAME grounds `decryptBook` does for a
   * still-encrypted book: no stored package (`DECRYPTION_FAILED`), expired licence
   * (`LICENCE_EXPIRED`) — a never-encrypted SUBSCRIPTION-tier book still carries a licence with a
   * real expiry (content-provider.ts's own `EncryptedPackage.licence` doc), and this accessor
   * must not become a second way to read an expired book that bypasses the check `getBook` already
   * enforces. Elite audio has no disk copy to return a path to; also rejects.
   */
  getPlaintextPath(bookId: BookId): Promise<string>;
}
```

**Why a NEW interface, not a new method on `ContentProvider`:** `ContentProvider` is the seam
"the Reader (epub.js/pdf.js) codes against... ONE call, whole book" (its own doc comment) — every
existing caller of `getBook` is written against the assumption that it's the only thing here, and
none of them need a path accessor. Keeping `getPlaintextPath` off `ContentProvider` means:
- Zero risk of an EPUB/PDF call site accidentally reaching for a path instead of decrypting.
- The name `PlaintextAssetProvider` states the precondition in the type a caller imports, rather
  than relying on a doc comment on a method living next to `getBook` that has no such
  precondition.
- No change to `ContentProvider`'s own shape, so the `__typecheck__.ts` pins for it
  (`ReturnType<ContentProvider['getBook']>` etc.) are untouched — this is additive, not a
  modification to an existing frozen shape.

## 3. The hard guard, and why it can't be a compile-time-only check

The brief asked: "It must be impossible to obtain a path to encrypted EPUB/PDF `.content.bin`
through it." Read literally as "encrypted EPUB/PDF," the natural instinct is to key the guard off
`ContentFormat`. **That's the wrong test** — `EncryptedPackage.encryption` is independently
nullable from `format`; `content-provider.ts`'s own doc says `encryption: null` means "open access
**or** audio." An EPUB or PDF CAN be open access (no encryption) — `contentStore.test.ts`'s
"open access (no encryption)" describe block already exercises exactly this, format-independent.
So the real, correct precondition is **`pkg.encryption === null`**, not **`pkg.format === 'AUDIO'`**
— a format-based guard would either wrongly refuse a legitimate open-access EPUB/PDF, or (worse,
if implemented as an allowlist that's later "fixed" by someone who assumes format IS the
right key) wrongly permit some future encrypted-audio edge case the current contract doesn't
carry but doesn't rule out either.

**This can't be enforced at compile time**, and that should be said plainly rather than papered
over with a type that looks like it enforces more than it does: whether a *specific, already-
persisted* `bookId` is encrypted is a runtime fact (it's per-package, read from disk), not a
static property of `BookId` (which is just a branded string) or of `ContentFormat`. No type
signature on `getPlaintextPath(bookId: BookId)` can know this ahead of the lookup.

What the design DOES get from types:
1. **The interface boundary itself.** `PlaintextAssetProvider` is a distinct type from
   `ContentProvider`. A caller has to explicitly import and depend on
   `PlaintextAssetProvider`/`getPlaintextPath` to reach this at all — there is no path through the
   `ContentProvider` surface that "accidentally" reaches it, and no shared method name to overload.
2. **The runtime guard is where the real enforcement lives, and it is UNCONDITIONAL** — checked
   first, before any filesystem access, symmetric with how `decryptBook()` already checks
   `assertLengthInvariant`/`isLicenceExpired` before touching the raw key:

   ```ts
   // src/features/encryption/contentStore.ts (implementation, once 3a/3b below are agreed)
   async function getPlaintextPath(bookId: BookId): Promise<string> {
     const pkg = resolvePackage(bookId);
     if (!pkg) {
       throw new ContentFailure(ContentError.DECRYPTION_FAILED, bookId,
         new Error('no stored package for this book — call store() first'));
     }
     if (pkg.encryption !== null) {
       throw new ContentFailure(ContentError.NOT_PLAINTEXT, bookId,
         new Error('getPlaintextPath is for never-encrypted content only — this package is encrypted'));
     }
     if (isElite(pkg)) {
       throw new ContentFailure(ContentError.NOT_PLAINTEXT, bookId,
         new Error('Elite content has no on-disk copy to return a path to'));
     }
     if (isLicenceExpired(pkg)) {
       throw new ContentFailure(ContentError.LICENCE_EXPIRED, bookId);
     }
     return contentFile(bookId).uri; // the SAME path store() already wrote to — no new file
   }
   ```

   This is fail-closed in the same style `errors.ts`'s own header already requires of every
   `ContentStore` method ("FAIL-CLOSED. Every code is a hard DENY"), and it is Abhinav's file to
   actually write — shown here only to demonstrate the guard is real and checkable, not to
   pre-empt his implementation.
3. **A dedicated error code** (`ContentError.NOT_PLAINTEXT` below) makes "you called this on
   encrypted content" a distinguishable, typed, testable outcome — not a generic
   `DECRYPTION_FAILED` that would blur "you don't have the key" together with "you asked the wrong
   question of the wrong package."

## 4. Proposed diff

### `src/shared/contracts/errors.ts`

```diff
 export enum ContentError {
   INTEGRITY_FAILED = 'INTEGRITY_FAILED',
   DECRYPTION_FAILED = 'DECRYPTION_FAILED',
   LICENCE_INVALID = 'LICENCE_INVALID',
   LICENCE_EXPIRED = 'LICENCE_EXPIRED',
   KEYSTORE_UNAVAILABLE = 'KEYSTORE_UNAVAILABLE',
+
+  // getPlaintextPath (content-provider.ts's PlaintextAssetProvider) was called for a package
+  // that IS encrypted, or that has no on-disk plaintext copy (Elite). Distinguished from
+  // DECRYPTION_FAILED on purpose: this is "you asked the wrong question of this package," not
+  // "the key/tag didn't work." Never thrown for getBook/decryptBook.
+  NOT_PLAINTEXT = 'NOT_PLAINTEXT',
 }
```

Purely additive — no existing member renamed or removed, so per CLAUDE.md's freeze rules this is
in the "safe" category, but it's included in this Gate ask rather than assumed, since `errors.ts`
is explicitly co-frozen (Reader + Encryption) and the new member's *meaning* is worth agreeing on
by name, not just its addition.

### `src/shared/contracts/content-provider.ts`

```diff
 // The seam the Reader (epub.js / pdf.js) codes against. ONE call, whole book.
 export interface ContentProvider {
   getBook(bookId: BookId): Promise<Bytes>;
 }
+
+// A SEPARATE seam from ContentProvider above, deliberately — see the Contracts-Gate proposal
+// this was added from (src/features/reader/audio/CONTRACTS_GATE_PROPOSAL_PLAINTEXT_PATH.md) for
+// the full "why not just a new method on ContentProvider" rationale. Exists so a caller that
+// genuinely knows it is dealing with never-encrypted content (today: an audio player) can get a
+// URI instead of paying a whole-file RAM copy through getBook — audio was never encrypted, so it
+// never needed the "decrypt whole book into RAM" step ContentProvider exists to gate.
+export interface PlaintextAssetProvider {
+  /**
+   * Absolute path to this book's plaintext content, already on disk. No decrypt, no RAM copy —
+   * same cost class as ContentStore.isAvailableOffline.
+   *
+   * REJECTS ContentFailure(NOT_PLAINTEXT) if the stored package IS encrypted (pkg.encryption !==
+   * null — NOT keyed off ContentFormat; an EPUB/PDF can be legitimate open access too, see
+   * contentStore.test.ts's "open access" block) or is Elite (no disk copy exists). Also rejects
+   * DECRYPTION_FAILED (nothing stored) / LICENCE_EXPIRED, same as decryptBook — a never-encrypted
+   * Subscription-tier book still carries a real licence.expiresAt and this must not become a
+   * second way to read past it.
+   */
+  getPlaintextPath(bookId: BookId): Promise<string>;
+}
```

### `src/shared/contracts/__typecheck__.ts`

```diff
 import type {
   EncryptedPackage,
   SyncRecordBase,
   Locator,
   ContentProvider,
+  PlaintextAssetProvider,
   BookSearchIndex,
   ContentFormat,
   Bytes,
   ...
 } from '@/shared/contracts';
+import { ContentError } from '@/shared/contracts';

 // --- getBook stays async (Promise<Bytes>), not a sync in-RAM read ----------
 true satisfies ReturnType<ContentProvider['getBook']> extends Promise<Bytes> ? true : false;
+
+// --- getPlaintextPath returns a string path, not Bytes — pins the two seams apart ---
+true satisfies ReturnType<PlaintextAssetProvider['getPlaintextPath']> extends Promise<string> ? true : false;
+
+// --- the dedicated error code exists and is distinct from DECRYPTION_FAILED ---
+true satisfies ContentError.NOT_PLAINTEXT extends ContentError.DECRYPTION_FAILED ? false : true;
```

The canary can pin the *shapes*, not the runtime guard (§3) — that needs a real test in
`contentStore.test.ts` (Abhinav's file), e.g. "getPlaintextPath rejects NOT_PLAINTEXT for an
encrypted EPUB fixture" and "getPlaintextPath rejects LICENCE_EXPIRED for an expired open-access
audio fixture," mirroring the existing "open access (no encryption)" describe block's style. Not
drafted here — implementation and its tests are Abhinav's call once the shape above is agreed.

## 5. What changes downstream once this lands

**Exactly one file:** `src/features/reader/audio/audioAssetResolver.ts`. The `AudioAssetResolver`
interface (Reader-owned, already shipped in Phase 1) does not change at all — that's the entire
point of naming the stopgap a stopgap. Only its implementation swaps:

```diff
-async function resolveAudioAssetUriStopgap(bookId: BookId): Promise<string> {
-  const bytes = await getBook(bookId);
-  const file = scratchFileFor(bookId);
-  ...write bytes to file...
-  await closeBook(bookId);
-  return file.uri;
-}
+async function resolveAudioAssetUriViaContentProvider(bookId: BookId): Promise<string> {
+  return `file://${await plaintextAssetProvider.getPlaintextPath(bookId)}`;
+}
```

No duplicate file, no whole-file RAM copy, no `closeBook` bookkeeping (there was never a session to
close). The `STOPGAP_AUDIO_EXTENSION` hardcode also stops being necessary IF `getPlaintextPath` (or
a small follow-up) also exposes `mimeType` — worth deciding in the same Gate conversation whether
that's a second return field here or a separate `getMimeType`-style accessor; not resolved by this
proposal, flagged so it doesn't get lost.

## 6. Open question for the Gate conversation, not resolved here

Should `getPlaintextPath` live on `ContentStore` too (mirroring how `getBook`/`decryptBook` are
both `ContentStore` methods AND the thing `ContentProvider.getBook` delegates to), or only on the
new `PlaintextAssetProvider`/`contentProvider.ts` (Reader's thin wrapper)? This proposal drafts it
as a `contentProvider.ts`-level addition (delegating to a same-named `contentStore.ts` internal
function) to match `getFormat`'s own precedent in that file, but whether `ContentStore` itself
(the frozen interface Encryption implements) needs the method added too is Abhinav's call — he
owns the store, and BookmarksPanel-style precedent isn't available for something this new.
