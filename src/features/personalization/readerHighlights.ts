// src/features/personalization/readerHighlights.ts
// Owner: Personalization (Vaishnavi).
//
// The "writes" half of the highlight-painting stage, exactly parallel to readerAppearance.ts:
// it turns stored highlights into a FORMAT-FREE, primitive-only payload the reader can paint, and
// the host call-sites that feed that payload on open and on user add/remove. It does NOT touch the
// bridge or src/features/reader/ — it produces what the future `paintHighlights` command will carry.
// Ahana owns the "applies" half (the bridge command + painting via the highlight seam); the seam is
// the boundary, the same way `toReaderAppearance` writes and the Reader applies. See
// READER_HIGHLIGHTS_WIRING.md.
//
// WHY THIS SHAPE EXISTS — it keeps a frozen contract OFF the WebView bridge, the same reason
// ReaderAppearance is a bridge-local flat shape. `HighlightPaint` (sync/stores/highlightStore.ts)
// discriminates on `format: 'PDF' | 'EPUB'` — those are `ContentFormat` literals (primitives.ts), a
// frozen contract. WEBVIEW_BRIDGE.md forbids a `ContentFormat` value on the wire (format is routed by
// COMMAND NAME, not carried as a value; `readerBridge.test.ts`'s "never puts a ContentFormat value
// into a command payload" pins it). So `HighlightPaint[]` must NOT be forwarded as-is. This file maps
// it host-side into per-shell arrays that carry no `format` field at all — id + color always survive;
// EPUB carries the two CFIs, PDF carries page + offsets. Same move as `goTo` unwrapping `.cfi` rather
// than sending a `Locator`, and `openEpub`/`openPdf` routing by name rather than value.

import {
  highlightStore,
  toPaintable,
  type HighlightPaint,
  type SelectionRange,
} from '@/features/sync/stores/highlightStore';
import { downloadStore } from '@/features/sync/stores/downloadStore';
import { syncEngine } from '@/features/sync/syncEngine';
import { pushNow } from '@/features/personalization/pushOnEdit';

/**
 * One EPUB highlight the reader can paint, format-free. `id` is what tap-to-delete removes by; the
 * two CFIs are position-independent (a reflow does not invalidate them), so nothing here needs to
 * know whether the book is single- or double-spread. `color` is a CSS colour string.
 */
export interface EpubHighlightPaint {
  id: string;
  startCfi: string;
  endCfi: string;
  color: string;
}

/**
 * One PDF highlight the reader can paint, format-free. `page` is 1-based and is what makes this
 * SPREAD-AWARE: in a double-page spread two pages are visible on two canvases, and `page` is what
 * routes each highlight to the correct one. Offsets are character offsets into that page's text
 * layer — per-page and independent, so a spread is just two of these painted at once (see the
 * PDF-double-spread note in the flow doc). `color` is a CSS colour string.
 */
export interface PdfHighlightPaint {
  id: string;
  page: number;
  startOffset: number;
  endOffset: number;
  color: string;
}

/**
 * The whole set of highlights to paint, split by which shell would render them. A book is one format
 * (one shell per book), so in practice exactly one of these is non-empty for a given open book — the
 * call-site sends the array matching the shell it opened. Split rather than a single tagged array
 * precisely so no `format` discriminant has to travel: the partition IS the routing, done host-side.
 */
export interface ReaderHighlights {
  epub: EpubHighlightPaint[];
  pdf: PdfHighlightPaint[];
}

/**
 * The result of loading highlights for a book: the paintable set, plus the ids that could NOT be made
 * paintable (corrupt or mixed-format locators). `toPaintable` returns those separately rather than
 * swallowing them because a stored highlight that cannot be drawn is a bug worth surfacing; this
 * carries that up to the call-site rather than dropping it here.
 */
export interface LoadedHighlights {
  highlights: ReaderHighlights;
  skippedIds: string[];
}

/**
 * The pure core: `HighlightPaint[]` -> the format-free per-shell payload. This is the single
 * "resolve host-side, send primitives" seam for highlights — the `format` discriminant stops here and
 * nothing downstream sees it. Fields are copied EXPLICITLY (not spread-minus-format) so it is
 * impossible for `format` to leak by accident and obvious at a glance what crosses the bridge.
 */
