# Reader → TTS seam (`ReaderTextProvider`)

**Owner:** Reader (Ahana) · **Consumer:** Accessibility (Hruthik) · **Status:** real EPUB provider
implemented (step 5, 2026-08-23); Accessibility's demo-tab call site retired (step 6, 2026-08-23);
`fakeReaderTextProvider.ts` itself deleted (2026-09-09), see "The fake, and deleting it" below
**Agreed:** 2026-08-16

The interface is `src/features/reader/tts/readerTextProvider.ts` and it is the whole of what
Accessibility codes against. This file records the decisions behind it, the ownership boundary, the
sequencing, and what has to be deleted when the real implementation lands.

For anything about the WebView bridge itself, `WEBVIEW_BRIDGE.md` is the source of truth. This file
does not restate it.

---

## The boundary

|                    |                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------ |
| Reader owns        | `src/features/reader/**`, the bridge, segmentation, CFIs, spine order, the highlight |
| Accessibility owns | the TTS session, the platform voice, prefs under `accessibility.tts.*`               |
| Crosses the seam   | `TtsSentence`, `TtsFetchResult`, `TtsInterruption`, and nothing else                 |

Accessibility does not send bridge commands, does not read `book.spine`, and does not construct or
parse a CFI. Reader does not read `AccessibilityPrefs` and does not decide when to speak.

**The one boolean that does cross, and how.** Reader decides whether and where the TTS controls
appear, which means it needs `accessibility.tts.enabled` — and the rule above says it cannot go and
read it. So Accessibility exports it as a primitive: `useTtsEnabled()` in
`features/accessibility/tts/useTtsEnabled.ts`. Reader calls that and never imports a prefs shape.
This is also the *only* gate on TTS being available: `useTtsSession`'s `play()` deliberately does
not re-check `enabled`, on the grounds that mounting the controls is already the decision.

`ReaderTextProvider` has **no `dispose`**. Lifetime belongs to whoever owns the book —
`ReaderScreen`, in the effect that calls `closeBook` — and a consumer that could tear the provider
down could tear it down while another consumer was using it. Teardown travels one way, through
`onInterrupted`.

## Decisions, and why

**One sentence at a time.** Never a chapter, never the book. `contentProvider.ts` already makes the
whole decrypted book resident once; a chapter handed to React Native for TTS would be a second copy
of licensed plaintext for no capability gain.

**Segmentation happens in the WebView.** It is the only place a DOM exists, and a CFI can only be
minted from a live range against a section's `cfiBase`.

**`text` and `cfi` are two projections of one DOM Range.** The provider builds the range, then emits
`range.toString()` and `new EpubCFI(range, cfiBase)`. There is no second code path producing the
string, so the spoken text and the highlighted range cannot drift. Everything else about the seam
follows from protecting that property — including the character cap, which must apply while the
range is still open. A caller that truncated the string after receiving it would highlight more than
it spoke.

**Spine order, not TOC order.** A navigation document omits sections, reorders them, and repeats
hrefs — `ReaderScreen.tsx`'s Contents list documents the 20 MB fixture repeating one `src` five
times. `spineIndex` is identity; `chapterHref` deliberately does not cross the seam.

**Empty and unreadable sections are invisible.** The provider skips them and returns the next real
sentence, so `spineIndex` is not contiguous between consecutive sentences. Non-linear spine items
(`linear="no"` — answer keys, ad pages) are stepped over by `next` for the same reason.

**Auto-continue needs no separate call.** `next` crosses spine items itself; `lastInSection` exists
so a caller with `autoContinueChapter` off knows where to stop. `getNextChapter` was proposed and
dropped.

**Resume reads the reader's live position, not `Progress`.** `current(null)` resolves wherever the
reader actually is. After a search hit or a Contents tap that is not the persisted record, and
`Progress.offset` is an integer whose own contract notes say it cannot anchor a reflowable EPUB. No
new preference was introduced.

**A position mid-sentence restarts that sentence.** Sub-sentence resume needs offsets neither
platform TTS engine reports reliably, and would leave the highlight over text that was never spoken.

**Highlighting is a separate call from fetching.** A session prefetches the next sentence while the
current one is still speaking, so painting at fetch time would run the highlight one sentence ahead
of the voice. Pause keeps the highlight, stop clears it, an error clears it, and Reader clears it
itself on user navigation.

