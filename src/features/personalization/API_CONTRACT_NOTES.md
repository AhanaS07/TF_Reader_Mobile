# API_CONTRACT_NOTES.md — Personalization

**Owner: Vaishnavi. Status as of `83f4e2e` (2026-08-17).**

Short doc, because the honest finding is short: **neither wokay's nor flambeau's contract mentions
prefs, and this directory has no HTTP surface of its own.** Everything below is either a
consequence of that absence, or something that reaches you through Sync. Nothing here has been
changed in your code.

- Ledger and cross-capability view: `src/shared/contracts/CONTRACT_ALIGNMENT.md`
- Full evidence: `src/shared/contracts/API_CONTRACT_REVIEW_CONTEXT.md`
- The two items below are shared with `src/features/sync/API_CONTRACT_NOTES.md` — Karthik owns the
  transport, you own the shape.

---

## 1. `C2` 🟠 — prefs are part of the majority of CAP-7 that no contract covers

Neither published document defines personalization, progress, bookmarks, highlights, accessibility
prefs, outbox or sync push/pull. Both other teams wrote their contract **before** their code —
flambeau's own framing is *"the contract is agreed before the code, not after"* — and only two of
their endpoints are actually implemented today. CAP-7 wrote the code and never published a contract.

**The recommendation the review makes: CAP-7 publishes its own contract file, so the cohort has
three, not two.** Your part of that is small and specific: `DEFAULT_PREFS` /
`ReaderPrefs` (`shared/contracts/prefs.ts`) and `personalizationRow.ts`'s row shape are the material.
Nobody outside this repo can currently see what a prefs record looks like on the wire, which means
nobody outside this repo can build against it.

Worth doing before it's urgent. The alternative is that it gets defined by whoever writes the server
first.

## 2. `C1` 🟡 — `/api/v1/personalization` is a subtree nobody allocated

`syncApi.ts:180` builds `/api/v1/personalization` (among seven siblings). Both contracts split
`/api/v1/**` between wokay and flambeau **exhaustively**, and that path is in neither allocation.

If the services ever merge into the single Spring Boot application both contracts describe, this
fails in a confusing way rather than an obvious one: flambeau notes *"one filter chain covers the
whole app surface"* with a public-path allowlist, so an unallocated `/api/v1/**` path is
**authenticated by a chain that has never heard of it** — it `401`s rather than `404`s.

There is a second, separate mismatch: the tracked backend serves `/api/personalization` (no `/v1`),
while the client targets `/api/v1/personalization` on a different, untracked backend on port 9000.
Karthik's call which is canonical.

**Nothing for you to change** — the fix is one prefix decision in Sync (`/api/v1/sync/**` for the
whole CAP-7 surface). Listed here so that if you add a synced pref entity, you know the prefix under
it is unsettled and shouldn't be treated as stable.

---

## 3. What is *not* a problem

Recorded so a contract sweep doesn't generate work here.

- **Prefs never cross the wokay/flambeau boundary.** They are device-and-account state, synced
  through CAP-7's own service. No field here mirrors a contract shape, so no field here can diverge
  from one.
- **`DEFAULT_PREFS` and `createDefaultAccessibilityPrefs()` are pinned in
  `shared/contracts/__typecheck__.ts`**, including the "reset hands back a detached copy" property.
  That's the internal freeze doing its job. Be aware it guards **only** the internal seam — no test
  in this repo asserts anything against an external contract.
- **`migratePrefs.ts` is yours alone.** Schema versioning of a local store is exactly the kind of
  thing a published contract should *not* dictate.

---

## 4. One thing to watch, when auth lands

`B1` — the app currently sends no `Authorization` header anywhere, and has no token at all. When that
is fixed (Abhinav + CAP-6), prefs sync becomes **per-account** in a way it isn't today: right now
`syncApi.ts` writes against a `USER_ID` constant with no server-side identity behind it.

The question that will surface then, and is worth deciding before rather than after: **do prefs
follow the account or the device?** Reading position clearly follows the account. Font size and
theme arguably follow the device — a phone and a tablet want different values, and syncing them is a
downgrade, not a feature. `shared/contracts/prefs.ts` currently makes no distinction, so today the
answer is "account, implicitly."

Accessibility prefs have the same question and a different likely answer — see
`src/features/accessibility/API_CONTRACT_NOTES.md`.
