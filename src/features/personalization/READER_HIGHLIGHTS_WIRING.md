# Reader-highlights wiring — writes/applies split

**Owner of the writes half: Personalization (Vaishnavi). Owner of the applies half: Reader (Ahana).**

This is the highlight-painting analog of the prefs-application stage (`READER_PREFS_APPLICATION.md`).
It follows the identical shape: **Vaishnavi resolves host-side into a bridge-local, primitive-only
payload; Ahana carries it across the bridge and applies it to the rendition.** The seam between them
is the payload type, exactly as `ReaderAppearance` is the seam for prefs.

## What is built (writes half — `readerHighlights.ts`)

A pure mapper plus the three host call-sites, fully unit-tested (`readerHighlights.test.ts`, 10 cases):

| Export | Role |
| ------ | ---- |
| `toReaderHighlights(paintable)` | pure: `HighlightPaint[]` → `{ epub, pdf }`, **stripping the `format` discriminant** |
| `loadReaderHighlights(bookId)` | call-site 1 — on open: `list(this book)` → `toPaintable` → payload (+ `skippedIds`) |
| `addEpubHighlight(bookId, startCfi, endCfi, color?)` | call-site 2a — user highlights an EPUB selection |
| `addPdfHighlight(bookId, selection, color?)` | call-site 2b — user highlights a PDF selection (per-page) |
| `removeHighlight(bookId, id)` | call-site 3 — tap-to-delete, **by stored id** (`bookId` re-lists the right book) |

Every call is scoped to `bookId` (2026-08-24), mirroring `readerBookmarks.ts` — see the resolved open item.

Every `add*`/`remove` persists through `highlightStore` (which enqueues the sync outbox in the same
transaction — offline-safe) and returns the **fresh, full, authoritative set**, so the caller always
sends one idempotent repaint rather than an incremental patch.

## What Ahana adds (applies half)

Nothing here compiles a `paintHighlights` command into `readerBridge.ts` — that command forces both
WebView entries to implement it, which is the reader's painting work, so it is yours to land as one
change (the same way `applyAppearance` was). The pieces:

1. **`readerBridge.ts`** — add `paintHighlights` to `READER_COMMANDS` and a
   `{ type: 'paintHighlights'; highlights: EpubHighlightPaint[] | PdfHighlightPaint[] }` case to
   `ReaderCommand`, importing the two payload types from `@/features/personalization/readerHighlights`
   (the same cross-owner import `ReaderAppearance` already makes). Add its `buildCommandScript` arm
   (a `JSON.stringify` of the array, as safe as `applyAppearance` — the payload is primitive-only).
   Follow the CLAUDE.md bridge ritual (both entries, `parseReaderMessage` needs no change — this is
   host→WebView only). It is fire-and-forget, like `setSpokenRange`.
2. **`epub.entry.ts` / `pdf.entry.ts`** — paint through the existing highlight seam
   (`webview/src/highlightSeam.ts`) with **`owner: 'user'`** and the `user` visual channel from
   `HIGHLIGHT_LAYERS.md` (solid fill). Keep an `id → painted cfiRange/page-range` map and **diff
   against it on each repaint**: paint ids that are new, `remove` ids no longer in the set. That diff
   is what makes `removeHighlight` work — the deleted id is simply absent from the next set.
3. **`ReaderScreen.tsx`** — call `loadReaderHighlights()` after `rendered` (highlights need the
   rendition to exist, like `setSpokenRange`) and send `paintHighlights` with `highlights.epub` or
   `highlights.pdf` per `format`. On a user highlight/delete gesture, call the matching
   `add*`/`removeHighlight`, then send `paintHighlights` with the returned fresh set. Log `skippedIds`.

## The three locked constraints, and where each lives

1. **Format-free per-shell payload (bridge rule).** Honored in `toReaderHighlights`: `HighlightPaint`
   discriminates on `format` (a frozen `ContentFormat` literal); the mapper copies fields explicitly
   into per-shell arrays with no `format` field. `readerHighlights.test.ts` pins that no
   `"EPUB"`/`"PDF"`/`"AUDIO"` and no `format` key survives — the executable form of
   `readerBridge.test.ts`'s "never puts a ContentFormat value into a command payload".
2. **Spread-aware PDF.** `PdfHighlightPaint` carries **`page`** per highlight, so in a double-page
   spread the applies half routes each to the correct canvas. Storage is unchanged (PDF locators stay
   per-page `{page, offset}`); a spread is just two pages painted at once. The multi-canvas routing +
   re-paint on double↔single flip is the applies half's job; the payload already carries what it needs.
3. **`tf-hl-*` owner namespacing.** User highlights paint under **`owner: 'user'`** at the seam, so
   they cannot collide with TTS (`'tts'`) or search (`'search'`). The payload deliberately does not
   carry an owner — it is fixed for this call-site. See `HIGHLIGHT_LAYERS.md`.

## Open item — per-book scoping RESOLVED 2026-08-24

`highlightStore.list()`/`add*` used to key off the single hard-coded `BOOK_ID`, so every book would show
every other book's highlights (same defect as bookmarks). Fixed: Karthik's stores take `bookId` (commit
`25cd740`) and `readerHighlights.ts` now threads a real `bookId` through every call
(`list(undefined, bookId)`). Note the applies-half isn't wired in `ReaderScreen` yet, so this is ready
for whenever painting lands — the seam is already per-book. Only `USER_ID` stays single-user prototype.

Historic note (superseded): `highlightStore.list()` filtered by the single hard-coded `USER_ID`/`BOOK_ID`, so a
second book won't load its own highlights until identity takes a book list. Not this stage's fix —
same limit the whole sync prototype carries.

See also: `HIGHLIGHT_LAYERS.md` (the collision convention this obeys), `WEBVIEW_BRIDGE.md` (the bridge
rule), `~/My_Reports/bookmarks-highlights-flow-and-sync.md` (the full flow + sync design).
