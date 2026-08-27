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

**Update, 2026-08-27: neither highlight action is an RN-rendered affordance any more.** The
description below (a passive `selection` + anchor driving a floating "Highlight" popup;
`highlightPressed` driving a floating "Delete highlight" popup) is history, not current behaviour —
UIKit's native selection callout is drawn above the whole app, so an RN popup for either action can
be visually unreachable even when triggered correctly. Both actions are native `menuItems` entries
on the WebView now; `selection`/`highlightPressed` are sent only in reply to
`requestCurrentSelection`/`confirmDeleteHighlight` and carry no anchor. `WEBVIEW_BRIDGE.md`'s "The
highlight set" section is the current, authoritative shape — this section stays as the record of
how call-sites 2 and 3 were originally wired.

## What Ahana added (applies half) — LANDED, 2026-08-26

All three pieces below, plus **two the plan did not anticipate**: this stage needed traffic in the
*other* direction (a selection has to reach the host before `addEpubHighlight` can be called with
it), and the PDF shell had nothing to select. Everything is green under `npm test && npm run
typecheck && npm run lint`.

1. **`readerBridge.ts`** — as specified. `paintHighlights` in `READER_COMMANDS`, the
   `{ type: 'paintHighlights'; highlights: EpubHighlightPaint[] | PdfHighlightPaint[] }` case, the
   `buildCommandScript` arm, the `CommandArgs` entry (which is what forced both entries to implement
   it, exactly as predicted). **Plus two new `ReaderMessage` types**, which the plan's "this is
   host→WebView only, `parseReaderMessage` needs no change" did not foresee:
   - **`selection`** — `{ kind: 'cfiRange', startCfi, endCfi } | { kind: 'pageRange', page,
     startOffset, endOffset } | null`. Exactly `addEpubHighlight`'s and `addPdfHighlight`'s own
     arguments, so the host forwards rather than re-derives. Discriminated on `kind`, never on
     format. **Sent on every change including the clear**, so the menu cannot outlive the words it
     would act on. Carries an `anchor` — the only pixel-valued payload on this bridge, and
     deliberately so: it says where the finger just was, it is consumed within the same gesture, and
     nothing stores it.
   - **`highlightPressed`** — `{ id, anchor }`. Only the id identifies the highlight, per item 4 of
     the brief; the anchor is where to put the menu.
2. **The entries** — both paint through the seam under `owner: 'user'` with the solid-fill channel,
   keep an `id → painted range` map, and diff against it (`webview/src/highlightPaint.ts`, pure and
   tested). Two things worth knowing:
   - **The EPUB seam did not actually paint anything, for anyone, including TTS.** epub.js's `type`
     argument is its annotation KIND and `Annotation.attach()` has no `else` branch, so the per-owner
     `type` `HIGHLIGHT_LAYERS.md` mandated meant nothing was ever drawn. Corrected in the seam and in
     that doc's §1. TTS's styles were camelCased CSS keys applied as SVG attributes, so they were
     inert too — also fixed. Neither is visible to a unit test, which is why neither had been caught.
   - **The PDF shell grew a text layer.** A rasterised page has no text to select and nothing to
     anchor to. `webview/src/pdfHighlightSeam.ts` (DOM) + `pdfTextRange.ts` (pure, tested) render
     pdf.js's standard text layer over every visible page, map a selection to the character offsets
     `highlightStore` stores, and map stored offsets back to boxes. Spread-aware by construction —
     everything is keyed on a page number — so single-page, double spread and continuous scroll are
     the same code path with a different number of surfaces.
3. **`ReaderScreen.tsx`** — `loadReaderHighlights()` after `rendered` (not merely once `send` exists:
   painting needs a rendition), one effect that sends `paintHighlights` with `highlights.epub` or
   `highlights.pdf` from an exhaustive `switch (format)`, and the add/remove call-sites replacing
   state with each returned fresh set. `skippedIds` is **surfaced, not logged** — a quiet notice at
   the foot of the page, matching how the bookmarks panel reports its own.

### The one design decision this needed that the brief did not cover: THE GESTURE MODEL

There is **no mode and no toggle**. Long-press some text and a small menu offers **Highlight**;
long-press a highlight you already made — anywhere in it, one word is enough — and the same menu
offers **Delete highlight** instead. A directional drag still turns the page. One gesture to learn;
which offer it brings follows from what is under the finger.

**Getting there meant moving page-turn swipe INTO the WebView**, and that is the part worth knowing
about. Swipe used to be an RN `PanResponder` on an overlay above the WebView
(`reader-swipe-catcher`). That overlay is the topmost hit-test target for every touch in the viewer,
so the document underneath never received a `touchstart` while it was mounted — fine for swipes,
fatal for selection, which is the first half of making a highlight. The two could not both own the
same touches from opposite sides of the bridge.

So the overlay is gone and both gestures are recognised in the document, where the whole touch is
visible and they can be told apart by SHAPE: hold still and the text selects, drag sideways and the
page turns (`webview/src/touchGesture.ts`, pure and tested). Consequences worth flagging:

- **`{ type: 'next' | 'prev' }` is no longer sent for a swipe** — only by the Prev/Next buttons. The
  shells call their own navigation directly, and the host learns about it from `relocated` exactly as
  before.
- **Delete is a two-step gesture, never one.** The press OFFERS; the menu button performs. A long
  press is deliberate but it is not a confirmation, and this is the only gesture in the reader that
  destroys saved work.
- **`::selection` is themed now** (`webview/src/selectionTheme.ts`). WebKit's default fill is opaque
  and hides the words it is selecting, which matters more than usual when seeing the selection IS the
  feedback that the gesture worked. The theme's link colour at 32% alpha, with a lightness-derived
  neutral scrim as the fallback.
- **Two RN-side pieces are pure and tested rather than eyeballed**: `highlightPopup.ts` (where the
  menu goes, and how it stays on screen at a margin or a first line) and the gesture thresholds above.

Worth a look on the simulator before you rely on it: it changes what every touch on the book does,
and no unit test can see a swipe that stopped working.

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
   **Partially weakened as of 2026-08-26, and honestly:** the namespace is now carried by the CSS
   class and the annotation's `data`, not by epub.js's `type` argument, because a per-owner `type`
   painted nothing at all (that doc's §1 has the source-level detail). Two owners painting the
   *identical* range string can therefore collide in epub.js's own map. Bounded and repaintable;
   recorded rather than hidden.

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
