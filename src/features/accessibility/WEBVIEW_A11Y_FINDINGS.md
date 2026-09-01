# WebView Screen-Reader Findings — Consolidated

**Owner: Hruthik. Status: desk research only. Last reviewed: 2026-08-17.**

> **THE SPIKE HAS RUN — this document has not been updated for it, and §2 below is wrong.**
> The Android/TalkBack pass happened 2026-08-24/25 and found a total failure (F4), which has since
> been attributed and fixed (2026-08-28). iOS/VoiceOver is still unrun. Read
> `WEBVIEW_A11Y_SPIKE.md` for what is actually known; treat §2, §4's "all nine items are still
> open", and §6 here as superseded. Everything in §3 (the Day-1 desk research) still stands, and
> §3.6's "accessibilityLabel trap" turned out to be exactly right — see the spike's F4(a).

> This document rolls up everything the team has learned or decided about WebView (VoiceOver /
> TalkBack) accessibility for the Reader's EPUB/PDF surface, across Day 1, Day 2, and Day 3. It is a
> consolidation of existing research — nothing here is a new finding, and nothing here should be
> read as a validated result. The one open item that would change that (the Day-2 device spike) is
> called out explicitly in §2 and §5.

This is desk research from the accessibility workstream's Day 1–3, consolidated from a standalone
research folder (original source files, including the Day-1 findings doc and the day3 planning
docs referenced below, are retained outside this repo in the `day wise` research folder).

---

## 1. Executive summary

The Reader hosts EPUB/PDF content inside a WebView (`epub.js` / `pdf.js`), which means there are
**two independent accessibility trees** converging on one screen reader:

```text
World A — Native RN UI            World B — Reader WebView

Native RN UI                      Reader WebView
     ↓                                 ↓
RN Accessibility API              HTML accessibility tree
     ↓                                 ↓
VoiceOver / TalkBack               WebKit / Android WebView
                                        ↓
                                   VoiceOver / TalkBack
```

