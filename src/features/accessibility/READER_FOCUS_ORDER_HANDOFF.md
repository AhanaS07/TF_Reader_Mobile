# Reader focus-order handoff (Day 3)

**Owner of this doc:** Accessibility (Hruthik). **Owner of the files it describes:** Reader (Ahana).

This is a spec, not a patch — it touches nothing under `src/features/reader/**`, per this repo's
ownership rules. It exists because Day 3's "predictable focus order & restoration" goal covers the
toolbar, TOC panel, search panel, and the native↔WebView seam, all of which live in Reader's
directory. `VoicePicker`/`TtsControls` (the two files that *are* Accessibility's) already got the
real fix — see their own source and `VoicePicker.test.tsx`.

Every citation below is a point-in-time audit from 2026-08-25. Confirm file/line still matches
before applying anything here — this doc will drift as `ReaderScreen.tsx` changes.

---

## STATUS, 2026-09-03 — read this before the items below

Reader implemented **1, 2, 3, 4, 7, 8, 9**, and closed **5** with no code. Only **6** is still open.

The 2026-08-26 split was: focus RESTORATION (4, 7) needs no device evidence — you already know which
control the user came from — while focus ENTRY (2, 5, 6) waits on the on-device VoiceOver/TalkBack
spike (`WEBVIEW_A11Y_SPIKE.md`). **That deferral held for 6 only.** 2 and 5 were released from it on
2026-09-03 for reasons the spike does not touch:

- **2 (TOC entry) is native RN, not WebView content.** What the spike blocks is every question about
  focus *inside* the book's document — §8's F4/F6, and §12.3's three-tap table, are all about the
  WebView's virtual node tree. The Contents panel is a plain conditionally-rendered `View` of
  `Pressable`s, a sibling of `ReaderWebView` on the native side of that boundary, and §12.3 records
  native controls (including the Contents button itself) taking touch-exploration focus reliably
  throughout that same session. So this item was never what the WebView blocker gated. **And §12.4
  observed the defect directly** — "Opened the TOC panel (focus stayed on the toolbar back-arrow
  rather than entering the panel — item 2 …, expected, still deferred)". Implemented; see the
  item's own note below.
- **5 (Search entry) needed no code either way.** That item's own recommendation was "don't add
  plumbing without evidence `autoFocus` is insufficient", so the spike gated an ADDITION, not a
  decision. Verified and closed below.
