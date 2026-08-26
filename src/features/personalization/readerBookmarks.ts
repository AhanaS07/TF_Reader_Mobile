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
import { bookmarkStore, parseLocator } from '@/features/sync/stores/bookmarkStore';
import type { ReaderTarget } from '@/features/reader/readerBridge';
import { pushNow } from '@/features/personalization/pushOnEdit';

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
 * `bookId` is passed explicitly rather than letting `bookmarkStore.list` fall back to the single
 * hardcoded `BOOK_ID` — that fallback is why every book used to show every other book's bookmarks.
 * `list(undefined, bookId)` keeps the store's `userId` default (single-user prototype) while pinning
 * the book. Now multi-book capable: the reader passes the id of whichever book is open.
 */
async function reload(bookId: string): Promise<LoadedBookmarks> {
  return toReaderBookmarks(await bookmarkStore.list(undefined, bookId));
}

/** CALL-SITE 1 — on open: load THIS book's bookmarks for the panel. */
export function loadBookmarks(bookId: string): Promise<LoadedBookmarks> {
  return reload(bookId);
}

/**
 * CALL-SITE 2a — user bookmarks the current EPUB position. Persists via the store (which enqueues the
 * sync outbox in the same transaction — offline-safe) and returns the fresh full set for the panel.
 * `cfi` is the current reading position the reader already reports on `relocated`.
 *
 * `pushNow()` after the write kicks a sync so a bookmark made while already online reaches the server
 * now, not on the next reconnect — fire-and-forget, never a precondition of the local save. See
 * pushOnEdit.ts.
 */
export async function addCurrentEpubBookmark(
  bookId: string,
  cfi: string,
  chapterId?: string,
  name?: string,
): Promise<LoadedBookmarks> {
  await bookmarkStore.addForCfi(cfi, chapterId, name, bookId);
  pushNow();
  return reload(bookId);
}

/** CALL-SITE 2b — user bookmarks the current PDF page. */
export async function addCurrentPdfBookmark(
  bookId: string,
  page: number,
  name?: string,
): Promise<LoadedBookmarks> {
  await bookmarkStore.addForPage(page, name, bookId);
  pushNow();
  return reload(bookId);
}

/**
 * CALL-SITE 3 — user deletes a bookmark by tapping it in the panel. Delete is BY STORED ID
 * (soft-delete tombstone). Independent creates and deletes never collide (each is a unique id), so
 * plain LWW still behaves as union across those — the one same-id case is delete-vs-rename, resolved
 * engine-side (see `renameBookmark`). Returns the fresh set, the deleted id absent from it.
 */
export async function removeBookmark(bookId: string, id: string): Promise<LoadedBookmarks> {
  await bookmarkStore.remove(id);
  pushNow();
  return reload(bookId);
}

/**
 * CALL-SITE 4 — user renames an existing bookmark by tapping it in the panel and giving it a new name.
 * This is the REAL update-in-place op that replaces Reader's delete-and-recreate stand-in (see
 * READER_BOOKMARKS_WIRING.md item 6): one write, one outbox entry, and the bookmark's id and `target`
 * are untouched — only `name` changes. Returns the fresh set for the panel to re-render, then nudges a
 * sync so the rename reaches the server now (see pushOnEdit.ts).
 *
 * WHY THIS DOES NOT BREAK plain-LWW-as-union (the reason bookmarks were create+delete-only): a rename
 * is a same-id UPDATE, and two independent renames of DIFFERENT bookmarks never collide (different
 * ids), so union still holds for them. The ONE case a same-id UPDATE reintroduces is delete-vs-rename
 * on the SAME id — a rename with a later stamp could otherwise resurrect a bookmark another device
 * deleted. Making deletes win that race is an engine-side guard (`is_deleted` sticky in
 * `applyServerRecord`), which is KARTHIK's call — this facade only produces the local UPDATE + outbox
 * entry; it cannot and does not decide the cross-device resolution. See the open item in the wiring doc.
 */
export async function renameBookmark(
  bookId: string,
  id: string,
  name: string,
): Promise<LoadedBookmarks> {
  await bookmarkStore.rename(id, name);
  pushNow();
  return reload(bookId);
}
