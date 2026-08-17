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

**Proposed disposition, to ratify at the Gate before auth lands.** Today everything is
account-scoped by default, only because `prefs.ts` draws no account-vs-device line — that implicit
answer is wrong for the ergonomic fields. Proposed split:

| Field | Follows | Why |
| --- | --- | --- |
| reading position (progress) | **account** | resume anywhere; already account-scoped, not in this record |
| bookmarks / highlights | **account** | annotations are content, they travel with the reader |
| `theme` | **device** | phone vs tablet, OLED vs LCD differ; `'system'` is already device-derived |
| `font`, `typography` | **device** | ergonomics track screen size & viewing distance, not identity |
| `layout` (flow, spread) | **device** | `spread: 'double'` is a tablet affordance, meaningless on a phone |
| `zoom` | **device** | screen-size dependent |
| `accessibility` | **account (likely)** | a user's needs travel with them — but confirm in the a11y notes |

The catch: this record is a per-user singleton with no scope field, so honouring the split needs
**either** a `scope` discriminator added to the contract **or** a second device-local prefs store that
never syncs. That is a contract change, hence a Gate decision, not something to infer at auth time.
Until it's ratified, the code stays account-scoped and this table is the proposal, not the state.

Accessibility prefs have the same question and a different likely answer — see
`src/features/accessibility/API_CONTRACT_NOTES.md`.

---

## 5. `C2` material — the prefs wire contract, so the cohort can build against it

This is the Personalization slice of the review's `C2` recommendation (CAP-7 publishes its own
contract). Draft: pin it here first, promote to a shared `src/shared/contracts/` file if the Gate
greenlights an official CAP-7 contract (that placement is Ahana's call — `shared/` is hers).

**Transport:** CAP-7's own sync service (Karthik), not wokay/flambeau. A prefs record is a **per-user
singleton** — one per user, applied across all books, **no `bookId`** — extending `SyncRecordBase`:

```jsonc
{
  // identity / sync (SyncRecordBase)
  "id": "uuid",               // client-generated UUID
  "userId": "user-001",       // owner, sent with every change
  "updatedAt": 1755432000000, // client wall-time epoch-ms, stamped at EDIT time — LWW key, NON-null
  "isDeleted": false,         // soft-delete tombstone; for a singleton stays false except account cleanup
  "synced": false,            // false on create; sync layer flips true on ack

  // prefs values
  "theme": "system",          // 'light' | 'dark' | 'sepia' | 'system' | 'highContrast'(deprecated)
  "font":       { "family": "system", "customFontUri": "file://…" }, // customFontUri optional
  "typography": { "size": 16, "lineHeight": 1.5, "spacing": 0, "margins": 16 },
  "layout":     { "flow": "paginated", "spread": "single" }, // flow: paginated|scrolled-doc, spread: single|double
  "zoom":       { "level": 1.0 },                            // 1.0 = 100%
  "accessibility": { /* AccessibilityPrefs — shape owned by accessibility.ts, not restated */ }
}
```

**Semantics a consumer must honour:**

- **LWW on `updatedAt`**, stamped client-side at edit time so it works offline. Last *edit* wins, not
  last arrival; `updatedAt` must exist the moment the record is written.
- **"Reset to defaults" is a rewrite + `updatedAt` bump, not a delete** — a singleton has no tombstone.
- **`accessibility` is a composed view, not a co-stored blob.** It is its own synced record with its
  own row, endpoint and `updatedAt`; Sync joins the two on read and splits them on write
  (`features/sync/sharedPrefs.ts`). The split exists because folding a11y onto the prefs singleton made
  a theme edit and a TTS-rate edit share one `updatedAt`, so whole-record LWW silently dropped one.

**Defaults (`DEFAULT_PREFS`):** `theme: 'system'`, `font: { family: 'system' }`,
`typography: { size: 16, lineHeight: 1.5, spacing: 0, margins: 16 }`,
`layout: { flow: 'paginated', spread: 'single' }`, `zoom: { level: 1.0 }`,
`accessibility: DEFAULT_ACCESSIBILITY_PREFS`.

**Local persistence** — the nested shape flattens to the `personalization` table (accessibility is a
separate table); `theme` / `layout_flow` / `layout_spread` are validated against their unions on read,
not blind-cast, and `updated_at` is ISO-8601 UTC TEXT (epoch-ms ↔ ISO at the boundary). Full column
list and the adapter live in `personalizationRow.ts`.

**Open items a consumer should know:**

- **`typography.size` units are not yet agreed** (points vs scale-factor). `DEFAULT_PREFS` commits
  *points* (16) today; don't hardcode an interpretation until this closes (Ahana + Vaishnavi).
- **`theme: 'highContrast'` is deprecated** in favour of `accessibility.display.highContrast`, kept in
  the union only so old records parse. Migrate on read (`migratePrefs.ts`).

---

## 6. `typography.size` units + text-scale composition — proposed, pending Ahana

Closes prefs.ts DECISION LOG #4. This is a joint call with Ahana (she renders it); recorded here as a
proposal to ratify, not a settled answer. Schema-safe either way — the column is REAL, so nothing in
`personalizationRow.ts` changes. It blocks *Reader applying prefs*, not the store.

Three knobs scale text and their interaction was undecided:

| Knob | Where | Role |
| --- | --- | --- |
| `typography.size` | `prefs.ts` | user's base font size (reader "text size" control) — currently **not consumed** |
| `respectOsFontScale` | `accessibility.ts` | honour OS Dynamic Type |
| `fontScaleMultiplier` | `accessibility.ts` | extra user multiplier on top |

**Proposed units:** `typography.size` is **absolute points (pt)**, not a scale factor. `DEFAULT_PREFS`
already commits `size: 16`, which is only sensible as 16pt (16× would be absurd). It also gives each
knob a distinct job — if `size` were a multiplier it would duplicate `fontScaleMultiplier`.

**Proposed composition — base, then OS scale, then user multiplier:**

```
effectivePt = typography.size                          // chosen base, in pt
            × (respectOsFontScale ? osFontScale : 1.0) // OS Dynamic Type, if opted in
            × fontScaleMultiplier                       // extra a11y multiplier, last
```

This is exactly today's `resolveFontScale()` (`accessibility.ts`) multiplied by the pt base — additive,
not a reorder. `resolveFontScale` currently excludes `typography.size` on purpose "until its units are
agreed"; ratifying this is what lets it be fed in. Reader owns a final clamp to a sane min/max (impl
detail, not contract).