- **6 (search-result focus) stays deferred.** Not for want of a destination — that call has since
  been made (`SearchMatchBar`'s counter, not the WebView container) — but the item is the one place
  focus is sent *because* the user has arrived at book content, so what the spike settles is whether
  that arrival is observable at all.

**§12 of the spike is not on this branch yet.** "§11 Configuration A results (2026-08-31, Hruthik)"
— §12.1 through §12.8, the device pass §11 asked for — lives on `origin/feature/accessibility` and
has not merged into `T4_Ahana` or `dev_T4`, where `WEBVIEW_A11Y_SPIKE.md` still ends at §11. The
citations above resolve the moment that branch lands, which is the intended reading order; until
then, `git show origin/feature/accessibility:src/features/accessibility/WEBVIEW_A11Y_SPIKE.md`.
Flagged rather than dropped because CLAUDE.md asks for citations that resolve, and this is the case
that rule does not quite cover: a path that resolves on the branch that owns the evidence and not
yet on the one reading it. Item 2's justification does not depend on it either way — the
native/WebView distinction above stands on its own.

**Four corrections to the spec, found while implementing it:**

1. **Item 1's TTS toggle no longer exists.** The speaker button was removed — `accessibility.tts.enabled`
   is now the only switch and mounts the transport directly. Search, Bookmarks and Contents got
   `expanded`; Contents omits it while disabled, since a control that can never open is not "collapsed".
2. **Item 8's single wrapper is not possible, and reparenting to create one would be a bug.** The
   TOC/Search/Bookmarks panels are siblings of `ReaderWebView` *inside* `viewer`, so no existing node
   holds the background and excludes the panels. Wrapping means reparenting, and changing the viewer's
   height re-paginates epub.js and invalidates every resolved CFI (`SearchMatchBar.tsx`'s header).
   Implemented as the same two props applied to the existing background nodes instead — no new nodes,
   no layout change.
3. **Item 8 also had a stranding bug.** Hiding the whole background removes the Contents button — which
   *is* the TOC's close affordance, unlike Search and Bookmarks which close from inside their own
   panels. The bottom row therefore stays reachable while the TOC is open. Caught by existing tests.
4. **Item 9's premise was wrong.** `ReaderWebView`'s container had no `accessibilityLabel` at all, so
   this was real work rather than a no-op. It now has one ("Book content").
   **CORRECTION, 2026-08-28 (Reader): putting it ON THE CONTAINER was itself a defect, and it has
   been moved.** On Android `accessibilityLabel` is a `contentDescription`, and a ViewGroup that is
   important-for-accessibility with one is a screen-reader focus LEAF — TalkBack announces "Book
   content" and never descends into the WebView's virtual node tree, so no heading, paragraph or
   link in the book is reachable. That is precisely the "accessibilityLabel trap" this workstream
   documents, using this exact string as its example (`ACCESSIBILITY_ARCHITECTURE_MAP.md` §1,
   `WEBVIEW_A11Y_FINDINGS.md` §3.6). It landed two days AFTER the spike, so it did not cause F4's
   original observation — but it would have made any fix unobservable. The named stop this item
   asked for is now a 1x1 `accessible` sibling INSIDE the container, which gives the traversal its
   stop without making the container itself focusable. See `WEBVIEW_A11Y_SPIKE.md` F4(a).

**On the `VoicePicker` pattern this doc cites:** it did not exist in the repo when the items were
written, so Reader established the helper — `src/features/reader/a11yFocus.ts`. `VoicePicker.tsx` and
`TtsControls.tsx` have since been folded onto it, so there is one implementation of the node
resolution and null-handling. The `setTimeout` around each stays local to Accessibility: it is Modal
mount timing, not focusing.

---

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

## 2. TOC panel focus entry — **IMPLEMENTED, 2026-09-03 (Reader)**

Original spec: inline panel, `ReaderScreen.tsx:1364–1496` (now 2316–2470). No ref, no focus-on-open
anywhere. Ref the first row (or the empty-state `Text` when `toc.length === 0`), and in an effect
keyed on `showToc`, focus it when that becomes `true`.

Implemented as `firstTocRowRef` (`ReaderScreen.tsx:704`), attached to the row at index 0 only
(~2394), and an effect keyed on `showToc` sitting directly under `closeToc` (~1597) so the entry and
restore halves read as the pair they are. Tests: the `focus entry` block in
`ReaderScreen.test.tsx`'s `screen-reader focus order` describe. Three deviations from the spec, each
deliberate:

- **`focusOn` from `src/features/reader/a11yFocus.ts`, not a hand-rolled
  `setAccessibilityFocus(findNodeHandle(...))`.** That helper is where this repo decided what a
  missing node means, and `VoicePicker`/`TtsControls` are already folded onto it. Its header warns
  against effects keyed on "is the panel open"; this one qualifies because it returns early on
  `false`, and `showToc` only ever becomes `true` from the Contents button's own press — so it
  cannot fire on a render the user did not cause.
- **No `setTimeout`, as this item anticipated.** The panel is a conditionally-rendered `View` in the
  same tree, so its host node is attached by the time effects run for the commit that mounted it.
  The delay `VoicePicker` needs is a property of `Modal`'s asynchronous native attach, which this
  has none of. Not added on spec; add one only with device evidence.
- **One ref, not two.** The empty-state `Text` this item also names is unreachable: the Contents
  button is `disabled` while `toc.length === 0`, and that press is the only `setShowToc(true)` in
  the file, so the panel cannot be opened empty. Pinned from both ends — the existing "reports
  disabled with no outline" test guards the premise, and a new focus-entry test asserts the press is
  inert. A second ref would have been unreachable code, and `focusOn` no-ops silently anyway.

Not covered here, and not this item: the effect deliberately does **not** re-fire when a fresh `toc`
message lands while the panel is open. Keying it on `toc` as well would yank a reader who has
already scrolled the list back to its first row; there is a test for that.

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

## 5. Search panel focus entry — **CLOSED, 2026-09-03 (Reader). No code.**

Original spec: `SearchPanel.tsx:98–114`. The `TextInput` already has `autoFocus`, which is likely
sufficient on its own — RN's `TextInput` autofocus generally carries screen-reader focus too, and
the panel fully unmounts/remounts on each open (`{showSearch && <SearchPanel/>}`,
`ReaderScreen.tsx:1506`) so `autoFocus` re-fires every time. **Recommend verifying on-device before
adding an explicit `AccessibilityInfo.setAccessibilityFocus` call here** — don't add redundant
plumbing without evidence `autoFocus` doesn't already carry AT focus on both VoiceOver and TalkBack.

Both premises re-checked and still hold; only the line numbers drifted. `autoFocus` is
`SearchPanel.tsx:113`, on the `TextInput` that also carries the explicit `accessibilityLabel`
("Search in this book"); the mount is still `{showSearch && <SearchPanel …/>}`, now
`ReaderScreen.tsx:2431`, so the whole panel — field included — is remounted per open and `autoFocus`
fires each time rather than only on the first.

**Closed as "no code", which is the outcome this item asked for, not a shortcut past it.** The
device check it recommends gates an ADDITION: it is the evidence that would justify layering an
explicit `focusOn` call on top of `autoFocus`. With no such evidence, adding one is the belt-and-
braces plumbing this item names and warns off — a second focus move a frame after the first, on a
field that already has it, on both platforms. Nothing is deferred by closing it; if a device pass
later shows `autoFocus` does not carry AT focus, reopen it *then*, with the finding attached.

The adjacent behaviour is already pinned in `ReaderScreen.test.tsx`: "does NOT move focus when the
TOC closes because Search is opening" exists precisely because Search brings its own entry focus,
and would start failing if that stopped being true and something else were added here.

## 6. Search result focus — **IMPLEMENTED, 2026-09-09 (Reader)**

Picked the match-bar-counter option this item's own note left open: the immediate next thing a
result selection should announce is "here's your match count," not silently re-entering the book.

`ReaderScreen.tsx`'s `selectHit` and the queued-seek flush effect both bump a `matchBarFocusSignal`
counter (not a boolean — `stepHit` calls back into `selectHit` too, and must NOT re-trigger this) at
the two points search genuinely closes because of a selection, direct and queued. A `matchBarCounterRef`
effect keyed on that counter calls `focusOn`, mirroring `firstTocRowRef`'s own entry-effect pattern —
in `ReaderScreen`, not inside `SearchMatchBar`, because `SearchMatchBar` unmounts/remounts
independently of a fresh selection (reopening the results list from its own counter, then an
explicit Close with nothing newly chosen) and a bump-counter comparison only works cleanly in a
component whose lifetime outlasts that transition. `SearchMatchBar` now forwards a ref to its
counter button for this. Covered by four new cases in `ReaderScreen.test.tsx`'s "focus restoration"
block: results-list selection, arrow-stepping (must NOT re-fire), a queued selection resolving after
`send` becomes ready, and explicit Close with stale hits present (must NOT fire either).

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

**Explicitly deferred, not specced further here** — and STILL deferred as of 2026-08-28, now behind
`WEBVIEW_A11Y_SPIKE.md` §11's re-run rather than behind the original spike: moving focus to specific
DOM content (e.g. the current chapter's heading) on entering the WebView. That needs a new `ReaderCommand` (e.g.
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
- VoicePicker's focus entry/restoration: implemented in `TtsControls.tsx`/`VoicePicker.tsx`, and
  both now call Reader's shared `focusOn`. **`TtsControls` IS mounted** — `ReaderScreen` renders it
  whenever TTS is enabled for an EPUB, in place of the page-navigation row. The "not mounted
  anywhere yet" note this line used to cite is gone from that file.

## STATUS, 2026-08-28 — `fakeReaderTextProvider.ts`'s test-double dependency is gone

`TTS_PROVIDER.md`'s deletion table named `useTtsSession.test.ts`/`.android.test.ts`'s dependency on
`src/features/reader/tts/fakeReaderTextProvider.ts` as the one thing blocking that file's deletion.
That dependency no longer exists: `src/features/accessibility/tts/testSupport/fakeReaderTextProvider.ts`
is a forked, Accessibility-owned copy (same content, `Owner: Accessibility (Hruthik)`), and both
test files now import from it instead. Confirmed via
`grep -rn "features/reader/tts/fakeReaderTextProvider" src/` — the only remaining hits are
`fakeReaderTextProvider.ts`/`.test.ts` referencing themselves and `TTS_PROVIDER.md`'s own table.

So, on your side: `TTS_PROVIDER.md`'s deletion-table items 1, 2, and 4
(`fakeReaderTextProvider.ts`, its test, and that table's own section) are unblocked — item 3
("every `createFakeReaderTextProvider` call site outside `src/features/reader/tts/`") is now
satisfied. Deleting those two files and updating that doc's status line is yours to do, since they
live in `src/features/reader/`.

**Done, 2026-09-09.** Both files deleted; `TTS_PROVIDER.md` updated. One thing found while diffing
the two test files before deleting: the fork was missing 4 cases the original still had, all
covering `setSpokenWordRange`/`spokenWordRanges` (call-order, independence from the sentence log,
teardown, silent-accept of an unresolvable range) — ported into the fork's own test file rather
than dropped. Worth knowing about since it's your test file now.

**Also renamed the same day: your fork is no longer `fakeReaderTextProvider.ts`.** Since Reader's
copy is gone and yours is the sole survivor, "Fake" is dropped from the filename and every exported
identifier — now `src/features/accessibility/tts/testSupport/testReaderTextProvider.ts`,
`TestReaderTextProvider`, `createTestReaderTextProvider`, `TestBook`, `DEFAULT_TEST_BOOK`. Reason:
"fake" reads as a mocking-library fake, which this never was — it's a deterministic, hand-written
test double. `useTtsSession.ts`/`.test.ts`/`.android.test.ts` are updated to match.

Also, separately: `accessibility-frontend-integration-contract.md` had a documentation error (§0,
§2.3, §3, §4, §5 attributed `TtsControls`/`VoicePicker` to you) that's now corrected to match
`CLAUDE.md`'s ownership table and both files' own headers — Accessibility (Hruthik) owns them, not
Reader. Flagging directly since you've been editing them in good faith under the old (wrong) text —
this doesn't undo that collaboration, just corrects who signs off on the next changes to those two
files specifically.

**Two more items, consolidated here rather than left scattered across plan files:**

3. **The `customFontUri` collision is decided and implemented — this item is closed.**
   `ReaderScreen.tsx:215-221` now documents and applies the precedence: `dyslexiaFont === true` WINS
   OUTRIGHT over `font.family`/`customFontUri`, not a merge, because the two cannot compose (one
   `@font-face`, one `font-family`). Ahana's call, confirmed 2026-09-03. `readerAnnouncements.ts`
   already checks `dyslexiaFont` before `fontFamily` for the same ranking, so the announcement wording
   and the applied precedence agree.
4. **Handoff B (Dyslexia Font / High Contrast / Reduce Motion) is open whenever you pick it up.**
   Full detail lives in `~/.claude/plans/day-5-accessibility-compressed-whistle.md` — not urgent,
   just flagging its existence here too since a plan file isn't somewhere you'd otherwise look.
   Short version: `AccessibilitySettingsPanel.tsx`/`dyslexiaFontLoader.ts`/`highContrastColors.ts`
   are built, tested, and unmounted; mounting the panel and wiring the two overrides into
   `buildAppearanceWithFont()` (same seam `a11yFlowOverride` already uses, not
   `toReaderAppearance()`) is the remaining work, and it's entirely yours per the contract's §5.
