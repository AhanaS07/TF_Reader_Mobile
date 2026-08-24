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

## 6. Bookmark/highlight locator-duplication — a backend contract this client now depends on

Two devices can each independently create a bookmark or highlight at the same position while both
are offline - they mint different ids for what is semantically the same thing, and nothing catches
it until both reach the server. `bookmarkStore.add()` / `highlightStore.add()` now pre-check local
SQLite for an existing active row at the same locator (same-device duplicates, or a span already
pulled from another device), but that cannot see a genuine concurrent create on a device that is
*also* still offline - only the server can.

**The backend contract this depends on:** a unique constraint on `(userId, bookId, locator)` for
bookmarks and `(userId, bookId, startLocator, endLocator)` for highlights, rejecting the second
`CREATE` with **409**, and distinguishing it from an ordinary same-id retry (a dropped-connection
resend, which must keep succeeding via PUT) by the response body's `message` field:

| `message` | Meaning | Client behaviour |
| --- | --- | --- |
| `"BOOKMARK_LOCATOR_DUPLICATION"` | Different id already occupies this locator | Adopt the existing document, discard this device's own id |
| `"HIGHLIGHT_LOCATOR_DUPLICATION"` | Same, for highlights | Same |
| anything else (e.g. `"Bookmark '<id>' already exists"`) | Same id, dropped-connection retry | Unchanged: PUT to our own id |

`code` stays `CODE_TAKEN` / status `409` in both cases - **only `message` distinguishes them**, so
if the backend ever changes that string, `syncEngine.ts`'s `LOCATOR_DUPLICATION_MESSAGES` set (and
this table) have to change with it, in the same deploy.

**Resolution, client-side (`syncEngine.ts`, `LocatorCollision`):** on the duplication message, the
client does NOT retry under its own id - a PUT there would 404, since that id never existed
server-side. Instead it lists the collection, finds the record matching its own locator, adopts
that record under **its** id via the normal `applyServerRecord` path, and hard-deletes (no
tombstone - nothing else has seen this id) its own local row. Counted as a resolved conflict, same
as any other.

**Not yet handled:** there is no "find by locator" endpoint, so resolution lists the whole
collection and matches client-side (`findDuplicateRecord`). Fine while a book's bookmarks/highlights
stay small; a dedicated query is the honest fix if that stops being true.

---

## 7. `pull()` is now multi-book; the stores are now multi-book/multi-user CAPABLE, not yet USED that way

`syncEngine.ts`'s `pull()` used to hard-code a single `BOOK_ID` for every userBook-scoped
collection - the comment that used to sit on `pull()` called this out explicitly as a prototype
limitation. **That loop is fixed now**: it pulls progress/bookmarks/highlights/downloads for
*every* book this device has a local `downloads` row for (`downloadStore.downloadedBookIds()`),
not one hard-coded id. A book only ever enters that list by being downloaded on this device first -
`pull()` refreshes data for books already held, it does not discover new ones from the server.

`bookmarkStore`, `highlightStore`, `progressStore`, and `downloadStore`'s convenience methods
(`recordCompleted`/`list`/`currentForBook`/`isBookValid`/`setValidity`) now all accept optional
`bookId`/`userId` parameters, defaulting to the hard-coded `BOOK_ID`/`USER_ID` constants - **every
existing caller keeps identical behaviour**, nothing was required to change.

**What this does NOT do, and whose call it is:** `readerBookmarks.ts`/`readerHighlights.ts`
(Personalization, Vaishnavi) and whatever calls them in Reader do not pass a real `bookId` today -
they were single-book all the way up before this, independently of Sync. Threading a real book id
from Reader through Personalization's adapters into these now-capable Sync functions is needed
before multi-book bookmarks/highlights actually work end-to-end; it's flagged here, not done, since
it means changing files this table doesn't own.

`personalizationStore`/`accessibilityStore` were deliberately left out of this - they're
`SCOPE: 'user'`, singleton-per-user by contract, and the field-level merge work already changes
enough about them in the same area without also touching their id derivation.

---

## 8. Pull-merge convergence bug: a preserved pending edit's outbox payload was going stale

`mergeFieldLevel` (§ field-level merge, above) used to hard-code the merged row's `synced` flag to
`1` on every successful merge - regardless of whether the row already had a genuine pending local
edit (`synced: 0`) before the merge ran. Concretely: device has an unsynced `zoom` edit queued;
a pull discovers a remote `theme` change from another device; the merge correctly keeps `zoom`
local and adopts `theme` from remote - but then marked the row fully synced anyway. The outbox
entry queued for the `zoom` edit still existed (this bug never touched the outbox table itself),
but its payload was captured *before* the merge, so it did not carry the newly-adopted `theme`
field. The next push would have sent that stale snapshot and **silently reverted `theme`** back
to its pre-merge value - a real, if narrow, data-loss path.

**Fix, two parts:**
- `mergeFieldLevel` now sets `merged.synced = existing.synced` (preserve, not hard-code) - a row
  that was already pending stays pending regardless of which individual fields the merge just
  adopted from the incoming record.
- `syncEngine.ts`'s `pull()` - **not** `applyServerRecord` itself - refreshes the outbox entry to
  the merged payload whenever a merge leaves the row `synced: 0`. It has to live in `pull()`
  specifically: `applyServerRecord` is also called by `serverHasDiverged` *during an active push*
  for this same row, which already owns rebuilding the payload and clearing the outbox once
  `send()` succeeds (see § field-level merge above) - enqueuing from inside `applyServerRecord`
  too would insert a second outbox row that push's own `outboxStore.remove([op.id])` (keyed on the
  original op's id) would never find, leaving an orphaned duplicate. Confirmed by a real test
  failure when first attempted the other way.

Scoped to `mergeFields` tables only (personalization, accessibility) - progress/bookmarks/
highlights/downloads don't set `mergeFields`, so neither code path touches them.

---

## Not your problem, but it will land on you

| # | Item | Why it reaches Sync |
| --- | --- | --- |
| `C4` | wokay caps `items:batch` at 100 ids; flambeau's `GET /api/v1/library` deliberately doesn't paginate *because* of that cap | Whoever builds a library shelf hits both constraints together — a shelf over 100 must use the paged `GET /api/v1/loans`. Worth designing once rather than discovering |
| `B5` | Loans are borrowed and never returned, so ELITE copies leak | `downloadStore` is where a downloads row is written; a return-on-delete flow touches it |
| `B1` | There is no auth anywhere in the app | When a token exists, `syncApi.ts`'s `request()` needs the header too — it has none today either |
