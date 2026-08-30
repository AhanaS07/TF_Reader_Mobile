# Highlight-layer collision convention

**Owner: Personalization + Search (Vaishnavi). Enforcement seam: Reader (Ahana). Interim TTS client: Accessibility (Hruthik).**

This is the convention every feature that paints into the reader must follow. It is the *rules*; the
*mechanism* that makes them cheap to obey already exists in code (`webview/src/highlightSeam.ts` +
`highlightNaming.ts`). Read this before you call `rendition.annotations` — or, better, before you're
tempted to, because you should be calling the seam instead.

## Why this exists

Every in-book highlight in the EPUB renderer lands in one shared store: epub.js's
`rendition.annotations`. Three features want to paint into it:

| Owner string | Feature | Painted by | Status |
| ------------ | ------- | ---------- | ------ |
| `tts`        | Read-aloud spoken word/sentence | Accessibility (Hruthik) | **live** — `epub.entry.ts` |
| `user`       | User's saved highlights | Personalization (Vaishnavi) | **live** — both shells, via `paintHighlights`; long-press to create/delete |
| `search`     | In-book search match highlight | Search (Vaishnavi) writes, Reader (Ahana) applies | **live** — both shells, via `paintSearchMatch` |

`user` landed 2026-08-26 (`paintHighlights`; see `../personalization/READER_HIGHLIGHTS_WIRING.md`),
so two owners can now paint at once and §1 below stopped being a forecast. It also stopped being
correct — read the correction there before writing another client.

`search` landed 2026-08-29 (`paintSearchMatch`; `WEBVIEW_BRIDGE.md` has the bridge half). All three
owners are now claimed, and §1's bounded cost stopped being theoretical with it — see the collision
note at the end of that section.

**How epub.js makes them fight, if unmanaged:**

- It keys its internal annotation map on **`cfiRange + type`**, where `type` is the first argument to
  `.add`/`.remove` (the annotation *kind*: `'highlight'`, `'underline'`, `'mark'`). Two owners that
  paint the same range with the same `type` clobber each other, and one owner's
  `.remove(cfiRange, 'highlight')` silently deletes the other's paint.
- All annotations share the default `.epubjs-hl` CSS class, so styling one styles all.
- Overlapping ranges occlude by DOM order — last-painted wins the pixels.
- An unscoped removal (`.remove(cfiRange)` without a discriminating `type`) wipes whatever is there,
  regardless of who put it there.

## The convention

### 1. Namespace by owner — by CSS class, NOT by the `type` argument

> **CORRECTED 2026-08-26, and the correction is the important part of this section.** This rule used
> to say every owner must pass a per-owner **`type`** to `.add`/`.remove`, on the reading that
> epub.js keys removal on `cfiRange + type` and so a per-owner `type` is the only thing that makes
> one owner's `remove` structurally incapable of touching another's paint. That is true of `remove`
> and false of everything else, because of what `Annotation.attach()` does with the same value
> (`epubjs/lib/annotations.js`):
>
> ```js
> if (type === "highlight")      result = view.highlight(...);
> else if (type === "underline") result = view.underline(...);
> else if (type === "mark")      result = view.mark(...);
> ```
>
> There is no `else`. `type` is epub.js's annotation **KIND**, not a free label: a value outside
> those three matches no branch, and **nothing is ever painted**. The annotation is filed in the map
> and attached to every view and draws nothing. That is why the TTS spoken highlight never actually
> appeared on a device despite being wired end to end — unit tests cannot see a blank overlay, and
> the paint was the one part no test called. Found while building the `user` client; confirmed
> against epub.js 0.3.93's source, not inferred.

So: **the kind passed to `.add` is always `'highlight'`**, and the namespacing that survives is the
per-owner **CSS class** (`annotationClassName`) plus the owner stamped into the annotation's `data`,
which marks-pane copies onto the painted element's `dataset`. `webview/src/highlightSeam.ts` does
both; no caller should be passing a `type` at all.

