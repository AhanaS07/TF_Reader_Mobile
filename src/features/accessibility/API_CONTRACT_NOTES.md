# API_CONTRACT_NOTES.md — Accessibility

**Owner: Hruthik. Status as of `83f4e2e` (2026-08-17).**

**The honest headline: the API contract review found nothing wrong in this directory, because there
is nothing in it yet, and because neither wokay's nor flambeau's contract mentions accessibility at
all.** This doc exists so that when you do start building, the four things that will reach you are
already written down rather than discovered.

Nothing here has been changed in your code.

- Ledger and cross-capability view: `src/shared/contracts/CONTRACT_ALIGNMENT.md`
- Full evidence: `src/shared/contracts/API_CONTRACT_REVIEW_CONTEXT.md`
- The TTS seam you'll build against: `src/features/reader/TTS_PROVIDER.md` (Ahana) — read that
  first; it's the source of truth for that interface and is not part of this review.

---

## 1. What already exists for you, and is already pinned

You have more of a contract than the directory suggests:

- **`shared/contracts/accessibility.ts`** — `AccessibilityPrefs`, `ReduceMotion`,
  `TtsHighlightMode`, `DEFAULT_ACCESSIBILITY_PREFS`, `createDefaultAccessibilityPrefs()`. Also
  `TTS_PITCH_MIN`/`TTS_PITCH_MAX`/`isValidTtsPitch` (2026-08-20), added alongside the existing rate
  bounds once `tts.pitch` got a UI — `sharedPrefs.ts` now clamps it on read the same way it already
  clamped rate.
- **`shared/contracts/__typecheck__.ts`** pins all of it, including that "reset" hands back a
  **detached copy** rather than a shared reference to the defaults. That property is load-bearing —
  if it broke, resetting one reader's prefs would mutate the defaults for everyone.
- **`sync/stores/accessibilityStore.ts`** — the persistence and sync path, Karthik's.
- **`src/features/reader/tts/readerTextProvider.ts`** — the permanent, agreed text-provider contract,
  plus `fakeReaderTextProvider.ts`, which serves canned sentences with **synthetic CFIs that resolve
  against no book** so you can build a TTS session before the real provider exists.
- **`WEBVIEW_A11Y_FINDINGS.md`** (this directory) — consolidated desk research on WebView/epub.js
  screen-reader accessibility (VoiceOver/TalkBack), including the architecture split between native
  RN and the Reader WebView and the risk register that governs it. **`WEBVIEW_A11Y_SPIKE.md`** is
  the on-device spike instrument it depends on — not yet run.

**On the fake:** it is scaffolding and it is meant to be substituted, not extended. Its test file
pins properties of the *seam*, not of the fake, so it's the checklist the real provider must satisfy
— port it rather than dropping it. The test-only handles live on `FakeReaderTextProvider` and
deliberately **not** on `ReaderTextProvider`, so production code typed against the interface can't
reach them. If something outside `reader/tts/` breaks when the fake is deleted, the boundary leaked
and that's the bug. `CLAUDE.md` has the four-item deletion table.

The real provider is blocked behind converting the WebView JS to a typechecked build — see
`src/features/reader/WEBVIEW_BRIDGE.md`. That's Ahana's sequencing, not a decision you need to make,
but it's why the fake exists.

---

## 2. `C2` 🟠 — accessibility prefs are part of the uncontracted majority

Neither published contract defines accessibility prefs, personalization, progress, bookmarks,
highlights, outbox, or sync push/pull. That's the bulk of what CAP-7 ships, and it is entirely
uncontracted — while both other teams published a contract *before* writing code, and have
implemented only two endpoints so far.

The review recommends **CAP-7 publish its own contract file, so the cohort has three, not two.** Your
part is `accessibility.ts` plus whatever `accessibilityStore` puts on the wire. It's small; the value
is that nobody outside this repo can currently see what an accessibility record looks like, so nobody
outside this repo can build for it.

## 3. `C1` 🟡 — `/api/v1/accessibility` is a subtree nobody allocated

