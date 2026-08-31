# Accessibility Architecture Map

**Owner:** Hruthik (Accessibility), team t4targaryen.
**Date:** 2026-08-24.
**Status:** consolidated architecture + integration-point map, verified against code as of this
date. Supersedes stale claims in earlier desk-research docs where noted — every correction below
was checked with a grep against the current tree, not assumed.

> This is a documentation-only deliverable. No code changes accompany this document. Every gap
> identified in §4–§6 is a **finding to plan against**, not something fixed here.

---

## 1. Two accessibility trees (executive summary)

The Reader hosts EPUB/PDF content (`epub.js` / `pdf.js`) inside a WebView, which means two
independent accessibility trees converge on one screen reader:

```text
Native RN UI                      Reader WebView
     |                                 |
RN Accessibility API              HTML accessibility tree
     |                                 |
VoiceOver / TalkBack               WebKit / Android WebView
                                        |
                                   VoiceOver / TalkBack
```

**The single most important rule:** `<WebView accessibilityLabel="Book content" />` labels the
native WebView **container only** — it does nothing for the HTML rendered inside it (`<h1>`, `<p>`,
`<button>`, etc.). Neither layer substitutes for the other; each needs its own treatment. This is
referred to elsewhere as the "accessibilityLabel trap."

**And it is worse than "does nothing": on Android it actively HIDES the content.** A ViewGroup that
is important-for-accessibility and carries a `contentDescription` is a screen-reader focus leaf, so
TalkBack announces the container and never descends into the WebView's virtual node tree. This repo
had that exact line, added 2026-08-26 in good faith as a "named stop" for the focus order, and
removed 2026-08-28 — see `WEBVIEW_A11Y_SPIKE.md` F4(a). The named stop is now a 1x1 sibling node
INSIDE the container, which gives the traversal its stop without making the container focusable.

**Still the largest open unknown:** the on-device VoiceOver/TalkBack spike
(`WEBVIEW_A11Y_SPIKE.md`, 21-area matrix) has an **Android pass complete (2026-08-24/25)** but
**iOS still not run** (no device available for that pass), and the purpose-built sample A/B
fixtures weren't used for the Android pass either (a real pre-existing book was substituted). Every
risk in §6 that depends on "does the real `epub.js`-rendered DOM expose a correct accessibility
tree" is unconfirmed on iOS, and only partially confirmed on Android, until the full spike runs on
both platforms with the intended fixtures. Read every other section of this document with that
caveat — don't infer iOS behavior from the Android results.

---

## 2. Ownership model

| Layer | Owner | Owns |
|---|---|---|
| Native RN reader UI (toolbar, panels, TOC, search) | Ahana (Reader) | `src/features/reader/**`, the WebView bridge, focus/labels on native controls |
| WebView DOM (EPUB/PDF semantic content) | Ahana (Reader) + `epub.js`/`pdf.js` | Headings, paragraphs, links, images, in-book focus, semantic reading structure |
| Accessibility prefs, TTS session, screen-reader metadata | Hruthik (Accessibility) | `accessibility.*` prefs, `src/features/accessibility/**`, the TTS session/state |
| Theme/font/typography/layout prefs, WebView appearance injection | Vaishnavi (Personalization) | `src/features/personalization/**`, the contents of the `applyAppearance` payload |
| Prefs persistence & sync | Karthik (Sync) | `src/features/sync/**`, SQLite tables, conflict resolution |

**Standing rule (frozen since 2026-08-16):** Reader does not read `AccessibilityPrefs` and does not
decide when to speak. The only crossing point between Reader and Accessibility is the
`ReaderTextProvider` seam, whose types are `TtsSentence`, `TtsFetchResult`, `TtsInterruption` — and
nothing else. Accessibility pulls one `TtsSentence` at a time (capped at 400 chars); it does not
receive whole chapters.

With ownership explicit, bugs route immediately: a mislabelled toolbar button is an RN-props fix
(Reader); an unnavigable chapter is a DOM/`epub.js` fix (Reader/WebView); a wrong TTS rate is an
Accessibility fix.

---

## 3. State & announcement ownership model

- `AccessibilityPrefs` (`src/shared/contracts/accessibility.ts`) has four sub-blocks — `text`,
  `display`, `tts`, `announce` — plus a top-level `screenReaderHints: boolean`.
