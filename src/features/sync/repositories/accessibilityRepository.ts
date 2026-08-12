import { getDatabase, newId, nowIso } from '../db/database';
import { accessibilityMapper } from '../db/mappers';
import type { AccessibilityRow } from '../db/types';
import { USER_ID } from '../config';
import { createSyncableTable, withWriteLock } from './syncableTable';

export const accessibilityTable = createSyncableTable<AccessibilityRow>({
  table: 'accessibility',
  entityType: 'accessibility',
  toServer: accessibilityMapper.toServer,
  toRow: accessibilityMapper.toRow,
});

const defaults = (): AccessibilityRow => ({
  id: newId(),
  user_id: USER_ID,
  dyslexia_font: 0,
  respect_os_font_scale: 1,
  bold_text: 0,
  reduce_motion: 'system',
  tts_enabled: 0,
  tts_voice_id: null,
  tts_rate: 1.0,
  tts_pitch: 1.0,
  tts_highlight_mode: 'sentence',
  tts_auto_continue_chapter: 1,
  tts_background_playback: 0,
  font_scale_multiplier: 1.0,
  readable_spacing: 0,
  high_contrast: 0,
  large_touch_targets: 0,
  large_audio_controls: 0,
  announce_page_changes: 1,
  announce_chapter_changes: 1,
  updated_at: nowIso(),
  is_deleted: 0,
  synced: 0,
});

/** Accessibility is user scoped only - there is no book_id on this table. */
export const accessibilityRepository = {
  ...accessibilityTable,

  async current(): Promise<AccessibilityRow | null> {
    const db = await getDatabase();
    return db.getFirstAsync<AccessibilityRow>(
      `SELECT * FROM accessibility
        WHERE user_id = ? AND is_deleted = 0
        ORDER BY updated_at DESC
        LIMIT 1`,
      [USER_ID],
    );
  },

  /**
   * Runs under `withWriteLock`: without it, two overlapping calls would each see "no row yet"
   * and each create their own, silently duplicating the one-row-per-user invariant.
   */
  async update(patch: Partial<AccessibilityRow>): Promise<AccessibilityRow> {
    return withWriteLock(async () => {
      const existing = await this.current();
      const base = existing ?? defaults();
      const row: AccessibilityRow = {
        ...base,
        ...patch,
        id: base.id,
        user_id: USER_ID,
        updated_at: nowIso(),
        is_deleted: 0,
        synced: 0,
      };
      return accessibilityTable.saveLocal(row, existing ? 'UPDATE' : 'CREATE', {
        locked: true,
      });
    });
  },
};
