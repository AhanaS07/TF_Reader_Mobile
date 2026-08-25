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

import {
  ContentError,
  ContentFailure,
  DEFAULT_PREFS,
  DEFAULT_ACCESSIBILITY_PREFS,
  createDefaultAccessibilityPrefs,
  resolveReduceMotion,
} from '@/shared/contracts';
import type {
  EncryptedPackage,
  SyncRecordBase,
  Locator,
  ContentProvider,
  BookSearchIndex,
  ContentFormat,
  Bytes,
  SharedPrefs,
  Theme,
  AccessibilityPrefs,
  ReduceMotion,
  TtsHighlightMode,
  ReadingIntent,
  LicenceModel,
  Loan,
  ReadingSessionResponse,
  FlambeauErrorCode,
  EncryptionDescriptor,
  AccessTier,
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
({ type: 'AUDIO', positionMs: 872_000 }) satisfies Locator;
({ type: 'AUDIO', positionMs: 872_000, trackId: 'ch-03' }) satisfies Locator;
// @ts-expect-error audio position is milliseconds under its own key, never PDF's `offset`
({ type: 'AUDIO', offset: 872_000 }) satisfies Locator;
// @ts-expect-error seconds-as-`position` was considered and rejected - positionMs only
({ type: 'AUDIO', position: 872 }) satisfies Locator;
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

// --- prefs is a PER-USER SINGLETON: bookId stays out ----------------------
// Reversal guard for the T4_Ahana -> dev_T4 decision. A keyof check rather than
// an expect-error directive: an excess-property error lands on the literal, not
// the property line, which makes directive placement fragile (see cipherLength).
false satisfies 'bookId' extends keyof SharedPrefs ? true : false;
true satisfies SharedPrefs extends SyncRecordBase ? true : false;

// --- accessibility is a COMPOSED block, NOT a second synced record --------
// It must carry no identity/sync fields of its own — one prefs record per user
// holds all of it, under one updatedAt.
true satisfies SharedPrefs['accessibility'] extends AccessibilityPrefs ? true : false;
false satisfies 'updatedAt' extends keyof AccessibilityPrefs ? true : false;
false satisfies 'id' extends keyof AccessibilityPrefs ? true : false;

// --- reduceMotion is a TRI-STATE, not a boolean ---------------------------
// A boolean cannot express "follow the OS" — `false` would be ambiguous between
// "user turned it off" and "user never chose". Pinned on the FIELD, not just the
// alias, so re-typing the field boolean fails even if ReduceMotion survives.
'system' satisfies AccessibilityPrefs['display']['reduceMotion'];
'on' satisfies ReduceMotion;
'off' satisfies ReduceMotion;
// @ts-expect-error the boolean shape was rejected at sign-off
false satisfies AccessibilityPrefs['display']['reduceMotion'];

// The stored value alone is not applicable — it only resolves against live OS
// state, so the resolver must stay part of the contract.
resolveReduceMotion('system', true) satisfies boolean;

// --- TTS highlight granularity is the three named modes -------------------
'sentence' satisfies TtsHighlightMode;
// @ts-expect-error paragraph-level sync was never in the union
'paragraph' satisfies TtsHighlightMode;

// --- Theme keeps 'highContrast' ONLY so old records still parse -----------
// Deprecated in favour of accessibility.display.highContrast, which is the
// single source of truth. Removing the variant is a breaking read, not a
// cleanup — it must outlive the migration.
'highContrast' satisfies Theme;
true satisfies 'highContrast' extends keyof AccessibilityPrefs['display'] ? true : false;

// --- DEFAULT_PREFS carries VALUES only, no identity/sync fields -----------
false satisfies 'id' extends keyof typeof DEFAULT_PREFS ? true : false;
false satisfies 'synced' extends keyof typeof DEFAULT_PREFS ? true : false;
DEFAULT_PREFS.accessibility satisfies AccessibilityPrefs;

// --- defaults are shared; "reset" must hand back a detached copy ----------
DEFAULT_ACCESSIBILITY_PREFS satisfies AccessibilityPrefs;
createDefaultAccessibilityPrefs() satisfies AccessibilityPrefs;

// --- ReadingIntent is exactly the two wire values --------------------------
// DOWNLOAD is refused for ELITE server-side regardless of this union — that's
// a runtime gate (Loan.canPersist), not something the type system can pin.
'STREAM' satisfies ReadingIntent;
'DOWNLOAD' satisfies ReadingIntent;
// @ts-expect-error only STREAM | DOWNLOAD are frozen
'BORROW' satisfies ReadingIntent;

// --- LicenceModel is exactly the three wire values --------------------------
// wokay's ENTITLED_UNLIMITED/ENTITLED_CONCURRENT are renamed to
// SUBSCRIPTION/ELITE at this file's boundary — pin the renamed values, not
// the spec's own names.
'OPEN_ACCESS' satisfies LicenceModel;
'SUBSCRIPTION' satisfies LicenceModel;
'ELITE' satisfies LicenceModel;
// @ts-expect-error only OPEN_ACCESS | SUBSCRIPTION | ELITE are frozen
'PREMIUM' satisfies LicenceModel;

// --- Loan: canPersist is THE download-button gate, not licenceModel --------
// institutionId / dueAt / returnedAt are legitimately optional (open access
// never expires; an individual subscriber has no institution) — omitted from
// this literal on purpose, not missing by oversight.
({
  loanId: 'loan_1',
  itemId: 'book_1',
  userId: 'user_1',
  licenceModel: 'SUBSCRIPTION',
  status: 'ACTIVE',
  borrowedAt: '2026-08-14T00:00:00Z',
  canPersist: true,
  serverTime: '2026-08-14T00:00:00Z',
}) satisfies Loan;

// --- ReadingSessionResponse: content ships a SignedUrl ---------------------
// loanId (open access) / index (wantSearchIndex unset) / encryption (open
// access or audio) are all legitimately absent — omitted here on purpose.
// content's cipherLength/originalLength/mimeType are ALSO optional on the
// real spec (a null field is omitted, not sent as null — see SignedUrl's own
// comment) — only url/expiresAt are required, so only those two appear here.
({
  sessionId: 'sess_1',
  itemId: 'book_1',
  expiresAt: '2026-08-14T00:05:00Z',
  serverTime: '2026-08-14T00:00:00Z',
  content: {
    url: 'https://example.com/signed',
    expiresAt: '2026-08-14T00:10:00Z',
  },
}) satisfies ReadingSessionResponse;

// --- ReadingSessionResponse: the real backend's licenceId/licenceModel/canPersist ------------
// Confirmed live against tf_reader_backend_temp (2026-08-23) — the real response carries these
// directly, which is what lets checkLicense.ts skip a separate borrow/loan call. See this file's
// header on ReadingSessionResponse.
({
  sessionId: 'sess_1',
  licenceId: 'loan_1',
  itemId: 'book_1',
  accessLevel: 'ENTITLED_UNLIMITED',
  licenceModel: 'SUBSCRIPTION',
  canPersist: true,
  expiresAt: '2026-08-14T00:05:00Z',
  serverTime: '2026-08-14T00:00:00Z',
  content: {
    url: 'https://example.com/signed',
    expiresAt: '2026-08-14T00:10:00Z',
  },
}) satisfies ReadingSessionResponse;

// --- FlambeauErrorCode wires through the barrel (sample, not exhaustive) ---
'NO_ACTIVE_LOAN' satisfies FlambeauErrorCode;
'DEVICE_LIMIT_REACHED' satisfies FlambeauErrorCode;
'TOKEN_EXPIRED' satisfies FlambeauErrorCode;

// --- EncryptionDescriptor.keyId is OPTIONAL, matching wokay's schema ---------
// Same "a null field is omitted, not sent as null" convention as SignedUrl
// above. keyFingerprint stays required — it is the anti-key-substitution check
// (CONTRACT_ALIGNMENT.md B3/C7), not an optional hint.
({
  algorithm: 'AES-256-GCM',
  layout: 'nonce(12) || ciphertext || tag(16)',
  wrappedBek: 'BASE64',
  wrapAlgorithm: 'RSA-OAEP-256',
  keyFingerprint: 'sha256:deadbeef',
}) satisfies EncryptionDescriptor;

// --- AccessTier carries no values of its own; it is LicenceModel ------------
// It used to spell the three tiers 'OA' | 'Subscribed' | 'Elite' — a FOURTH
// vocabulary for values that already had three (B9). Pins the collapse.
'SUBSCRIPTION' satisfies AccessTier;
// @ts-expect-error the old spelling is gone — nothing may reintroduce it
'Subscribed' satisfies AccessTier;
