# Proposal: expose page navigation as a native accessibility action, for TalkBack

**Status: proposal only, not implemented. Needs Ahana's review and sign-off before any of
`ReaderScreen.tsx`, `ReaderWebView.tsx`, or `readerBridge.ts` is touched** — every file this
proposes changing lives in `src/features/reader/`, which she owns per this repo's `CLAUDE.md`
ownership table. This document is the extent of the change made from here.

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
