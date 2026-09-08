# Reader-bookmarks wiring — writes/applies split

**Owner of the writes half: Personalization (Vaishnavi). Owner of the panel UI: Reader (Ahana).**

The bookmark sibling of `READER_HIGHLIGHTS_WIRING.md`, and simpler in one way that matters: **bookmarks
do not paint, so there is no new bridge command to add.** A bookmark is a place to jump to, and the
jump is the `goTo` command that already exists for read-position restore and search hits. So the
applies half here is a panel UI, not a bridge change.

## What is built (writes half — `readerBookmarks.ts`)

A pure mapper plus the four call-sites, unit-tested (`readerBookmarks.test.ts`):

| Export | Role |
| ------ | ---- |
| `toReaderBookmarks(rows)` | pure: `BookmarkRow[]` → `{ bookmarks: { id, label, target }[], skippedIds }` |
| `loadBookmarks(bookId)` | call-site 1 — on open: `list(this book)` → navigable rows |
| `addCurrentEpubBookmark(bookId, cfi, chapterId?, name?)` | call-site 2a — bookmark the current EPUB position |
| `addCurrentPdfBookmark(bookId, page, name?)` | call-site 2b — bookmark the current PDF page |
| `removeBookmark(bookId, id)` | call-site 3 — tap-to-delete, **by stored id** (`bookId` re-lists the right book) |
| `renameBookmark(bookId, id, name)` | call-site 4 — rename in place, **by stored id**; id + `target` unchanged, only `name` |

Every call is scoped to `bookId` (2026-08-24) — see the resolved open item below.

Each `add*`/`removeBookmark` persists through `bookmarkStore` (row + sync outbox op in one
transaction — offline-safe) and returns the **fresh full set** for the panel to re-render.

`target` is exactly `goTo`'s `ReaderTarget` (`{ kind: 'href', href }` for EPUB, `{ kind: 'page', page }`
for PDF) — format-free, and the same type `goTo` already accepts. Reused rather than reinvented so a
tap re-maps nothing and cannot drift from what the bridge takes.

## What Ahana adds (the panel UI) — LANDED, 2026-08-24

