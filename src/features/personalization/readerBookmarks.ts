// src/features/personalization/readerBookmarks.ts
// Owner: Personalization (Vaishnavi).
//
// The host call-sites for bookmarks — `list()` on open into a navigable panel, add on a user gesture,
// remove on tap-to-delete. The sibling of readerHighlights.ts, and simpler in one important way:
// bookmarks DO NOT PAINT, so there is no new bridge command to wait on. A bookmark is a place to jump
// to, and the jump is the EXISTING `goTo` command. This file's whole job is to turn a stored
// `BookmarkRow` into `{ label, target }` where `target` is exactly `goTo`'s `ReaderTarget` — so
// tapping a bookmark needs nothing from the WebView half that read/search navigation didn't already.
//
// WHY REUSE `ReaderTarget` RATHER THAN INVENT A PARALLEL TYPE (as readerHighlights had to for its
// paint payload): a highlight's paint shape had no existing wire type, so it defined its own. A
// bookmark's destination DOES have one — `goTo` already carries `ReaderTarget`, and it is already
// format-free (it discriminates on `kind: 'href' | 'page'`, NOT on ContentFormat — see the long note
// in readerBridge.ts). Producing that type directly means a bookmark tap re-maps nothing and cannot
// drift from what `goTo` accepts. The import is `import type` (erased), so it adds no runtime coupling.

import type { BookmarkRow, Locator } from '@/features/sync/localDb/types';
import { parseLocator } from '@/features/sync/localDb/mappers';
import type { ReaderTarget } from '@/features/reader/readerBridge';
import { annotationsRouter } from '@/features/personalization/annotationsRouter';

/**
 * One bookmark the panel can render and navigate to. `id` is what tap-to-delete removes by; `target`
 * is handed straight to `goTo`. No format field — an EPUB bookmark's CFI travels as a `kind: 'href'`
 * target (epub.js resolves a CFI or a spine href through the same call), a PDF bookmark's page as a
 * `kind: 'page'` target.
 */
export interface ReaderBookmark {
  id: string;
  /** User-facing label: the bookmark's name, else its chapter id, else a positional fallback. */
  label: string;
  target: ReaderTarget;
}

/**
 * The loaded set, plus the ids of rows that could NOT be turned into a target — corrupt locator
 * JSON, or (since AUDIO shipped) a valid locator with no `ReaderTarget` to reach it. Surfaced rather
 * than swallowed, exactly as `toPaintable`/`loadReaderHighlights` surface theirs — a stored bookmark
 * that cannot be navigated to from this panel is worth seeing, not a silently missing row.
 */
export interface LoadedBookmarks {
  bookmarks: ReaderBookmark[];
  skippedIds: string[];
}

/**
 * A stored `Locator` -> the `goTo` target that reaches it. EPUB anchors by CFI, PDF by page — the two
 * addressing schemes `ReaderTarget` exists to carry.
 *
 * Returns null for AUDIO: `ReaderTarget` is bridge-local to the WebView reader (`kind: 'href' |
 * 'page'`, see readerBridge.ts) and an audiobook's position has no destination there — audio never
 * opens through `goTo`. Not a gap to close in this file; a navigable audio bookmark needs its own
 * seam into AudioPlayerScreen, which is a call for whoever owns that route.
 */
function toTarget(locator: Locator): ReaderTarget | null {
  if (locator.type === 'EPUB') return { kind: 'href', href: locator.cfi };
  if (locator.type === 'PDF') return { kind: 'page', page: locator.page };
  return null;
}

/** The label to show, in precedence order: explicit name, then chapter id, then a positional default. */
function labelFor(row: BookmarkRow, locator: Locator): string {
  if (row.name) return row.name;
  if (row.chapter_id) return row.chapter_id;
  return locator.type === 'PDF' ? `Page ${locator.page}` : 'Bookmark';
}

/**
 * The pure core: `BookmarkRow[]` -> navigable panel rows, corrupt rows set aside. Store order is kept
 * (that is `listActive`'s order); any sort is the panel's decision, not this seam's.
 */
export function toReaderBookmarks(rows: BookmarkRow[]): LoadedBookmarks {
  const bookmarks: ReaderBookmark[] = [];
  const skippedIds: string[] = [];

  for (const row of rows) {
    const locator = parseLocator(row.locator);
    if (!locator) {
      skippedIds.push(row.id);
      continue;
    }
    const target = toTarget(locator);
    if (!target) {
      skippedIds.push(row.id);
      continue;
    }
    bookmarks.push({ id: row.id, label: labelFor(row, locator), target });
  }

  return { bookmarks, skippedIds };
}

/**
 * list (scoped to THIS book) -> navigable rows. Shared by every call-site below.
 *
 * Goes through `annotationsRouter`, which reads Mongo directly when online (refreshing the SQLite
 * snapshot for a downloaded book) and SQLite when offline — see annotationsRouter.ts. `bookId` pins the
 * open book; the single-user prototype `userId` default lives in the router.
 */
async function reload(bookId: string): Promise<LoadedBookmarks> {
  return toReaderBookmarks(await annotationsRouter.bookmarks.list(bookId));
}

/** CALL-SITE 1 — on open: load THIS book's bookmarks for the panel. */
export function loadBookmarks(bookId: string): Promise<LoadedBookmarks> {
  return reload(bookId);
}

/**
 * CALL-SITE 2a — user bookmarks the current EPUB position. Persists via `annotationsRouter`: online it
 * writes straight to Mongo, offline it queues in SQLite for the reconcile — see annotationsRouter.ts.
 * Returns the fresh full set for the panel. `cfi` is the reading position the reader reports on
 * `relocated`.
 */
export async function addCurrentEpubBookmark(
  bookId: string,
  cfi: string,
  chapterId?: string,
  name?: string,
): Promise<LoadedBookmarks> {
  await annotationsRouter.bookmarks.addForCfi(cfi, chapterId ?? null, name, bookId);
  return reload(bookId);
}

/** CALL-SITE 2b — user bookmarks the current PDF page. */
export async function addCurrentPdfBookmark(
  bookId: string,
  page: number,
  name?: string,
): Promise<LoadedBookmarks> {
  await annotationsRouter.bookmarks.addForPage(page, name, bookId);
  return reload(bookId);
}

/**
 * CALL-SITE 3 — user deletes a bookmark by tapping it in the panel. Delete is BY STORED ID
 * (soft-delete tombstone). Independent creates and deletes never collide (each is a unique id), so
 * plain LWW still behaves as union across those — the one same-id case is delete-vs-rename, resolved
 * engine-side (see `renameBookmark`). Returns the fresh set, the deleted id absent from it.
 */
export async function removeBookmark(bookId: string, id: string): Promise<LoadedBookmarks> {
  await annotationsRouter.bookmarks.remove(id);
  return reload(bookId);
}

/**
 * CALL-SITE 4 — user renames an existing bookmark by tapping it in the panel and giving it a new name.
 * The REAL update-in-place op that replaces Reader's delete-and-recreate stand-in (READER_BOOKMARKS_
 * WIRING.md item 6): the id and `target` are untouched, only `name` changes. Persists via
 * `annotationsRouter` (online → Mongo PUT, offline → SQLite pending for the reconcile) and returns the
 * fresh set. Concurrent delete-vs-rename on the same id resolves server-wins-on-divergence in our own
 * reconcile — see ANNOTATIONS_STORAGE.md; it is no longer routed through Sync's engine.
 */
export async function renameBookmark(
  bookId: string,
  id: string,
  name: string,
): Promise<LoadedBookmarks> {
  await annotationsRouter.bookmarks.rename(id, name);
  return reload(bookId);
}
