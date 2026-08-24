# Reader-bookmarks wiring — writes/applies split

**Owner of the writes half: Personalization (Vaishnavi). Owner of the panel UI: Reader (Ahana).**

The bookmark sibling of `READER_HIGHLIGHTS_WIRING.md`, and simpler in one way that matters: **bookmarks
do not paint, so there is no new bridge command to add.** A bookmark is a place to jump to, and the
jump is the `goTo` command that already exists for read-position restore and search hits. So the
applies half here is a panel UI, not a bridge change.

## What is built (writes half — `readerBookmarks.ts`)

A pure mapper plus the three call-sites, unit-tested (`readerBookmarks.test.ts`, 10 cases):

| Export | Role |
| ------ | ---- |
| `toReaderBookmarks(rows)` | pure: `BookmarkRow[]` → `{ bookmarks: { id, label, target }[], skippedIds }` |
| `loadBookmarks()` | call-site 1 — on open: `list()` → navigable rows |
| `addCurrentEpubBookmark(cfi, chapterId?, name?)` | call-site 2a — bookmark the current EPUB position |
| `addCurrentPdfBookmark(page, name?)` | call-site 2b — bookmark the current PDF page |
| `removeBookmark(id)` | call-site 3 — tap-to-delete, **by stored id** |

Each `add*`/`removeBookmark` persists through `bookmarkStore` (row + sync outbox op in one
transaction — offline-safe) and returns the **fresh full set** for the panel to re-render.

`target` is exactly `goTo`'s `ReaderTarget` (`{ kind: 'href', href }` for EPUB, `{ kind: 'page', page }`
for PDF) — format-free, and the same type `goTo` already accepts. Reused rather than reinvented so a
tap re-maps nothing and cannot drift from what the bridge takes.

## What Ahana adds (the panel UI)

No `readerBridge.ts` / entry changes needed. In `ReaderScreen.tsx` (and a panel component):

1. **On open** — after `rendered`, call `loadBookmarks()` and render the list. Log `skippedIds`.
2. **Tap a bookmark** — `send({ type: 'goTo', target: bookmark.target })`. That's the whole navigation
   path; it already works for search hits and TOC entries.
3. **Add-current-position button** — you already track the current position from `relocated`
   (`ReaderPosition`): a `cfi` for EPUB → `addCurrentEpubBookmark(cfi, ...)`, a `page` for PDF →
   `addCurrentPdfBookmark(page, ...)`. Re-render with the returned set.
4. **Delete** — `removeBookmark(id)` on the row's delete affordance, re-render with the returned set.

Offline vs online is invisible to the panel: the store writes locally and the sync engine pushes to
Mongo when connected. Nothing in the UI observes the network.

## Open item (unchanged, pre-ship — Karthik/joint)

`bookmarkStore.list()` filters by the single hard-coded `USER_ID`/`BOOK_ID` in `syncConfig.ts`, so a
second book won't load its own bookmarks until identity takes a book list. Same limit the whole sync
prototype carries; not this stage's fix.

See also: `READER_HIGHLIGHTS_WIRING.md` (the highlight sibling), `~/My_Reports/bookmarks-highlights-flow-and-sync.md`.
