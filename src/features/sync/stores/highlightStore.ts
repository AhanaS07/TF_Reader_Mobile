import { newId, nowIso } from '../localDb/database';
import { highlightMapper, parseLocator } from '../localDb/mappers';
import type { HighlightRow, Locator } from '../localDb/types';
import { BOOK_ID, USER_ID } from '../syncConfig';
import { createSyncableTable } from './syncableTable';

export const highlightTable = createSyncableTable<HighlightRow>({
  table: 'highlights',
  entityType: 'highlights',
  toServer: highlightMapper.toServer,
  toRow: highlightMapper.toRow,
});

export interface SelectionRange {
  page: number;
  startOffset: number;
  endOffset: number;
}

export const highlightStore = {
  ...highlightTable,

  list(): Promise<HighlightRow[]> {
    return highlightTable.listActive(USER_ID, BOOK_ID);
  },

  /**
   * Stores a text selection as two locators.
   *
   * The selected text itself is deliberately not stored - the offsets are enough
   * to find the passage again when the page is re-rendered.
   */
  async addFromSelection(
    selection: SelectionRange,
    color = 'yellow',
  ): Promise<HighlightRow> {
    const startLocator: Locator = {
      type: 'PDF',
      page: selection.page,
      offset: selection.startOffset,
    };
    const endLocator: Locator = {
      type: 'PDF',
      page: selection.page,
      offset: selection.endOffset,
    };
    return this.add(startLocator, endLocator, color);
  },

  /**
   * Stores an EPUB selection, which is anchored by CFI rather than by page offsets.
   *
   * There was no EPUB path here at all before: `addFromSelection` only ever emitted PDF
   * locators, so a reflowable book could not record a highlight even though the contract has
   * always described one.
   */
  addFromCfi(startCfi: string, endCfi: string, color = 'yellow'): Promise<HighlightRow> {
    return this.add({ type: 'EPUB', cfi: startCfi }, { type: 'EPUB', cfi: endCfi }, color);
  },

  /** Stores a highlight from two already-built locators of either format. */
  async add(
    startLocator: Locator,
    endLocator: Locator,
    color = 'yellow',
  ): Promise<HighlightRow> {
    const now = nowIso();
    const row: HighlightRow = {
      id: newId(),
      user_id: USER_ID,
      book_id: BOOK_ID,
      start_locator: JSON.stringify(startLocator),
      end_locator: JSON.stringify(endLocator),
      color,
      created_at: now,
      updated_at: now,
      is_deleted: 0,
      synced: 0,
    };
    return highlightTable.saveLocal(row, 'CREATE');
  },

  remove(id: string): Promise<void> {
    return highlightTable.softDeleteLocal(id);
  },
};

/**
 * Shape a viewer needs to paint highlights back onto the content.
 *
 * A discriminated union, not a PDF-only shape. The previous version was PDF-only and dropped
 * anything else with a bare `continue`, so an EPUB highlight was stored and synced correctly
 * and then simply never rendered - no error, no log, nothing to notice.
 */
export type HighlightPaint =
  | {
      format: 'PDF';
      id: string;
      page: number;
      startOffset: number;
      endOffset: number;
      color: string;
    }
  | { format: 'EPUB'; id: string; startCfi: string; endCfi: string; color: string };

/**
 * Converts stored rows into paintable highlights.
 *
 * Rows whose locators are corrupt, or whose two ends disagree on format, are skipped and
 * returned separately rather than silently swallowed - a highlight that cannot be drawn is a
 * bug worth surfacing, not a no-op.
 */
export function toPaintable(rows: HighlightRow[]): {
  paintable: HighlightPaint[];
  skipped: HighlightRow[];
} {
  const paintable: HighlightPaint[] = [];
  const skipped: HighlightRow[] = [];

  for (const row of rows) {
    const start = parseLocator(row.start_locator);
    const end = parseLocator(row.end_locator);
    const color = row.color ?? 'yellow';

    if (!start || !end || start.type !== end.type) {
      skipped.push(row);
      continue;
    }

    if (start.type === 'PDF' && end.type === 'PDF') {
      paintable.push({
        format: 'PDF',
        id: row.id,
        page: start.page,
        startOffset: start.offset ?? 0,
        endOffset: end.offset ?? 0,
        color,
      });
    } else if (start.type === 'EPUB' && end.type === 'EPUB') {
      paintable.push({
        format: 'EPUB',
        id: row.id,
        startCfi: start.cfi,
        endCfi: end.cfi,
        color,
      });
    } else {
      skipped.push(row);
    }
  }

  return { paintable, skipped };
}