**Four non-ok statuses, not seven.** End-of-chapter is `lastInSection` on an ok result, not a
status. An empty chapter is not a status either — it is skipped. Collapsing those two is what keeps
the union small enough to handle exhaustively.

**These methods never reject.** Type-aware lint is on for this directory, and a seam that can both
resolve a status and throw makes every call site carry two error paths for one question. An aborted
request resolves `unavailable`.

**Stale replies are dropped by a generation stamp, internally.** Every bridge request will carry a
`(bookId, generation)` pair; mismatched replies are discarded before they resolve. Accessibility
neither passes nor sees it — pushing that across the seam would be exporting Reader's problem.

## Sequencing

Steps 3 and 4–5 run in parallel. That is the point of the fake: Accessibility is not blocked on the
WebView conversion.

```
1. Agree the interface                      ✅ 2026-08-16
2. Ship types + FakeReaderTextProvider       ✅ 2026-08-16
3. Accessibility builds the TTS session      ← unblocked, against the fake
4. Reader: typechecked WebView conversion    ✅ 2026-08-18
5. Reader: sentence/highlight bridge + real provider   ✅ 2026-08-23
6. Swap fake → real; integration and device testing    ← Accessibility's demo call site done,
                                                            2026-08-23; fake file itself not yet
                                                            deleted, see below
```

**Step 4 is done** — prefs-application called the conversion in and it landed the same day, so the
WebView half is typechecked TypeScript that imports its types from `readerBridge.ts`
(`WEBVIEW_BRIDGE.md`). Step 5 is therefore unblocked.

**Step 5 is done, 2026-08-23.** `tts/realReaderTextProvider.ts` implements the full
`ReaderTextProvider` interface for EPUB against a real book: `requestTtsSentence`/`ttsSentence` is
the bridge's first request/reply pair (`WEBVIEW_BRIDGE.md`'s "Current surface" table has the detail),
segmentation and CFI-minting live in `webview/src/epubTtsResolver.ts` (DOM/epub.js-touching, not
unit-tested — same tier as `epub.entry.ts`) and `webview/src/ttsSegmentation.ts` (pure, unit-tested:
sentence-boundary splitting and the 400-char word-boundary cap, no `Intl.Segmenter` since this
WebView targets `safari15`). `setSpokenRange` paints through the new owner-namespaced highlight seam
(`webview/src/highlightSeam.ts`/`highlightNaming.ts` — see open item 4, struck below) rather than
calling `rendition.annotations` directly. Mounted in `ReaderScreen.tsx` whenever `useTtsEnabled()`
and `format === 'EPUB'` both hold — there is no in-reader toggle. The preference IS the switch:
turning it on puts the transport on screen (replacing the page-navigation row), turning it off
removes it and stops speech, because `ttsEnabled` collapses `ttsProvider` to null and that is
`useTtsSession`'s only dependency, so its cleanup calls `Tts.stop()`. A speaker button in the
toolbar was a second control for a decision the preference already owned; what remains of it is a
non-interactive 🔊 cue painted on the page while `status === 'speaking'`.

**Not done as part of step 5, on purpose — out of scope, not overlooked:**
~~word-level highlighting~~ (**landed 2026-09-05, see below**), scroll-follow-the-spoken-range (open
item 2, unchanged below), and a real `onInterrupted` source for `'revoked'` (open item 1, unchanged
below — `terminate()` handles the reason identically to `'closed'` internally, but nothing calls it
yet).

### Word-level highlighting — `setSpokenWordRange`, landed 2026-09-05

```ts
type SpokenWordRange = { cfi: string; start: number; end: number };
setSpokenWordRange(range: SpokenWordRange | null): void;   // null clears
```

The seam carries sub-sentence ranges now. `setSpokenRange` says which SENTENCE; this says which WORD
inside it. Accessibility calls it on every `tts-progress` event while
`tts.highlightMode === 'word'`. `WEBVIEW_BRIDGE.md`'s "The spoken word" section is the bridge half
and `HIGHLIGHT_LAYERS.md` §3 the visual half; what belongs to this seam:

- **`start`/`end` index `TtsSentence.text`** — the string the caller handed the engine — so they are
  exactly what the platform reports back (iOS `location`/`length`, Android `start`/`end`). A caller
  passes on what it was given and nothing else. They are NOT DOM offsets, and the mapping between the
  two is the Reader side's problem, not the caller's.
- **One nullable object, not three arguments.** The bridge's `CommandArgsMatchPayloads` proof
  requires one payload field per command; the reasoning is on the type itself.
