# Reader → TTS seam (`ReaderTextProvider`)

**Owner:** Reader (Ahana) · **Consumer:** Accessibility (Hruthik) · **Status:** real EPUB provider
implemented (step 5, 2026-08-23); Accessibility's demo-tab call site retired (step 6, 2026-08-23) —
`fakeReaderTextProvider.ts` itself stays for now, see "The fake, and deleting it" below
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

**What did NOT happen: `fakeReaderTextProvider.ts` itself was not deleted.** The deletion table below
assumed the demo was the only call site outside `reader/tts/` — it wasn't. `useTtsSession.test.ts`
(~20 call sites) and `useTtsSession.android.test.ts` (2 call sites) use `createFakeReaderTextProvider`
as a session-logic test double — prefetch, generation counters, teardown — independent of whether a
real book exists. Deleting the fake would break those tests today. Whether Accessibility should fork
its own private test double instead (so this file can eventually close) or whether the fake keeps
double-duty as shared test infra permanently is an open call between Hruthik and Ahana, not decided by
this change.

**What the conversion did NOT do for this seam, so nobody plans around a saving that is not there.**
It removed the hand-sync risk; it did not build request/reply. `requestSentence` still needs a
**reply**, which is the first non-fire-and-forget call on this bridge: `buildCommandScript` only
injects a call, and nothing correlates a response back to its caller. That correlation — plus the
`(bookId, generation)` stamp described above — is real work, and it is Reader's. What is genuinely
cheaper now is that the reply's seven-field payload is a shared type rather than a shape to
hand-copy, and that a mismatch is a compile error.

## The fake, and deleting it

`fakeReaderTextProvider.ts` serves canned sentences with **synthetic CFIs that resolve against no
book**. It exercises the shape of the seam — ordering, section boundaries, the character cap,
cancellation, teardown — and nothing about rendering.

It exports from the same folder the real provider will live in, so the swap on the Accessibility
side is one import changing. That only holds while nothing depends on the test-only handles
(`sentences`, `spokenRanges`, `setPosition`, `navigate`, `interrupt`), which exist on
`FakeReaderTextProvider` and **not** on `ReaderTextProvider`. Production code typed as
`ReaderTextProvider` cannot reach them; that is the intended pressure.

The production call site that used to exist — `src/features/accessibility/tts/TtsReadingScreen.tsx`,
the "TTS Demo" route, standing in for a real mount point until step 5 landed — is gone as of
2026-08-26. **The remaining call sites outside `reader/tts/` are test-only:**
`src/features/accessibility/tts/useTtsSession.test.ts` and `useTtsSession.android.test.ts`, which use
`createFakeReaderTextProvider` to drive `useTtsSession`'s own state machine (prefetch, generation
counters, teardown) without a real book or WebView. That is a different kind of dependency than "no
real provider exists yet" — it would still be useful even after every production caller is real,
which is why item 3 below is not auto-satisfied by the demo's removal.

Delete together, once items 1-3 are actually all gone:

| #   | Delete                                                                            |
| --- | --------------------------------------------------------------------------------- |
| 1   | `src/features/reader/tts/fakeReaderTextProvider.ts`                               |
| 2   | `src/features/reader/tts/fakeReaderTextProvider.test.ts`                          |
| 3   | every `createFakeReaderTextProvider` call site outside `src/features/reader/tts/` — as of 2026-08-23 that's just `useTtsSession.test.ts` / `.android.test.ts`; see the note above before assuming this is done |
| 4   | this section                                                                      |

`readerTextProvider.ts` is **not** on that list — it is the permanent contract. Neither is
`TTS_PROVIDER.md`; strike the table above and leave the rest.

Before deleting, port `fakeReaderTextProvider.test.ts` rather than dropping it. Every case in it
pins a property of the seam, not a property of the fake, so it is the checklist the real provider
has to satisfy — most sharply the two that carry the data-minimisation guarantee: an in-flight
request must resolve `unavailable` when teardown arrives, and every call after teardown must too.

## Open items

1. **`onInterrupted('revoked')` has no source yet.** There is no `onAccessRevoked` anywhere in this
   repo. `offline-lock.ts` defines a `revoked` signal and `event-bus.ts` defines a carrier for it,
   but that file is marked "PROPOSAL — NOT FINALISED, NOT WIRED", is not exported from the barrel,
   and nothing imports it. The nearest real thing today is `verifyReadingAccess` rejecting in
   `readerAssets.ts`, which is per-open rather than live. The reason is wired when a source exists;
   consumers should build against the reason, not the source. **Karthik + Abhinav.**
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

   The visibility test itself (`spokenRangeVisible`, same file) treats PARTIAL overlap as visible,
   not full containment — a sentence painted where it starts, that also runs onto the next page, is
   not "off-screen" the instant it paints. `anyRectOnScreen` (`highlightGeometry.ts`, pure,
   unit-tested) is the rect/viewport arithmetic this rests on; `contents.window`, not the outer
   `#viewer` `viewportSize()` measures, is the viewport it's measured against, since
   `getClientRects()` on a `contents.range()` Range is in the chapter iframe's own coordinate space.

   Word-precision is gated on `highlightMode === 'word'`, same as the word paint itself —
   `useTtsSession.ts`'s `handleTtsProgress` only forwards `tts-progress` ticks in that mode (see
   `ACCESSIBILITY_ARCHITECTURE_MAP.md`'s `tts.highlightMode` row for why that RN-side wiring needed
   re-landing). `'sentence'`-mode readers still get the coarse, once-per-sentence follow — no page
   ever fails to turn — just not the exact-word boundary.

   The word wash being cleared at the TOP of `setSpokenRange`, before anything paints, remains the
   load-bearing precondition it always was: a `display()` that re-renders the view while a stale mark
   is still attached would carry it into the new one.

   **Genuinely still open, not solved by this:** auto-follow does not back off after the reader's own
   manual swipe/scroll — no "recently navigated" signal exists, so the next tick pulls the view back
   to wherever speech currently is. PDF's `setSpokenRange`/`setSpokenWordRange` remain documented
   no-ops (`pdf.entry.ts`) — nothing to follow there yet.
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
