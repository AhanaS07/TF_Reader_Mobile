// Conformance against the frozen contracts in @/shared/contracts.
//
// Every case here is a drift review found, and each one was invisible to __typecheck__.ts
// because this feature used to declare its own parallel types instead of importing the frozen
// ones. The types now come from the contract, so most of these could not compile if they
// regressed - but the runtime behaviour they guard (a locator being dropped, a default being
// the wrong unit) is not something a type can catch.

import {
  DEFAULT_ACCESSIBILITY_PREFS,
  DEFAULT_PREFS,
  resolveReduceMotion,
} from '@/shared/contracts';
import type { Locator, SharedPrefs } from '@/shared/contracts';
import { getDatabase } from './localDb/database';
import { parseLocator } from './localDb/mappers';
import type { AccessibilityRow, HighlightRow, PersonalizationRow } from './localDb/types';
import { accessibilityStore } from './stores/accessibilityStore';
import { bookmarkStore } from './stores/bookmarkStore';
import { highlightStore, toPaintable } from './stores/highlightStore';
import { personalizationStore } from './stores/personalizationStore';
import { progressStore } from './stores/progressStore';
import { mergeSharedPrefs, readSharedPrefs, writeSharedPrefs } from './sharedPrefs';

const USER = 'user-001';
const BOOK = 'book-001';

function highlightRow(id: string, start: unknown, end: unknown): HighlightRow {
  return {
    id,
    user_id: USER,
    book_id: BOOK,
    start_locator: JSON.stringify(start),
    end_locator: JSON.stringify(end),
    color: 'yellow',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    is_deleted: 0,
    synced: 0,
  };
}

async function resetAll(): Promise<void> {
  const db = await getDatabase();
  await db.execAsync(
    `DELETE FROM outbox; DELETE FROM progress; DELETE FROM highlights;
     DELETE FROM bookmarks; DELETE FROM personalization; DELETE FROM accessibility;`,
  );
}

beforeEach(resetAll);

describe('Locator casing', () => {
  it('writes UPPERCASE discriminants, matching ContentFormat', async () => {
    const row = await highlightStore.addFromSelection({
      page: 4,
      startOffset: 10,
      endOffset: 20,
    });
    expect(JSON.parse(row.start_locator).type).toBe('PDF');
    expect(JSON.parse(row.end_locator).type).toBe('PDF');
  });

  it('bookmarks write UPPERCASE too', async () => {
    const row = await bookmarkStore.addForPage(7);
    expect(JSON.parse(row.locator).type).toBe('PDF');
  });

  it('reads rows written with the old lowercase casing rather than dropping them', async () => {
    // Rows already on disk carry 'pdf' / 'epub'. A strict UPPERCASE check would silently skip
    // every one of them - the same failure this replaces, pointed the other way.
    expect(parseLocator('{"type":"pdf","page":3,"offset":9}')).toEqual({
      type: 'PDF',
      page: 3,
      offset: 9,
    });
    expect(parseLocator('{"type":"epub","cfi":"epubcfi(/6/4)"}')).toEqual({
      type: 'EPUB',
      cfi: 'epubcfi(/6/4)',
    });
  });

  it('returns null for a corrupt or unknown locator instead of throwing', () => {
    expect(parseLocator('not json')).toBeNull();
    expect(parseLocator('{"type":"MOBI","page":1}')).toBeNull();
    expect(parseLocator('{"type":"PDF"}')).toBeNull();
    expect(parseLocator(null)).toBeNull();
  });
});