- **Failure is silent and clears the previous word.** Resolution genuinely fails in ordinary
  situations — paged away mid-utterance, section not rendered, a one-word sentence the sentence wash
  already covers — and on all of them the previous word is removed rather than left painted. A
  highlight on the last word while the voice has moved on is a lie; showing nothing is not.
- **`setSpokenRange` clears it**, so a caller changing sentence, stopping, or turning word mode off
  mid-utterance needs no separate clear.
- **Device verification is Accessibility's**, deferred deliberately: nothing on `T4_Ahana` calls this
  yet, so it landed unverified on hardware. What that pass is actually checking is the two opacity
  constants in `webview/src/selectionTheme.ts`'s `spokenWordOpacity` — computed from the palettes and
  WCAG contrast, never observed — and its comment names the two failure signatures to look for.

**Step 6, Accessibility's half: done, 2026-08-26.** `TtsReadingScreen.tsx` (the standalone "TTS
Demo" screen, with no `bookId`/`send` of its own) is retired now that `ReaderScreen` has a real mount
point — deleted along with its test, `src/navigation/TtsDemoScreen.tsx`, the `TtsDemo` route in
`RootNavigator.tsx`, and `BookListScreen`'s row into it.

**This section previously dated that removal 2026-08-23 and it was not true.** The screen survived
the `RootNavigator` landing and stayed reachable from `BookListScreen` for three more days, which
meant the app shipped two TTS surfaces: the real one in the reader, and a demo serving canned
sentences whose synthetic CFIs resolve against no book. Anyone testing TTS from that row got
plausible speech unrelated to any book. Recorded rather than quietly corrected, because a doc that
declares work done is how the second surface went unnoticed.

**What did NOT happen at the time: `fakeReaderTextProvider.ts` itself was not deleted.** The
deletion table below assumed the demo was the only call site outside `reader/tts/` — it wasn't.
`useTtsSession.test.ts` (~20 call sites) and `useTtsSession.android.test.ts` (2 call sites) used
`createFakeReaderTextProvider` as a session-logic test double — prefetch, generation counters,
teardown — independent of whether a real book exists. Deleting the fake would have broken those
tests then.

**That open call is decided, and closed: Accessibility forked its own private copy, 2026-08-28.**
`src/features/accessibility/tts/testSupport/fakeReaderTextProvider.ts` (same content,
`Owner: Accessibility (Hruthik)`) is the permanent test double for `useTtsSession`'s tests; both
files above now import from it instead of from `reader/tts/`. Reader's original — this file's own
copy — is DELETED as of 2026-09-09, with its test cases ported into the fork's test file rather than
dropped (see the table below).

**What the conversion did NOT do for this seam, so nobody plans around a saving that is not there.**
It removed the hand-sync risk; it did not build request/reply. `requestSentence` still needs a
**reply**, which is the first non-fire-and-forget call on this bridge: `buildCommandScript` only
injects a call, and nothing correlates a response back to its caller. That correlation — plus the
`(bookId, generation)` stamp described above — is real work, and it is Reader's. What is genuinely
cheaper now is that the reply's seven-field payload is a shared type rather than a shape to
hand-copy, and that a mismatch is a compile error.

## The fake, and its deletion — DONE, 2026-09-09

`fakeReaderTextProvider.ts` served canned sentences with **synthetic CFIs that resolved against no
book**. It exercised the shape of the seam — ordering, section boundaries, the character cap,
cancellation, teardown — and nothing about rendering. Read the rest of this section as a record of
what happened, not a to-do list.

| # | Delete | Status |
| - | ------ | ------ |
| 1 | `src/features/reader/tts/fakeReaderTextProvider.ts` | **Done** |
| 2 | `src/features/reader/tts/fakeReaderTextProvider.test.ts` | **Done** |
| 3 | every `createFakeReaderTextProvider` call site outside `src/features/reader/tts/` | **Already satisfied before this change** — both remaining call sites (`useTtsSession.test.ts`, `useTtsSession.android.test.ts`) had already moved to Accessibility's fork on 2026-08-28 |
| 4 | this section | **Done** — struck above |

`readerTextProvider.ts` stays — it is the permanent contract, never was on this list.

