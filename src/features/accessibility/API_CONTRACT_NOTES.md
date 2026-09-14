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
- **`src/features/reader/tts/readerTextProvider.ts`** — the permanent, agreed text-provider contract.
  Reader's own `fakeReaderTextProvider.ts`, which used to sit next to it, is deleted (2026-09-09);
  your own forked copy — renamed the same day to
  `src/features/accessibility/tts/testSupport/testReaderTextProvider.ts` — is now the sole
  surviving copy — see "On the test double" below.
- **`WEBVIEW_A11Y_FINDINGS.md`** (this directory) — consolidated desk research on WebView/epub.js
  screen-reader accessibility (VoiceOver/TalkBack), including the architecture split between native
  RN and the Reader WebView and the risk register that governs it. **`WEBVIEW_A11Y_SPIKE.md`** is
  the on-device spike instrument it depends on — not yet run.

**On the test double** (renamed from `fakeReaderTextProvider.ts`/`FakeReaderTextProvider` on
2026-09-09 — "fake" read as a mocking-library fake, which this never was): the real provider landed
(step 5, 2026-08-23) and Reader's copy is deleted (2026-09-09, per `CLAUDE.md`'s deletion table).
Your fork at `src/features/accessibility/tts/testSupport/testReaderTextProvider.ts` is not
scaffolding waiting to be substituted — it's permanent test infrastructure for
`useTtsSession.test.ts`/`.android.test.ts`, which use it to drive the session hook's own state
machine (prefetch, generation counters, teardown) without needing a real book or WebView,
independent of whether the real provider exists. While diffing before deleting Reader's copy, 4
cases it had (`setSpokenWordRange`/`spokenWordRanges`: call-order, independence from the sentence
log, teardown, silent-accept of an unresolvable range) were found missing from your fork's test
file and ported in rather than dropped — worth a look since it's your file now. The test-only
handles still live on `TestReaderTextProvider` and deliberately **not** on `ReaderTextProvider`, so
production code typed against the interface can't reach them.

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

## 6. `accessibility.tts.highlightMode === 'word'` — landed 2026-09-07, both halves together

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

**Net effect of the revert, while it lasted:** `'word'` mode behaved identically to `'sentence'`
mode — no word-level highlight painted, no bridge command sent.

**Landed for real, 2026-09-07, both halves together this time.** The WebView-facing
half (`webview/src/bridge.ts`'s `CommandArgs`, `epub.entry.ts`'s `setSpokenWordRange` handler,
`pdf.entry.ts`'s no-op, `ReaderTextProvider`/`realReaderTextProvider.ts`, both HTML artifacts
rebuilt) landed 2026-09-07 (`559c47ba`/`ce7a6769`/`2a59f298`) — with one shape change from the reverted
2026-09-02 attempt: `setSpokenWordRange` now takes one object argument
(`{ cfi, start, end } | null`), not three positional ones, per `bridge.ts`'s
`CommandArgsMatchPayloads` proof. The offset-arithmetic gap this section originally flagged
(`expandPointCfi` cannot produce a new point CFI offset from an existing one) was resolved by writing
fresh resolution logic in `epubTtsResolver.ts`'s `resolveSpokenWordCfi`, not by extending
`epubCfiRange.ts` — see that function's own doc comment for why.

The RN side — `useTtsSession.ts`'s `tts-progress` subscription and gated `handleTtsProgress`, and
both fakes' `spokenWordRanges` recording handles — was re-landed the same day, same design as the
2026-09-02 attempt, updated for the object-shaped call. One deliberate deviation: the reverted
attempt also sent a second, explicit `setSpokenWordRange(null, 0, 0)` clear from `clearHighlight()`
and `handleTtsStart()`; that's redundant now; `setSpokenRange`'s WebView handler already clears the
word wash unconditionally at its own top (`clearSpokenWord()`), a consolidation that landed with the
2026-09-05/07 work, after the original attempt was written.

**`'word'` mode now does more than paint.** `setSpokenWordRange` also drives the word-precise half of
TTS auto-follow (`TTS_PROVIDER.md` open item 2) — the reason the RN-side wiring was worth re-landing
now rather than leaving deferred.

**2026-09-07 addendum, resolved:** this section originally flagged `webview/src/epubTtsResolver.ts`'s
`resolveSpokenWordCfi(rendition, sentenceCfi, start, end)` (backed by `ttsWordOffsets.ts`) as an
unreached head start on the CFI-resolution problem above — built by Ahana, unit-tested
(`epubTtsResolver.test.ts`, `ttsWordOffsets.test.ts`), but not yet imported by `epub.entry.ts`.
That's what the "Landed for real" paragraph above did: `epub.entry.ts`'s `setSpokenWordRange`
handler now imports and calls `resolveSpokenWordCfi` directly — the orphan is wired in, not
rewritten.

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

---

## 8. Per-device sync scope — a design sketch, so this stays deferred rather than re-derived later

**Not implemented, not scheduled — §7's decision to stay account-scoped is unchanged.** Written
down now because §4/§7 both warn that retrofitting this later is a migration, and a migration is
cheaper to execute against a plan than to improvise once someone is actually blocked on it.

**The shape, if/when this is picked up**, mirroring `migratePrefs.ts`'s (Personalization's)
existing precedent for versioned local-schema changes:

