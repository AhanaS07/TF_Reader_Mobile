# API_CONTRACT_NOTES.md — Sync

**Owner: Karthik. Status as of `83f4e2e` (2026-08-17).**

Sync's position in the wokay/flambeau contract review. The headline is unusual: **almost nothing in
this directory conflicts with either contract, because neither contract mentions any of it.** That
is the finding.

**Read before** changing `syncApi.ts`'s URL construction, `syncConfig.ts`'s base URLs, or adding a
new synced entity type. Nothing here has been changed in your code.

- Ledger and cross-capability view: `src/shared/contracts/CONTRACT_ALIGNMENT.md`
- Full evidence: `src/shared/contracts/API_CONTRACT_REVIEW_CONTEXT.md`

---

## 1. `C2` 🟠 — no contract covers CAP-7's sync surface at all

Neither published document defines progress, bookmarks, highlights, personalization, accessibility
prefs, outbox, or sync push/pull. **That is the majority of what CAP-7 actually ships**, and it is
entirely uncontracted.

This is nobody's conflict, and therefore nobody's action item unless it's raised. Both other teams
wrote their contract before their code — flambeau's own words: *"the contract is agreed before the
code, not after"* — and only two of their endpoints are actually implemented today.

**Recommendation: CAP-7 publishes its own contract file in the same style, so the cohort has three,
not two.** The material already exists: `localDb/schema.ts` for the shapes, and the controllers in
`TF_Reader_Backend`'s `modules/sync/backend/` for the routes. Doing this is also what makes `C1`
below a decision rather than a discovery.

**Take this to the Contracts Gate.** It is the one item on this list that only you can raise.

---

## 2. `C1` 🟡 — two separate prefix problems, and they shouldn't be conflated

Both contracts describe **one Spring Boot application** containing every team's modules, with
`/api/v1/**` split by subtree:

```
flambeau: /api/v1/auth/**  /api/v1/loans/**  /api/v1/reading-sessions
          /api/v1/holds/** /api/v1/library   /api/v1/items/{id}/availability
          /api/v1/ops/**
wokay:    /api/v1/institutions/**  /api/v1/catalogue/**
          /opds/v1/**              /api/admin/v1/**
```

That allocation is exhaustive. Against it:

### (a) The client claims subtrees nobody allocated

`syncApi.ts:180` builds every URL as `` `${API_V1}/${entityPath}` `` → `/api/v1/progress`,
`/api/v1/bookmarks`, `/api/v1/highlights`, `/api/v1/personalization`, `/api/v1/accessibility`,
`/api/v1/downloads`, `/api/v1/outbox`, `/api/v1/sync-metadata`. **None of those is allocated to
anyone.**

If the services ever merge into the single application both contracts describe, this matters
concretely: flambeau notes that *"one filter chain covers the whole app surface"* with a public-path
allowlist, so these paths would be **authenticated by flambeau's chain, which knows nothing about
them** — they would `401`, not `404`. That is a much more confusing failure than a missing route.

**Cheapest fix:** move CAP-7's surface under one clearly-owned subtree — `/api/v1/sync/**` — and
register it in the allocation. One claim to negotiate instead of eight scattered top-level ones.

### (b) The client and the tracked backend don't agree with each other

The tracked service in `TF_Reader_Backend` maps `@RequestMapping("/api/progress")`,
`/api/bookmarks`, `/api/highlights`, `/api/personalization`, `/api/accessibility`, `/api/downloads`,
`/api/outbox`, `/api/sync`, `/api/sync-metadata` — i.e. **`/api/*`, outside the contested
`/api/v1/**` space entirely.** The client's `API_V1` prefix targets a *different, untracked* "Mongo
backend" on port 9000 (`syncConfig.ts:43`).

So the tracked backend and this client cannot currently be talking to each other, and anyone
comparing them finds every path off by `/v1`. **Only you can say which service is canonical** —
worth answering before anyone reads a design intent into the mismatch. Note that (b) is arguably
good news for (a): the tracked backend's `/api/*` doesn't collide with either contract's claims.

---

## 3. `B6` 🟡 — revocation channel: now the `downloads` pull itself, not a separate feed

`GET /api/v1/loans/changes` was the contract's originally designed revocation channel, and this
section used to describe `loanChanges.ts` polling it. **That mechanism is now removed.** The
licence side changed how it publishes revocation: it writes `isValid` directly onto the
`downloads` document server-side (Mongo), rather than emitting it as an event on a feed this
device has to page through. `A10` (whether the feed lives at `/api/v1/loans/changes` or
`/api/v1/changes`) is therefore **moot** — there is no feed call left for the path to matter to.

**Why this is on your list and not only Abhinav's, unchanged from before:** it is still a
sync-shaped concern (pull, act-on-change) about a value Download/licence owns the source of.

- **This is still what makes Download's fail-open policy safe.** The app allows reads against
  already-persisted ciphertext on any unconfirmable error (`B7`), which means a revoked reader
  keeps reading offline indefinitely unless something eventually tells it otherwise. Fail-open
  plus a working entitlement check is a reasonable design; fail-open plus no check is a hole. The
  action on a revocation is still `ContentStore.destroy()`.