describe('EPUB highlights', () => {
  it('can be created at all - there was no EPUB path before', async () => {
    const row = await highlightStore.addFromCfi('epubcfi(/6/4!/4/2)', 'epubcfi(/6/4!/4/8)');
    expect(JSON.parse(row.start_locator)).toEqual({
      type: 'EPUB',
      cfi: 'epubcfi(/6/4!/4/2)',
    });
  });

  it('survives toPaintable instead of being silently dropped', () => {
    // THE BUG: toPaintable did `if (start.type !== 'pdf') continue`, so every contract-shaped
    // highlight - EPUB or PDF - vanished from rendering with no error.
    const { paintable, skipped } = toPaintable([
      highlightRow('h-epub', { type: 'EPUB', cfi: 'a' }, { type: 'EPUB', cfi: 'b' }),
    ]);

    expect(skipped).toHaveLength(0);
    expect(paintable).toEqual([
      { format: 'EPUB', id: 'h-epub', startCfi: 'a', endCfi: 'b', color: 'yellow' },
    ]);
  });

  it('paints PDF highlights alongside EPUB ones', () => {
    const { paintable } = toPaintable([
      highlightRow('h-pdf', { type: 'PDF', page: 2, offset: 1 }, { type: 'PDF', page: 2, offset: 5 }),
      highlightRow('h-epub', { type: 'EPUB', cfi: 'x' }, { type: 'EPUB', cfi: 'y' }),
    ]);
    expect(paintable.map((p) => p.format)).toEqual(['PDF', 'EPUB']);
  });

  it('paints legacy lowercase rows rather than discarding them', () => {
    const { paintable, skipped } = toPaintable([
      highlightRow('h-old', { type: 'pdf', page: 1, offset: 0 }, { type: 'pdf', page: 1, offset: 4 }),
    ]);
    expect(skipped).toHaveLength(0);
    expect(paintable[0]).toMatchObject({ format: 'PDF', page: 1 });
  });

  it('reports an unpaintable highlight instead of swallowing it', () => {
    const { paintable, skipped } = toPaintable([
      highlightRow('h-bad', { type: 'PDF', page: 1 }, { type: 'EPUB', cfi: 'z' }),
      highlightRow('h-corrupt', null, null),
    ]);
    expect(paintable).toHaveLength(0);
    expect(skipped.map((r) => r.id)).toEqual(['h-bad', 'h-corrupt']);
  });
});

describe('EPUB progress anchoring', () => {
  it('stores a CFI so a reflowable book can restore its position', async () => {
    // An integer offset cannot express a CFI: the same character sits at a different offset at
    // a different font size or viewport. progress.ts flagged this OPEN against Sync.
    const cfi: Locator = { type: 'EPUB', cfi: 'epubcfi(/6/14!/4/2/2)' };
    await progressStore.savePosition(cfi);

    expect(await progressStore.currentLocator()).toEqual(cfi);
  });

  it('still records the integer offset for a PDF, as the Day-1 freeze requires', async () => {
    await progressStore.savePosition({ type: 'PDF', page: 31 });

    const row = await progressStore.current();
    expect(row?.offset).toBe(31);
    expect(await progressStore.currentLocator()).toEqual({ type: 'PDF', page: 31 });
  });

  it('falls back to offset for rows written before the locator column existed', async () => {
    const db = await getDatabase();
    await db.runAsync(
      `INSERT INTO progress (id, user_id, book_id, "offset", locator, updated_at, is_deleted, synced)
       VALUES (?, ?, ?, ?, NULL, ?, 0, 1)`,
      ['legacy', USER, BOOK, 18, '2026-01-01T00:00:00.000Z'],
    );

    expect(await progressStore.currentLocator()).toEqual({ type: 'PDF', page: 18 });
  });

  it('writes offset 0 and keeps the real position in locator.positionMs for AUDIO', async () => {
    // offset is a required NOT NULL column with no meaning for AUDIO - the real position is
    // locator.positionMs (annotations.ts's own comment on the AUDIO variant). Pins the
    // `locator.type === 'AUDIO' ? 0 : ...` branch in progressStore.ts's savePosition().
    const audio: Locator = { type: 'AUDIO', positionMs: 872_000, trackId: 'ch-03' };
    await progressStore.savePosition(audio);

    const row = await progressStore.current();
    expect(row?.offset).toBe(0);
    expect(await progressStore.currentLocator()).toEqual(audio);
  });

  it('returns null for a corrupt (non-null) locator — does not mislabel it as PDF', async () => {
    // A non-null but unparseable locator means the row was written after the column existed but
    // something corrupted the JSON. We don't know the format, so null is safer than fabricating
    // a PDF page — callers treat null as "no saved position, start from beginning".
    // Previously this returned { type:'PDF', page:0 } (the offset fallback). Fixed in
    // progressStore.ts: the PDF fallback now only fires when locator IS null (legacy rows).
    const db = await getDatabase();
    await db.runAsync(
      `INSERT INTO progress (id, user_id, book_id, "offset", locator, updated_at, is_deleted, synced)
       VALUES (?, ?, ?, ?, ?, ?, 0, 1)`,
      ['corrupt-audio', USER, BOOK, 0, '{not valid json', '2026-01-01T00:00:00.000Z'],
    );

    expect(await progressStore.currentLocator()).toBeNull();
  });
});

