// Owner: Reader (Ahana).
//
// SESSION-ONLY reading-position cache, keyed by BookId. Deliberately not persisted anywhere:
// `progressStore.savePage()`/`savePosition()` (Sync's side) own writing a durable progress record —
// see ReaderScreen.tsx's own note on `position` for why that boundary exists. This module is not
// that: it exists so navigating BookList -> Reader -> BookList -> Reader within the SAME app run
// resumes where you left off, and a relaunch starts fresh (module state, nothing written to disk).

import type { ReaderPosition, ReaderTarget } from '@/features/reader/readerBridge';
import type { BookId } from '@/shared/contracts';

const positions = new Map<BookId, ReaderPosition>();

export function getSessionPosition(bookId: BookId): ReaderPosition | undefined {
  return positions.get(bookId);
}

export function setSessionPosition(bookId: BookId, position: ReaderPosition): void {
  positions.set(bookId, position);
}

/**
 * A resumable `ReaderTarget` for `goTo`, or null when there is nothing to resume (no position
 * recorded yet, or an EPUB that reported `relocated` before its rendition had produced a CFI).
 *
 * CFI AS `href`, DELIBERATELY. `ReaderTarget` has no `cfi` kind — `goTo` only carries `href`/`page`
 * — but that is not a gap this file works around: `epub.entry.ts`'s own `goTo` forwards `target.href`
 * straight to `rendition.display()`, and epub.js's `display()` already accepts a bare CFI string —
 * the same trick `applyAppearance`'s flow-change path uses internally
 * (`createRendition().display(cfi ?? undefined)`). An EPUB CFI is already a valid `href` on the
 * wire, so this is not new bridge surface and needs no `readerBridge.ts`/template change.
 */
export function targetFromPosition(position: ReaderPosition | undefined): ReaderTarget | null {
  if (!position) return null;
  if (position.kind === 'page') return { kind: 'page', page: position.page };
  return position.cfi === null ? null : { kind: 'href', href: position.cfi };
}
