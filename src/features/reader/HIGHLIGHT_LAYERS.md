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
| `search`     | In-book search match highlight | Search (Vaishnavi) | pending — search only scrolls today |

`user` landed 2026-08-26 (`paintHighlights`; see `../personalization/READER_HIGHLIGHTS_WIRING.md`),
so two owners can now paint at once and §1 below stopped being a forecast. It also stopped being
correct — read the correction there before writing a third client.

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
nothing at all; it is now `{ fill: '#ffd500', 'fill-opacity': '0.4', 'mix-blend-mode': 'multiply' }`
— the same intended translucent yellow, expressed in the vocabulary that reaches the element. The
interim rule for Hruthik is unchanged: **keep TTS translucent** so it layers rather than masks.

`user` paints `{ fill: <the stored colour>, 'fill-opacity': '1', 'mix-blend-mode': 'multiply' }`.
Full opacity *with* `multiply` is what makes "solid" and "the text is still readable" the same thing
— multiply darkens the page towards the fill instead of covering the glyphs, which is how a physical
highlighter behaves and why epub.js's own defaults use it. A flat opaque rect would be solid and
unreadable.

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
- **The visual channel is the same too**, reached differently: `background: <colour>` plus
  `mix-blend-mode: multiply` in CSS, where the EPUB side gets multiply from epub.js's own defaults.
- **The boxes are `pointer-events: none`, and that is load-bearing.** A box that takes touches
  swallows the drag that starts inside it, so an existing highlight could never be selected through or
  extended. A long press on one is resolved by hit-testing the painted geometry instead
  (`highlightAt`), across every visible surface — so it works on either page of a spread.

**TTS is still a documented no-op here**, and that is now a segmentation limit rather than a missing
seam: `readerTextProvider.ts`'s model is CFI-based, so Reader never builds one for a PDF book.

## Handoff

- **Ahana (seam):** DONE, 2026-08-26. The `user` client is built end to end — create-on-selection,
  painting via the seam under `owner: 'user'`, and tap-to-delete by `id` — in both shells, behind the
  `paintHighlights` / `selection` / `highlightTapped` trio (`WEBVIEW_BRIDGE.md`). Building it is what
  found the two corrections in §1 and §3 above, so **read those before writing the `search` client**:
  a per-owner `type` paints nothing, and camelCased style keys are ignored.
- **Hruthik (TTS, interim):** you're the only live client. The rule for you is §3 — **keep the spoken
  highlight translucent** (`rgba(...)` with alpha well under 1) so `user`/`search` layers show
  through it, and keep painting through the seam with `owner: 'tts'`. No coordination needed beyond
  that; the namespace already isolates you.
- **Vaishnavi:** `search` is the one client left. It calls the same seam with `owner: 'search'` and
  §3's outline channel — expressed as SVG attributes (`stroke`, `stroke-opacity`, `fill: 'none'`),
  not CSS property names. The `user` client is live and is the layer a search box has to remain
  findable *over*.

See also: `TTS_PROVIDER.md` (open item 4, where this collision was first raised and the seam agreed),
`WEBVIEW_BRIDGE.md` (the bridge rule for the future `paintHighlights` command — payloads cross the
wire format-free, so the host maps `HighlightPaint[]` to a per-shell shape before sending), and
`~/My_Reports/bookmarks-highlights-flow-and-sync.md` (the full flow + sync design).
