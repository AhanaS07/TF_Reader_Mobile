# Reader focus-order handoff (Day 3)

**Owner of this doc:** Accessibility (Hruthik). **Owner of the files it describes:** Reader (Ahana).

This is a spec, not a patch — it touches nothing under `src/features/reader/**`, per this repo's
ownership rules. It exists because Day 3's "predictable focus order & restoration" goal covers the
toolbar, TOC panel, search panel, and the native↔WebView seam, all of which live in Reader's
directory. `VoicePicker`/`TtsControls` (the two files that *are* Accessibility's) already got the
real fix — see their own source and `VoicePicker.test.tsx`.

Every citation below is a point-in-time audit from 2026-08-25. Confirm file/line still matches
before applying anything here — this doc will drift as `ReaderScreen.tsx` changes.

Background: `ACCESSIBILITY_ARCHITECTURE_MAP.md` §5/§6 already tracks "no focus trap / restoration
on TOC, Search, TTS, VoicePicker panels" as a confirmed medium-severity gap. This doc is the
file-level breakdown of the Reader-owned two-thirds of that gap.

## 1. Toolbar focus order

`ReaderScreen.tsx`. Render order already matches the intended traversal — no reordering needed:
- Top toolbar (1195–1245): Search → Bookmarks → TTS.
- Bottom bar (1591–1670): Prev → Contents → page-indicator → Next.

Gap: the four toggle buttons (Search, Bookmarks, TTS, Contents) have no
`accessibilityState={{ expanded }}`, so a screen reader never announces whether the panel it
controls is open. Suggested diff shape (repeat per toggle, using each button's own state variable):

```diff
 <Pressable
   accessibilityRole="button"
   accessibilityLabel="Search this book"
+  accessibilityState={{ expanded: showSearch }}
   onPress={...}
 >
```

## 2. TOC panel focus entry

Inline panel, `ReaderScreen.tsx:1364–1496`. No ref, no focus-on-open anywhere. Suggested: ref the
first row (or the empty-state `Text` at 1414–1415 when `toc.length === 0`), and in an effect keyed
on `showToc`, call `AccessibilityInfo.setAccessibilityFocus(findNodeHandle(ref.current))` when it
becomes `true`. This is a plain conditionally-rendered `View`, not a `Modal` — unlike
`VoicePicker`'s fix, mount timing here may not need an artificial delay; verify on-device before
assuming a `setTimeout` is required.

## 3. TOC panel focus traversal

Rows already render in the correct order (`toc.map`, line 1423) — traversal is correct by
construction, nothing to change there. Gap: the two `LinearGradient` fade overlays (1478–1493) are
decorative but not hidden from the accessibility tree. Suggested: add the same two-prop pattern
already used at 1286–1293 (swipe catcher) and 1572–1580 (privacy cover):

```diff
 <LinearGradient ... pointerEvents="none" style={styles.tocFadeTop} />
+  accessibilityElementsHidden
+  importantForAccessibility="no-hide-descendants"
```

(apply to both gradients).

## 4. TOC focus restoration

Ref the "Contents" button (1600–1612). Centralize a `closeToc()` used by every `setShowToc(false)`
call site, mirroring the `closeVoicePicker()` pattern now in `TtsControls.tsx`. The one wrinkle TOC
has that VoicePicker doesn't: `setShowToc(false)` is called from **two different kinds of event** —
(a) TOC's own toggle button or a row's `goTo` selection (a real "close" the user should feel land
back on the Contents button), and (b) as a mutual-exclusion side effect when Search/Bookmarks/TTS
opens instead (where focus should go to *that* panel's own entry point, not back to Contents).
Suggested: `closeToc(restoreFocus: boolean)`, called with `true` from (a) and `false` from (b).
Getting this wrong (restoring on every close) would fight the newly-opened panel's own entry-focus
call from item 2's equivalent in Search/Bookmarks.

## 5. Search panel focus entry

`SearchPanel.tsx:98–114`. The `TextInput` already has `autoFocus`, which is likely sufficient on
its own — RN's `TextInput` autofocus generally carries screen-reader focus too, and the panel fully
unmounts/remounts on each open (`{showSearch && <SearchPanel/>}`, `ReaderScreen.tsx:1506`) so
`autoFocus` re-fires every time. **Recommend verifying on-device before adding an explicit
`AccessibilityInfo.setAccessibilityFocus` call here** — don't add redundant plumbing without
evidence `autoFocus` doesn't already carry AT focus on both VoiceOver and TalkBack.

## 6. Search result focus

`selectHit`, `ReaderScreen.tsx:1010–1043`. On the success path (`send` is ready): the panel closes
(`setShowSearch(false)`) and `send({ type: 'goTo', target })` navigates the WebView, but nothing
redirects focus anywhere — it likely lands nowhere meaningful. `SearchMatchBar` mounts right after
(per the `!showSearch && search.hits.length > 0` condition at `ReaderScreen.tsx:1533`). Suggested:
after `setShowSearch(false)` in this branch, move focus onto one of:
- The `ReaderWebView` container ref (see item 10 — same native-side-boundary technique), or
- `SearchMatchBar`'s counter once it mounts, which needs its own ref + open-effect mirroring
  `VoicePicker`'s `firstRowRef`/`useEffect` pattern (`VoicePicker.tsx:42–55`).

Either is defensible; picking between them is a design call for whoever implements this, since it
depends on whether the immediate next thing a user should hear is "here's your match count" or
"here's the book content you jumped to."

## 7. Search focus restoration

`SearchPanel`'s `onClose` wiring, `ReaderScreen.tsx:1517–1520`
(`cancelPendingSeek(); setShowSearch(false)`). Ref the toolbar Search button (1195–1213); restore
focus onto it **only** for this explicit-Close path — not the successful-result path, which item 6
already sends elsewhere. Same centralization approach as TOC (item 4): a `closeSearch()` helper
used at this call site specifically, distinct from the state changes `selectHit` makes on its own
success path.

## 8. Prevent hidden overlay content from entering focus

Today only two overlays hide *themselves* from AT — the swipe catcher (`ReaderScreen.tsx:1286–1293`)
and the privacy cover (`ReaderScreen.tsx:1572–1580`), both via
`accessibilityElementsHidden` + `importantForAccessibility="no-hide-descendants"` on the overlay
itself. Nothing hides the *background* (the WebView + toolbar + bottom controls bar) while TOC or
Search is open, so a screen reader can navigate through an open panel into inert content behind it.

Suggested: wrap `ReaderWebView` + the top toolbar + the bottom controls bar in one container, and
apply the same two props conditionally:

```diff
 <View style={styles.readerChrome}
+  accessibilityElementsHidden={showToc || showSearch || showBookmarks}
+  importantForAccessibility={(showToc || showSearch || showBookmarks) ? 'no-hide-descendants' : 'yes'}
 >
```

This is the exact pattern the file already uses twice, just retargeted at the background instead of
at decorative chrome. `VoicePicker`'s equivalent doesn't need this — it's a real RN `Modal`, and its
own `accessibilityViewIsModal` fix (see `VoicePicker.tsx`, and the regression test in
`VoicePicker.test.tsx`) already reinforces that boundary. Worth reading that test before applying
this item: `accessibilityViewIsModal` hides *siblings* of the view it's set on, which is a sharp
edge worth being deliberate about if TOC/Search ever gain their own `accessibilityViewIsModal`
instead of this sibling-hiding approach.

## 9. Native ↔ WebView transition — native-side boundary only

Scope note: the Day 3 checklist's native↔WebView item was explicitly narrowed to the native-side
half only (moving true DOM-level focus, e.g. onto a chapter heading, is deferred — see below).

`ReaderWebView.tsx`. What's needed here is narrow: confirm the WebView's native container is a
real, reachable, labelled stop in the toolbar↔content traversal. The existing container-level
`accessibilityLabel` (documented elsewhere as the "accessibilityLabel trap" for *book content*,
`ACCESSIBILITY_ARCHITECTURE_MAP.md` §1) is exactly what makes the *container* — as opposed to the
content inside it — a valid stop, so there's nothing to change for that half.

**Explicitly deferred, not specced further here:** moving focus to specific DOM content (e.g. the
current chapter's heading) on entering the WebView. That needs a new `ReaderCommand` (e.g.
`focusContent`) added to `readerBridge.ts`, implemented in both `epub.entry.ts` and `pdf.entry.ts`,
with `assets/reader/reader-{epub,pdf}.html` regenerated via `npm run reader:build-html` and
`WEBVIEW_BRIDGE.md`'s "Current surface" table updated — the full checklist is in
`WEBVIEW_BRIDGE.md`'s "Before you change the bridge" section. Don't start that work before the
on-device VoiceOver/TalkBack spike (`WEBVIEW_A11Y_SPIKE.md`) runs: every DOM-accessibility behavior
a `focusContent` command would rely on (does a heading survive `epub.js` rendering, does focus
cross the iframe/content-document boundary predictably) is currently unconfirmed, not resolved.

## What's already done (no Reader-side work needed)

- VoicePicker's own hidden-background handling: covered by its `accessibilityViewIsModal` fix.
  Nothing in Reader depends on this.
- VoicePicker's focus entry/restoration: implemented in `TtsControls.tsx`/`VoicePicker.tsx`. Not
  mounted anywhere yet (`TtsControls.tsx`'s own header note) — wiring it into `ReaderScreen.tsx`'s
  toolbar is a separate, Reader-owned decision, not part of this handoff.