No `readerBridge.ts` / entry changes needed, as predicted. `BookmarksPanel.tsx` (presentational,
matching `SearchPanel.tsx`'s split) plus the wiring in `ReaderScreen.tsx`:

1. **On open** — a `useEffect` keyed on `isRendered` calls `loadBookmarks()` once, the same "once per
   mount" shape as the resume-target flush effect. `skippedIds.length` renders as a count in the
   panel rather than only being logged, on the same "surface it" reasoning as the TOC hardeners.
2. **Tap a bookmark** — `selectBookmark` sends `{ type: 'goTo', target: bookmark.target }` and closes
   the panel. A dedicated handler rather than reusing the existing `goTo` (which closes the *Contents*
   panel) — same command, different panel to dismiss.
3. **Add-current-position button** — `canAddCurrentBookmark` gates on `send !== null` and on
   `position`'s own nullability (`kind: 'cfi'` starts `cfi: null` until epub.js resolves a location,
   the same guard `sessionProgress.ts` already needed). `addCurrentBookmark` branches on
   `position.kind` into `addCurrentEpubBookmark(cfi)` / `addCurrentPdfBookmark(page)` and replaces
   `bookmarks` state with the returned fresh set — no name/chapterId prompt, so a fallback label
   (`labelFor`'s "Bookmark" / "Page N") is what most rows show today.
4. **Delete** — `removeBookmark(id)` on a per-row "Delete" affordance, same fresh-set re-render.
5. **Add a label** — the add row now carries a "Name this bookmark (optional)" field, threaded through
   to `addCurrentEpubBookmark`'s/`addCurrentPdfBookmark`'s existing `name` parameter. Blank stays
   `undefined`, so `labelFor`'s own fallback (chapter id, or "Bookmark"/"Page N") still applies rather
   than this panel inventing a second empty-label convention.
6. **Rename an existing bookmark — DONE, end to end (Reader side swapped 2026-09-02, Ahana).**
   `renameBookmark(bookId, id, name)` in `readerBookmarks.ts` (call-site 4 above), backed by
   `bookmarkStore.rename(id, name)`: one write, one outbox entry, id and `target` untouched, only
   `name` changes. `ReaderScreen`'s delete-and-recreate stand-in is gone — `submitBookmarkRename`
   there is now a single call to this op. `BookmarksPanel`'s `onRename` narrowed to
   `(id: string, name?: string)` in the same change, since the whole bookmark was only ever passed so
   the stand-in could re-create the row at the same `target`.
   - A cleared name field reaches this op as `''` rather than `undefined` (the signature takes a
     required `string`); `labelFor` reads an empty name as absent, so the row falls back to its
     chapter id / positional label exactly as a never-named one does.
   - The delete-vs-rename race a same-id UPDATE reintroduces is closed engine-side — see the
     "Real rename op" resolved item below.
7. **The bookmarked-page badge — PURELY VISUAL, not a control.** `isCurrentPositionBookmarked` (a
   `useMemo` over `bookmarks` and `position`, no store read of its own) drives a small corner badge
   over the viewer, the way Word marks a bookmarked location with an icon rather than a button. It does
   NOT open the panel and has no `onPress` — an earlier version made it a `Pressable` that opened
   `BookmarksPanel`; the user asked for the opposite. The panel is reached from the toolbar; this is
   only the "you are somewhere you bookmarked" cue. PDF matches by PAGE (the same granularity
   `addCurrentPdfBookmark` writes at); EPUB matches by exact CFI, an honest narrower claim since a CFI
   addresses a point, not a page.
   - **Background**: a warm gold circle (`#ffd54f`) plus a shadow (`elevation` on Android), not white —
     white-on-a-white-page barely registered. Colours are inline for the same reason the rest of this
     screen's are (`src/theme/` has not landed).
   - **"Page Bookmarked" tooltip, TWO triggers.** `onHoverIn`/`onHoverOut` (mouse/trackpad) — but
     **verified against RN's own source, not assumed: this is currently INERT on every platform this
     app ships to.** `Pressability.js`/`HoverState.js` route `Pressable`'s hover callbacks through the
     legacy `onMouseEnter`/`onMouseLeave` path by default, and `isHoverEnabled()` is hard-coded to stay
     `false` unless `Platform.OS === 'web'` — never on native iOS/Android, regardless of an iPad
     trackpad or Mac Catalyst, and this app has no web target configured. It is kept anyway for if/when
     a web target or RN's W3C Pointer Events ever apply here, and is proven today only by the Jest test
     that calls it directly, not by anything reachable on a real device. `onLongPress`/`onPressOut` is
     the trigger that actually works today, on a phone, an iPad, or the simulator — not `onPress`,
     since a plain tap must stay inert, same as the rest of this badge's "not a button" behaviour.
     Because either trigger needs the badge to actually receive touch/pointer events, it is no longer
     `pointerEvents="none"` — the accepted tradeoff is a finger tap landing exactly on this 30x30
     corner being swallowed rather than reaching a swipe gesture underneath it, negligible given the
     badge's size and inset placement, and harmless either way since a plain tap still does nothing.
8. **Cross-book filtering — the real per-book scoping does it now; Reader's format filter is a
   guard.** Every call above is scoped to `bookId`, so the panel receives only the open book's rows
   and `bookmarksForOpenBook` (`ReaderScreen.tsx`) has nothing left to exclude. It was kept anyway
   (recommented 2026-09-02): both store methods still DEFAULT `bookId` to the single `BOOK_ID`
   constant in `syncConfig.ts`, so a call-site that stops passing it silently goes back to serving
   every book — and `target.kind` catches the cross-format half of that at the point of use, for the
   price of one `Array.filter`. Same-format cross-book leakage is what it cannot catch, then as now.

Mutual exclusion with Contents/Search/TTS (all four panels close each other) and swipe-to-turn-page
are both gated on `showBookmarks` the same way the other three panels already were. Covered by
`ReaderScreen.test.tsx`'s "ReaderScreen bookmarks panel" and "ReaderScreen bookmark badge" describe
blocks, mocking this file's exports the same way search's `queryBookIndex` seam is mocked elsewhere
in that suite.

Offline vs online is invisible to the panel: the store writes locally and the sync engine pushes to
Mongo when connected. Nothing in the UI observes the network.

## Open items (pre-ship — Karthik/Vaishnavi)

**Per-book scoping — RESOLVED 2026-08-24.** Was: `bookmarkStore.add()` stamped every row's `book_id`
with the single hard-coded `BOOK_ID` and `list()` filtered by that same singleton, so `loadBookmarks()`
returned every bookmark ever created, for every book. Fixed end to end: Karthik made the stores
multi-book capable (`list`/`add*`/`addForCfi`/`addForPage` take a `bookId`, commit `25cd740`);
`readerBookmarks.ts` now threads a real `bookId` through every call — `list(undefined, bookId)` keeps the
store's single-user default while pinning the open book; and `ReaderScreen.tsx` passes its open-book
`bookId` prop into all four call-sites. Bookmarks are now genuinely per-book, including two books of the
SAME format. **Item 8's `target.kind` mitigation is now redundant** for correctness (the data itself
distinguishes books) — it still harmlessly filters by format and can be simplified whenever Reader
touches it. Only the `USER_ID` half stays single-user prototype (separate identity item).

**Real rename op — RESOLVED 2026-08-27 (Karthik).** The op landed 2026-08-26:
`renameBookmark(bookId, id, name)` (`readerBookmarks.ts`) → `bookmarkStore.rename(id, name)` (a
same-id UPDATE through the shared `saveLocal` primitive). The delete-vs-rename cross-device race it
reintroduced is now closed: `applyServerRecord` (`syncableTable.ts`) makes deletes STICKY regardless
of timestamp — a local tombstone rejects any incoming non-delete update outright, and an incoming
delete applies unconditionally over a live local row (both directions, or the guard would contradict
itself on ordering). Rename-vs-rename stays plain LWW, as recommended (later name wins, no data
loss). Pinned by `syncableTable.test.ts` (generic mechanism) and `bookmarkStore.test.ts`'s
"delete-vs-rename (cross-device)" block (the real scenario).

**AUDIO locator — bookmarks skip it, deliberately (2026-08-26).** Since AUDIO joined the frozen
`Locator` union (Karthik, for future audio-progress sync), a bookmark row can carry one. `toTarget`
returns null for AUDIO and `toReaderBookmarks` sets the row aside into `skippedIds` — an audiobook
position has no `ReaderTarget` (`kind: 'href' | 'page'`) to reach in the text reader. Unreachable today
(bookmarks are only minted from EPUB/PDF reading positions), pinned by a test so the skip can't silently
regress. A genuinely navigable audio bookmark needs its own seam into `AudioPlayerScreen` — a separate
future feature for whoever owns that route, NOT this panel. Note: `skippedIds` currently pools this with
corrupt-locator rows; if audio bookmarks ever become creatable, split the two so a valid-but-audio row
isn't surfaced as corruption.

See also: `READER_HIGHLIGHTS_WIRING.md` (the highlight sibling), `~/My_Reports/bookmarks-highlights-flow-and-sync.md`.
