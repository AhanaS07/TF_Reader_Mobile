// Field-level merge for personalization (B6-adjacent work, not B6 itself): personalization is a
// one-row-per-user singleton with many independently editable fields (theme, font, typography,
// layout, zoom), so whole-row Last-Write-Wins loses a genuinely non-conflicting concurrent edit -
// device A's theme change and device B's font-size change should both survive, not have whichever
// device syncs later wipe out the other's field. accessibilityStore is the identical mechanism on
// a different table and is not re-tested field-by-field here; syncableTable.ts's mergeFieldLevel
// is shared by both.

import { getDatabase } from '../localDb/database';
import type { PersonalizationRow } from '../localDb/types';
import { parseFieldTimestamps } from './fieldTimestamps';
import { personalizationId, personalizationStore, personalizationTable } from './personalizationStore';

const USER = 'user-001';

async function resetTable(): Promise<void> {
  const db = await getDatabase();
  await db.execAsync(`DELETE FROM personalization; DELETE FROM outbox;`);
}

beforeEach(resetTable);

/** A server-shaped record (camelCase), the same shape `toRow` expects off the wire. */
function serverRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: personalizationId(USER),
    userId: USER,
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
    updatedAt: '2026-08-20T09:00:00.000Z',
    isDeleted: false,
    fieldUpdatedAt: {},
    ...overrides,
  };
}

async function currentRow(): Promise<PersonalizationRow | null> {
  return personalizationStore.current();
}

describe('different-field merge', () => {
  it('keeps a local edit to one field AND adopts a remote edit to a different field', async () => {
    // Seed a row as if pulled once already, at T0.
    await personalizationTable.applyServerRecord(
      serverRecord({ updatedAt: '2026-08-20T08:00:00.000Z' }),
    );

    // Local device edits theme only, at T1 (after T0).
    await personalizationStore.update({ theme: 'dark' });

    // Remote pull brings back a record where SOMEONE ELSE changed fontFamily only, at T2 (after
    // T1) - theme in this incoming record is still the OLD value, from before the local edit.
    const applied = await personalizationTable.applyServerRecord(
      serverRecord({
        theme: 'light', // stale relative to the local edit
        fontFamily: 'serif', // genuinely newer than anything local has for this field
        updatedAt: '2026-08-20T10:00:00.000Z',
        // field_updated_at's map keys are the LOCAL row's snake_case column names, not the
        // wire's camelCase field names - toServer/toRow pass the map through opaquely.
        fieldUpdatedAt: { font_family: '2026-08-20T10:00:00.000Z' },
      }),
    );

    expect(applied).toBe(true);
    const row = await currentRow();
    expect(row?.theme).toBe('dark'); // local edit survived
    expect(row?.font_family).toBe('serif'); // remote edit landed
  });
});

describe('same-field Last-Write-Wins', () => {
  it('remote wins when its field timestamp is newer', async () => {
    await personalizationTable.applyServerRecord(
      serverRecord({ updatedAt: '2026-08-20T08:00:00.000Z' }),
    );
    await personalizationStore.update({ theme: 'dark' }); // local edit at "now"

    const applied = await personalizationTable.applyServerRecord(
      serverRecord({
        theme: 'system',
        // Deliberately far in the future, so it is newer than the local edit regardless of
        // exactly when this test runs (2026-08-25 stopped being "the future" on 2026-08-25).
        updatedAt: '2099-08-25T00:00:00.000Z',
        fieldUpdatedAt: { theme: '2099-08-25T00:00:00.000Z' },
      }),
    );

    expect(applied).toBe(true);
    expect((await currentRow())?.theme).toBe('system');
  });

  it('local wins, and the remote write is discarded, when the local field timestamp is newer', async () => {
    await personalizationTable.applyServerRecord(
      serverRecord({ updatedAt: '2026-08-20T08:00:00.000Z' }),
    );
    await personalizationStore.update({ theme: 'dark' }); // local edit at "now"

    const applied = await personalizationTable.applyServerRecord(
      serverRecord({
        theme: 'system',
        updatedAt: '2026-08-01T00:00:00.000Z', // in the past relative to the local edit
        fieldUpdatedAt: { theme: '2026-08-01T00:00:00.000Z' },
      }),
    );

    // Nothing actually changed - the incoming theme lost, and nothing else in the record was
    // newer either, so this pull is a pure no-op.
    expect(applied).toBe(false);
    expect((await currentRow())?.theme).toBe('dark');
  });
});

