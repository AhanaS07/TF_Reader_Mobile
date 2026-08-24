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
| `user`       | User's saved highlights | Personalization (Vaishnavi) | pending — host call-site wiring |
| `search`     | In-book search match highlight | Search (Vaishnavi) | pending — search only scrolls today |

Nothing collides at runtime *today* because only `tts` paints. This document settles the rules before
`user` and `search` land, so the collision is designed out rather than discovered on a device.

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

### 1. Namespace by owner — mandatory, and it must go through `type`

Every owner gets a distinct **`type`** *and* a distinct **CSS class**, both derived from its owner
string. This is not stylistic: because epub.js keys removal on `cfiRange + type`, a per-owner `type`
is the *only* thing that makes one owner's `remove` structurally incapable of touching another's
paint. A per-owner class alone would fix the styling collision but leave the clobber/remove collision
intact.

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

Today `tts` paints `backgroundColor: rgba(255, 213, 0, 0.4)` (translucent yellow) via
`TTS_SPOKEN_STYLES` in `epub.entry.ts` — already a translucent overlay, so it composes correctly with
a solid `user` fill beneath it. That is the interim rule for Hruthik: **keep TTS translucent** so it
layers rather than masks.

### 4. Z-order — TTS on top, and only for the same-channel tie

DOM/paint order decides overlap. The priority is **`tts` > `search` > `user`**: the ephemeral,
moving layer sits on top so it's always visible, the durable layer sits at the bottom. This only
matters when two owners would otherwise occupy the *same* channel; the distinct-channel rule (§3) is
what keeps it from mattering most of the time. **This is priority, not mutual exclusion** — a lower
layer is never removed to show a higher one.

## PDF is out of scope for this convention (for now)

The PDF renderer has **no highlight seam** in the current scope — `pdf.entry.ts`'s TTS handler is a
documented no-op. When PDF highlight painting lands it will need its own seam, and it must be
**spread-aware from day one**: in a double-page spread two pages are visible at once, so paint must
cover both visible pages and hit-test across the spread, and re-paint on a double↔single flip. The
storage/contract is unchanged (PDF locators stay per-page `{page, offset}`); only the painting/nav
wiring must stop assuming one page in view. The owner/variant naming convention above carries over
unchanged — a PDF seam should reuse `highlightNaming.ts`.

## Handoff

- **Ahana (seam):** the enforcement mechanism (`highlightSeam.ts` + `highlightNaming.ts`) is yours
  and already built. This doc is the contract it enforces. The one thing still on the reader side is
  the **`user` client**: create-on-selection (selection → locators), painting saved highlights via
  the seam, and tap-to-delete by `id`. That's the joint reader-UI task; my host call-sites feed it.
- **Hruthik (TTS, interim):** you're the only live client. The rule for you is §3 — **keep the spoken
  highlight translucent** (`rgba(...)` with alpha well under 1) so `user`/`search` layers show
  through it, and keep painting through the seam with `owner: 'tts'`. No coordination needed beyond
  that; the namespace already isolates you.
- **Vaishnavi (me):** `user` and `search` clients call the same seam with their own owner strings and
  the channels/styles in §3 when the host call-site wiring and search-match painting land.

See also: `TTS_PROVIDER.md` (open item 4, where this collision was first raised and the seam agreed),
`WEBVIEW_BRIDGE.md` (the bridge rule for the future `paintHighlights` command — payloads cross the
wire format-free, so the host maps `HighlightPaint[]` to a per-shell shape before sending), and
`~/My_Reports/bookmarks-highlights-flow-and-sync.md` (the full flow + sync design).
