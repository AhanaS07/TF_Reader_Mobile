// src/shared/contracts/__typecheck__.ts
// CONTRACT CANARY — CAP-7 Reader & Offline (Team t4targaryen)
//
// This file has NO runtime purpose. It is never imported by app code; it exists
// only so `tsc --noEmit` (and therefore CI) goes RED the moment a frozen shape
// changes. Each `satisfies` pins a shape; each `@ts-expect-error` pins a shape we
// deliberately REMOVED — if someone re-adds it, the directive becomes unused and
// tsc fails. If this file errors, a Week-1 freeze was broken; find out why before
// merging, don't "fix" the canary.
//
// Also validates the wiring: importing via '@/shared/contracts' exercises the
// tsconfig `paths` alias AND the index.ts barrel in one line.

import { ContentError, ContentFailure } from '@/shared/contracts';
import type {
  EncryptedPackage,
  SyncRecordBase,
  Locator,
  ContentProvider,
  BookSearchIndex,
  ContentFormat,
  Bytes,
} from '@/shared/contracts';

// --- ContentError is a real enum (value import must work) ------------------
ContentError.INTEGRITY_FAILED satisfies ContentError;

// --- ContentFailure is an Error subclass carrying code + bookId ------------
const _fail = new ContentFailure(ContentError.DECRYPTION_FAILED, 'book_1');
_fail satisfies Error; // must be catchable as an Error / pass instanceof
_fail.code satisfies ContentError; // typed, switchable discriminant
_fail.bookId satisfies string; // context travels to the catch site

// --- ContentFormat is exactly the three wire values -----------------------
'PDF' satisfies ContentFormat;
'EPUB' satisfies ContentFormat;
'AUDIO' satisfies ContentFormat;
// @ts-expect-error only PDF | EPUB | AUDIO are frozen
'MOBI' satisfies ContentFormat;

// --- Locator discriminants are UPPERCASE ----------------------------------
({ type: 'EPUB', cfi: 'epubcfi(/6/4)' }) satisfies Locator;
({ type: 'PDF', page: 12 }) satisfies Locator;
// @ts-expect-error lowercase discriminants were reconciled out
({ type: 'epub', cfi: 'x' }) satisfies Locator;

// --- SyncRecordBase: updatedAt / synced are NON-null (client-edit-time LWW) -
({ id: 'r1', userId: 'u1', updatedAt: 123, isDeleted: false, synced: true }) satisfies SyncRecordBase;
// @ts-expect-error updatedAt must exist at edit time — nullable was reverted
({ id: 'r1', userId: 'u1', updatedAt: null, isDeleted: false, synced: true }) satisfies SyncRecordBase;

// --- EncryptedPackage: BOTH length fields ship (option (b), Abhinav's call) --
// cipherLength is REQUIRED alongside originalLength. The store asserts
// `content.length === cipherLength === 12 + originalLength + 16` at store() and
// raises INTEGRITY_FAILED on mismatch — the type system can pin the fields'
// presence, but NOT that identity, so the assertion is an implementation
// obligation on Encryption.
//
// Reversal guard: this line goes red if anyone drops cipherLength again. It is
// a keyof check rather than a @ts-expect-error because a missing-property error
// is reported at the literal, not at a property line, which makes directive
// placement fragile (see the earlier cipherLength directive bug).
true satisfies 'cipherLength' extends keyof EncryptedPackage ? true : false;
({
  bookId: 'book_1',
  format: 'PDF',
  content: new Uint8Array() as Bytes,
  encryption: null,
  licence: null,
  cipherLength: 6373780,
  originalLength: 6373752,
  mimeType: 'application/pdf',
}) satisfies EncryptedPackage;

// --- BookSearchIndex.format never includes AUDIO (no text, no index) -------
'PDF' satisfies BookSearchIndex['format'];
// @ts-expect-error audio is never indexed
('AUDIO') satisfies BookSearchIndex['format'];

// --- getBook stays async (Promise<Bytes>), not a sync in-RAM read ----------
true satisfies ReturnType<ContentProvider['getBook']> extends Promise<Bytes> ? true : false;