describe('typography units', () => {
  it('defaults to POINTS, matching DEFAULT_PREFS, not scale factors', async () => {
    // The table defaulted to 1.0 / 1.0 / 0.0 while the contract said 16 / 1.5 / 16. The adapter
    // passes values through untouched, so Reader was handed size 1.0 and rendered 1pt text.
    const row = await personalizationStore.update({});

    expect(row.typography_size).toBe(DEFAULT_PREFS.typography.size);
    expect(row.typography_line_height).toBe(DEFAULT_PREFS.typography.lineHeight);
    expect(row.typography_margins).toBe(DEFAULT_PREFS.typography.margins);
    expect(row.typography_size).toBe(16);
  });

  it('a merged prefs object carries the contract defaults through to Reader', async () => {
    await personalizationStore.update({});
    const prefs = await readSharedPrefs();
    expect(prefs.typography).toEqual(DEFAULT_PREFS.typography);
  });
});

describe('screenReaderHints', () => {
  it('persists - it is the one contract field the table used to be missing', async () => {
    const row = await accessibilityStore.update({ screen_reader_hints: 1 });
    expect(row.screen_reader_hints).toBe(1);

    const prefs = await readSharedPrefs();
    expect(prefs.accessibility.screenReaderHints).toBe(true);
  });

  it('is included in the outbox payload, so it can sync', async () => {
    await accessibilityStore.update({ screen_reader_hints: 1 });

    const db = await getDatabase();
    const queued = await db.getFirstAsync<{ payload: string }>(
      `SELECT payload FROM outbox WHERE entity_type = 'accessibility'`,
    );
    expect(JSON.parse(queued!.payload).screenReaderHints).toBe(true);
  });

  it('defaults to the contract value', async () => {
    const prefs = await readSharedPrefs();
    expect(prefs.accessibility.screenReaderHints).toBe(
      DEFAULT_ACCESSIBILITY_PREFS.screenReaderHints,
    );
  });
});

describe('SharedPrefs merge', () => {
  it('assembles both tables into one contract-shaped record', async () => {
    await personalizationStore.update({ theme: 'dark', zoom: 1.25 });
    await accessibilityStore.update({ tts_enabled: 1, tts_rate: 1.75 });

    const prefs: SharedPrefs = await readSharedPrefs();

    expect(prefs.theme).toBe('dark');
    expect(prefs.zoom.level).toBe(1.25);
    expect(prefs.accessibility.tts.enabled).toBe(true);
    expect(prefs.accessibility.tts.rate).toBe(1.75);
    expect(typeof prefs.updatedAt).toBe('number');
    expect(prefs.userId).toBe(USER);
  });

  it('falls back to the frozen defaults when neither table has a row', async () => {
    const prefs = await readSharedPrefs();
    expect(prefs.theme).toBe(DEFAULT_PREFS.theme);
    expect(prefs.accessibility).toEqual(DEFAULT_ACCESSIBILITY_PREFS);
  });

  it('reports updatedAt as epoch-ms, per the contract Timestamp', async () => {
    await personalizationStore.update({ theme: 'sepia' });
    const prefs = await readSharedPrefs();
    // Sanity: a plausible ms epoch, not a stringified ISO or a seconds value.
    expect(prefs.updatedAt).toBeGreaterThan(1_600_000_000_000);
  });

  it('takes the later of the two rows, so the merge is only as fresh as its freshest half', () => {
    const personalization = {
      id: 'prefs-user-001',
      user_id: USER,
      theme: 'dark',
      font_family: 'system',
      custom_font_uri: null,
      typography_size: 16,
      typography_line_height: 1.5,
      typography_spacing: 0,
      typography_margins: 16,
      layout_flow: 'paginated',
      layout_spread: 'single',
      zoom: 1,
      updated_at: '2026-01-01T00:00:00.000Z',
      is_deleted: 0,
      synced: 1,
      field_updated_at: '{}',
    } satisfies PersonalizationRow;

    const merged = mergeSharedPrefs(personalization, {
      ...(accessibilityDefaultsRow()),
      updated_at: '2026-06-01T00:00:00.000Z',
    });

    expect(merged.updatedAt).toBe(Date.parse('2026-06-01T00:00:00.000Z'));
  });

  it('migrates the deprecated highContrast theme on read', async () => {
    // The contract deprecates theme 'highContrast' in favour of the a11y flag, which is the
    // single source of truth, and asks for a read-time migration. This merge is the read.
    await personalizationStore.update({ theme: 'highContrast' });

    const prefs = await readSharedPrefs();
    // Base theme under the boost must be 'light' (classic high contrast is dark-on-light;
    // ratified 2026-08-17). Asserting the exact value, not just "not highContrast", is the point:
    // the merge and Personalization's migratePrefs.ts had silently diverged (dark vs light)
    // precisely because this test never pinned the base. It must match HIGH_CONTRAST_BASE_THEME.
    expect(prefs.theme).toBe('light');
    expect(prefs.accessibility.display.highContrast).toBe(true);
  });

  it('validates loose TEXT columns rather than trusting them', async () => {
    const db = await getDatabase();
    await db.runAsync(
      `INSERT INTO personalization
         (id, user_id, theme, font_family, custom_font_uri, typography_size,
          typography_line_height, typography_spacing, typography_margins,
          layout_flow, layout_spread, zoom, updated_at, is_deleted, synced)
       VALUES (?, ?, 'neon', 'system', NULL, 16, 1.5, 0, 16, 'sideways', 'triple', 1, ?, 0, 1)`,
      ['prefs-user-001', USER, '2026-01-01T00:00:00.000Z'],
    );

    const prefs = await readSharedPrefs();
    expect(prefs.theme).toBe(DEFAULT_PREFS.theme);
    expect(prefs.layout.flow).toBe(DEFAULT_PREFS.layout.flow);
    expect(prefs.layout.spread).toBe(DEFAULT_PREFS.layout.spread);
  });

  it('resolves reduceMotion as a tri-state, not a boolean', async () => {
    await accessibilityStore.update({ reduce_motion: 'on' });
    const prefs = await readSharedPrefs();

    expect(prefs.accessibility.display.reduceMotion).toBe('on');
    expect(resolveReduceMotion(prefs.accessibility.display.reduceMotion, false)).toBe(true);
  });

  it('clamps an out-of-range TTS rate into the contract bounds', async () => {
    await accessibilityStore.update({ tts_rate: 99 });
    const prefs = await readSharedPrefs();
    expect(prefs.accessibility.tts.rate).toBeLessThanOrEqual(3.0);
  });
});

