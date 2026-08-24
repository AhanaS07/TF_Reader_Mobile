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
6. **Rename an existing bookmark** — UI landed 2026-08-24, but `ReaderScreen.renameBookmark`'s
   implementation is a **TEMPORARY STAND-IN, agreed with the user, not a design decision.**
   `readerBookmarks.ts` is create-and-delete-only on purpose (see `removeBookmark`'s own note: it is
   what lets plain LWW behave as a union across devices), and whether a real update-in-place op can be
   added without breaking that guarantee is **Karthik/Vaishnavi's call to make**, not Reader's to
   assume — outside Reader's ownership per CLAUDE.md. Until they ship it, `renameBookmark` fakes the
   same user-visible result by composing calls Reader already has: `add*`s a new bookmark at the SAME
   `target` under the new name, awaits that, THEN `removeBookmark`s the old id — sequenced, not
   parallel, so a failed add never leaves neither copy. This is two writes and two sync-outbox entries
   for what is conceptually one edit, which is exactly the kind of thing a real update op should
   collapse to one — **replace `renameBookmark`'s body with a single call once that op exists**, and
   remove this item. `BookmarksPanel.tsx`'s `onRename` prop does not change either way — only what
   `ReaderScreen` does behind it.
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
8. **Cross-book filtering — PARTIAL, on the honest half of the underlying defect.** See the new "Open
   item" below: `bookmarkStore.list()` returns every bookmark for every book, always, because
   `bookmarkStore.add()` stamps every row with the single hardcoded `BOOK_ID`. Reader cannot fix that
   from its own files, but `bookmarksForOpenBook` (`ReaderScreen.tsx`) filters what it CAN prove:
   `target.kind` (`'href'` vs `'page'`) can't apply to the wrong format, so an EPUB never lists a PDF's
   bookmarks and vice versa. Two books of the SAME format still see each other's — nothing in the
   returned data distinguishes them.

Mutual exclusion with Contents/Search/TTS (all four panels close each other) and swipe-to-turn-page
are both gated on `showBookmarks` the same way the other three panels already were. Covered by
`ReaderScreen.test.tsx`'s "ReaderScreen bookmarks panel" and "ReaderScreen bookmark badge" describe
blocks, mocking this file's exports the same way search's `queryBookIndex` seam is mocked elsewhere
in that suite.

Offline vs online is invisible to the panel: the store writes locally and the sync engine pushes to
Mongo when connected. Nothing in the UI observes the network.

## Open items (pre-ship — Karthik/Vaishnavi)

**Every bookmark is tagged with the same book, always — not just "second book won't load its own
yet".** `bookmarkStore.add()` stamps every row's `book_id` with the single hard-coded `BOOK_ID` from
`syncConfig.ts`, regardless of which book was actually open when it was created, and `list()` filters
by that same singleton. So `loadBookmarks()` returns every bookmark ever created, for every book,
always — there is no per-book identity in the data at all, not merely an unapplied filter. Raised
2026-08-24 when the user asked for bookmarks to be scoped to the open book; confirmed with them that
the real fix (thread an actual `bookId` through `bookmarkStore.ts`'s and `readerBookmarks.ts`'s
signatures, replacing the constant) is Karthik/Vaishnavi's to make, not Reader's — same reasoning as
`renameBookmark` in item 6. **Reader's partial mitigation is item 8 above** (filtering by
`target.kind`, which stops cross-FORMAT leaks but not same-format ones) — replace it with the real
per-book filter once the store threads a real id, and remove item 8's note when that happens.

**New, 2026-08-24 — a real rename op.** See item 6 above: `renameBookmark`'s delete-and-recreate is a
stand-in, not the intended shape. Needs a decision on whether `readerBookmarks.ts`'s
create-and-delete-only model can take an update op without breaking the plain-LWW-as-union guarantee,
and if so, what it looks like on the wire (presumably an `updateBookmark(id, name)` alongside the
existing three call-sites). Reader will swap `renameBookmark`'s body to call it once it exists.

See also: `READER_HIGHLIGHTS_WIRING.md` (the highlight sibling), `~/My_Reports/bookmarks-highlights-flow-and-sync.md`.
