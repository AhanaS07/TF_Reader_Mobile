import { DEFAULT_ACCESSIBILITY_PREFS } from '@/shared/contracts';
import { getDatabase, nowIso, toInt } from '../localDb/database';
import { accessibilityMapper } from '../localDb/mappers';
import type { AccessibilityRow } from '../localDb/types';
import { USER_ID } from '../syncConfig';
import { parseFieldTimestamps, stampChangedFields, stringifyFieldTimestamps } from './fieldTimestamps';
import { createSyncableTable, withWriteLock } from './syncableTable';

/** Every column `update()` can independently change - see the identical note on personalizationStore.ts. */
export const ACCESSIBILITY_MERGE_FIELDS = [
  'dyslexia_font',
  'respect_os_font_scale',
  'bold_text',
  'reduce_motion',
  'tts_enabled',
  'tts_voice_id',
  'tts_rate',
  'tts_pitch',
  'tts_highlight_mode',
  'tts_auto_continue_chapter',
  'tts_background_playback',
  'font_scale_multiplier',
  'readable_spacing',
  'high_contrast',
  'large_touch_targets',
  'large_audio_controls',
  'announce_page_changes',
  'announce_chapter_changes',
  'screen_reader_hints',
] as const;

export const accessibilityTable = createSyncableTable<AccessibilityRow>({
  table: 'accessibility',
  entityType: 'accessibility',
  toServer: accessibilityMapper.toServer,
  toRow: accessibilityMapper.toRow,
  mergeFields: ACCESSIBILITY_MERGE_FIELDS,
});

/**
 * Deterministic id for the per-user a11y singleton - same reasoning as
 * `personalizationId`: a device-minted UUID lets two devices create two server documents for
 * a record the contract defines as one-per-user, and neither side ever sees a conflict.
 */
export const accessibilityId = (userId: string) => `a11y-${userId}`;

/**
 * Every value is taken from DEFAULT_ACCESSIBILITY_PREFS rather than restated, so the table can
 * no longer drift from the frozen contract the way `screenReaderHints` did - it was the one
 * field of the contract's nineteen with no column here, so it could neither persist nor sync.
 */
const defaults = (): AccessibilityRow => ({
  id: accessibilityId(USER_ID),
  user_id: USER_ID,
  dyslexia_font: toInt(DEFAULT_ACCESSIBILITY_PREFS.text.dyslexiaFont),
  respect_os_font_scale: toInt(DEFAULT_ACCESSIBILITY_PREFS.text.respectOsFontScale),
  font_scale_multiplier: DEFAULT_ACCESSIBILITY_PREFS.text.fontScaleMultiplier,
  readable_spacing: toInt(DEFAULT_ACCESSIBILITY_PREFS.text.readableSpacing),
  bold_text: toInt(DEFAULT_ACCESSIBILITY_PREFS.display.boldText),
  high_contrast: toInt(DEFAULT_ACCESSIBILITY_PREFS.display.highContrast),
  reduce_motion: DEFAULT_ACCESSIBILITY_PREFS.display.reduceMotion,
  large_touch_targets: toInt(DEFAULT_ACCESSIBILITY_PREFS.display.largeTouchTargets),
  large_audio_controls: toInt(DEFAULT_ACCESSIBILITY_PREFS.display.largeAudioControls),
  tts_enabled: toInt(DEFAULT_ACCESSIBILITY_PREFS.tts.enabled),
  tts_voice_id: DEFAULT_ACCESSIBILITY_PREFS.tts.voiceId,
  tts_rate: DEFAULT_ACCESSIBILITY_PREFS.tts.rate,
  tts_pitch: DEFAULT_ACCESSIBILITY_PREFS.tts.pitch,
  tts_highlight_mode: DEFAULT_ACCESSIBILITY_PREFS.tts.highlightMode,
  tts_auto_continue_chapter: toInt(DEFAULT_ACCESSIBILITY_PREFS.tts.autoContinueChapter),
  tts_background_playback: toInt(DEFAULT_ACCESSIBILITY_PREFS.tts.backgroundPlayback),
  announce_page_changes: toInt(DEFAULT_ACCESSIBILITY_PREFS.announce.pageChanges),
  announce_chapter_changes: toInt(DEFAULT_ACCESSIBILITY_PREFS.announce.chapterChanges),
  screen_reader_hints: toInt(DEFAULT_ACCESSIBILITY_PREFS.screenReaderHints),
  updated_at: nowIso(),
  is_deleted: 0,
  synced: 0,
  field_updated_at: '{}',
});

/** Accessibility is user scoped only - there is no book_id on this table. */
export const accessibilityStore = {
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
      const now = nowIso();
      const row: AccessibilityRow = {
        ...base,
        ...patch,
        id: base.id,
        user_id: USER_ID,
        updated_at: now,
        is_deleted: 0,
        synced: 0,
        field_updated_at: stringifyFieldTimestamps(
          stampChangedFields(parseFieldTimestamps(base.field_updated_at), patch, ACCESSIBILITY_MERGE_FIELDS, now),
        ),
      };
      return accessibilityTable.saveLocal(row, existing ? 'UPDATE' : 'CREATE', {
        locked: true,
      });
    });
  },
};