describe('SharedPrefs write', () => {
  it('splits one prefs object back across both tables, each with its own outbox entry', async () => {
    await writeSharedPrefs({
      ...DEFAULT_PREFS,
      theme: 'sepia',
      accessibility: { ...DEFAULT_ACCESSIBILITY_PREFS, screenReaderHints: true },
    });

    expect((await personalizationStore.current())?.theme).toBe('sepia');
    expect((await accessibilityStore.current())?.screen_reader_hints).toBe(1);

    const db = await getDatabase();
    const queued = await db.getAllAsync<{ entity_type: string }>(
      `SELECT entity_type FROM outbox ORDER BY entity_type`,
    );
    // Two records, two independent operations - the whole point of the a11y split.
    expect(queued.map((q) => q.entity_type)).toEqual(['accessibility', 'personalization']);
  });

  it('round-trips through read without losing anything', async () => {
    const written = {
      ...DEFAULT_PREFS,
      theme: 'dark' as const,
      typography: { size: 18, lineHeight: 1.6, spacing: 1, margins: 20 },
      accessibility: {
        ...DEFAULT_ACCESSIBILITY_PREFS,
        display: { ...DEFAULT_ACCESSIBILITY_PREFS.display, reduceMotion: 'off' as const },
        tts: { ...DEFAULT_ACCESSIBILITY_PREFS.tts, enabled: true, rate: 2.0 },
        screenReaderHints: true,
      },
    };
    await writeSharedPrefs(written);

    const read = await readSharedPrefs();
    expect(read.theme).toBe(written.theme);
    expect(read.typography).toEqual(written.typography);
    expect(read.accessibility).toEqual(written.accessibility);
  });
});

/** A defaults-shaped accessibility row, for the pure-merge cases that skip the DB. */
function accessibilityDefaultsRow(): AccessibilityRow {
  return {
    id: 'a11y-user-001',
    user_id: USER,
    dyslexia_font: 0,
    respect_os_font_scale: 1,
    font_scale_multiplier: 1.0,
    readable_spacing: 0,
    bold_text: 0,
    high_contrast: 0,
    reduce_motion: 'system',
    large_touch_targets: 0,
    large_audio_controls: 0,
    tts_enabled: 0,
    tts_voice_id: null,
    tts_rate: 1.0,
    tts_pitch: 1.0,
    tts_highlight_mode: 'sentence',
    tts_auto_continue_chapter: 1,
    tts_background_playback: 0,
    announce_page_changes: 1,
    announce_chapter_changes: 1,
    screen_reader_hints: 0,
    updated_at: '2026-01-01T00:00:00.000Z',
    is_deleted: 0,
    synced: 1,
    field_updated_at: '{}',
  };
}