- **This is a real narrowing of what Sync can report, and needs Abhinav's sign-off, not just
  notice.** The old feed carried a `reason` (`ENTITLEMENT_REVOKED` vs `_EXPIRED` vs `_SUSPENDED` vs
  `LOAN_RETURNED` vs `LOAN_RENEWED`), which is what let `_EXPIRED` map to the non-destructive
  `'expired'` lock reason instead of `'revoked'`. A bare `isValid: boolean` carries none of that -
  `applyDownloadRecord` in `offlineLock.ts` currently emits `reason: 'revoked'` unconditionally for
  every `false` transition, because there is nothing else to go on. If the licence side's writer
  can distinguish "revoked" from "merely expired" (which Encryption already detects unaided from
  the licence it holds), that distinction needs to travel on the `downloads` document too, or every
  invalidation reason now triggers BEK destruction, including ones that never used to.

### Status — mechanism replaced (this change)

`offlineLock.ts` no longer reads a feed. `downloads` is one of the six collections
`syncEngine.ts`'s `pull()` already sweeps every run; `pull()` now routes each `downloads` record
through `applyDownloadRecord` instead of the generic `applyServerRecord` directly. That function
still calls the generic one underneath (so Last-Write-Wins still governs whether the record is
even applied), then diffs the row's `is_valid` before vs. after and emits `content.lock` /
`content.unlock` on the shared bus only on a genuine transition — a repeated revocation is not
re-announced. `LAST_LOAN_CHANGES_CURSOR` is gone (nothing pages through anything any more);
`LAST_ENTITLEMENT_CHECK_AT` stays, now set whenever the `downloads` collection is pulled, since
that pull IS the entitlement check now.

What it deliberately still does NOT do:

- **It does not gate reading.** Encryption remains the only gate. `is_valid` is advisory and exists
  so the UI can explain a locked book; `downloadStore.isBookValid()` still means "what the last
  check said", not "the column the reader gates on".
- **It does not destroy key material.** `reason: 'revoked'` is the privileged signal that asks
  Encryption to. Nothing subscribes yet — **that half is Abhinav's** and until it lands a
  revocation is recorded and announced but nothing acts on it.

Fail-open is unchanged, just inherited from the pull it now rides on rather than from its own
try/catch: offline, or any failed pull, means `applyDownloadRecord` is never called for anything,
so nothing changes and nothing is announced. `B7`'s hole therefore narrows but does not close — a
revoked book stays readable while the device stays offline, which still needs the Phase 6
anti-rollback high-water-mark.

**This still needs a joint decision, not just a Sync-side change.** `src/shared/contracts/
offline-lock.ts` — jointly owned by Sync and Encryption — documents a *previous* withdrawn attempt
at offline entitlement that had this exact shape: an externally-written, synced `is_valid` column
as a second, independent source of entitlement truth that could disagree with the `SignedLicence`
Encryption already verifies, and that propagated one device's verdict to every other device. That
file's own open question 3 says the column "must not be a synced column: one device's verdict must
not propagate as another device's truth" — which this design is. Whether that concern still
applies now that the write comes from the licence side itself (rather than from another device's
locally-computed verdict) is exactly the kind of thing that file exists to have agreed jointly
before being built, and it has not been re-visited here.

---

## 4. `B2`-adjacent 🟡 — three base URLs, none of them `:8080`

Not your finding, but two of the three constants are yours, so a fix touches this directory.

| Consumer | Constant | Value |
| --- | --- | --- |
| Download / reading sessions | `download/config.ts:31` | `:4000` — mock backend |
| Sync CRUD | `sync/syncConfig.ts:40` | `:9000` — Mongo backend |
| Book file + pdf.js assets | `sync/syncConfig.ts:47` | `:8090` — "old Spring app" |
| **Both contracts** | — | **`http://localhost:8080`** |

Both contracts specify `:8080` for everyone, so "point the app at the real backend" is currently a
three-place change across two owners. If CAP-7's surface ends up on the same application (`C1`), two
of these three collapse. Coordinate with Abhinav rather than each of you renaming your own constant.

`download/config.ts`'s header explains why Download doesn't reach into `sync/config.ts` — separately
owned modules, separate configs. That reasoning is sound and should survive any consolidation:
whatever replaces these should be one **env var**, not one module importing another's config.

---

## 5. `contractConformance.test.ts` — what it does and doesn't guard

Worth being explicit, because the name invites a wrong assumption. That test and
`shared/contracts/__typecheck__.ts` guard the **internal** Week-1 freeze — the seams between the
five of us. **No test in this repo asserts anything against wokay's or flambeau's published
shapes.** So "conformance is green" currently means "we agree with ourselves."

The review's assessment: a conformance test over the *external* request/response shapes, built from
the specs' own examples rather than from our types, is the highest-value single addition available.
For the flambeau side that's Abhinav's; if `C2` lands and CAP-7 publishes a contract, the same
pattern applies here.

---

## Not your problem, but it will land on you

| # | Item | Why it reaches Sync |
| --- | --- | --- |
| `C4` | wokay caps `items:batch` at 100 ids; flambeau's `GET /api/v1/library` deliberately doesn't paginate *because* of that cap | Whoever builds a library shelf hits both constraints together — a shelf over 100 must use the paged `GET /api/v1/loans`. Worth designing once rather than discovering |
| `B5` | Loans are borrowed and never returned, so ELITE copies leak | `downloadStore` is where a downloads row is written; a return-on-delete flow touches it |
| `B1` | There is no auth anywhere in the app | When a token exists, `syncApi.ts`'s `request()` needs the header too — it has none today either |
