// Owner: Download (Abhinav).
//
// Conformance test over flambeau's PUBLISHED request/response shapes for the two endpoints this
// app actually calls (`POST /api/v1/loans`, `POST /api/v1/reading-sessions`) — as opposed to
// downloadManager.test.ts's tests, which prove the full orchestration (borrow -> session -> fetch
// -> store) works end to end. This file's only job is the wire boundary: does what we SEND match
// what flambeau documents, and does what we ASSUME about the response match what flambeau
// actually guarantees.
//
// Recommended in API_CONTRACT_REVIEW_CONTEXT.md §9: "A conformance test over the flambeau
// request/response shapes would have caught B4, B10 and B14, and is probably the highest-value
// single addition here." This is that test. Each section below cites which finding it guards.
//
// Contract sources: https://deepu1004.github.io/flambeau-api-contracts/ (flambeau-api.yaml),
// as transcribed into API_CONTRACT_REVIEW_CONTEXT.md §5 (A1), §6 (B10), §8 (field tables). This
// file has NO access to the YAML itself — the literal reference lists below are a manual
// transcription and can drift from the real spec the same way any of our own types can. Re-check
// them against flambeau-api.yaml directly if this file and reality ever disagree, don't just
// "fix" this file to match a guess.

import { borrowLoan, openReadingSession } from './readingSessionClient';
import { generateDeviceKeypair, publicKeyToRawBase64 } from '../encryption/deviceKeypair';
import { API_BASE_URL } from './config';
import { DownloadError } from './errors';
import type { Loan, ReadingSessionResponse } from '@/shared/contracts';

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  jest.clearAllMocks();
});

// ── A: request shape conformance ──────────────────────────────────────────────────────────────
// §8.1's table: BorrowRequest is `{ itemId }` only. ReadingSessionRequest's fields the client
// actually controls are `itemId, format, intent, devicePublicKey, wantSearchIndex` — `subject`
// and `loan` are explicitly NOT on the HTTP surface (flambeau derives them from the bearer token
// / ActiveLoanQuery). Asserting their ABSENCE is the valuable half of this section: sending them
// would be harmless against today's mock, but would be sending fields flambeau's real endpoint
// was never designed to read from the body at all.

describe('request shape — POST /api/v1/loans (BorrowRequest)', () => {
  it('sends exactly {itemId} — no more, no less', async () => {
    let sentBody: unknown;
    global.fetch = jest.fn().mockImplementation(async (url: string, init?: { body?: string }) => {
      if (url === `${API_BASE_URL}/api/v1/loans`) {
        sentBody = init?.body ? JSON.parse(init.body) : undefined;
        return new Response(
          JSON.stringify({
            loanId: 'l1',
            itemId: 'book-1',
            userId: 'u1',
            licenceModel: 'OPEN_ACCESS',
            status: 'ACTIVE',
            borrowedAt: new Date().toISOString(),
            canPersist: true,
            serverTime: new Date().toISOString(),
          } satisfies Loan),
          { status: 200 },
        );
      }
      return new Response(null, { status: 404 });
    });

    await borrowLoan('book-1');

    expect(sentBody).toEqual({ itemId: 'book-1' });
  });
});

describe('request shape — POST /api/v1/reading-sessions (ReadingSessionRequest)', () => {
  it('sends only documented fields, and never `subject` or `loan` (both come from the token/lease, not the body)', async () => {
    const { publicKey } = await generateDeviceKeypair();
    let sentBody: Record<string, unknown> | undefined;
    global.fetch = jest.fn().mockImplementation(async (url: string, init?: { body?: string }) => {
      if (url === `${API_BASE_URL}/api/v1/reading-sessions`) {
        sentBody = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
        return new Response(
          JSON.stringify({
            sessionId: 's1',
            itemId: 'book-1',
            expiresAt: new Date().toISOString(),
            serverTime: new Date().toISOString(),
            content: { url: 'http://localhost:4000/x', expiresAt: new Date().toISOString() },
          } satisfies ReadingSessionResponse),
          { status: 200 },
        );
      }
      return new Response(null, { status: 404 });
    });

    await openReadingSession('book-1', {
      format: 'EPUB',
      intent: 'STREAM',
      devicePublicKey: publicKeyToRawBase64(publicKey),
      wantSearchIndex: false,
    });

    const DOCUMENTED_REQUEST_FIELDS = new Set([
      'itemId',
      'format',
      'intent',
      'devicePublicKey',
      'wantSearchIndex',
    ]);
    expect(sentBody).toBeDefined();
    for (const key of Object.keys(sentBody!)) {
      expect(DOCUMENTED_REQUEST_FIELDS.has(key)).toBe(true);
    }
    // The specific, named regression this guards against — not just "no extra keys" in general.
    expect(sentBody).not.toHaveProperty('subject');
    expect(sentBody).not.toHaveProperty('loan');
  });
});