**What is lost, stated plainly rather than buried:** epub.js hashes its annotation map on
`encodeURI(cfiRange + type)`, so two owners painting the *exact same range string* now collide there
— the later `add` displaces the earlier, and a `remove` for that range removes whichever is filed.
It is bounded (identical ranges only, and a repaint restores it) and it is the price of painting at
all. It is **not** a reason to go back: nothing painted is strictly worse than a rare clobber.

**The `search` client REFUSES that collision rather than accepting it, and the reason is asymmetry.**
Highlighting a word and then searching for it is not exotic, and the two ranges are then identical
strings. `add` displaces the user's map entry without detaching its mark, so this layer's next
`remove` — which happens on the very next arrow press — orphans a rect nothing can ever delete. One
layer is transient and the other is the reader's saved work, so the transient one gives way:
`epub.entry.ts`'s `applySearchMatch` skips the paint and reports `searchMatchPainted: false`. Nothing
is lost visually — the user's own highlight is already marking that spot.

The naming is centralised and unit-tested in `webview/src/highlightNaming.ts`:

```
annotationType(owner)            -> `tf-hl-${owner}`              e.g. tf-hl-user
annotationClassName(owner, variant) -> `tf-hl-${owner}--${variant}`  e.g. tf-hl-user--saved
```

**Owner strings are reserved here so two features never pick the same one:** `tts`, `user`, `search`.
Do not invent a fourth without adding a row to the table above — the whole guarantee is that the
string is unique.

### 2. Go through the seam — never call `rendition.annotations` directly

`webview/src/highlightSeam.ts` is the one place `rendition.annotations` is allowed to be called. It
takes `(rendition, owner, cfiRange, variant, styles?)` and applies the namespacing for you:

```
add(rendition, 'user', cfiRange, 'saved', USER_STYLES)
remove(rendition, 'user', cfiRange)
```

The seam is **stateless on purpose** — it does not remember what it last painted for an owner.
`add`/`remove` are the primitive; a caller that wants "replace" (as `setSpokenRange` does) calls
`remove` then `add` and keeps its own "what did I last paint" map. User highlights keep an
`id → painted-range` map anyway, for tap-to-delete (delete is by stored `id` → `remove(id's range)`,
never by re-selecting the range).

### 3. Distinct visual channels — overlap must COMPOSE, not mutually exclude

A word being read aloud can also be a search hit inside a user's saved highlight. All three must
remain legible at once — losing search context or the user's highlight during read-aloud is a
regression, not a simplification. So each owner claims a different visual channel:

| Owner    | Channel | Rationale |
| -------- | ------- | --------- |
| `user`   | **Solid/opaque fill** (the highlight colour) | It's the durable, user-authored layer; it reads as "the highlight." |
| `search` | **Outline / box** (border, minimal fill) | Transient; must be findable *over* a user fill without hiding it. |
| `tts`    | **Translucent overlay** on top | Ephemeral, moves every word; a low-alpha wash composites over whatever is beneath. |