**The problem is not capability, it is ownership.** A WebView is not a black box to assistive
technology — `WKWebView` and Android WebView both expose the HTML/DOM's own accessibility
information to VoiceOver/TalkBack. But that also means React Native's `accessibilityLabel` on the
native `<WebView>` container does nothing for the HTML rendered inside it (the "accessibilityLabel
trap" — see §3.6). The two layers must be designed, labelled, and tested separately.

**Research conclusion:** Feasible — WebView content can be made fully accessible.
**Implementation risk:** Medium/High — two a11y layers must be maintained separately.
**Biggest open unknown:** does the actual `epub.js`-rendered EPUB DOM expose a correct, stable
accessibility tree and predictable focus behavior to VoiceOver and TalkBack? Documentation cannot
settle this — it requires on-device testing, which is the Day-2 spike that has not yet been run.

---

## 2. Day-2 spike status: ~~NOT RUN~~ — RAN 2026-08-24/25 (Android only)

> **SUPERSEDED.** This section described the state before the spike ran. Its list of what the spike
> was designed to test is still an accurate description of the instrument; its claim that every
> result cell is a placeholder is not. `WEBVIEW_A11Y_SPIKE.md` §4–§10 has the results, §8 has the
> findings and their current status, and §11 is the re-verification protocol.

### Original text (kept for the record)


The Day-2 spike (`WEBVIEW_A11Y_SPIKE.md`, in this same directory) is the instrument designed to
answer the open question above. **Every result cell in it is still a placeholder.** It has not been
executed on a device. This is currently the largest open unknown across the entire accessibility
workstream — confirmed as still open as of Day 3 (`Day_3_Plan.md`, open item #8: "WebView a11y
spike (21-area matrix) — Accessibility — **Not run**").

What the spike is designed to test, once run:

- **Environment**: real device/OS combinations, both VoiceOver and TalkBack, actual `epub.js`
  version — table currently empty.
- **Two sample EPUBs**: Sample A (well-formed) and Sample B (poor quality) — deliberately
  including a bad EPUB, "to show what happens when the book fights back," since EPUB source
  quality is outside the team's control.
- **DOM inspection checklist** (run *before* screen-reader testing, since it explains most
  downstream behavior): is content inside an iframe/content document; do `h1`/`h2` survive
  rendering; are paragraphs real `<p>` elements; does pagination rewrite/clone the DOM; are
  off-screen pages hidden from the a11y tree; does the library itself apply `aria-hidden`; are
  `alt` attributes preserved; are internal links real `<a href>` elements.
- **21-area PASS/FAIL/PARTIAL matrix** (VoiceOver × TalkBack, independently) covering entering
  WebView a11y navigation, heading/paragraph/link/image announcement, decorative-image handling,
  reader control buttons (next/prev/play/pause/search/bookmark/settings), focus order across the
  native↔web seam, page/chapter-change announcement, dynamic DOM updates, modal focus trap and
  restoration, large text, and high contrast — plus a dedicated heading-navigation sub-check
  (the best proxy for whether the EPUB's semantic structure survived `epub.js`).
- **One end-to-end "journey" test per platform**: turn screen reader on → open book → enter
  Reader → chapter heading → paragraphs → Next page → confirm new content reachable → open Reader
  controls → activate TTS → pause → resume → close controls → confirm return to reading position.
  Recording *where* it breaks, not just whether it did.
- **Announcement-behavior table** specifically for page-turn verbosity (is the whole page
  re-read? are controls re-announced? is focus sensible?), with room for a verbatim
  VoiceOver/TalkBack transcript.
- **Platform-divergence table** — same DOM, different VoiceOver/TalkBack behavior.
- **Findings**, each required to be attributed to a layer (`epub.js` / our WebView glue /
  native RN / EPUB source itself) so blame/ownership is unambiguous.
- **Risk-register re-rating** — carries forward the Day-1 risk register (§4 below) with
  "Observed" and "New severity" columns to fill in.
- **Conclusion template**: is the DOM usable as-is / work required on our side / work belonging
  to `epub.js` or unfixable / blocking for Week 1 / carried to Day 3.

Until this is run, every Day-1 "High" risk below remains unconfirmed rather than resolved.

---

## 3. Day-1 findings (desk research)

### 3.1 Architecture split — who owns what

| Native RN layer owns | WebView layer owns |
|---|---|
| Back, Reader toolbar, Settings, Search UI | EPUB text, headings, paragraphs |
| TTS controls (if native), Bookmark UI | Links, images & figures, tables |
| Accessibility settings, bottom sheets & modals | Semantic reading structure, HTML focus, EPUB-internal controls |

With ownership explicit, bugs route immediately: a mislabelled toolbar button is an RN-props fix;
an unnavigable chapter is a DOM/`epub.js` fix.

### 3.2 Concept mapping (native RN → WebView)

| Native React Native | WebView equivalent |
|---|---|
| `accessible` | HTML/DOM accessibility exposure |
| `accessibilityLabel` | `aria-label` / accessible name |
| `accessibilityRole` | Semantic HTML element or ARIA `role` |
| `accessibilityState` | ARIA states (`aria-expanded`, `aria-pressed`, …) |
| `accessibilityHint` | ARIA description / supporting text |
| `accessibilityActions` | HTML/ARIA interaction semantics |
| `accessibilityLiveRegion` (Android) | `aria-live` |

### 3.3 Core rule: semantic HTML first

Prefer real elements (`<button>`, `<h1>`/`<h2>`, `<p>`, `<a>`, `<img>`) over ARIA-patched `<div>`s.
A native element arrives with correct role/name/behavior for free; ARIA is a patch that must be
kept in sync by hand. EPUB structure specifically must survive the `epub.js` rendering pipeline —
if headings are flattened during pagination, heading-navigation is lost, which is a **functional
regression, not a cosmetic one**.

### 3.4 Don't over-expose the DOM

Marking every span/wrapper/icon/decorative element as accessible is itself an accessibility bug —
verbosity, not omission, is the risk, especially in a reading app where sessions run an hour.
Decorative images need `alt=""`; meaningful images (diagrams, figures) need real descriptive
`alt` text. Alt-text quality inside third-party EPUBs is outside the app's control — flagged as
its own risk-register item (§4).

### 3.5 Focus differs across the native/WebView seam

Native and WebView focus follow different pipelines (native a11y tree vs. DOM → web a11y tree →
platform a11y system) that must converge sensibly at the boundary:

```text
Native control
      ↓
   WebView
      ↓
 Web content
```

Nothing in either framework guarantees correct behavior here — it is the highest-risk, least
tested seam in the architecture (see the "bad focus experience" example: unlabeled content reads
as "random span," "empty div," "anonymous element" — invisible in a visual QA pass since the page
looks perfect).

### 3.6 The `accessibilityLabel` trap

The most common mistake in this architecture: `<WebView accessibilityLabel="Book content" />`
labels the **native WebView container only** — it does nothing for the HTML rendered inside it
(`<h1>`, `<p>`, `<button>`, etc.). Neither layer substitutes for the other; both need their own
treatment.

### 3.7 Dynamic content must not be over-announced

Page turns must not trigger a full re-read of the page. `aria-live="assertive"` should be
reserved for errors the user must act on; page changes are `polite` at most, and gated behind the
`announce.pageChanges` accessibility preference (`AccessibilityPrefs.announce.pageChanges`,
`src/shared/contracts/accessibility.ts` — a real field, defaulting to `true`) rather than
hardcoded. The WebView implementation must read that preference through the same composed-prefs
path the rest of the Reader will eventually use:

```text
Accessibility Settings → accessibilityStore.ts (src/features/sync/stores/)
  → SQLite (accessibility table) → readSharedPrefs() (src/features/sync/sharedPrefs.ts)
  → SharedPrefs.accessibility (AccessibilityPrefs) → Reader
```

As of this writing, the Reader does not yet call `readSharedPrefs()` or apply any prefs into the
WebView — per `src/features/reader/WEBVIEW_BRIDGE.md`, that wiring is the not-yet-built
"prefs-application" bridge-conversion stage. So this section states a requirement for that future
work, not a description of current behavior. The Reader must never read Accessibility settings
directly once that wiring lands.

### 3.8 Test VoiceOver and TalkBack independently

Android and iOS accessibility approaches differ; the same DOM can produce different navigation,
grouping, and announcements across engines. A pass on one platform is not evidence for the other
— every row of the test matrix (§2) carries two independent verdicts.

### 3.9 The real open question

"Does WebView support accessibility?" is already answered (yes, by documentation). The useful,
*unanswered* question is: does the team's actual `epub.js`-rendered EPUB DOM — specifically its
iframe/content-document layer — expose a correct accessibility tree and predictable focus/
announcement behavior to VoiceOver and TalkBack? This can only be settled by the Day-2 device
spike (§2), not by further desk research.

---

## 4. Risk register (Day-1, carried unresolved into Day-2/3)

| Risk | Severity | Why it matters | Action |
|---|---|---|---|
| EPUB DOM not semantically accessible | High | Screen reader can't convey book structure; no heading navigation | Inspect rendered DOM in the spike |
| `epub.js` iframe/content focus | High | Focus/navigation may behave unpredictably across the iframe boundary | Device test both platforms |
| Page transition accessibility | High | Dynamic content may be under- or over-announced | Test with `announce.pageChanges` on and off |
| VoiceOver vs TalkBack differences | Medium | Identical DOM can behave differently per engine | Dual-platform verdicts on every matrix row |
| Reader controls outside the WebView | Medium | Native/web a11y trees must interoperate at the seam | Test focus order across the boundary |
| Modal focus restoration | Medium | User can lose their reading position on dismiss | Test open *and* close for every sheet |
| Images / alt-text quality | Medium | Third-party EPUB metadata quality varies, outside our control | Test with a good and a poor sample EPUB |
| Excessive announcements | Medium | Live-region overuse interrupts reading | Audit every `aria-live` usage |
| ARIA overuse | Medium | Incorrect ARIA makes semantics worse than no ARIA | Semantic-HTML-first review rule |

~~All nine items are still open~~ — **re-rated 2026-08-24/25**; see `WEBVIEW_A11Y_SPIKE.md` §9,
which carries this exact table forward with the "Observed" / "New severity" columns filled in. Three
were escalated to Critical/Blocking on the Android evidence, and three new rows were added.

---

## 5. Downstream impact (Day 3)

Day 3 did not redo this research, but multiple concrete decisions were made *around* the
unresolved spike rather than waiting for it:

- **The new Accessibility metadata screen (Reader → Book Information → Accessibility) was
  built native, not WebView-hosted** — explicitly citing this research: *"Native, not WebView —
  this is the seam Day 1 §7 warned about — `screenReaderHints` reaches native controls only"*
  (`day3/findings/F10_Summary_Surface.md`, `day3/Day_3_Surface_Plan.md`).
- **Accessibility summary text (publisher-provided prose) is banned from ever being rendered
  through a WebView** — *"Render as text. Never as HTML, never through a WebView, never through
  anything that interprets markup"* — both for the WebView-seam risk and because it's untrusted
  third-party text (`day3/Day_3_Parse_Plan.md`).
- **"Screen reader compatible" is an explicitly forbidden claim** in the new Accessibility
  surface's copy rules, specifically because that claim "depends on our WebView, not their
  [publisher] metadata," and the Day-2 spike is still unrun (`day3/Day_3_Surface_Plan.md`,
  `F10_Summary_Surface.md`).
- **`Day_3_Plan.md` open-items list (#8)** carries the spike forward verbatim as "Not run —
  still the largest unknown in the workstream," owner: Accessibility.

Day 4's TTS-extraction work (`day4/TTS_Extraction_Analysis.md`) is a separate, unrelated track
(on-device TTS code reuse) — it contains no WebView or screen-reader-specific code, and only
shares the unrun spike as a passing dependency mention, not as new research.

---

## 6. Consolidated open items / next step

~~One item is actually blocking further confidence in this area~~ — **the Android half is done.**
What remains:

> **1. Run the iOS/VoiceOver pass.** Never run; every VoiceOver cell in all 21 matrix rows is still
> `—`, and both causes behind F4 are Android-specific in mechanism, so the Android result says
> nothing about WKWebView.
>
> **2. Re-run Android against the Sample A/B fixtures and the F4 fixes.** The 2026-08-24/25 pass used
> a real pre-existing book because `ensureSeeded()` short-circuited the fixture path. The protocol,
> including how to get past that, is `WEBVIEW_A11Y_SPIKE.md` §11.

Nothing else in this workstream is blocked on new research — the Day-3 decisions in §5 already
work around the unresolved risk conservatively (native surfaces, no WebView rendering of
publisher text, no unverified "screen reader compatible" claims) and do not need to be revisited
unless the spike produces a surprising result.
