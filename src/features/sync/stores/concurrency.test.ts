// Write serialization — the guarantee `withWriteLock` exists to provide.
//
// REGRESSION SUITE. The lock was removed in the restructure with no replacement, and these
// are the cases that caught it. Two failure modes, both reachable from ordinary UI actions:
//
//   1. One SQLite connection backs the whole app and it can hold only one transaction at a
//      time. Two overlapping saveLocal calls - two bookmarks added at once, two rapid page
//      turns - both open one, and the second throws "cannot start a transaction within a
//      transaction".
//   2. The four singleton stores each do "find the current row, else create one". Without the
//      lock held across BOTH halves, two concurrent first-time callers each read "nothing yet"
//      and each insert their own row, quietly producing two live rows where the design
//      promises exactly one.
//
// Runs against real SQLite (sql.js, via root __mocks__/expo-sqlite.js), so the transaction
// error is the engine's own, not a simulated one.

import { getDatabase } from '../localDb/database';
import type { OutboxRow } from '../localDb/types';
import { accessibilityStore } from './accessibilityStore';
import { bookmarkStore } from './bookmarkStore';
import { downloadStore } from './downloadStore';
import { personalizationStore } from './personalizationStore';
import { progressStore } from './progressStore';

const USER = 'user-001';
const BOOK = 'book-001';

async function countRows(table: string): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM ${table} WHERE is_deleted = 0`,
  );
  return row?.n ?? 0;
}

async function resetAll(): Promise<void> {
  const db = await getDatabase();
  await db.execAsync(
    `DELETE FROM outbox; DELETE FROM progress; DELETE FROM downloads;
     DELETE FROM personalization; DELETE FROM accessibility; DELETE FROM bookmarks;`,
  );
}

beforeEach(resetAll);

describe('concurrent writes to one table', () => {
  it('two simultaneous recordCompleted calls resolve to a single row', async () => {
    await expect(
      Promise.all([
        downloadStore.recordCompleted('/tmp/a.pdf'),
        downloadStore.recordCompleted('/tmp/b.pdf'),
      ]),
    ).resolves.toHaveLength(2);

    expect(await countRows('downloads')).toBe(1);
  });

  it('two simultaneous savePosition calls resolve to a single progress row', async () => {
    await Promise.all([
      progressStore.savePosition({ type: 'PDF', page: 3 }),
      progressStore.savePosition({ type: 'PDF', page: 4 }),
    ]);

    expect(await countRows('progress')).toBe(1);
  });

  it('two simultaneous personalization updates resolve to a single prefs row', async () => {
    await Promise.all([
      personalizationStore.update({ theme: 'dark' }),
      personalizationStore.update({ zoom: 1.5 }),
    ]);

    expect(await countRows('personalization')).toBe(1);
  });

  it('two simultaneous accessibility updates resolve to a single a11y row', async () => {
    await Promise.all([
      accessibilityStore.update({ tts_rate: 1.5 }),
      accessibilityStore.update({ bold_text: 1 }),
    ]);

    expect(await countRows('accessibility')).toBe(1);
  });
});

describe('concurrent writes across different tables', () => {
  it('does not collide on the single connection\'s one open transaction', async () => {
    // These touch four unrelated tables, so nothing here is a logical conflict - the only
    // thing that can break is the shared transaction, which is exactly the point.
    await expect(
      Promise.all([
        progressStore.savePosition({ type: 'PDF', page: 9 }),
        bookmarkStore.addForPage(9),
        downloadStore.recordCompleted('/tmp/c.pdf'),
        personalizationStore.update({ theme: 'sepia' }),
      ]),
    ).resolves.toBeDefined();
  });

  it('queues one outbox operation per write, none lost to the interleaving', async () => {
    await Promise.all([
      bookmarkStore.addForPage(1),
      bookmarkStore.addForPage(2),
      bookmarkStore.addForPage(3),
    ]);

    const db = await getDatabase();
    const queued = await db.getAllAsync<OutboxRow>(
      `SELECT * FROM outbox WHERE entity_type = 'bookmarks'`,
    );
    expect(queued).toHaveLength(3);
    expect(await countRows('bookmarks')).toBe(3);
  });
});

describe('a failed write does not jam the queue behind it', () => {
  it('lets later writes through after one rejects', async () => {
    // withWriteLock swallows the rejection on the internal chain so one bad write cannot
    // deadlock every write after it, while still surfacing the real error to its own caller.
    const boom = progressStore.savePosition(
      // A locator whose page is not a number reaches SQLite as a bad bind and rejects.
      { type: 'PDF', page: Symbol('nope') as unknown as number },
    );
    await expect(boom).rejects.toBeDefined();

    await expect(bookmarkStore.addForPage(5)).resolves.toBeDefined();
    expect(await countRows('bookmarks')).toBe(1);
  });
});

describe('singleton identity', () => {
  it('derives the prefs id from the user rather than minting one per device', async () => {
    // A device-minted UUID means two devices create two server documents for a record the
    // contract defines as one-per-user, and neither ever detects a conflict.
    const row = await personalizationStore.update({ theme: 'dark' });
    expect(row.id).toBe(`prefs-${USER}`);
  });

  it('derives the a11y id from the user too', async () => {
    const row = await accessibilityStore.update({ bold_text: 1 });
    expect(row.id).toBe(`a11y-${USER}`);
  });

  it('a second update reuses the same row rather than adding one', async () => {
    await personalizationStore.update({ theme: 'dark' });
    await personalizationStore.update({ theme: 'sepia' });

    expect(await countRows('personalization')).toBe(1);
    expect((await personalizationStore.current())?.theme).toBe('sepia');
  });
});

describe('book scoping', () => {
  it('keeps progress scoped to one user and book', async () => {
    await progressStore.savePosition({ type: 'PDF', page: 12 });
    const row = await progressStore.current();
    expect(row?.user_id).toBe(USER);
    expect(row?.book_id).toBe(BOOK);
  });
});
