// Lighter coverage for the 5 repositories beyond progressRepository — their
// shared createSyncableTable behavior (LWW, outbox enqueue, soft-delete) is
// already exercised by progressRepository.test.ts. These tests cover only
// what's specific to each repository's own convenience methods.

import { getDatabase } from '../db/database';
import { outboxRepository } from './outboxRepository';
import { bookmarkRepository, parseLocator } from './bookmarkRepository';
import { highlightRepository, toPaintable } from './highlightRepository';
import { downloadRepository, downloadTable } from './downloadRepository';
import { USER_ID, BOOK_ID } from '../config';
import { personalizationRepository } from './personalizationRepository';
import { accessibilityRepository } from './accessibilityRepository';
import { progressRepository } from './progressRepository';

beforeEach(async () => {
  const db = await getDatabase();
  await db.execAsync(
    'DELETE FROM bookmarks; DELETE FROM highlights; DELETE FROM downloads; ' +
      'DELETE FROM personalization; DELETE FROM accessibility; DELETE FROM progress; ' +
      'DELETE FROM outbox;',
  );
});

describe('bookmarkRepository', () => {
  it('addForPage creates a page-locator bookmark, listed and enqueued for push', async () => {
    const row = await bookmarkRepository.addForPage(12, 'My bookmark');
    expect(row.chapter_id).toBe('page-12');
    expect(parseLocator(row.locator)).toEqual({ type: 'pdf', page: 12, offset: 0 });

    const list = await bookmarkRepository.list();
    expect(list.map((r) => r.id)).toContain(row.id);
    expect(await outboxRepository.countPending()).toBeGreaterThan(0);
  });

  it('remove tombstones the bookmark, excluding it from list()', async () => {
    const row = await bookmarkRepository.addForPage(3);
    await bookmarkRepository.remove(row.id);

    const list = await bookmarkRepository.list();
    expect(list.map((r) => r.id)).not.toContain(row.id);
  });
});

describe('highlightRepository', () => {
  it('addFromSelection stores start/end locators and is paintable', async () => {
    const row = await highlightRepository.addFromSelection(
      { page: 5, startOffset: 10, endOffset: 40 },
      'green',
    );
    expect(row.color).toBe('green');

    const paintable = toPaintable([row]);
    expect(paintable).toEqual([{ id: row.id, page: 5, startOffset: 10, endOffset: 40, color: 'green' }]);
  });

  it('defaults to yellow when no color is given', async () => {
    const row = await highlightRepository.addFromSelection({ page: 1, startOffset: 0, endOffset: 1 });
    expect(row.color).toBe('yellow');
  });

  it('remove tombstones the highlight, excluding it from list()', async () => {
    const row = await highlightRepository.addFromSelection({ page: 2, startOffset: 0, endOffset: 5 });
    await highlightRepository.remove(row.id);

    const list = await highlightRepository.list();
    expect(list.map((r) => r.id)).not.toContain(row.id);
  });

  it('toPaintable drops a row with a corrupted locator without crashing or corrupting the others (correlates by id, not index)', async () => {
    const good1 = await highlightRepository.addFromSelection({ page: 1, startOffset: 0, endOffset: 5 });
    const corrupted = { ...good1, id: 'corrupted-row', start_locator: '{not valid json' };
    const good2 = await highlightRepository.addFromSelection({ page: 9, startOffset: 1, endOffset: 2 });

    const paintable = toPaintable([good1, corrupted as any, good2]);

    expect(paintable.map((p) => p.id).sort()).toEqual([good1.id, good2.id].sort());
    expect(paintable.find((p) => p.id === good1.id)).toEqual({
      id: good1.id,
      page: 1,
      startOffset: 0,
      endOffset: 5,
      color: 'yellow',
    });
  });
});

describe('downloadRepository', () => {
  it('recordCompleted creates one row per book and keeps local_path device-local', async () => {
    const row = await downloadRepository.recordCompleted('/tmp/book.pdf', 'PDF');
    expect(row.local_path).toBe('/tmp/book.pdf');
    expect(row.status).toBe('COMPLETED');
    expect((await downloadRepository.currentForBook())?.id).toBe(row.id);
  });

  it('a second recordCompleted for the same book updates the same row', async () => {
    const first = await downloadRepository.recordCompleted('/tmp/a.pdf');
    const second = await downloadRepository.recordCompleted('/tmp/b.pdf');
    expect(second.id).toBe(first.id);
    expect((await downloadRepository.currentForBook())?.local_path).toBe('/tmp/b.pdf');
  });

  it('an explicit isValid:false from the server survives an unchanged re-pull (no flip back to valid)', async () => {
    const row = await downloadRepository.recordCompleted('/tmp/a.pdf');

    // Server marks the download invalid (e.g. the file expired server-side) and echoes it back
    // on the push acknowledgement.
    const invalidUpdatedAt = '2030-01-01T00:00:00.000Z';
    await downloadTable.adoptPushResult(
      {
        id: row.id,
        userId: USER_ID,
        bookId: BOOK_ID,
        format: 'PDF',
        status: 'COMPLETED',
        isValid: false,
        updatedAt: invalidUpdatedAt,
      },
      row.updated_at,
    );
    expect((await downloadRepository.findById(row.id))?.is_valid).toBe(0);

    // A later pull re-fetches the SAME unchanged record - it must not flip is_valid back to 1.
    const applied = await downloadTable.applyServerRecord({
      id: row.id,
      userId: USER_ID,
      bookId: BOOK_ID,
      format: 'PDF',
      status: 'COMPLETED',
      isValid: false,
      updatedAt: invalidUpdatedAt,
    });
    expect(applied).toBe(false); // unchanged updated_at - LWW correctly skips the rewrite
    expect((await downloadRepository.findById(row.id))?.is_valid).toBe(0);
  });
});