export function toReaderHighlights(paintable: HighlightPaint[]): ReaderHighlights {
  const epub: EpubHighlightPaint[] = [];
  const pdf: PdfHighlightPaint[] = [];

  for (const p of paintable) {
    if (p.format === 'EPUB') {
      epub.push({ id: p.id, startCfi: p.startCfi, endCfi: p.endCfi, color: p.color });
    } else {
      pdf.push({
        id: p.id,
        page: p.page,
        startOffset: p.startOffset,
        endOffset: p.endOffset,
        color: p.color,
      });
    }
  }

  return { epub, pdf };
}

/**
 * list (scoped to THIS book) -> paintable -> format-free payload, surfacing skipped rows. Shared by
 * every call-site below.
 *
 * `bookId` is passed explicitly rather than letting `highlightStore.list` fall back to the single
 * hardcoded `BOOK_ID` — that fallback is why every book would show every other book's highlights.
 * `list(undefined, bookId)` keeps the store's single-user default while pinning the open book.
 */
async function reload(bookId: string): Promise<LoadedHighlights> {
  const rows = await highlightStore.list(undefined, bookId);
  const { paintable, skipped } = toPaintable(rows);
  return {
    highlights: toReaderHighlights(paintable),
    skippedIds: skipped.map((row) => row.id),
  };
}

/**
 * CALL-SITE 1 — on open. The reader calls this once the shell is ready and paints the returned set
 * (see READER_HIGHLIGHTS_WIRING.md for exactly when). This is the `list()`-on-open half of the task.
 *
 * `pull()` (syncEngine.ts, Sync/Karthik) only ever refreshes highlights for books this device has
 * a local `downloads` row for — a book read online without ever being downloaded is invisible to
 * it, no matter how long another device has had highlights on it. `syncEngine.pullBook(bookId)` is
 * the per-book top-up for exactly that case; skipped for a downloaded book, since the regular sweep
 * already covers it and a second fetch here would just be redundant network traffic. Only on THIS
 * call-site, not `reload()`'s other callers (add/remove) — the top-up matters once, at open, to
 * catch up on anything written elsewhere before this device had a copy; it is not a live
 * subscription, and re-fetching on every local edit would add a round trip nothing asked for.
 */
export async function loadReaderHighlights(bookId: string): Promise<LoadedHighlights> {
  const downloaded = await downloadStore.currentForBook(bookId);
  if (!downloaded) await syncEngine.pullBook(bookId);
  return reload(bookId);
}

/**
 * CALL-SITE 2a — user highlights an EPUB selection. Persists via the store (which enqueues the sync
 * outbox in the same transaction) and returns the FRESH full set, so the caller re-sends one
 * authoritative `paintHighlights`. Returning the whole set rather than the one new highlight keeps
 * paint idempotent and matches the reader keeping an `id -> painted-range` map it diffs against.
 *
 * `pushNow()` after the write kicks a sync so a highlight made while already online reaches the server
 * now, not on the next reconnect — fire-and-forget, never a precondition of the local save. See
 * pushOnEdit.ts.
 */
export async function addEpubHighlight(
  bookId: string,
  startCfi: string,
  endCfi: string,
  color?: string,
): Promise<LoadedHighlights> {
  await highlightStore.addFromCfi(startCfi, endCfi, color, bookId);
  pushNow();
  return reload(bookId);
}

/** CALL-SITE 2b — user highlights a PDF selection (per-page; a `SelectionRange` is single-page). */
export async function addPdfHighlight(
  bookId: string,
  selection: SelectionRange,
  color?: string,
): Promise<LoadedHighlights> {
  await highlightStore.addFromSelection(selection, color, bookId);
  pushNow();
  return reload(bookId);
}

/**
 * CALL-SITE 3 — user deletes a highlight by tapping it. Delete is BY STORED ID (soft-delete
 * tombstone), never by re-selecting the range — the reader has the id from its painted-range map.
 * Returns the fresh set; the id just removed is absent from it, so the reader un-paints it as part of
 * the same diff every repaint does.
 */
export async function removeHighlight(bookId: string, id: string): Promise<LoadedHighlights> {
  await highlightStore.remove(id);
  pushNow();
  return reload(bookId);
}