**`styles` ARE SVG PRESENTATION ATTRIBUTES, NOT CSS DECLARATIONS** — the other half of the 2026-08-26
correction. marks-pane applies them with `element.setAttribute(name, value)` onto an `<svg><g>`, so
`fill` / `fill-opacity` / `mix-blend-mode` work and a camelCased CSS property name is *silently
ignored*. `TTS_SPOKEN_STYLES` used to read `{ backgroundColor: 'rgba(255, 213, 0, 0.4)' }`, which did
nothing at all; it is now `{ fill: '#ffd500', 'fill-opacity': '0.2', 'mix-blend-mode':
<theme-adjusted> }` — the same intended translucent yellow, expressed in the vocabulary that reaches
the element (opacity lowered from an original `0.4` alongside `user`'s own correction below, to keep
the two channels in the ordering this section's table intends). It goes through the same
`highlightFill` as `user` for the same reason: a fixed `multiply` made the spoken word invisible on
the dark theme, which is the theme where knowing where the voice is matters most. The interim rule
for Hruthik is unchanged: **keep TTS translucent** so it layers rather than masks.

**`user` paints `{ fill: <theme-adjusted colour>, 'fill-opacity': '0.25', 'mix-blend-mode':
<theme-adjusted> }`** — not `fill-opacity: '1'` with a fixed `multiply`, which read as fully opaque
and hid the text on every theme, confirmed on-device. A correctly-translucent `multiply` is still
wrong on two of the three shipped themes: it nearly disappears against dark's near-black page, and
barely shifts a warm fill like the default yellow against sepia's similarly warm, pale page.
`webview/src/selectionTheme.ts`'s `highlightFill(color, bg)` (pure, unit-tested) picks fill and
blend per page: `screen` on a dark page, a darker shade of the same colour on a warm/light page like
sepia, and the stored colour with `multiply` unchanged on a neutral light page. "Solid, distinct
from `tts`" is still the intent; how to render it now depends on the page behind it.

**THE SHADE IS A FUNCTION OF THE PAGE, SO IT IS RE-DERIVED WHEN THE PAGE CHANGES COLOUR.** Both
shells re-tint the `user` and `tts` layers from `applyAppearance` whenever `bg` moves, rather than
leaving a highlight wearing the theme it was created under. Without it, a light→dark switch leaves
`multiply` against a near-black page and the highlight all but vanishes — and no later repaint
repairs it, because `paintHighlights` diffs on ids alone (`highlightPaint.ts`) and an already-painted
id is skipped.

The two shells re-tint differently, and the asymmetry is forced:

- **PDF** simply repaints. `paintPage` is a whole-layer `replaceChildren` over a handful of divs
  whose geometry it re-measures on every zoom anyway, so re-deriving the colour is free.
- **EPUB must REMOVE THEN ADD, never re-add.** epub.js's `Annotations.add` hashes on
  `encodeURI(cfiRange + type)` and overwrites that map entry **without detaching the mark already
  attached**, while also pushing a duplicate hash into `_annotationsBySectionIndex`. So a bare re-add
  leaves the old-coloured rect painted underneath the new one — compositing darker, and undeletable,
  since `remove` can only reach the winner — and attaches it twice more on the next `hooks.render`.
  `epub.entry.ts` has two functions for this on purpose: `repaintLiveAnnotations()` (live rendition,
  removes first) and `repaintUserHighlights()` (a rendition that was just rebuilt, so there is
  nothing to detach). Using the second where the first belongs is the bug it was written to prevent.

### 3a. Geometry is transient too — re-measure on every re-layout

> **ADDED 2026-08-30. This is the same shape of rule as §3's shade, and it was missing for the thing
> that moves far more often than the theme does: the RECTS.** An EPUB highlight stayed exactly where
> it was painted when the reader changed text size, so it stopped covering its own words. The CFIs
> were never wrong — a CFI is element indices plus a character offset, and no reflow can invalidate
> one. What went stale was the pixels.

**The rule, for both shells: a painted highlight's rectangles are derived state with a lifetime of
one layout. Every path that re-lays out the content must re-measure them.**

- **PDF already obeyed it**, which is why a PDF highlight tracks through any zoom. `pdf.entry.ts`
  states it outright — every path that re-rasterises a page rebuilds its text layer and repaints it —
  and everything funnels through `renderPageSurface` → `paintPage`, which re-derives every box from
  the stored character offsets.
- **EPUB did not, and epub.js will not do it for you.** marks-pane re-measures correctly *when asked*
  (`Highlight.render()` re-reads `range.getClientRects()` every time), but `Pane.render()` has
  exactly one caller in epub.js — `IframeView.reframe()` — behind two gates a stylesheet change slips
  past:
  1. **the resize is never detected.** `Contents.resizeObservers()` observes
     `document.documentElement`, and in paginated flow epub.js pins the *body* to a fixed
     width/height, so extra text overflows into more COLUMNS and no observed box changes. No
     `resizeCheck()`, no `CONTENTS.RESIZE`, no `expand()`.
  2. **even when it fires, the reframe is width-gated.** `expand()` rounds the strip up to a whole
     number of pages and reframes only on a real delta — so 16pt → 17pt in a chapter that still spans
     twelve pages re-measures nothing.

  So the shell asks for it: `epub.entry.ts`'s `scheduleGeometryRefresh()` runs
  `forceReflow()` (`epubViewGeometry.ts`, which is also what stops epub.js's cached strip width — and
  therefore its page count — describing the old type size) and then `repaintLiveAnnotations()`, which
  re-measures all three layers for free, because remove-then-add resolves each CFI to a **fresh**
  `Range` that marks-pane measures on `addMark`. Coalesced onto one frame, and fired from
  `applyAppearance`, the rendition's `resized`, and each chapter's own `contents.on('resize')` (the
  reflows the *book* causes — a late image, a web font — which no command announces).

**Whether a change needs it is `epubLayoutSignature.ts`** — pure, unit-tested, and exhaustive over
`ReaderAppearance` by a compile-time canary, so **adding a typography field fails to compile until
someone classifies it**. Four fields (`highContrast`, `boldText`, `dyslexiaFont`, `readableSpacing`)
are classified paint-only *only because the EPUB shell does not put them in the stylesheet yet*;
whoever wires one in must move its key to `GeometryKey` in the same change, or the drift comes back.

**And the hit-test cache goes with them.** `highlightBoxCache` holds the rects a long press is tested
against, so a stale one deletes the wrong highlight — silently, with no undo. It is dropped by the
same refresh.

### 3a. A CFI RESOLVES AGAINST THE WRONG CHAPTER RATHER THAN FAILING

Found 2026-08-30 while probing the `search` client, and it is a property of epub.js that every
cross-chapter caller here has to know: **`EpubCFI.toRange` walks only the local path after `!` and
never looks at the spine component.** A CFI belonging to chapter 3 therefore resolves happily against
chapter 1's document, to whatever sits at the same tree position. Measured on this repo's sample
book: of 400 foreign CFIs resolved against chapter 1, **399 returned a real range** (one threw, none
returned null), several addressing different text than they name.

Painting was never affected — `Annotations.add` compares `annotation.sectionIndex === view.index`
itself. Two other things were:

- **The `user` layer's hit test was wrong, and could delete the wrong highlight.** `epub.entry.ts`'s
  `highlightBoxes` built its box list from every painted highlight, relying on a foreign CFI failing
  to resolve. It does not, so a chapter-2 highlight contributed phantom boxes to chapter 1, and a
  long press landing on one made `confirmDeleteHighlight` delete that highlight instead — silently,
  with no undo. Fixed by scoping on `cfiHasBase(cfiRange, contents.cfiBase)` first. **This predates
  the search client**; it was found by the same probe and is fixed in the same change.
- **The `search` layer must verify before it files.** See §1's collision note and
  `WEBVIEW_BRIDGE.md`'s search-match section: an unverifiable range filed into `Annotations` throws
  from `hooks.render` on every later visit to that chapter, not once.

`cfiHasBase` (pure, in `epubCfiRange.ts`, unit-tested) is the scoping test. Use it before resolving
any CFI you did not just mint from the document in front of you.

### 4. Z-order — TTS on top, and only for the same-channel tie

DOM/paint order decides overlap. The priority is **`tts` > `search` > `user`**: the ephemeral,
moving layer sits on top so it's always visible, the durable layer sits at the bottom. This only
matters when two owners would otherwise occupy the *same* channel; the distinct-channel rule (§3) is
what keeps it from mattering most of the time. **This is priority, not mutual exclusion** — a lower
layer is never removed to show a higher one.

## PDF — IN scope as of 2026-08-26, with its own seam

Was "out of scope, and when it lands it will need its own seam, spread-aware from day one." It
landed, and it is: `webview/src/pdfHighlightSeam.ts` (DOM, same untested tier as `highlightSeam.ts`)
plus `webview/src/pdfTextRange.ts` (pure, unit-tested). What that took, and what carries over:

- **A rasterised page has no text**, so there was nothing to select and nothing to anchor to. The
  shell now renders pdf.js's standard **text layer** over every visible page — that is what makes
  selection possible, and what character offsets (how `highlightStore` addresses a PDF highlight) are
  counted against. `.pdf-text-layer` and `.pdf-highlight-layer` are styled in
  `reader-pdf.template.html`; the entry creates them but a `.ts` file cannot carry their CSS.
- **Spread-aware by construction, not by a special case.** Everything is keyed on a PAGE NUMBER and
  scoped to that page's own surface, so a double-page spread is simply two surfaces, continuous
  scroll is up to `2 * SCROLL_BUFFER_PAGES + 1`, and a double↔single flip re-renders both. `page`
  travels in the paint payload (`PdfHighlightPaint`) for exactly this reason. Storage is unchanged —
  PDF locators stay per-page `{page, offset}`.
- **A selection that crosses the spread is REFUSED, not truncated.** `SelectionRange` is single-page
  by construction, so half of a cross-page selection would be stored silently and the other half
  lost.
- **The naming convention carries over unchanged** — the seam reuses `annotationClassName('user',
  'saved')`, so a PDF highlight box and an EPUB one answer to the same class.
- **The visual channel is the same too**, reached differently — and, like the EPUB side, NOT a
  fixed `background`/`multiply` pair any more. `pdfHighlightSeam.ts`'s `paintPage` calls the SAME
  `highlightFill(color, bg)` the EPUB side does, setting `background`/`opacity`/inline
  `mixBlendMode` per page (the template's CSS class still carries `multiply` as the no-JS fallback,
  but an inline style always wins). `bg` is `pdf.entry.ts`'s own `currentBg`, not read back from
  `document.body.style.background` — that serialised form is not guaranteed hex across engines and
  would silently defeat `highlightFill`'s `parseHex`.
- **A superseded render must not paint.** `ensureSurface` hands back a NEW surface object over the
  SAME DOM layers, so two overlapping `renderPageSurface` passes for one page (rapid zoom, where
  `renderCurrent` starts a fresh render per step with nothing serialising them) can end with the
  older one landing last. `paintPage` is a whole-layer `replaceChildren`, so that erases the newer
  pass's boxes, and the caller's trailing cleanup then deletes the newer, valid `pageSurfaces` entry
  — leaving correct pixels with no hit-testing until something re-renders the page. Fixed 2026-08-30
  by a per-page token claimed *inside* `renderPageSurface` (`surfaceRenderTokens`) and checked before
  it writes anything, plus an identity-checked `forgetPageSurface(page, only)` so a caller can only
  forget its own surface. The sharing that makes it possible is pinned in `pdfHighlightSeam.test.ts`.
- **The boxes are `pointer-events: none`, and that is load-bearing.** A box that takes touches
  swallows the drag that starts inside it, so an existing highlight could never be selected through or
  extended. A long press on one is resolved by hit-testing the painted geometry instead
  (`highlightAt`), across every visible surface — so it works on either page of a spread. **The EPUB
  shell hit-tests the same way now**, measuring `contents.range(cfiRange).getClientRects()` instead
  of pdf.js's text layer, through the same pure `highlightAt` — so `highlightAt` and `HighlightBox`
  moved out of `pdfTextRange.ts` into `webview/src/highlightGeometry.ts`. See WEBVIEW_BRIDGE.md for
  what the EPUB side did before and why a caret was the wrong primitive.

**Search paints here too, as of 2026-08-29** — `paintSearchPage` in the same seam, into a THIRD layer
(`.pdf-search-layer`) appended after the highlight layer, because on this side DOM order is §4's
z-order. Same page-number routing, so a spread is two surfaces and the outline lands on the right one.

> ### ⚠️ The two extractions of a PDF page do NOT agree on where character N is
>
> A search hit's `Locator.offset` and this seam's character offsets are produced by two independent
> extractions of the same page, and they are counted differently:
>
> | | Rule | Where |
> | --- | --- | --- |
> | Search | `item.str` + **a separator after every item** (`\n` on `hasEOL`, else a space) | `../search/extractor.ts`'s `pageItemsToText` |
> | Reader | the items' lengths, **no separator** — "item boundaries add nothing" | `pdfTextRange.ts`'s header |
>
> Both are right for their own purpose: Search needs the separator or two runs fuse into one token
> and phrase adjacency breaks, and Reader must not invent one or every stored highlight offset would
> depend on a joining convention only that file knows about. But a hit's offset therefore runs ahead
> of this layer's by **one character per preceding item** — tens of characters into a page — and
> feeding it straight to `slicesForRange` paints a confident box on the wrong word.
>
> **MEASURED, not reasoned about.** Replaying every PDF posting in the shipped
> `sample-pdf-search-index.json` against the same document's text layer: **129 of 153 raw offsets
> land on the wrong text**, and **153 of 153 are exact after conversion** (the 24 that happen to be
> right are the ones early on page 1, before any separator has been passed — which is exactly why
> this is easy to miss by spot-checking).
>
> Converted on the READER side (`pdfSearchMatch.ts`, pure and unit-tested), not fixed in
> `extractor.ts`: those offsets are what every index already built contains, and that file is
> Search's. The conversion is exact, and it is still **verified against the page's real text**
> before painting, with the page-level cue as the fallback — exactness assumes the two extractions
> saw the same items, which this shell can check the answer of but not the premise.

**TTS is still a documented no-op here**, and that is now a segmentation limit rather than a missing
seam: `readerTextProvider.ts`'s model is CFI-based, so Reader never builds one for a PDF book.

## Handoff

- **Ahana (seam):** DONE, 2026-08-26, since revised. The `user` client is built end to end — both
  create and delete are native WebView menu items now (`WEBVIEW_BRIDGE.md`'s "The highlight set"),
  painting via the seam under `owner: 'user'` either way. Building it is what found the two
  corrections in §1 and §3 above, and they bind every client written since: a per-owner `type` paints
  nothing, and camelCased style keys are ignored. **Read both before adding a fourth owner** — and
  add its row to the table at the top first, since the whole guarantee is that the string is unique.
- **Hruthik (TTS, interim):** you're the only live client. The rule for you is §3 — **keep the spoken
  highlight translucent** (`rgba(...)` with alpha well under 1) so `user`/`search` layers show
  through it, and keep painting through the seam with `owner: 'tts'`. No coordination needed beyond
  that; the namespace already isolates you.
- **`search`:** DONE, 2026-08-29, split the way `user` was — Vaishnavi wrote the host-side payload
  (`../search/readerSearchMatch.ts`), Ahana the bridge command and both paints. EPUB goes through the
  same seam with `owner: 'search'` and §3's outline channel as SVG attributes (`fill: 'none'`,
  `stroke`, `stroke-width`, `stroke-opacity`); PDF through `paintSearchPage` into its own layer. The
  stroke is theme-derived in one place for both shells (`selectionTheme.ts`'s `matchStroke`), for the
  same reason the fill is — a mid-blue line on a near-black page is barely a line.

  Two things found while building it, both recorded where the next person will look rather than only
  here: the identical-range collision §1 calls bounded is real and is refused (end of §1), and the
  two extractions of a PDF page disagree about character offsets (the ⚠️ box in the PDF section).

See also: `TTS_PROVIDER.md` (open item 4, where this collision was first raised and the seam agreed),
`WEBVIEW_BRIDGE.md` (the bridge rule for the future `paintHighlights` command — payloads cross the
wire format-free, so the host maps `HighlightPaint[]` to a per-shell shape before sending), and
`~/My_Reports/bookmarks-highlights-flow-and-sync.md` (the full flow + sync design).