Every case in the deleted test file pinned a property of the seam, not a property of the fake, so
rather than drop them they were ported into
`src/features/accessibility/tts/testSupport/fakeReaderTextProvider.test.ts` (Accessibility's fork,
which already carried the fake's other cases but was missing the four covering
`setSpokenWordRange`/`spokenWordRanges` — call-order, independence from the sentence log, teardown,
and silent-accept of an unresolvable range). That fork is now the sole surviving copy of this test
double, and future changes to it are Accessibility's (Hruthik's) call.

## Open items

1. ~~**`onInterrupted('revoked')` has no source yet.**~~ **The safety property holds, and has since
   before this line was last true — only the `'revoked'` LABEL is still unused.** This was stale the
   moment it was last edited (2026-09-08): a live, mid-read revocation path already exists and
   already stops TTS from an already-mounted `ReaderScreen`, through two independent sources —
   Sync's `content.lock` bus event (`useContentLock`, pushed) and `startAccessMonitor`'s 5-minute
   re-verification poll (pulled) — both converging on `ReaderScreen.tsx`'s `tearDownAndLock`, which
   calls `ttsSessionRef.current.stop()` AND `ttsProviderRef.current?.notifyClosed()` (redundantly,
   deliberately) before `closeBook(bookId)` ever runs. `event-bus.ts`'s "PROPOSAL — NOT FINALISED,
   NOT WIRED" header is itself stale in the same way — `src/shared/contracts/index.ts` already
   exports it, and `offline-lock.ts` and `contentStore.ts` both consume it for real.
   What genuinely does not exist is the LABEL: every one of these paths fires `onInterrupted('closed')`
   — `terminate('revoked')` is reachable in `realReaderTextProvider.ts` but nothing calls it, since
   `EpubReaderTextProvider` has no `notifyRevoked()` method, only `notifyClosed()`.
   `useTtsSession.ts` needs no change either way — its handler already treats `'closed'`/`'revoked'`
   identically. Landing the distinct label, if it's ever wanted (e.g. to report a revocation
   differently from a normal close), is a small, localized addition: a `notifyRevoked()` mirroring
   `notifyClosed()`, called from `tearDownAndLock` instead when the teardown reason is a revocation
   specifically. **Karthik + Abhinav's call on whether the label is worth the distinction.**
