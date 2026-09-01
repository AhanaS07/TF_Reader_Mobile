import { DEFAULT_PREFS } from '@/shared/contracts';
import { getDatabase, nowIso } from '../localDb/database';
import { personalizationMapper } from '../localDb/mappers';
import type { PersonalizationRow } from '../localDb/types';
import { USER_ID } from '../syncConfig';
import { parseFieldTimestamps, stampChangedFields, stringifyFieldTimestamps } from './fieldTimestamps';
import { createSyncableTable, withWriteLock } from './syncableTable';

/**
 * Every column `update()` can independently change - the merge unit is one field, not the
 * whole row. Meta columns (id, user_id, updated_at, is_deleted, synced, server_updated_at,
 * field_updated_at) are deliberately excluded: they are bookkeeping, not user-editable content,
 * and giving them their own merge timestamp would conflate a metadata write with a content edit.
 */
export const PERSONALIZATION_MERGE_FIELDS = [
  'theme',
  'font_family',
  'custom_font_uri',
  'typography_size',
  'typography_line_height',
  'typography_spacing',
  'typography_margins',
  'layout_flow',
  'layout_spread',
  'zoom',
] as const;

export const personalizationTable = createSyncableTable<PersonalizationRow>({
  table: 'personalization',
  entityType: 'personalization',
  toServer: personalizationMapper.toServer,
  toRow: personalizationMapper.toRow,
  mergeFields: PERSONALIZATION_MERGE_FIELDS,
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
 * Every default is taken from DEFAULT_PREFS rather than restated, so this table cannot drift
 * from the contract again. `lineHeight` (1.5) and `margins` (16) are settled per review; the
 * table previously defaulted both to scale factors (1.0 / 0.0), and since the prefs adapter
 * passes values through untouched, a defaulted row handed Reader 1pt text.
 *
 * PROVISIONAL - `typography_size`. The pt-vs-scale-factor question is prefs.ts STILL-OPEN #4
 * and is not Sync's to close. Review asked to "leave size for now", but a column needs some
 * default, so 1.0 and 16 are equally a choice - there is no neutral value. It follows
 * DEFAULT_PREFS (16) because that is the only value committed anywhere that does not render
 * 1pt text, and because deriving it here means the decision changes in exactly one place: if
 * #4 lands on scale factors, DEFAULT_PREFS moves and this follows automatically.
 */
const defaults = (): PersonalizationRow => ({
  id: personalizationId(USER_ID),
  user_id: USER_ID,
  theme: DEFAULT_PREFS.theme,
  font_family: DEFAULT_PREFS.font.family,
  custom_font_uri: null,
  // See PROVISIONAL note above - tracks DEFAULT_PREFS, does not decide the units.
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
  field_updated_at: '{}',
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
      const now = nowIso();
      const row: PersonalizationRow = {
        ...base,
        ...patch,
        id: base.id,
        user_id: USER_ID,
        updated_at: now,
        is_deleted: 0,
        synced: 0,
        // Stamps only the fields this patch actually touches, so the next merge can tell
        // "I changed theme just now" from "I haven't touched theme since the last sync" -
        // a single whole-row updated_at cannot make that distinction.
        field_updated_at: stringifyFieldTimestamps(
          stampChangedFields(parseFieldTimestamps(base.field_updated_at), patch, PERSONALIZATION_MERGE_FIELDS, now),
        ),
      };
      return personalizationTable.saveLocal(row, existing ? 'UPDATE' : 'CREATE', {
        locked: true,
      });
    });
  },
};
