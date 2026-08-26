// Covers bookmarkStore.add()'s dedup guard - see the identical note on highlightStore.test.ts.

import { getDatabase } from '../localDb/database';
import { bookmarkStore } from './bookmarkStore';

async function resetTable(): Promise<void> {
  const db = await getDatabase();
  await db.execAsync(`DELETE FROM bookmarks; DELETE FROM outbox;`);
}

beforeEach(resetTable);

describe('add() dedup', () => {
  it('returns the existing row instead of creating a duplicate at the same locator', async () => {
    const first = await bookmarkStore.addForPage(42, 'first name');
    const second = await bookmarkStore.addForPage(42, 'second name');

    expect(second.id).toBe(first.id);
    expect(second.name).toBe('first name'); // the existing row wins - the new name is ignored
    expect(await bookmarkStore.list()).toHaveLength(1);
  });

  it('creates a genuinely new row for a different locator', async () => {
    await bookmarkStore.addForPage(42);
    await bookmarkStore.addForPage(43);

    expect(await bookmarkStore.list()).toHaveLength(2);
  });

  it('allows re-adding at a locator whose only prior bookmark was removed', async () => {
    const first = await bookmarkStore.addForPage(42);
    await bookmarkStore.remove(first.id);

    const second = await bookmarkStore.addForPage(42);

    expect(second.id).not.toBe(first.id);
    expect(await bookmarkStore.list()).toHaveLength(1);
  });

  it('does not match a bookmark at a different locator, even for the same page number expressed differently', async () => {
    await bookmarkStore.addForCfi('epubcfi(/6/4!/4/2)', 'chapter-1');
    const pageBookmark = await bookmarkStore.addForPage(1);

    expect(await bookmarkStore.list()).toHaveLength(2);
    expect(pageBookmark.id).not.toBe(undefined);
  });
});

describe('rename()', () => {
  it('changes only the name, keeps the id and locator, and re-queues the row for push', async () => {
    const created = await bookmarkStore.addForPage(7, 'Old name');
    await markAllSynced();

    const renamed = await bookmarkStore.rename(created.id, 'New name');

    expect(renamed).not.toBeNull();
    expect(renamed!.id).toBe(created.id); // same row, updated in place
    expect(renamed!.name).toBe('New name');
    expect(renamed!.locator).toBe(created.locator); // the jump target is untouched
    expect(renamed!.synced).toBe(0); // a fresh local edit, unsynced again

    const [live] = await bookmarkStore.list();
    expect(live.name).toBe('New name');
    expect(await bookmarkStore.list()).toHaveLength(1); // no second row

    // The rename queued an UPDATE for the sync engine to push.
    expect(await outboxOps()).toContainEqual({ entity_type: 'bookmarks', operation: 'UPDATE' });
  });

  it('is a no-op returning null for an unknown id', async () => {
    expect(await bookmarkStore.rename('nope', 'x')).toBeNull();
  });

  it('is a no-op returning null for an already-deleted bookmark', async () => {
    const created = await bookmarkStore.addForPage(7, 'Old name');
    await bookmarkStore.remove(created.id);

    expect(await bookmarkStore.rename(created.id, 'New name')).toBeNull();
  });
});

async function markAllSynced(): Promise<void> {
  const db = await getDatabase();
  await db.execAsync(`UPDATE bookmarks SET synced = 1; DELETE FROM outbox;`);
}

async function outboxOps(): Promise<{ entity_type: string; operation: string }[]> {
  const db = await getDatabase();
  return db.getAllAsync<{ entity_type: string; operation: string }>(
    `SELECT entity_type, operation FROM outbox`,
  );
}