- Accessibility prefs are persisted as **their own SQLite record**
  (`src/features/sync/stores/accessibilityStore.ts`), deliberately separate from Personalization's
  record even though both are read/written through the same `prefsStore` singleton. Reason: whole-
  record last-write-wins conflict resolution would otherwise let a concurrent edit to
  `accessibility.tts.rate` on one device and `theme` on another silently discard one of them —
  acceptable for cosmetic prefs, a correctness failure for an accessibility setting a user depends
  on. `sharedPrefs.ts`'s `mergeSharedPrefs()`/`writeSharedPrefs()` join/split the two records
  transparently, so `prefsStore` callers never see the split.
- **`screenReaderHints` reaches native RN controls only.** It does not affect EPUB content inside
  the WebView — that tree comes from the DOM and is unreachable from RN props. Any future copy,
  UI, or documentation describing this flag must not imply it makes book *content* more accessible.
  Correspondingly, "screen reader compatible" must never be claimed as a general property of the
  Reader — it depends on the still-unrun WebView spike (§1), not on this flag.
- `announce.pageChanges` / `announce.chapterChanges` are owned by Accessibility and transported to
  the WebView today via the `applyAppearance` bridge command, resolved into
  `ReaderAppearance.announcePageChanges` (`src/features/personalization/readerAppearance.ts:134,262`).
  ~~**Verified gap:** ... The carrier exists end-to-end; the consumer does not.~~
  **`announcePageChanges` NOW HAS A CONSUMER (2026-08-28) — but a native one, not a WebView one, and
  that is the design rather than a shortcut.** `ReaderScreen` retains the last-sent `ReaderAppearance`
  and reads the flag at `relocated` time, announcing through `AccessibilityInfo`. It is native
  because the event that warrants the announcement (`relocated`) is already on the native side, and
  an `aria-live` region inside the WebView would announce from a document a screen reader may not be
  able to reach at all — which is F4. `announce.chapterChanges` was added to `ReaderAppearance` in
  the same change and is consumed the same way. See `src/features/reader/READER_ANNOUNCEMENTS.md`.
  **`reduceMotion` is still unconsumed** — that half of the original finding stands.
- **Live-apply channel:** `prefsStore.savePrefs()` → in-memory `notify()` → `ReaderScreen.tsx`'s
  `prefsStore.subscribe()` → `toReaderAppearance()` re-resolve → `applyAppearance` bridge command,
  with no reopen required. This is the one true write path the rest of the app relies on for "save
  now, reader updates immediately."
- **Found inconsistency:** `useTtsSession.ts` does **not** use this path. It persists
  `rate`/`pitch`/`voiceId`/`autoContinueChapter` changes by calling `readSharedPrefs`/
  `writeSharedPrefs` (`src/features/sync/sharedPrefs.ts`) directly, bypassing `prefsStore.savePrefs()`
  and therefore its `subscribe()`/`notify()` channel entirely. Nothing currently needs to react live
  to a TTS-only pref change, so this isn't visibly broken today — but it means TTS prefs are the one
  place in the app where a write doesn't flow through the store the rest of the architecture depends
  on. Documented as a risk in §6, not fixed here.

---

## 4. Controls requiring accessibility support (audit)

Every interactive control was checked for `accessible`, `accessibilityLabel`, `accessibilityRole`,
`accessibilityState`, `accessibilityHint`, and `accessibilityLiveRegion`. `src/screens`,
`src/components`, and `src/navigation` are currently empty — all reader UI lives in
`src/features/reader/` and `src/features/accessibility/`.

### `src/features/reader/ReaderScreen.tsx`

**Audited 2026-08-25; closed by Reader 2026-08-26.** Every gap this table listed is now fixed except
the TOC-row hint, which was declined with a reason.

