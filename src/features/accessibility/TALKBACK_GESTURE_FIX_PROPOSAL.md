# Proposal: expose page navigation as a native accessibility action, for TalkBack

**Status: implemented and unit-tested.** Ahana reviewed this proposal, caught a real defect in its
original sketch (see "Resolution, Ahana" below), and implemented the corrected version (`0a2b46d`)
— a dedicated sibling node on `ReaderWebView`, not the container, wired through to
`ReaderScreen.tsx`. On-device verification confirmed the underlying action fires and the page
visibly turns (see "Phase 5 — on-device verification" below); real TalkBack gesture-surfacing
(two-finger swipe vs. local Actions menu) is the one item still open.

Written from `src/features/accessibility/` (Hruthik's lane) as a handoff, prompted by
`WEBVIEW_A11Y_SPIKE.md` §13 (2026-09-11) — read that section first for the reproduction and the
three-layer breakdown of why TalkBack can't currently scroll or turn pages in the EPUB WebView.

## Problem

With TalkBack on, a user cannot scroll or page-turn the book content rendered inside the reader's
WebView. Three independent things are broken (`WEBVIEW_A11Y_SPIKE.md` §8, §12.3, §12.6, §13):

1. Degenerate/incorrect accessibility bounds for off-screen content — addressed, largely resolved
   (§12.2).
2. The `accessibilityLabel` container trap — fixed, but insufficient alone (§12.3).
3. **Still open**, and the one this proposal works around rather than fixes: touch exploration
   cannot reach WebView-internal content at all, even with correct bounds and no container label —
   narrowed to an `ACTION_ACCESSIBILITY_FOCUS` call that's accepted but never durably lands inside
   the WebView's own accessibility bridge (§12.6, 2026-09-11 instrumentation result). Separately,
   even the raw touch gestures that drive swipe-to-turn-page never reach the page's DOM listeners in
   the first place, because Android's touch-exploration layer consumes single-finger touches before
   they get there (§13's new mechanism-level note).

Root-causing #3 needs code-level investigation into how Android's WebView exposes an iframe's
content document to the accessibility bridge (§12.7, item 2) — genuinely hard, and still in
progress. This proposal does not attempt that. It proposes a different page-navigation path that
never depends on #3 being fixed at all.

## Why this sidesteps the open root cause, instead of needing it fixed

The native toolbar Prev/Next buttons already prove the workaround shape works today: they are plain
RN `Pressable`s (`ReaderScreen.tsx:3042-3144`), sitting *outside* the WebView, and TalkBack reliably
reaches and activates them (`WEBVIEW_A11Y_SPIKE.md`, rows 7/8 PASS). Neither of them ask TalkBack to
focus or scroll anything inside the WebView's own DOM/accessibility tree — the thing that's broken.

The proposal: give the reader a **second, TalkBack-native way to trigger the same page-turn**,
exposed as a custom accessibility action on a native View, rather than trying to make swipe/scroll
gestures reach the WebView's content.

## What already exists to reuse

Both toolbar buttons call (`ReaderScreen.tsx:3042-3144`):

```tsx
onPress={() => {
  pendingInitialVerifyRef.current = null;
  send?.({ type: 'next' }); // or 'prev'
}}
```

`send` (`ReaderWebView.tsx:150-152`):

```tsx
const send = useCallback((command: ReaderCommand): void => {
  webViewRef.current?.injectJavaScript(buildCommandScript(command));
}, []);
```

`ReaderCommand`'s `next`/`prev` variants are already payload-free (`readerBridge.ts:520-524`,
`READER_COMMANDS`, `buildCommandScript`), and this exact path is already proven reliable — it's the
one the toolbar buttons use today. **No bridge or type change is needed.** The only new thing is a
second call site for `send({type:'next'})`/`send({type:'prev'})`.

## Sketch

On `ReaderWebView`'s container `View` (`ReaderWebView.tsx:264-276`) — the same node whose
`accessibilityLabel` doc already warns about the container/leaf trap, so read that comment before
touching this — add:

```tsx
<View
  style={styles.container}
  testID="reader-webview-container"
  accessibilityElementsHidden={hidden}
  importantForAccessibility={hidden ? 'no-hide-descendants' : 'yes'}
  accessibilityRole="adjustable"
  accessibilityActions={[
    { name: 'increment', label: 'Next page' },
    { name: 'decrement', label: 'Previous page' },
  ]}
  onAccessibilityAction={(event) => {
    switch (event.nativeEvent.actionName) {
      case 'increment':
        send({ type: 'next' });
        break;
      case 'decrement':
        send({ type: 'prev' });
        break;
    }
  }}
>
```

`increment`/`decrement` on `accessibilityRole="adjustable"` is RN's standard mapped pair — TalkBack
exposes it as a two-finger swipe up/down without the user needing to open a local context menu to
discover it, which is closer to the swipe gesture the sighted flow already uses than a menu item
would be.

**This pattern is not used anywhere else in this codebase** (`grep -rn "accessibilityActions\|
onAccessibilityAction"` returns zero hits outside this proposal) — there's no existing precedent to
lean on here, so treat the exact TalkBack surfacing (two-finger swipe vs. local "Actions" menu vs.
something else on this RN/RNW version — `react-native@0.86.2`, `react-native-webview@13.16.1`) as
unverified until it's run on-device.

## Open question for Ahana

Whether `window.TFReader.next()`/`prev()` do anything sensible when the reader is in the
a11y-forced `scrolled-doc` flow, or whether they're paginated-flow-only. If the latter, this
proposal's `send` calls need a different target in that flow (e.g. a scroll-by-viewport command) —
not visible from the reader-side files read while writing this proposal, so flagging rather than
guessing.

## Testing plan

Reuse `WEBVIEW_A11Y_SPIKE.md`'s tap-exact-bounds methodology and its own stated confounds
(§12.5–§12.6: synthetic taps can't distinguish "reached and found nothing" from "never routed" for
non-clickable targets) rather than re-deriving a new one. Concretely: with TalkBack on, focus the
WebView container (should land on the same node the a11y-label sibling already makes a named stop
for), open TalkBack's local context menu or attempt the two-finger swipe, and confirm the page
actually turns — a real device or a rooted AVD is preferable per §12.5's note that synthetic
multi-finger gesture injection is unreliable on a stock emulator image.

## Not in scope here

- Fixing #3 itself (the WebView accessibility-bridge defect) — still open, still needs the
  code-level investigation §12.7 calls for.
- Any change to `touchGesture.ts` or `epub.entry.ts`'s existing swipe/long-press handling — this
  proposal adds a parallel path, it doesn't touch the existing one.
- Continuous-scroll-specific behavior beyond the open question above.

## Resolution, Ahana (2026-09-11) — sketch corrected, open question answered

**The sketch's placement reintroduces the exact `accessibilityLabel` container trap this codebase
already fixed once, via a different prop.** Putting `accessibilityActions`/`accessibilityRole` on
the container `View` (as sketched above) triggers RN's own Android delegate
(`ReactAccessibilityDelegate.kt`'s `onInitializeAccessibilityNodeInfo`) to **synthesize** a
`contentDescription` on that node whenever it has no existing text/description and either
`accessibilityActions`, `accessibilityState`, `accessibilityLabelledBy`, or `accessibilityRole` is
set (`hasContentToAnnounce`, ~lines 177–187) — by walking and concatenating descendant
text/descriptions (`getTalkbackDescription`, ~lines 944–1004). A ViewGroup with a synthesized
`contentDescription` is a screen-reader focus **leaf**: TalkBack announces it and never descends
into the WebView's own virtual accessibility tree — the identical Android-side symptom rule #1 of
`CLAUDE.md`'s reader-accessibility rules already fixed for a literal `accessibilityLabel` prop, just
triggered here by a different prop pair.

**Fix**: do not put `accessibilityActions`/`accessibilityRole`/`onAccessibilityAction` on the
container. Add a **second, dedicated 1x1 sibling `View`** inside the container instead — parallel to
the existing `testID="reader-webview-a11y-stop"` node, not layered onto it (that node is the "Book
content" named stop, a different purpose with its own role/label). The container itself keeps
exactly its current props.

**Open question, answered.** `next()`/`prev()` are not paginated-flow-only. epub.js's own vendored
source confirms it: `mapManager('scrolled-doc')` resolves to the `continuous` manager
(`node_modules/epubjs/src/managers/continuous/index.js`), whose `next()`/`prev()` (lines 525–567) are
a *separate* implementation from the paginated manager's — they call
`this.scrollBy(0, ±this.layout.height, true)`, i.e. a viewport-height scroll. That is exactly the
"native scrolling of the content" §13 already says is the thing TalkBack currently can't do at all
in `scrolled-doc` flow. No second/scroll-by-viewport command is needed — the same
`send({type:'next'|'prev'})` this proposal already reuses covers both flows.

See Ahana's plan (executed alongside this addendum) for the corrected implementation and its test
coverage.

## Phase 5 — on-device verification (Hruthik, 2026-09-14)

**Verified working, with one non-obvious caveat about the return value.** Confirmed via a temporary
in-process instrumentation test (same method as the 2026-09-11 F4 finding — a direct
`AccessibilityNodeInfo.performAction()` call, not gesture synthesis; `android/app/src/androidTest/`,
gitignored, deleted after; `build.gradle` reverted after) against `tts_spike`:

1. **The node is real and correctly exposed.** RN's `accessibilityRole="adjustable"` reports as
   `android.widget.SeekBar` to the accessibility tree — that's RN's own Android mapping, not a
   wrong-node bug — carrying exactly the two custom actions: `ACTION_SCROLL_FORWARD` labelled
   "Next page", `ACTION_SCROLL_BACKWARD` labelled "Previous page". Confirmed by reading
   `ReactAccessibilityDelegate.kt` directly: `increment`/`decrement` map to those two standard
   framework action IDs (lines 567–568), not custom ones.
2. **`performAction(ACTION_SCROLL_FORWARD)` returns `false` — and that is a red herring, not a
   failure.** Traced to `ReactAccessibilityDelegate.kt:220–264`: for any action in
   `accessibilityActionsMap`, the JS `AccessibilityActionEvent` is dispatched **unconditionally,
   before** the method returns anything (line 236–238). Only the *return value* differs for
   `adjustable` role on scroll actions — it delegates to `super.performAccessibilityAction()`
   instead of the usual `return true`, and a plain (non-natively-scrollable) `View`'s superclass
   answers `false` for `ACTION_SCROLL_FORWARD`/`BACKWARD` regardless of whether the JS handler ran.
   **A test (or a future reader of this doc) that stops at the boolean return value would wrongly
   conclude this doesn't work.**
3. **The page actually turns.** Confirmed visually, not just by return value: a screenshot taken
   ~immediately after firing `ACTION_SCROLL_FORWARD` shows the visible chapter content advanced
   from "paragraph 1" to "paragraph 3/4/5" (the sample fixture's own filler-paragraph numbering).
   Text-content comparison via the accessibility tree's `getText()` was tried first and is
   **not** a usable signal for this — the WebView's exposed text node appears to span far more of
   the chapter than what's on-screen (consistent with every prior finding in this file about
   CSS-column-paginated content's accessibility exposure), so it read identically before and after
   even though the visible page changed. Only a visual (screenshot) check caught the real result.

**Conclusion: the proposal works as corrected and implemented.** TalkBack users get a working
page-turn path that never depends on the still-open WebView touch-exploration defect (§12.6). The
`false` return value is expected and not a defect — noting it here so nobody "fixes" it later by
trying to make it return `true`, which would require making the sibling node a real
natively-scrollable View for no benefit.

**Not verified by this pass, and still open:** the actual TalkBack-gesture surfacing (two-finger
swipe vs. local Actions menu) on a real device — this test fired the underlying Android action
directly, which is what either surfacing mechanism would itself invoke, but doesn't confirm which
UX a real TalkBack user actually gets to trigger it, or how discoverable it is. That still needs a
real device or a rooted AVD per this doc's own original testing plan.
