// End-to-end (SQLite layer) proof that the PREFS WRITE PATH drives Karthik's field-level merge
// (sync commit d8fcb67) correctly. The merge only works if `update()` is called with just the
// changed field — his own test pins `update({theme})` -> stamps ['theme']. But the live path is
// prefsStore.savePrefs -> sharedPrefs.writeSharedPrefs -> personalizationStore.update, and before
// the 2026-08-24 granular-diff fix that path wrote the WHOLE row every save, stamping all ten
// fields and collapsing per-field merge back to whole-row LWW. These cases fail on the old path and
// pass on the fixed one, so they double as the regression guard for that fix.
//
// Runs against the real SQLite layer (expo-sqlite mock) — no backend. The real-Mongo twin is
// prefsFieldMerge.integration.test.ts.

import { getDatabase } from '@/features/sync/localDb/database';
import { parseFieldTimestamps } from '@/features/sync/stores/fieldTimestamps';
import { accessibilityStore } from '@/features/sync/stores/accessibilityStore';
import {
  personalizationId,
  personalizationStore,
  personalizationTable,
} from '@/features/sync/stores/personalizationStore';
import { USER_ID } from '@/features/sync/syncConfig';

import { prefsStore } from './prefsStore';

async function reset(): Promise<void> {
  const db = await getDatabase();
  await db.execAsync(`DELETE FROM personalization; DELETE FROM accessibility; DELETE FROM outbox;`);
}

beforeEach(reset);

/** A server-shaped personalization record (camelCase), as `toRow` expects off the wire. */
function serverRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: personalizationId(USER_ID),
    userId: USER_ID,
    theme: 'light',
    fontFamily: 'system',
    customFontUri: null,
    typographySize: 16,
    typographyLineHeight: 1.5,
    typographySpacing: 0,
    typographyMargins: 16,
    layoutFlow: 'paginated',
    layoutSpread: 'single',
    zoom: 1,
    updatedAt: '2026-08-20T08:00:00.000Z',
    isDeleted: false,
    fieldUpdatedAt: {}, // keys are LOCAL snake_case column names; toServer/toRow pass it opaquely
    ...overrides,
  };
}

async function outboxCount(): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM outbox`);
  return row?.n ?? 0;
}

it('savePrefs stamps ONLY the field it changed, not the whole row', async () => {
  // A row already exists (as if pulled once) with no per-field stamps yet.
  await personalizationTable.applyServerRecord(serverRecord());

  await prefsStore.savePrefs({ theme: 'dark' });

  const row = await personalizationStore.current();
  expect(row?.theme).toBe('dark');
  // The fix: exactly one field stamped. On the old whole-row write this was all ten.
  expect(Object.keys(parseFieldTimestamps(row?.field_updated_at))).toEqual(['theme']);
});

it('a local theme edit and a remote font edit both survive a merge', async () => {
  // Baseline pulled at T0, no per-field stamps.
  await personalizationTable.applyServerRecord(serverRecord());

  // This device changes theme only.
  await prefsStore.savePrefs({ theme: 'dark' });

  // A pull brings back a record where ANOTHER device changed fontFamily only (theme still old),
  // stamped far in the future so it unambiguously wins its own field.
  await personalizationTable.applyServerRecord(
    serverRecord({
      fontFamily: 'Merriweather',
      fieldUpdatedAt: { font_family: '2099-01-01T00:00:00.000Z' },
      updatedAt: '2099-01-01T00:00:00.000Z',
    }),
  );

  const row = await personalizationStore.current();
  expect(row?.theme).toBe('dark'); // local edit kept — not clobbered by the newer remote row
  expect(row?.font_family).toBe('Merriweather'); // remote edit to a different field adopted
});

it('re-saving the same value is a no-op — no extra outbox op, no re-stamp', async () => {
  await personalizationTable.applyServerRecord(serverRecord());
  await prefsStore.savePrefs({ theme: 'dark' });

  const afterFirst = await personalizationStore.current();
  const outboxAfterFirst = await outboxCount();

  await prefsStore.savePrefs({ theme: 'dark' }); // identical value

  const afterSecond = await personalizationStore.current();
  expect(await outboxCount()).toBe(outboxAfterFirst); // nothing new to push
  expect(afterSecond?.updated_at).toBe(afterFirst?.updated_at); // no needless bump
  expect(afterSecond?.field_updated_at).toBe(afterFirst?.field_updated_at);
});

it('an accessibility-only edit does not stamp any personalization field', async () => {
  await personalizationTable.applyServerRecord(serverRecord());

  const current = await prefsStore.getPrefs();
  await prefsStore.savePrefs({
    accessibility: {
      ...current.accessibility,
      display: { ...current.accessibility.display, reduceMotion: 'on' },
    },
  });

  const row = await personalizationStore.current();
  // Personalization row untouched: no field stamped, so a concurrent theme edit elsewhere is safe.
  expect(Object.keys(parseFieldTimestamps(row?.field_updated_at))).toEqual([]);
});

it('a personalization-only edit does not touch the accessibility row', async () => {
  await personalizationTable.applyServerRecord(serverRecord());
  // Seed an accessibility row with a non-default value, so a spurious touch would be visible.
  await accessibilityStore.update({ screen_reader_hints: 1 });
  const before = await accessibilityStore.current();

  await prefsStore.savePrefs({ theme: 'dark' });

  const after = await accessibilityStore.current();
  expect(after?.updated_at).toBe(before?.updated_at);
  expect(after?.field_updated_at).toBe(before?.field_updated_at);
  expect(after?.screen_reader_hints).toBe(1);
});
