// Field-level merge for accessibility - the identical mechanism as
// personalizationStore.fieldMerge.test.ts, on a different table (19 fields instead of 10).
// syncableTable.ts's mergeFieldLevel is shared by both; this file exists so accessibility's own
// wiring (ACCESSIBILITY_MERGE_FIELDS, accessibilityStore.update()) is verified directly rather
// than only by extension from personalization's coverage.

import { getDatabase } from '../localDb/database';
import type { AccessibilityRow } from '../localDb/types';
import { parseFieldTimestamps } from './fieldTimestamps';
import { accessibilityId, accessibilityStore, accessibilityTable } from './accessibilityStore';

const USER = 'user-001';
const SERVER_TIME = '2026-08-20T10:00:00.000Z';

function serverRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: accessibilityId(USER),
    userId: USER,
    dyslexiaFont: false,
    respectOsFontScale: true,
    boldText: false,
    reduceMotion: 'system',
    ttsEnabled: false,
    ttsVoiceId: null,
    ttsRate: 1.0,
    ttsPitch: 1.0,
    ttsHighlightMode: 'sentence',
    ttsAutoContinueChapter: true,
    ttsBackgroundPlayback: false,
    fontScaleMultiplier: 1.0,
    readableSpacing: false,
    highContrast: false,
    largeTouchTargets: false,
    largeAudioControls: false,
    announcePageChanges: true,
    announceChapterChanges: true,
    screenReaderHints: false,
    updatedAt: SERVER_TIME,
    isDeleted: false,
    fieldUpdatedAt: {},
    ...overrides,
  };
}

async function currentRow(): Promise<AccessibilityRow | null> {
  return accessibilityStore.current();
}

beforeEach(async () => {
  const db = await getDatabase();
  await db.execAsync(`DELETE FROM accessibility; DELETE FROM outbox;`);
});

describe('different-field merge', () => {
  it('keeps a local edit to one field AND adopts a remote edit to a different field', async () => {
    await accessibilityTable.applyServerRecord(
      serverRecord({ updatedAt: '2026-08-20T08:00:00.000Z' }),
    );
    await accessibilityStore.update({ high_contrast: 1 });

    const applied = await accessibilityTable.applyServerRecord(
      serverRecord({
        highContrast: false, // stale relative to the local edit
        ttsRate: 1.5, // genuinely newer than anything local has for this field
        updatedAt: '2026-08-20T10:00:00.000Z',
        fieldUpdatedAt: { tts_rate: '2026-08-20T10:00:00.000Z' },
      }),
    );

    expect(applied).toBe(true);
    const row = await currentRow();
    expect(row?.high_contrast).toBe(1); // local edit survived
    expect(row?.tts_rate).toBe(1.5); // remote edit landed
  });
});

describe('same-field Last-Write-Wins', () => {
  it('remote wins when its field timestamp is newer', async () => {
    await accessibilityTable.applyServerRecord(
      serverRecord({ updatedAt: '2026-08-20T08:00:00.000Z' }),
    );
    await accessibilityStore.update({ tts_enabled: 1 });

    const applied = await accessibilityTable.applyServerRecord(
      serverRecord({
        ttsEnabled: false,
        updatedAt: '2026-08-25T00:00:00.000Z',
        fieldUpdatedAt: { tts_enabled: '2026-08-25T00:00:00.000Z' },
      }),
    );

    expect(applied).toBe(true);
    expect((await currentRow())?.tts_enabled).toBe(0);
  });

  it('local wins, and the remote write is discarded, when the local field timestamp is newer', async () => {
    await accessibilityTable.applyServerRecord(
      serverRecord({ updatedAt: '2026-08-20T08:00:00.000Z' }),
    );
    await accessibilityStore.update({ tts_enabled: 1 });

    const applied = await accessibilityTable.applyServerRecord(
      serverRecord({
        ttsEnabled: false,
        updatedAt: '2026-08-01T00:00:00.000Z', // in the past relative to the local edit
        fieldUpdatedAt: { tts_enabled: '2026-08-01T00:00:00.000Z' },
      }),
    );

    expect(applied).toBe(false);
    expect((await currentRow())?.tts_enabled).toBe(1);
  });
});

describe('migration compatibility', () => {
  it('update() only ever stamps the fields it actually touches', async () => {
    const first = await accessibilityStore.update({ high_contrast: 1 });
    expect(Object.keys(parseFieldTimestamps(first.field_updated_at))).toEqual(['high_contrast']);

    const second = await accessibilityStore.update({ tts_rate: 1.2 });
    expect(Object.keys(parseFieldTimestamps(second.field_updated_at)).sort()).toEqual([
      'high_contrast',
      'tts_rate',
    ]);
  });
});