| Control | Has today | Gap |
|---|---|---|
| Search toggle | role, label, `accessibilityState={{expanded}}` | — complete |
| Bookmarks toggle | role, label, `accessibilityState={{expanded}}` | — complete |
| ~~TTS toggle ("Listen to this book")~~ | — | **Gone.** The speaker button was removed: `accessibility.tts.enabled` is now the only switch, and it mounts the transport directly. Two controls for one boolean is how a user ends up with TTS on and no controls |
| Prev button | role, explicit label ("Previous page"), explicit `accessibilityState={{disabled}}` | — complete |
| Next button | role, explicit label ("Next page"), explicit `accessibilityState={{disabled}}` | — complete |
| Contents/TOC toggle | role, label ("Contents"/"Close contents"), `accessibilityState` | — complete. Reports `expanded` when a TOC exists and `disabled` alone when it does not: a control that can never open is not "collapsed" |
| TOC row | role, `accessibilityState={{disabled}}` | **Hint declined, not overlooked.** `AccessibilityPrefs.screenReaderHints` is a frozen field defaulting to `false` and scoped to native RN controls — exactly this. A hardcoded always-on hint contradicts a preference the user is opted out of. Revisit behind a `useScreenReaderHints()` primitive when a settings screen exists |
| Page indicator / page-jump button | role, explicit label | — complete |
| Page-jump `TextInput` | explicit label | — complete |
| Error banner | `accessibilityRole="alert"` + `accessibilityLiveRegion="polite"` | — complete |
| Book content (WebView container) | hidden while any panel is open; label ("Book content") on a 1x1 SIBLING of the WebView, not on the container | — complete. **The label moved on 2026-08-28 and must not move back**: on Android `accessibilityLabel` is a `contentDescription`, and one on the ViewGroup wrapping a WebView makes it a focus leaf — TalkBack announces it and never descends into the DOM. That is §1's "accessibilityLabel trap", with this exact string as its example. See `WEBVIEW_A11Y_SPIKE.md` F4(a) |
| Bookmark badge, TTS "reading aloud" cue | role, label, hidden while any panel is open | — complete |
| Swipe-catcher overlay, privacy cover, TOC fades | `accessibilityElementsHidden` + `importantForAccessibility="no-hide-descendants"` | correctly hidden — not a gap |

### `src/features/reader/SearchPanel.tsx`
| Control | Has today | Gap |
|---|---|---|
| Search input | explicit label | — complete |
| Search submit button | role, explicit label | — complete |
| Close button | role, explicit label ("Close search") | — complete. All three panels now name their own close, so "Close" is never ambiguous |
| Status line | `accessibilityLiveRegion="polite"` | — present |
| "Still opening this book" busy row | `accessibilityLiveRegion="polite"` | — present |
| Result row | role, composed label ("Result N of M: {snippet}"), explicit `accessibilityState={{disabled}}` | — complete |

### `src/features/reader/SearchMatchBar.tsx`
Previous/Next/Dismiss all have explicit role + label. The step buttons now carry explicit
`accessibilityState={{disabled}}` as well.

**The live region on the counter was declined, not missed.** It changes on every arrow press — the
highest-frequency update on the screen — and with TTS speaking it would queue a screen-reader
utterance *while react-native-tts is mid-sentence of the book*: two speech streams, one output
device, neither ducking for the other. The gated channel for navigation announcements is
`announce.pageChanges`, which nothing reads yet; a search step is not one of those, and nothing in
this app announces unconditionally. The counter's own label already carries the count for anyone
who focuses it.

### `src/features/accessibility/tts/TtsControls.tsx` — closed by Accessibility, 2026-08-26
| Control | Has today | Gap |
|---|---|---|
| Transport (Play/Pause/Stop), Stop, Voice buttons | role, explicit labels | — complete |
| Rate chips, Pitch chips | role, explicit labels, `accessibilityState={{selected}}` | — complete |
| Error text | `accessibilityRole="alert"` + assertive live region | — complete |

### `src/features/accessibility/tts/VoicePicker.tsx` — closed by Accessibility, 2026-08-26
Backdrop, row labels/selection state and `accessibilityViewIsModal` all landed. Focus entry and
restoration are wired too — both now call Reader's shared `focusOn` (`src/features/reader/a11yFocus.ts`)
rather than resolving the node handle inline, so the null-handling lives in one place across both
capabilities. The `setTimeout` around each call stays local: it exists for RN `Modal` mount timing,
which is a property of Modal and not of focusing.

**Cross-cutting pattern:** no control audited is entirely bare (every `Pressable` at least has
`accessibilityRole="button"`). The two systemic gaps are (a) icon/text-only buttons relying on
implicit text-child naming instead of an explicit `accessibilityLabel`, and (b) toggle/selection
controls (TOC open/closed, search open/closed, TTS chip selection, VoicePicker selection) missing
explicit `accessibilityState`.

---

## 5. Focus & reading order

**Current state, updated 2026-08-26** — this section described the state before the focus work
landed on both sides. What is still true is listed second.