`syncApi.ts:180` builds `/api/v1/accessibility` among seven siblings. Both contracts split
`/api/v1/**` between wokay and flambeau **exhaustively**, and that path is in neither allocation.

The failure mode if the services ever merge is worth knowing because it's misleading: flambeau notes
*"one filter chain covers the whole app surface"* with a public-path allowlist, so an unallocated
`/api/v1/**` path gets **authenticated by a chain that has never heard of it** — it `401`s rather than
`404`s. You'd be debugging auth when the real problem is routing.

Nothing for you to fix (the answer is one prefix decision in Sync — `/api/v1/sync/**` for the whole
CAP-7 surface). Listed so you don't treat the prefix as settled if you add a synced entity.

---

## 4. The decision that *is* yours, and is worth making early

**Do accessibility prefs follow the account or the device?**

Nothing in the frozen contract distinguishes them, so today the answer is "account, implicitly" —
`accessibilityStore` syncs like everything else. That is very likely **wrong for this category
specifically**, and more so than for ordinary personalization:

- A screen-reader user's TTS rate, voice and highlight mode are **properties of how they use a
  device**, not of their library. Syncing them to a shared tablet, or from a phone with headphones to
  a desktop without, actively degrades the experience.
- `ReduceMotion` in particular usually mirrors an **OS-level** setting. If the OS says reduce motion
  and a synced pref says otherwise, the OS should win — and there's currently no field expressing
  "follow the system" as distinct from an explicit user choice.

Decide this before there are two devices in play. Retrofitting a per-device scope onto an
already-syncing pref is a migration; getting it right now is a field. `migratePrefs.ts`
(personalization) is the precedent for how a local schema change gets versioned.

Related and unsettled the same way, from `personalization`'s notes: reading position clearly follows
the account, font size arguably follows the device.

---

## 5. One thing that will reach you when auth lands

`B1` — the app currently sends no `Authorization` header anywhere and has no token at all;
`syncApi.ts` writes against a `USER_ID` constant with no server-side identity behind it. When that's
fixed, everything synced becomes genuinely per-account, which is the moment §4's answer starts
mattering in production rather than in theory.