// ── B: response shape conformance — guards B4 ─────────────────────────────────────────────────
// wokay's `ContentGrant` has exactly {content, index, encryption}; flambeau's
// `ReadingSessionResponse` has {sessionId, itemId, loanId?, expiresAt, serverTime, content,
// index?, encryption?}. NEITHER has a licence/signature object anywhere (B4). This section pins
// two things: (1) the client must not require anything beyond the documented REQUIRED fields to
// parse a response successfully, and (2) a minimal, spec-legal response genuinely carries no
// `licence` — so `downloadManager.ts`'s LocalLicenceRecord really is synthesized locally, not read off
// the wire. If flambeau's contract ever grows a real signed licence, THIS assertion is what should
// start failing, on purpose, as the signal to revisit B4's "no" recommendation.

describe('response shape — POST /api/v1/reading-sessions (ReadingSessionResponse)', () => {
  it('a response with ONLY the required fields (no optional field, no licence) parses successfully', async () => {
    const { publicKey } = await generateDeviceKeypair();
    const minimalResponse = {
      sessionId: 's1',
      itemId: 'book-1',
      expiresAt: new Date().toISOString(),
      serverTime: new Date().toISOString(),
      content: { url: 'http://localhost:4000/x', expiresAt: new Date().toISOString() },
      // Deliberately absent: loanId, index, encryption — all optional per the spec.
    } satisfies ReadingSessionResponse;

    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify(minimalResponse), { status: 200 }));

    const result = await openReadingSession('book-1', {
      format: 'EPUB',
      intent: 'STREAM',
      devicePublicKey: publicKeyToRawBase64(publicKey),
      wantSearchIndex: false,
    });

    expect(result).toEqual(minimalResponse);
    // The B4 assertion: nothing about a real response — not even a minimal one, not even a fully
    // populated one — ever carries a licence. content-provider.ts's LocalLicenceRecord is a
    // downloadManager.ts-side construction, never a field this client reads off the wire.
    expect(result).not.toHaveProperty('licence');
  });
});