**Done:**
- `VoicePicker` sets `accessibilityViewIsModal`, with a regression test covering the sharp edge
  (it hides SIBLINGS, so the backdrop close control has to stay reachable).
- Focus RESTORATION exists on the panels whose close is a deliberate act: TOC → Contents button,
  Search → toolbar Search button, VoicePicker → Voice button. Reader's `closeToc(restoreFocus)`
  carries the one rule that is easy to get wrong — restore when the user finished with the panel,
  do NOT restore when it closed because another panel is opening over it, or the restore races
  that panel's own entry focus.
- The background (toolbar, WebView container, on-page badges) leaves the focus order while a panel
  is open. One deliberate asymmetry: the bottom controls row stays reachable while the TOC is open,
  because the Contents button in that row IS the TOC's close affordance — hiding it stranded a
  screen-reader user inside the panel with no way out.
- The WebView container is a named stop ("Book content") between the toolbar and the bottom row.
- One shared `focusOn` helper (`src/features/reader/a11yFocus.ts`), used by both capabilities.

**Still open:**
- Focus ENTRY into the TOC and Search panels, and where focus should land after a search hit. All
  three want the on-device VoiceOver/TalkBack spike first: Search's `autoFocus` may already carry
  AT focus, in which case an explicit call is redundant plumbing.
- ~~No reading-order/focus-order handling across the native↔WebView seam: the `relocated` bridge
  message only updates RN visual state; it never calls `AccessibilityInfo.announceForAccessibility`~~
  — **the announcement half closed 2026-08-28.** `relocated` now carries a `ReaderSection` and drives
  pref-gated page/chapter announcements through `src/features/reader/a11yAnnounce.ts`, the shared
  sibling of `a11yFocus.ts`. **The focus half is still open**: nothing sends a WebView-side focus
  command, and `READER_FOCUS_ORDER_HANDOFF.md` §9's `focusContent` is still correctly deferred —
  moving DOM focus into content is the wrong order until F4's fixes are confirmed on a device.

**Expected/target reading order** (for future implementation, not built yet): toolbar → WebView
content (heading → paragraphs, in DOM order) → toolbar; panel open/close moves focus in and
restores it out on dismiss; page/chapter change produces at most one polite announcement gated by
`announce.pageChanges` / `announce.chapterChanges` — never a full page re-read, and `aria-live`
assertive is reserved for errors the user must act on.

Native/WebView concept mapping, for anyone implementing against this seam:

| Native React Native | WebView equivalent |
|---|---|
| `accessible` | HTML/DOM accessibility exposure |
| `accessibilityLabel` | `aria-label` / accessible name |
| `accessibilityRole` | Semantic HTML element or ARIA `role` |
| `accessibilityState` | ARIA states (`aria-expanded`, `aria-pressed`, …) |
| `accessibilityHint` | ARIA description / supporting text |
| `accessibilityLiveRegion` (Android) | `aria-live` |

---

## 6. Technical dependencies & risks

