import { getDatabase, newId, nowIso } from '../db/database';
import { personalizationMapper } from '../db/mappers';
import type { PersonalizationRow } from '../db/types';
import { USER_ID } from '../config';
import { createSyncableTable } from './syncableTable';

export const personalizationTable = createSyncableTable<PersonalizationRow>({
  table: 'personalization',
  entityType: 'personalization',
  toServer: personalizationMapper.toServer,
  toRow: personalizationMapper.toRow,
});

const defaults = (): PersonalizationRow => ({
  id: newId(),
  user_id: USER_ID,
  theme: 'system',
  font_family: 'system',
  custom_font_uri: null,
  typography_size: 1.0,
  typography_line_height: 1.0,
  typography_spacing: 0.0,
  typography_margins: 0.0,
  layout_flow: 'paginated',
  layout_spread: 'single',
  zoom: 1.0,
  updated_at: nowIso(),
  is_deleted: 0,
  synced: 0,
});

/** Personalization is user scoped - one preference set applies to every book. */
export const personalizationRepository = {
  ...personalizationTable,

  async current(): Promise<PersonalizationRow | null> {
    const db = await getDatabase();
    return db.getFirstAsync<PersonalizationRow>(
      `SELECT * FROM personalization
        WHERE user_id = ? AND is_deleted = 0
        ORDER BY updated_at DESC
        LIMIT 1`,
      [USER_ID],
    );
  },

  async update(patch: Partial<PersonalizationRow>): Promise<PersonalizationRow> {
    const existing = await this.current();
    const base = existing ?? defaults();
    const row: PersonalizationRow = {
      ...base,
      ...patch,
      id: base.id,
      user_id: USER_ID,
      updated_at: nowIso(),
      is_deleted: 0,
      synced: 0,
    };
    return personalizationTable.saveLocal(row, existing ? 'UPDATE' : 'CREATE');
  },
};
