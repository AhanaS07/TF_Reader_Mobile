# Day 2 — WebView Accessibility Spike Results

**Owner: Hruthik. Status: template — NOT YET RUN.** See `WEBVIEW_A11Y_FINDINGS.md` in this same
directory for the desk research this spike is meant to validate.

> Fill this in during the spike. Empty cells mean untested, not passing. Test protocol is the
> DOM-inspection checklist, area matrix, and journey test in §3–5 below.

**Question:** does the real `epub.js`-rendered EPUB DOM expose a usable accessibility
tree and predictable focus behaviour to VoiceOver and TalkBack?

---

## 1. Environment

| | iOS | Android |
|---|---|---|
| Device | — | — |
| OS version | — | — |
| Screen reader | VoiceOver | TalkBack |
| Screen-reader version | — | — |
| WebView engine | WKWebView | Android WebView — version: — |
| `epub.js` version | — | — |

---

## 2. Sample EPUBs

| Sample | Title / source | Structure quality | Alt text | Notes |
|---|---|---|---|---|
| A — well-formed | — | — | — | — |
| B — poor quality | — | — | — | — |

Sample B exists to show what happens when the book fights back. EPUB source quality
is outside our control, so "works on a clean EPUB" is not a complete answer.

---

## 3. DOM inspection

Do this **before** the screen-reader runs — it explains most of what follows.

| Check | Finding |
|---|---|
| Content inside an iframe / content document? | — |
| Do `h1`/`h2` survive rendering? | — |
| Are paragraphs real `<p>` elements? | — |
| Does pagination rewrite or clone the DOM? | — |
| Are off-screen pages hidden from the a11y tree? | — |
| Any `aria-hidden` applied by the library itself? | — |
| Are images preserved with their `alt` attributes? | — |
| Are internal links real `<a href>` elements? | — |

The off-screen-page question is the likely root cause if page changes misbehave: if
neighbouring pages stay in the tree, the screen reader will read content the user
cannot see.

---

## 4. Area matrix

Legend: `PASS` / `FAIL` / `PARTIAL` / `—` (untested)

| # | Area | VoiceOver | TalkBack | Notes |
|---|---|---|---|---|
| 1 | Enter WebView a11y navigation | — | — | |
| 2 | Chapter heading announced (with level) | — | — | |
| 3 | Paragraph text readable | — | — | |
| 4 | Links announced as links | — | — | |
| 5 | Images + alt text | — | — | |
| 6 | Decorative images ignored | — | — | |
| 7 | Next-page button | — | — | |
| 8 | Previous-page button | — | — | |
| 9 | Play button | — | — | |
| 10 | Pause button | — | — | |
| 11 | Search button | — | — | |
| 12 | Bookmark button | — | — | |
| 13 | Settings button | — | — | |
| 14 | Focus order across native ↔ web seam | — | — | |
| 15 | Page-change announcement | — | — | |
| 16 | Chapter-change announcement | — | — | |
| 17 | Dynamic DOM updates | — | — | |
| 18 | Modal/sheet focus trap | — | — | |
| 19 | Focus restoration after modal | — | — | |
| 20 | Large text | — | — | |
| 21 | High contrast | — | — | |

### Heading navigation

Can a user jump heading-to-heading inside a chapter, or is reading forced linear?

| | VoiceOver | TalkBack |
|---|---|---|
| Sample A | — | — |
| Sample B | — | — |

This is the single best proxy for whether the EPUB's semantic structure survived
`epub.js`.

---

## 5. Journey test

One uninterrupted run per platform. Record where it broke, not just whether it did.

```text
Screen reader ON → open book → enter Reader → chapter heading →
paragraphs → Next page → confirm new content reachable →
open Reader controls → activate TTS → pause → resume →
close controls → confirm return to reading position
```

| Platform | Completed? | Step it broke at | What happened |
|---|---|---|---|
| VoiceOver | — | — | — |
| TalkBack | — | — | — |

---

## 6. Announcement behaviour

Page turns are where over-announcing hurts most.

| Observation | VoiceOver | TalkBack |
|---|---|---|
| What is announced on page change? | — | — |
| Is the whole page re-read? | — | — |
| Are reader controls re-announced? | — | — |
| Does focus land somewhere sensible? | — | — |
| Is previous-page content still reachable? | — | — |

Verbatim transcript of a page turn is worth more than a verdict:

```text
VoiceOver:
TalkBack:
```

---

## 7. Platform divergence

Where the same DOM behaved differently. This table is the argument for testing both.

| Area | VoiceOver behaviour | TalkBack behaviour |
|---|---|---|
| — | — | — |

---

## 8. Findings

> One numbered finding per real observation, with the layer it belongs to —
> `epub.js`, our WebView glue, native RN, or the EPUB source itself.

```text
F1.  [layer]
F2.  [layer]
F3.  [layer]
```

Attributing the layer matters: an unnavigable chapter caused by a bad EPUB is a
content problem, the same symptom caused by `epub.js` pagination is ours to fix.

---

## 9. Risk register update

Day-1 risks, re-rated against what was actually observed.

| Risk | Day-1 severity | Observed | New severity |
|---|---|---|---|
| EPUB DOM not semantically accessible | High | — | — |
| `epub.js` iframe/content focus | High | — | — |
| Page-transition accessibility | High | — | — |
| VoiceOver vs TalkBack differences | Medium | — | — |
| Native/WebView focus interaction | Medium | — | — |
| Modal focus restoration | Medium | — | — |
| Image/alt-text quality | Medium | — | — |
| Excessive announcements | Medium | — | — |
| ARIA overuse/misuse | Medium | — | — |

---

## 10. Conclusion

```text
Is the epub.js DOM usable by screen readers as-is:
Work required on our side:
Work that belongs to epub.js / is unfixable by us:
Blocking for Week 1:
Carried to Day 3:
```