1. **Add a `deviceId` column to the `accessibility` table**, generated once per install (a UUID
   persisted outside the syncable record itself — e.g. alongside `expo-dev-launcher-installation-id.txt`'s
   pattern, or `expo-application`'s installation id if that's already available), not derived from
   anything account-related.
2. **Split `ACCESSIBILITY_MERGE_FIELDS` into two groups**, not one: device-scoped
   (`ttsVoiceId`, `ttsRate`, `ttsPitch`, `ttsHighlightMode`, `reduceMotion`, `largeAudioControls`,
   `ttsBackgroundPlayback` — properties of the hardware/OS a device runs on) vs. account-scoped
   (`dyslexiaFont`, `boldText`, `readableSpacing`, `highContrast`, `screenReaderHints`,
   `announcePageChanges`, `announceChapterChanges` — properties of how this *person* reads,
   reasonably expected to follow them across devices). This split itself is the one open judgment
   call — `largeTouchTargets`/`respectOsFontScale`/`fontScaleMultiplier` are debatable either way
   and would need an actual product decision, not just an engineering one, when this is picked up.
3. **Device-scoped fields key on `(userId, deviceId)`, not `userId` alone** — meaning the sync
   entity itself gains a compound identity, not just an extra column on today's one-row-per-user
   record. `syncApi.ts`'s generic `/api/v1/{entity}` CRUD pattern doesn't need to change shape for
   this (still `POST`/`PUT`/`DELETE` by `id`); what changes is that a device now creates its own
   accessibility record on first sync rather than reading/writing the one shared row.
4. **`reduceMotion` needs no change under this scheme** — it already resolves against live
   `AccessibilityInfo.isReduceMotionEnabled()` per device via `useReduceMotion.ts`'s tri-state
   resolution, independent of sync scope. The gap this migration actually closes is narrower than
   §4/§7 originally framed it: not "reduceMotion syncs wrong" (already handled), but "`ttsVoiceId`/
   `ttsRate`/`ttsHighlightMode` follow the account when a screen-reader user's voice and speed are
   properties of a specific device/headphone setup, not of their library."

**Trigger for actually building this:** real per-device identity existing at all (§7's own
condition) — `B1`'s single dev-token identity has no per-device concept to attach step 1 to yet,
so there's genuinely nothing to build against today, not just a deprioritization.

---

## 9. Revocation mid-TTS-session — a design sketch for when `B6`/`B7` land

**Not implemented, not scheduled — §5's "accepted behaviour, not a guarantee to build on" stands.**
Written down now for the same reason as §8: so this is a quick job when `B6`/`B7` (Download's
change feed) ship, not a rediscovery under pressure at that point.

**What actually happens today, for context:** `ReaderTextProvider`'s methods never reject
(`readerTextProvider.ts`'s own contract) — a mid-read decryption failure would resolve
`{status: 'unavailable'}` rather than throwing, and `useTtsSession.ts`'s `handleTtsFinish`/error
paths already treat an `unavailable` fetch result as a stopping condition. So the session
*wouldn't* crash if the key vanished mid-read — it would just stop, the same as reaching the end of
downloaded content. What's missing is *why* it stopped ever reaching the user or this file's own
telemetry as a distinct reason.

**The shape, when `B6`/`B7` exist:**

1. **The interruption reason should be `'revoked'`, not `'closed'`** — this is exactly the label
   distinction named in §6/the `tts.highlightMode` history and in `TTS_PROVIDER.md`'s open item 1:
   `EpubReaderTextProvider` already has `terminate('revoked')` reachable internally, but no
   `notifyRevoked()` method calls it — only `notifyClosed()` exists. **If item 12's proposal to
   Karthik/Abhinav lands first, this section has nothing further to do** — the plumbing already
   exists once that label is wired through. If it doesn't land first, this section's own trigger
   (a real revocation event) is a second, independent reason to finally add `notifyRevoked()`.
2. **The trigger is Sync's event bus, not a new signal Accessibility invents.** `offline-lock.ts`'s
   `content.lock` event with `reason: 'revoked'` is already the documented, wired mechanism
   (`useContentLock`, consumed today by `ReaderScreen.tsx`'s `tearDownAndLock`). The TTS session
   doesn't need its own subscription — `tearDownAndLock` already calls
   `ttsProviderRef.current?.notifyClosed()` before `closeBook()`; this section's whole ask is
   swapping that one call to `notifyRevoked()` specifically when the teardown reason is a
   revocation, which is a Reader-side (`ReaderScreen.tsx`) one-line change, not an Accessibility one.
3. **What Accessibility's own side would do with the distinct reason, once it exists:** surface a
   different message than a plain "session ended" — e.g. via `ttsStatusAnnouncement`
   (`ttsAnnouncements.ts`) — so a screen-reader user hears *why* TTS stopped rather than silence.
   `useTtsSession.ts`'s `status` already goes to `'idle'`/`'error'` on interruption; this is a
   messaging refinement on top of already-correct state handling, not a new state.

**Trigger for actually building this:** `B6`/`B7` shipping, which is what makes a live revocation
mid-session possible at all — today's fail-open entitlement check means this scenario cannot occur
in practice yet.