// ── C: error-code conformance — guards drift called out in A1/B10 ────────────────────────────
// `FlambeauErrorCode` (reading-session.ts) is a compile-time-only TS union — there is nothing to
// enumerate at runtime, so this list is a manual transcription of that type's current members and
// must be kept in sync with it by hand (same discipline SESSION_ERROR_CODE_MAP/FAIL_CLOSED_CODES
// already require of readingSessionClient.ts's own maintainer). What THIS section actually
// guards: that every code in that transcription is accounted for — either present in flambeau's
// DOCUMENTED set (API_CONTRACT_REVIEW_CONTEXT.md §5 A1), or explicitly listed in
// KNOWN_UNRATIFIED_CODES with the finding ID that disclosed it. A new code added to
// FlambeauErrorCode that is in neither list is exactly the undocumented-and-unnoticed drift A1/B10
// describe — this test forces a conscious choice (ratify it, or list it as known-unratified)
// instead of a silent addition.
describe('error-code conformance — FlambeauErrorCode vs. the documented contract (A1, B10)', () => {
  // Transcribed from reading-session.ts's FlambeauErrorCode — keep this in sync with that type.
  const MOBILE_FLAMBEAU_ERROR_CODES = [
    'VALIDATION_FAILED',
    'INVALID_DEVICE_PUBLIC_KEY',
    'UNAUTHENTICATED',
    'TOKEN_EXPIRED',
    'FORBIDDEN_SCOPE',
    'FORBIDDEN_INSTITUTION_MISMATCH',
    'NO_ENTITLEMENT',
    'ENTITLEMENT_EXPIRED',
    'ENTITLEMENT_SUSPENDED',
    'INSTITUTION_INACTIVE',
    'DOWNLOAD_NOT_PERMITTED',
    'DEVICE_LIMIT_REACHED',
    'NOT_FOUND',
    'CONTENT_NOT_READY',
    'NO_COPIES_AVAILABLE',
    'NO_ACTIVE_LOAN',
    'LOAN_NOT_ACTIVE',
    'OFFER_EXPIRED',
  ] as const;

  // wokay's own 11-member enum, PLUS the members flambeau's document adds from DenyReason/its own
  // raisable set (API_CONTRACT_REVIEW_CONTEXT.md A1) — i.e. flambeau's side of A1, which mobile's
  // type already takes (B10's own note: "mobile sides with flambeau"). Deliberately NOT wokay's
  // published 11 alone — that list explicitly EXCLUDES TOKEN_EXPIRED/INSTITUTION_INACTIVE, and
  // mobile correctly keeps both per flambeau's stated rationale.
  const DOCUMENTED_BY_FLAMBEAU = new Set([
    'UNAUTHENTICATED',
    'FORBIDDEN_SCOPE',
    'FORBIDDEN_INSTITUTION_MISMATCH',
    'NO_ENTITLEMENT',
    'CONTENT_NOT_READY',
    'DOWNLOAD_NOT_PERMITTED',
    'NOT_FOUND',
    'VALIDATION_FAILED',
    'TOKEN_EXPIRED',
    'INSTITUTION_INACTIVE',
    'NO_COPIES_AVAILABLE',
    'NO_ACTIVE_LOAN',
    'LOAN_NOT_ACTIVE',
    'DEVICE_LIMIT_REACHED',
    'OFFER_EXPIRED',
    'ENTITLEMENT_EXPIRED',
    'ENTITLEMENT_SUSPENDED',
  ]);

  // B10: "INVALID_DEVICE_PUBLIC_KEY — in neither contract. wokay's prose says a short key 'is
  // rejected' but names no code." Explicitly disclosed here rather than silently passing.
  const KNOWN_UNRATIFIED_CODES: Record<string, string> = {
    INVALID_DEVICE_PUBLIC_KEY: 'B10 — in neither contract; wokay names no code for a rejected key',
  };

  it('every FlambeauErrorCode member is either documented by flambeau, or explicitly disclosed as unratified', () => {
    const undisclosed = MOBILE_FLAMBEAU_ERROR_CODES.filter(
      (code) => !DOCUMENTED_BY_FLAMBEAU.has(code) && !(code in KNOWN_UNRATIFIED_CODES),
    );
    expect(undisclosed).toEqual([]);
  });

  it('CODE_TAKEN / TOO_MANY_IDS / STALE_VERSION (admin/batch-only codes) are correctly absent from the reader-facing type', () => {
    // B10: these three are real wokay codes, but the reader can never reach the admin/batch
    // endpoints that raise them — their absence here is correct, not a gap. Pinned so a future
    // "completeness" pass doesn't add them back under a mistaken belief they were missed.
    for (const adminOnlyCode of ['CODE_TAKEN', 'TOO_MANY_IDS', 'STALE_VERSION']) {
      expect(MOBILE_FLAMBEAU_ERROR_CODES).not.toContain(adminOnlyCode);
    }
  });
});

// ── D: mapped-code behavior for representative documented codes ──────────────────────────────
// downloadManager.test.ts already covers NO_ENTITLEMENT (loans) and DOWNLOAD_NOT_PERMITTED
// (reading-sessions) end to end. This section covers the other half of B10: codes that WERE
// promoted (pin the new dedicated member), and a code that deliberately was NOT (pin that the
// generic fallback + preserved `cause` still works) — so a future promotion shows up here as a
// test that needs deliberately updating, not one that silently keeps passing either way.
describe('promoted vs. still-generic error codes (B10)', () => {
  it('TOKEN_EXPIRED is promoted to its own DownloadError member, not the generic fallback', async () => {
    const { publicKey } = await generateDeviceKeypair();
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          status: 401,
          code: 'TOKEN_EXPIRED',
          message: 'token expired',
          path: '/api/v1/reading-sessions',
        }),
        { status: 401 },
      ),
    );

    await expect(
      openReadingSession('book-1', {
        format: 'EPUB',
        intent: 'STREAM',
        devicePublicKey: publicKeyToRawBase64(publicKey),
        wantSearchIndex: false,
      }),
    ).rejects.toMatchObject({
      code: DownloadError.TOKEN_EXPIRED,
      cause: { code: 'TOKEN_EXPIRED' },
    });
  });

  it('LOAN_NOT_ACTIVE (deliberately not promoted) still falls back to generic LOAN_FAILED, with the real code preserved as cause', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          status: 409,
          code: 'LOAN_NOT_ACTIVE',
          message: 'loan is not active',
          path: '/api/v1/loans',
        }),
        { status: 409 },
      ),
    );

    await expect(borrowLoan('book-1')).rejects.toMatchObject({
      code: DownloadError.LOAN_FAILED,
      cause: { code: 'LOAN_NOT_ACTIVE' },
    });
  });
});
