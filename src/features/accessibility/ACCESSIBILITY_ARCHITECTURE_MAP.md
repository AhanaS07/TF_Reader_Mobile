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

**Still the largest open unknown:** the on-device VoiceOver/TalkBack spike
(`WEBVIEW_A11Y_SPIKE.md`, 21-area matrix) **has never been run**. Every risk in §6 that depends on
"does the real `epub.js`-rendered DOM expose a correct accessibility tree" is unconfirmed, not
resolved, until that spike runs. Read every other section of this document with that caveat.

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
  **Verified gap:** `epub.entry.ts` assigns the incoming appearance to `currentAppearance` (line
  509) but nothing downstream ever reads `currentAppearance.announcePageChanges` or
  `currentAppearance.reduceMotion` again — no `aria-live` region, no announcement call, no
  animation gate exists in `epub.entry.ts` / `pdf.entry.ts`. The carrier exists end-to-end; the
  consumer does not. Same finding for `reduceMotion`.
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
| Control | Has today | Gap |
|---|---|---|
| Search toggle | role, label | — complete |
| TTS toggle ("Listen to this book") | role, label | — complete |
| Prev button | role, `disabled` prop | no explicit `accessibilityLabel` (relies on "‹ Prev" text child), no explicit `accessibilityState={{disabled}}` |
| Next button | role, `disabled` prop | same as Prev |
| Contents/TOC toggle | role | no explicit label, no `accessibilityState` for open/closed |
| TOC row | role, `accessibilityState={{disabled}}` | no `accessibilityHint` explaining it navigates to a chapter |
| Page indicator / page-jump button | role, explicit label | — complete |
| Page-jump `TextInput` | explicit label | — complete |
| Error banner | `accessibilityLiveRegion="polite"` | no `accessibilityRole="alert"` |
| Swipe-catcher overlay, privacy cover | `accessibilityElementsHidden` + `importantForAccessibility="no-hide-descendants"` | correctly hidden — not a gap |

### `src/features/reader/SearchPanel.tsx`
| Control | Has today | Gap |
|---|---|---|
| Search input | explicit label | — complete |
| Search submit button | role | implicit label only ("Search" text child) |
| Close button | role | implicit label only |
| Status line | `accessibilityLiveRegion="polite"` | — present |
| "Still opening this book" busy row | `accessibilityLiveRegion="polite"` | — present |
| Result row | role, `disabled` when not navigable | no explicit label/`accessibilityState={{disabled}}` |

### `src/features/reader/SearchMatchBar.tsx`
Best-labelled surface in the app: Previous/Next/Dismiss all have explicit role + label. Gaps: no
live region on the "Match N of M" counter text (changes on every step press, never announced);
disabled state on step buttons relies on the `disabled` prop rather than explicit
`accessibilityState`.

### `src/features/accessibility/tts/TtsControls.tsx`
| Control | Has today | Gap |
|---|---|---|
| Transport (Play/Pause/Stop), Stop, Voice buttons | role | implicit label only, no hint |
| Rate chips, Pitch chips | role | **no `accessibilityState={{selected}}`** — a screen reader cannot tell which rate/pitch is currently active (visual-only styling) |
| Error text | none | no live region — a TTS error mid-read is never announced |

### `src/features/accessibility/tts/VoicePicker.tsx`
| Control | Has today | Gap |
|---|---|---|
| Backdrop | `accessibilityRole="none"` | closes on tap but isn't exposed to AT as a "Close" control |
| "Platform default" row, voice rows | role | no label, no `accessibilityState={{selected}}` for the checkmark-indicated selection |
| The `Modal` itself | — | no `accessibilityViewIsModal` |

**Cross-cutting pattern:** no control audited is entirely bare (every `Pressable` at least has
`accessibilityRole="button"`). The two systemic gaps are (a) icon/text-only buttons relying on
implicit text-child naming instead of an explicit `accessibilityLabel`, and (b) toggle/selection
controls (TOC open/closed, search open/closed, TTS chip selection, VoicePicker selection) missing
explicit `accessibilityState`.

---

## 5. Focus & reading order

**Current state:**
- No `accessibilityViewIsModal` anywhere in the repo. TOC and Search panels are visual overlays
  rendered as siblings of `ReaderWebView`, not native `Modal`s. Only `VoicePicker` uses RN's
  `Modal`, which gives partial default focus trapping on iOS only, with no explicit reinforcement.
- No focus-restoration code on any panel close (TOC, Search, TTS, VoicePicker) — dismissing a panel
  never returns focus to the toolbar button that opened it.
- No reading-order/focus-order handling across the native↔WebView seam: the `relocated` bridge
  message (page/CFI change) only updates RN visual state (`ReaderScreen.tsx:673-680`); it never
  calls `AccessibilityInfo.announceForAccessibility` and never sends a WebView-side focus command.

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
| On-device VoiceOver/TalkBack spike never run | High | Open | Blocking further confidence on every DOM-accessibility claim below |
| EPUB DOM not semantically accessible (headings/paragraphs survive `epub.js`?) | High | Open, unconfirmed | Only settled by the spike's DOM-inspection checklist |
| `epub.js` iframe/content-document focus behavior | High | Open, unconfirmed | Device test required, both platforms |
| Page-transition accessibility (over/under-announcement) | High | Open, unconfirmed | Test with `announce.pageChanges` on and off once the consumer exists |
| `announcePageChanges` / `reduceMotion` unconsumed in WebView | Medium | **Confirmed via code (§3)** | Bridge carries both fields into `currentAppearance`; `epub.entry.ts`/`pdf.entry.ts` never read either again |
| No focus trap / restoration on TOC, Search, TTS, VoicePicker panels | Medium | **Confirmed via code (§5)** | Concrete, file-level version of the general "modal focus restoration" risk |
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

One item is actually blocking further confidence in this area: **run the on-device VoiceOver /
TalkBack spike** (`WEBVIEW_A11Y_SPIKE.md`) against both a well-formed and a poor-quality sample
EPUB, complete the DOM-inspection checklist, the 21-area matrix, and the end-to-end journey test on
both platforms, then re-rate the risk register in §6 against what was actually observed.

Nothing else here is blocked on that spike — the labelling/state gaps in §4, the focus-restoration
gaps in §5, and the `prefsStore` bypass in §3/§6 are all independently actionable today.