Also worth knowing, because it affects what a TTS session can assume: the app's per-open entitlement
check (`verifyReadingAccess`) **fails open** on any unconfirmable error, and the change feed that is
supposed to make that safe is unimplemented (`B6`/`B7`, Download's list). A long TTS session over an
already-downloaded book will not be interrupted by a revocation today. That's the current accepted
behaviour, not a guarantee to build on — if `B6` lands, a revocation mid-session becomes possible and
a TTS session needs to handle the book's key being destroyed underneath it.

---

## 6. `accessibility.tts.highlightMode === 'word'` — engine-half attempt reverted; still deferred

**2026-09-02** landed an engine-side attempt at this: native `tts-progress` subscribed
(`ttsEngine.ts:TTS_EVENTS`), normalized per-platform in `ttsProgress.ts`, and dispatched from
`useTtsSession.ts` via a new `setSpokenWordRange(cfi, start, end)` on `ReaderTextProvider`, which
sent a new `setSpokenWordRange` bridge command wired into `readerBridge.ts` (`ReaderCommand`,
`READER_COMMANDS`, `buildCommandScript`) — all landed on the RN side, ahead of the WebView half
(`webview/src/bridge.ts`'s `CommandArgs`, `epub.entry.ts`, `pdf.entry.ts`), which was never
implemented.

**2026-09-07: reverted in full.** Landing only the RN-side half broke `npm run typecheck` in CI
(`CommandArgsAreExhaustive`/`CommandArgsMatchPayloads` in `bridge.ts`, plus both `TFReaderApi`
implementations missing the property) — expected, per the exhaustiveness design, but blocking.
Rather than implement the WebView half out-of-ownership to unblock it, the whole RN-side addition
was reverted: the `setSpokenWordRange` bridge command (`readerBridge.ts`), the `ReaderTextProvider`
interface method, `realReaderTextProvider.ts`'s implementation, both `fakeReaderTextProvider.ts`
copies' `spokenWordRanges` recording handles, and `useTtsSession.ts`'s `tts-progress`
subscription/gating (`handleTtsProgress`, and the gated calls in `handleTtsStart`/`clearHighlight`).
`ttsProgress.ts`'s `normalizeTtsProgressEvent` itself was left in place (pure, still unit-tested,
independent of the bridge) since a future attempt will likely still need it.

**Net effect:** `'word'` mode currently behaves identically to `'sentence'` mode — no word-level
highlight is painted, no bridge command is sent. `TTS_PROVIDER.md`'s "Not done as part of step 5,
on purpose" framing for word-level highlighting is accurate again.

**For whoever lands this properly next, landing BOTH halves together in one change:**
- `webview/src/bridge.ts`'s `CommandArgs` needs a `setSpokenWordRange` entry.
- `epub.entry.ts` needs a `setSpokenWordRange` handler — `TFReaderApi<'openEpub'>` will not compile
  without it. Painting should reuse `highlightSeam.ts`'s `add`/`remove` with the existing
  `TTS_OWNER` and a new variant (e.g. `'spoken-word'`) so it doesn't collide with the sentence wash
  `setSpokenRange` already paints — same pattern `setSpokenRange` uses with `currentSpokenCfi`.
  Resolving `(sentenceCfi, start, end)` into a word-range CFI is NOT a pure reuse of
  `epubCfiRange.ts`'s existing exports: `expandPointCfi(startCfi, length)` only extends a GIVEN
  start point forward into a range — it has no way to produce a NEW point CFI offset from an
  existing one, which is exactly what the leading `start` offset needs (the word's own beginning
  within the sentence, not the sentence's own start). The offset arithmetic that would do this lives
  inline and unexported inside `expandPointCfi`. This needs new code — either exporting a
  point-advance step from `epubCfiRange.ts` (a natural, testable addition next to its siblings) or
  writing the equivalent in `epub.entry.ts` itself. Confirmed by reading `expandPointCfi`'s source,
  not inferred.
- `pdf.entry.ts` needs the same no-op row `setSpokenRange` already has.
- `WEBVIEW_BRIDGE.md`'s "Host → WebView" table needs the new row.
- `npm run reader:build-html` needs a run once the above lands, both HTML artifacts committed.
- On the RN side, this section's 2026-09-02 description above (the `ReaderTextProvider` method,
  `realReaderTextProvider.ts`'s implementation, `useTtsSession.ts`'s gated `tts-progress` wiring,
  the fakes' `spokenWordRanges` handles) is the shape to re-add — same design, just needs to land
  together with the WebView half this time rather than ahead of it.

---

## 7. `C1`/§4 follow-up — accessibility prefs stay account-scoped for now; `accessibilityGateway.ts` deleted

**2026-09-03.** Two closures from the same review pass:

**Per-account vs per-device sync scope (§4 above), decided:** staying account-scoped for now,
revisited when real multi-device auth lands. Nothing forces the decision today — `B1`'s dev token
is one identity with no per-device concept behind it yet, so "per-device" has no seam to attach to
without inventing one speculatively. The risk §4 named is real (TTS voice/rate/pitch and especially
`reduceMotion` are device/OS properties, not account properties) but is not yet observable: nobody
has two devices signed into the same dev token today. Writing it down here rather than leaving it
implicit, per §4's own warning that retrofitting per-device scope onto an already-syncing pref
later is a migration, not a field. Revisit this entry when real per-device identity exists —
`reduceMotion` is the field most likely to need to defer to live OS state instead of the synced
value at that point.

**`src/features/accessibility/persistence/accessibilityGateway.ts` and its test are deleted.** That
pair (`sqliteAccessibilityGateway`/`mongoAccessibilityGateway`) was unreferenced outside its own
test — confirmed by a repo-wide grep before removing it — and its Mongo half called the backend
directly (`api.create`/`api.update`), which was never a real seam: accessibility code has no
endpoint of its own to call, and Karthik's sync engine is the only thing that talks to Mongo.
Accessibility's job stays exactly `accessibilityStore.update()` writing to SQLite; nothing here
should ever reach past that. Verified no other file imported either half before deleting.