describe('personalizationRepository', () => {
  it('update() creates a row with defaults on the first call, patched with the given fields', async () => {
    const row = await personalizationRepository.update({ theme: 'dark' });
    expect(row.theme).toBe('dark');
    expect(row.font_family).toBe('system'); // untouched default
    expect((await personalizationRepository.current())?.id).toBe(row.id);
  });

  it('a second update() patches the same row rather than creating a new one', async () => {
    const first = await personalizationRepository.update({ theme: 'dark' });
    const second = await personalizationRepository.update({ zoom: 1.5 });
    expect(second.id).toBe(first.id);
    expect(second.theme).toBe('dark'); // preserved from the first patch
    expect(second.zoom).toBe(1.5);
  });
});

describe('concurrent first calls to the "find current row, else create" repositories (race)', () => {
  // Each of these four repositories documents "exactly one live row per user (+book)". Before
  // the withWriteLock fix, two overlapping first-time callers each read "nothing yet" and each
  // created their own row - and, independent of that, two concurrent saveLocal-based writes to
  // ANY table (even unrelated rows) collided trying to open two SQLite transactions at once
  // ("cannot start a transaction within a transaction" against the real node:sqlite mock, and
  // documented as unsafe against real expo-sqlite too - see withWriteLock's doc comment in
  // syncableTable.ts).

  it('personalizationRepository.update(): two concurrent first calls produce one row, not two', async () => {
    const [a, b] = await Promise.all([
      personalizationRepository.update({ theme: 'dark' }),
      personalizationRepository.update({ theme: 'light' }),
    ]);

    const db = await getDatabase();
    const rows = await db.getAllAsync('SELECT * FROM personalization');
    expect(rows).toHaveLength(1);
    expect(a.id).toBe(b.id);
  });

  it('accessibilityRepository.update(): two concurrent first calls produce one row, not two', async () => {
    const [a, b] = await Promise.all([
      accessibilityRepository.update({ dyslexia_font: 1 }),
      accessibilityRepository.update({ high_contrast: 1 }),
    ]);

    const db = await getDatabase();
    const rows = await db.getAllAsync('SELECT * FROM accessibility');
    expect(rows).toHaveLength(1);
    expect(a.id).toBe(b.id);
  });

  it('downloadRepository.recordCompleted(): two concurrent first calls produce one row, not two', async () => {
    const [a, b] = await Promise.all([
      downloadRepository.recordCompleted('/tmp/a.pdf'),
      downloadRepository.recordCompleted('/tmp/b.pdf'),
    ]);

    const db = await getDatabase();
    const rows = await db.getAllAsync('SELECT * FROM downloads');
    expect(rows).toHaveLength(1);
    expect(a.id).toBe(b.id);
  });

  it('progressRepository.savePosition(): two concurrent first calls produce one row, not two', async () => {
    const [a, b] = await Promise.all([
      progressRepository.savePosition(1),
      progressRepository.savePosition(2),
    ]);

    const db = await getDatabase();
    const rows = await db.getAllAsync('SELECT * FROM progress');
    expect(rows).toHaveLength(1);
    expect(a.id).toBe(b.id);
  });

  it('two concurrent saveLocal writes to entirely unrelated rows (two different bookmarks) do not collide on the single SQLite transaction', async () => {
    const [a, b] = await Promise.all([
      bookmarkRepository.addForPage(1),
      bookmarkRepository.addForPage(2),
    ]);
    expect(a.id).not.toBe(b.id);

    const list = await bookmarkRepository.list();
    expect(list.map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
  });
});

describe('accessibilityRepository', () => {
  it('update() creates a row with defaults on the first call, patched with the given fields', async () => {
    const row = await accessibilityRepository.update({ dyslexia_font: 1 });
    expect(row.dyslexia_font).toBe(1);
    expect(row.tts_highlight_mode).toBe('sentence'); // untouched default
    expect((await accessibilityRepository.current())?.id).toBe(row.id);
  });

  it('a second update() patches the same row rather than creating a new one', async () => {
    const first = await accessibilityRepository.update({ high_contrast: 1 });
    const second = await accessibilityRepository.update({ tts_enabled: 1 });
    expect(second.id).toBe(first.id);
    expect(second.high_contrast).toBe(1); // preserved from the first patch
    expect(second.tts_enabled).toBe(1);
  });
});