2. ~~**Does the reader scroll to follow the spoken range?**~~ **SOLVED, 2026-09-07 — word-precise,
   not just the sentence-level version originally proposed.** `../accessibility/TTS_AUTOFOLLOW_HANDOFF.md`
   was Accessibility's sentence-level proposal (a visibility check plus `rendition.display(cfi)`
   inside `setSpokenRange`'s own handler, no new bridge command). Landed as designed, PLUS a
   word-level refinement on top: `followSpokenRange(cfi)`
   (`webview/src/epub.entry.ts`, next to `contentsForCfi`) is called from BOTH `setSpokenRange`
   (coarse — a whole new sentence starting off-screen) and `setSpokenWordRange` (precise — this
   specific word has crossed off-screen), sharing one `lastAutoFollowedCfi` dedupe so neither
   double-navigates for the same target. The word-level call is what actually delivers "turn on the
   first word of the next page, not before the last word of this one": each `tts-progress` tick
   checks that word's own geometry, so a sentence straddling a page break gets checked word-by-word
   as speech crosses it, where the sentence-level call alone could only check the sentence as a whole
   at its start.

   The geometry both flows build on (`spokenRangeGeometry`, same file) treats PARTIAL overlap as
   relevant, not full containment — a sentence painted where it starts, that also runs onto the next
   page, is not "off-screen" the instant it paints. **Neither `contents.window`'s own dimensions nor
   the outer `#viewer` `viewportSize()` measures is the right viewport for this** — epub.js resizes
   each section's `<iframe>` to its own full content size on whichever axis `IframeView.size()`
   leaves free (width in paginated flow, height in scrolled-doc), so the iframe's own
   `innerWidth`/`innerHeight` reports the whole chapter's size, not what's on screen, on the one axis
   that matters. The actual viewport is the manager's `bounds()` (the fixed stage container —
   `rendition.manager`, reached through a cast since `epubjs`'s types don't expose it), compared
   against each rect after shifting it by the view's own `position()` (`element
   .getBoundingClientRect()`, which correctly reflects scroll position) — the same geometry epub.js's
   own `isVisible()`/`paginatedLocation()`/`scrolledLocation()` use internally.

   **2026-09-08 — the two flows stopped sharing one DECISION on that geometry, on purpose, though
   they still share the MEASUREMENT.** Paginated kept the original mechanism exactly as it shipped: a
   boolean `spokenRangeVisible` (`anyRectOnScreen`), a discrete `rendition.display(cfi)` page turn on
   a miss. Scrolled-doc now gets a teleprompter-style continuous reposition instead
   (`repositionForReadingZone`) — as the spoken position drifts toward the bottom quarter of the
   viewport (`READING_ZONE_TRIGGER_FRACTION = 0.75`), it smoothly scrolls (`manager.container
   .scrollBy`) to land it back at the upper-middle (`READING_ZONE_TARGET_FRACTION = 0.35`), rather
   than waiting for it to go fully off-screen and jumping. `readingZoneScrollDelta`
   (`highlightGeometry.ts`, pure, unit-tested) is the arithmetic; it never fires for a target ABOVE
   the zone, so it only ever catches up with forward reading, never fights a reader who scrolled back
   manually. Reserved for a section that IS currently rendered — a different, not-yet-mounted section
   still falls through to the same discrete `display()` jump paginated uses, since only epub.js's own
   `display()` can load and render a new section at all. The scroll is `behavior: 'smooth'` unless
   `currentAppearance?.reduceMotion` is true (read fresh on every call, no cached flag) — the first
   animation either shell has added; see `WEBVIEW_BRIDGE.md`'s decision #2.

   "Off-screen, jump" and "continuous, smooth" are different products, not two spellings of the same
   behaviour — this is the one place in the whole feature with an explicit flow branch, and it is
   deliberate precisely because `rendition.display()` itself stays flow-agnostic everywhere else.

   Word-precision is gated on `highlightMode === 'word'`, same as the word paint itself —
   `useTtsSession.ts`'s `handleTtsProgress` only forwards `tts-progress` ticks in that mode (see
   `ACCESSIBILITY_ARCHITECTURE_MAP.md`'s `tts.highlightMode` row for why that RN-side wiring needed
   re-landing). `'sentence'`-mode readers still get the coarse, once-per-sentence follow — no page
   ever fails to turn — just not the exact-word boundary.

   The word wash being cleared at the TOP of `setSpokenRange`, before anything paints, remains the
   load-bearing precondition it always was: a `display()` that re-renders the view while a stale mark
   is still attached would carry it into the new one.

   **Auto-follow also re-checks itself after any font-size/typography/margin change and after a
   paginated<->scrolled flow toggle**, not just at the next spoken sentence or word.
   `scheduleGeometryRefresh`'s `finish()` and `rebuildForFlowIfNeeded`'s post-rebuild callback both
   re-run `followSpokenRange` against whichever of `currentSpokenWordCfi`/`currentSpokenCfi` is set,
   with `lastAutoFollowedCfi` explicitly cleared first. This matters because both of those paths
   re-anchor the reader at `lastCfi` (wherever they were last relocated) rather than at the spoken
   position specifically — the two usually coincide, since auto-follow's own `display()` calls are
   what move `lastCfi` in the first place, but not when several sentences have played on the same
   page since the last one. A font-size increase can push a mid-page sentence off the bottom of the
   reflowed page even though the page's own reanchor "succeeds"; this catches that case rather than
   leaving the reader on a page that no longer shows what is being spoken.

   **Second on-device defect, found and fixed the same week: auto-follow worked in paginated flow
   and went permanently inert in scrolled-doc flow, silently.** The dedupe guard against overlapping
   `display()` calls was originally a flag cleared in `rendition.display()`'s own `.finally()`. In
   scrolled-doc flow, `display()` resolves through epub.js's `ContinuousViewManager`, which chains an
   UNBOUNDED virtualization pass onto every display — `.then(() => this.fill())`, recursing through
   `check()` via a queue gated on `requestAnimationFrame` (`managers/continuous/index.js`) —
   `DefaultViewManager` (paginated) has no such tail. On a real device that tail's `requestAnimationFrame`
   can stall (backgrounded, throttled, GPU-starved) and never resolve, which left the promise-settled
   flag stuck `true` FOREVER — every later auto-follow call silently no-opped on the guard check ahead
   of it, for the rest of the reading session, in scrolled-doc flow only. Paginated kept working
   because it has no such tail to hang on. Fixed by replacing the promise-gated flag with a fixed
   500ms cooldown timestamp (`followCooldownUntil`, `FOLLOW_COOLDOWN_MS`) — it serves the same
   purpose (absorb the gap between rapid word ticks and a slower transition) without depending on
   epub.js's internal promise ever settling.

   **Third on-device defect, and the most severe: auto-follow's own jump/scroll made TTS stop
   entirely, deterministically, on the very first one.** `ReaderScreen.tsx`'s `relocated` handler
   forwarded every relocation to `ttsProviderRef.current?.notifyRelocated()` unconditionally, on a
   premise that was true right up until auto-follow existed: "epub.js never fires `relocated` for
   `setSpokenRange`, which only touches annotations." Auto-follow's `rendition.display()`/`scrollBy()`
   calls are now INSIDE `setSpokenRange`'s/`setSpokenWordRange`'s own handlers, so that premise broke
   — auto-follow's own reposition fired the same `relocated` a manual page turn would, and
   `notifyRelocated()` treated it as the reader navigating away: it cleared the very highlight
   auto-follow had just centered on screen (`notifyRelocated()` calls `setSpokenRange(null)`) AND
   invalidated the session's prefetched next sentence, so the moment the current, auto-follow-
   triggered sentence finished, `handleTtsFinish()` found no prefetch and mistook it for end-of-book.
   The same premise-break also applies to `scheduleGeometryRefresh`'s reflow reanchor and
   `rebuildForFlowIfNeeded`'s post-rebuild redisplay — both redisplay the reader at a position they
   were already at, not somewhere new, and both fire a `display()` too.

   Fixed with a new, optional `ReaderMessage['relocated'].internalReposition` field
   (`WEBVIEW_BRIDGE.md` has the full account): `epub.entry.ts` marks the NEXT `relocated` as internal
   immediately before each of the four call sites that redisplay-without-navigating, and
   `ReaderScreen.tsx` skips `notifyRelocated()` specifically when the field is true.
   Progress-tracking (`ReaderRouteScreen.tsx`) is unaffected either way — it already reads every
   `relocated` cause-agnostically, which is correct and intentional (persisted "resume position" is
   supposed to be wherever the view/voice currently is).

   **Narrowed, not solved, by `setTtsSpeaking` (landed 2026-09-08):** the reader can no longer
   trigger a manual swipe (paginated) or drag-scroll (scrolled-doc) at all while `ttsSession.status`
   is `'speaking'` — `ReaderScreen.tsx` sends `{type: 'setTtsSpeaking', speaking}` on every status
   transition, and `epub.entry.ts` sets `touch-action: none` on the manager's container while true,
   plus an explicit `if (ttsSpeaking) return;` guard in `watchTouches`'s swipe handler
   (`WEBVIEW_BRIDGE.md` has the full surface entry). This closes the gesture path entirely, so it no
   longer fights auto-follow.

   **Genuinely still open, not solved by this:** a manual navigation reached WITHOUT a gesture — a
   TOC tap, a search-result tap, a bookmark tap — is deliberately NOT blocked while speaking (out of
   scope for `setTtsSpeaking`, by design: those are intentional host-driven jumps). Auto-follow still
   has no "recently navigated" signal for that path, so the next tick pulls the view back to wherever
   speech currently is. PDF's `setSpokenRange`/`setSpokenWordRange` remain documented no-ops
   (`pdf.entry.ts`) — nothing to follow there yet.
3. **`react-native-tts` is not in `package.json`.** It is a native module, so adding it forces a
   prebuild and a fresh dev build for everyone on T4 — an announcement, not a silent install.
4. ~~**Highlight styling will collide with Personalization's.**~~ **SOLVED, 2026-08-23.**
   `webview/src/highlightSeam.ts` is the one place `rendition.annotations` gets called from now:
   `add(rendition, owner, cfiRange, variant, styles?)` / `remove(rendition, owner, cfiRange)`
   namespace BOTH the epub.js annotation `type` and the CSS class per owner
   (`webview/src/highlightNaming.ts`, pure and unit-tested) — `type` matters as much as `className`
   here, because `Annotations.remove` is keyed on `cfiRange + type`, so a shared `type` string is
   what would let one owner's removal wipe another's paint, not just a shared class. TTS is the one
   client today (`owner: 'tts'`, `setSpokenRange`'s handler in `epub.entry.ts`). **Note for
   Vaishnavi:** Personalization can call the same `add`/`remove` with its own `owner` string when
   its highlight rendering lands — no coordination needed beyond picking a distinct owner name.
5. **The platform TTS engine retains the utterance.** Out of process and outside anyone's control.
   A known limit for the security notes, not something the seam can close.