| Risk | Severity | Status | Notes |
|---|---|---|---|
| On-device VoiceOver/TalkBack spike never run | High | **Android ran 2026-08-24/25; iOS still never run** | The Android pass found a total failure (F4), now attributed and fixed but unconfirmed on a device. Every VoiceOver cell in all 21 rows is still `—` — blocking further confidence on every DOM-accessibility claim below, on iOS in particular |
| EPUB DOM not semantically accessible (headings/paragraphs survive `epub.js`?) | High | Open, unconfirmed | Only settled by the spike's DOM-inspection checklist |
| `epub.js` iframe/content-document focus behavior | High | Open, unconfirmed | Device test required, both platforms |
| Page-transition accessibility (over/under-announcement) | High | Open, unconfirmed | Test with `announce.pageChanges` on and off once the consumer exists |
| ~~`announcePageChanges`~~ / `reduceMotion` unconsumed | Medium | **Half closed 2026-08-28** | `announcePageChanges` and the new `announceChapterChanges` are consumed natively by `ReaderScreen` (see §3 and READER_ANNOUNCEMENTS.md). `reduceMotion` is still read by nothing in either entry |
| On-device confirmation of the F4 fixes | **Critical/Blocking (re-confirmed 2026-08-31)** | **Partially run — still open** | Configuration A run against Sample A on-device (`WEBVIEW_A11Y_SPIKE.md` §12): cause (b)'s bounds fix confirmed working for on-screen content, but F4's core symptom — TalkBack cannot reach book content via touch exploration — is UNCHANGED, tested at 3 independent points all with correct bounds. Bounds were necessary but not sufficient. Configurations B/C/D (needed to isolate cause (a)) and Sample B / the real book are not run. |
| Reader overrides `layout.flow` when a screen reader is running | Low | **Deliberate, 2026-08-28** | Paginated flow makes book content unreachable (F4/F6). The override is announced with an `Alert` and a session-only opt-out, and `DevPreferencesMenu` disables and annotates its Flow rows while it is in effect — a stored preference is never silently changed. See `src/features/reader/readerA11yLayout.ts` |
| ~~No focus trap / restoration on TOC, Search, TTS, VoicePicker panels~~ | Medium | **Largely closed 2026-08-26 (§5)** | Restoration and background-hiding landed on both sides. What remains is focus ENTRY into TOC/Search and the post-search-hit destination, all gated on the device spike. Full control-by-control status: `READER_FOCUS_ORDER_HANDOFF.md` (same directory) |
| `useTtsSession` bypasses `prefsStore` write path | Low–Medium | **Confirmed via code (§3)** | Writes via `readSharedPrefs`/`writeSharedPrefs` directly; no live-subscriber notification on TTS pref changes; inconsistent with the app's single-write-path pattern |
| VoiceOver vs. TalkBack divergence | Medium | Open, unconfirmed | Same DOM can produce different navigation/grouping/announcements; every spike matrix row needs two independent verdicts |
| Image / alt-text quality | Medium | Open, out of app's control | Third-party EPUB metadata quality varies; test with one good and one poor sample EPUB |
| ARIA overuse / misuse | Medium | Open, process risk | Semantic-HTML-first is the mitigation; marking every span/wrapper as accessible is itself a bug (verbosity, not omission) |
| Highlight CSS ownership collision (`rendition.annotations`) | Medium | Open, unresolved since 2026-08-17 | Personalization (Vaishnavi) and Accessibility/TTS highlighting (Hruthik) both need it; no per-owner CSS class agreed |
| Account-vs-device scope for `accessibility.*` prefs | Medium | Open, undecided | Implicitly account-scoped via sync today; likely wrong for `tts.rate`/`voiceId`/`highlightMode` and `reduceMotion` (which usually mirrors an OS-level setting) — decide before two devices are in play |
| `tts.backgroundPlayback` | Low | Open, intentionally unexposed | Unverified on both platforms; not rendered in Settings until a device spike clears it |
| `tts.highlightMode` | Low | Open, intentionally unexposed | Persisted for forward-compat only; no consumer reads it yet, so it is deliberately not rendered as a control |
| Native "Accessibility metadata screen" (Book Info → Accessibility) | Informational | **Documented in prior planning docs; does not exist in code** | Only the data pipeline exists (`getPublicationAccessibility.ts`, `publicationA11ySummary.ts`); no screen renders it. Not a regression — just a stale doc-vs-code gap to stop propagating |
| `tts-integration-source/` staging folder | Informational | **Referenced in prior notes; does not exist on disk** | TTS is fully integrated and mounted at `src/features/accessibility/tts/**` / `ReaderScreen.tsx:1178` (verified) — treat any reference to a "staged, unintegrated" TTS module as stale |
| `composePreferences()` / `EffectivePreferences` | Informational | **Named in a prior contract doc; no such symbol exists** | The actual equivalent is `toReaderAppearance(prefs, env)` in `readerAppearance.ts` — use that name going forward |

---

## 7. Consolidated next step

One item is actually blocking further confidence in this area: **finish the on-device VoiceOver /
TalkBack spike** (`WEBVIEW_A11Y_SPIKE.md`) — the Android pass is complete (2026-08-24/25) but ran
against a substituted real book rather than the intended sample A/B fixtures, and iOS has not been
run at all. Re-run Android with the sample A/B fixtures, run the full pass on iOS, complete the
DOM-inspection checklist, the 21-area matrix, and the end-to-end journey test on both platforms,
then re-rate the risk register in §6 against what was actually observed. Focus-entry work in §5
(TOC/Search panel entry, post-search-hit destination — tracked in `READER_FOCUS_ORDER_HANDOFF.md`)
is gated on this same spike.

Nothing else here is blocked on that spike — the labelling/state gaps in §4, the focus-restoration
gaps in §5, and the `prefsStore` bypass in §3/§6 are all independently actionable today.
