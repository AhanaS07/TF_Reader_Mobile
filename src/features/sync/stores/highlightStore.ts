import { newId, nowIso } from '../localDb/database';
import { highlightMapper } from '../localDb/mappers';
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
      type: 'pdf',
      page: selection.page,
      offset: selection.startOffset,
    };
    const endLocator: Locator = {
      type: 'pdf',
      page: selection.page,
      offset: selection.endOffset,
    };
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

/** Shape the PDF viewer needs to paint highlights back onto the page. */
export interface HighlightPaint {
  id: string;
  page: number;
  startOffset: number;
  endOffset: number;
  color: string;
}

export function toPaintable(rows: HighlightRow[]): HighlightPaint[] {
  const paintable: HighlightPaint[] = [];
  for (const row of rows) {
    try {
      const start = JSON.parse(row.start_locator) as Locator;
      const end = JSON.parse(row.end_locator) as Locator;
      if (start.type !== 'pdf' || end.type !== 'pdf') continue;
      paintable.push({
        id: row.id,
        page: start.page,
        startOffset: start.offset ?? 0,
        endOffset: end.offset ?? 0,
        color: row.color ?? 'yellow',
      });
    } catch {
      // A corrupt locator should not stop the rest of the page rendering.
    }
  }
  return paintable;
}
