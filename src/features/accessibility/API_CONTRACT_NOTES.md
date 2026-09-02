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

## 6. `accessibility.tts.highlightMode === 'word'` — engine half done; WebView half is yours

**2026-09-02.** `TTS_PROVIDER.md`'s "Not done as part of step 5, on purpose" paragraph (word-level
highlighting) is now stale on the Accessibility side and needs your update, not mine — I'm not
editing your doc directly, per the ownership line in `CLAUDE.md`. Recording the current state here
instead, so it's written down even before your doc catches up.

**Done, on this side, with tests:** native `tts-progress` is now subscribed
(`ttsEngine.ts:TTS_EVENTS`), normalized per-platform in `ttsProgress.ts`
(`normalizeTtsProgressEvent` — iOS `location`/`length`, Android `start`/`end`, both covered by
`ttsProgress.test.ts`), and dispatched from `useTtsSession.ts`'s `handleTtsProgress`, gated on
`livePrefs.highlightMode === 'word'` so sentence mode (the default) never touches it
(`useTtsSession.test.ts` covers both branches). It calls a new `setSpokenWordRange(cfi, start,
end)` added to the `ReaderTextProvider` interface (`readerTextProvider.ts`) and implemented in
`realReaderTextProvider.ts` and both `fakeReaderTextProvider.ts` copies, which sends a new
`setSpokenWordRange` command already wired into `readerBridge.ts` (`ReaderCommand`,
`READER_COMMANDS`, `buildCommandScript`) — `cfi` is the sentence CFI `setSpokenRange` already
painted, `start`/`end` are character offsets into that sentence's text.

**Confirmed still missing, all on the WebView half (yours):**
- `webview/src/bridge.ts`'s `CommandArgs` has no `setSpokenWordRange` entry — right now this is a
  real `npm run typecheck` failure (`CommandArgsAreExhaustive`/`CommandArgsMatchPayloads`), by
  design per `CLAUDE.md`'s bridge workflow, not something I'm trying to silence.
- `epub.entry.ts` has no `setSpokenWordRange` handler — `TFReaderApi<'openEpub'>` is missing the
  property, another compile error. My best guess at the shape (yours to confirm or override): reuse
  `highlightSeam.ts`'s `add`/`remove` with the existing `TTS_OWNER` and a new variant (e.g.
  `'spoken-word'`) so it doesn't collide with the sentence wash `setSpokenRange` already paints, and
  `epubCfiRange.ts`'s `splitCfiRange`/`expandPointCfi`/`joinCfiRange` look like they'd turn
  `(sentenceCfi, start, end)` into a word-range CFI by string arithmetic without needing the DOM —
  but that's a pointer, not a prescription.
- `pdf.entry.ts` needs the same no-op row `setSpokenRange` already has.
- `WEBVIEW_BRIDGE.md`'s "Host → WebView" table needs the new row.
- `npm run reader:build-html` needs a run once the above lands, both HTML artifacts committed.

Not touching any of the four files above, or `TTS_PROVIDER.md`, myself — this section is the full
handoff.

**Correction to the "done" list above, same day:** the first version of this engine work called
`setSpokenWordRange` unconditionally from `handleTtsStart`/`clearHighlight`, not gated on
`highlightMode`. Since the WebView has no handler yet, that meant every TTS sentence start/stop —
in the default `'sentence'` mode, for every user, today — hit `buildCommandScript`'s `NOT_READY`
path and surfaced as `ReaderScreen`'s interrupting error banner
(`accessibilityRole="alert"`/`accessibilityLiveRegion="polite"`, "the one place in this screen
allowed to interrupt"). Fixed in `useTtsSession.ts`: both call sites now gate on
`livePrefs.highlightMode === 'word'`, matching `handleTtsProgress`'s existing gate, so the command
is never sent until there is a WebView handler to receive it. `useTtsSession.test.ts` updated to
assert zero `setSpokenWordRange` calls in `'sentence'` mode. Flagging this because it's the kind of
bug a WebView-side implementer would otherwise inherit silently — nothing to act on now that it's
fixed, but worth knowing it was there.
