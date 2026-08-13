import { DEFAULT_PREFS } from '@/shared/contracts';
import { getDatabase, nowIso } from '../localDb/database';
import { personalizationMapper } from '../localDb/mappers';
import type { PersonalizationRow } from '../localDb/types';
import { USER_ID } from '../syncConfig';
import { createSyncableTable, withWriteLock } from './syncableTable';

export const personalizationTable = createSyncableTable<PersonalizationRow>({
  table: 'personalization',
  entityType: 'personalization',
  toServer: personalizationMapper.toServer,
  toRow: personalizationMapper.toRow,
});

/**
 * Deterministic id for the per-user prefs singleton.
 *
 * A device-minted UUID is wrong for a record the contract defines as one-per-user: two devices
 * writing prefs before either has synced mint two different ids, so the server ends up holding
 * two documents and the pull inserts both locally - no id collision, so no conflict is ever
 * detected. `current()`'s ORDER BY updated_at DESC LIMIT 1 then hides the loser rather than
 * resolving it, and it can resurface the moment the winner is edited. Deriving the id from the
 * user makes the two devices collide on purpose, which is what lets LWW do its job.
 */
export const personalizationId = (userId: string) => `prefs-${userId}`;

/**
 * Typography units are POINTS, matching DEFAULT_PREFS in the frozen contract - not the scale
 * factors this table used to default to. The two readings were both committed, and the scale
 * factors were the ones reaching Reader: Vaishnavi's adapter passes the value straight through,
 * so a defaulted row handed Reader `typography.size = 1.0` and rendered 1pt text.
 */
const defaults = (): PersonalizationRow => ({
  id: personalizationId(USER_ID),
  user_id: USER_ID,
  theme: DEFAULT_PREFS.theme,
  font_family: DEFAULT_PREFS.font.family,
  custom_font_uri: null,
  typography_size: DEFAULT_PREFS.typography.size,
  typography_line_height: DEFAULT_PREFS.typography.lineHeight,
  typography_spacing: DEFAULT_PREFS.typography.spacing,
  typography_margins: DEFAULT_PREFS.typography.margins,
  layout_flow: DEFAULT_PREFS.layout.flow,
  layout_spread: DEFAULT_PREFS.layout.spread,
  zoom: DEFAULT_PREFS.zoom.level,
  updated_at: nowIso(),
  is_deleted: 0,
  synced: 0,
});

/** Personalization is user scoped - one preference set applies to every book. */
export const personalizationStore = {
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

  /**
   * Runs under `withWriteLock`: without it, two overlapping calls (e.g. two settings toggled
   * in quick succession) would each see "no row yet" and each create their own, silently
   * duplicating the one-preference-set-per-user invariant this store documents above.
   */
  async update(patch: Partial<PersonalizationRow>): Promise<PersonalizationRow> {
    return withWriteLock(async () => {
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
      return personalizationTable.saveLocal(row, existing ? 'UPDATE' : 'CREATE', {
        locked: true,
      });
    });
  },
};