describe('stale updates', () => {
  it('a fully stale record changes nothing and reports not-applied', async () => {
    await personalizationTable.applyServerRecord(
      serverRecord({ updatedAt: '2026-08-20T08:00:00.000Z' }),
    );
    await personalizationStore.update({ theme: 'dark', zoom: 2 });

    const staleApplied = await personalizationTable.applyServerRecord(
      serverRecord({
        theme: 'system',
        zoom: 3,
        updatedAt: '2026-08-01T00:00:00.000Z',
        fieldUpdatedAt: { theme: '2026-08-01T00:00:00.000Z', zoom: '2026-08-01T00:00:00.000Z' },
      }),
    );

    expect(staleApplied).toBe(false);
    const row = await currentRow();
    expect(row?.theme).toBe('dark');
    expect(row?.zoom).toBe(2);
  });

  it('a partially stale record only updates the field that is actually newer', async () => {
    await personalizationTable.applyServerRecord(
      serverRecord({ updatedAt: '2026-08-20T08:00:00.000Z' }),
    );
    await personalizationStore.update({ theme: 'dark', zoom: 2 });

    const applied = await personalizationTable.applyServerRecord(
      serverRecord({
        theme: 'system', // stale - must be rejected
        zoom: 5, // genuinely newer - must land
        // 2099, not 2026: this needs to be genuinely newer than the local edit regardless of
        // exactly when this test runs, and 2026-08-25 stopped being "the future" on 2026-08-25.
        updatedAt: '2099-08-25T00:00:00.000Z',
        fieldUpdatedAt: {
          theme: '2026-08-01T00:00:00.000Z',
          zoom: '2099-08-25T00:00:00.000Z',
        },
      }),
    );

    expect(applied).toBe(true);
    const row = await currentRow();
    expect(row?.theme).toBe('dark'); // stale field rejected
    expect(row?.zoom).toBe(5); // newer field applied
  });
});

describe('migration compatibility', () => {
  it('a pre-migration row (empty field_updated_at) falls back to whole-row updated_at per field', async () => {
    // Simulates a row written by the app before this feature existed: `field_updated_at`
    // defaults to '{}' (the migration's own default), so every field must behave exactly like
    // whole-row LWW until something starts recording per-field times again.
    const db = await getDatabase();
    await db.runAsync(
      `INSERT INTO personalization
         (id, user_id, theme, font_family, custom_font_uri, typography_size,
          typography_line_height, typography_spacing, typography_margins, layout_flow,
          layout_spread, zoom, updated_at, is_deleted, synced, field_updated_at)
       VALUES (?, ?, 'light', 'system', NULL, 16, 1.5, 0, 16, 'paginated', 'single', 1, ?, 0, 1, '{}')`,
      [personalizationId(USER), USER, '2026-08-20T08:00:00.000Z'],
    );

    // Older than the row's updated_at - must be rejected, same as whole-row LWW would.
    const staleApplied = await personalizationTable.applyServerRecord(
      serverRecord({ theme: 'dark', updatedAt: '2026-08-19T00:00:00.000Z' }),
    );
    expect(staleApplied).toBe(false);

    // Newer than the row's updated_at - must be accepted, same as whole-row LWW would.
    const newerApplied = await personalizationTable.applyServerRecord(
      serverRecord({ theme: 'dark', updatedAt: '2026-08-21T00:00:00.000Z' }),
    );
    expect(newerApplied).toBe(true);
    expect((await currentRow())?.theme).toBe('dark');
  });

  it('update() only ever stamps the fields it actually touches', async () => {
    const first = await personalizationStore.update({ theme: 'dark' });
    expect(Object.keys(parseFieldTimestamps(first.field_updated_at))).toEqual(['theme']);

    const second = await personalizationStore.update({ zoom: 2 });
    expect(Object.keys(parseFieldTimestamps(second.field_updated_at)).sort()).toEqual([
      'theme',
      'zoom',
    ]);
  });
});
