// The push queue's retry policy: backoff, the DEAD parking rule, and revive().
//
// Restored after review pointed out the renamed store kept its logic but lost its test file.
// These are the cases that were covered before: DEAD after MAX_PUSH_RETRIES, revive() bringing
// parked ops back, and countPending excluding DEAD.

import { getDatabase } from '../localDb/database';
import type { OutboxRow } from '../localDb/types';
import { MAX_PUSH_RETRIES } from '../syncConfig';
import { outboxStore } from './outboxStore';

async function reset(): Promise<void> {
  const db = await getDatabase();
  await db.execAsync(`DELETE FROM outbox`);
}

async function rowFor(entityId: string): Promise<OutboxRow> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<OutboxRow>(
    `SELECT * FROM outbox WHERE entity_id = ?`,
    [entityId],
  );
  if (!row) throw new Error(`no outbox row for ${entityId}`);
  return row;
}

beforeEach(reset);

describe('enqueue', () => {
  it('queues an operation as PENDING with a zeroed retry budget', async () => {
    await outboxStore.enqueue('progress', 'e1', 'CREATE', { offset: 1 });

    const row = await rowFor('e1');
    expect(row.status).toBe('PENDING');
    expect(row.retry_count).toBe(0);
    expect(row.next_retry_at).toBeNull();
    expect(JSON.parse(row.payload).offset).toBe(1);
  });

  it('supersedes a queued operation for the same record instead of appending', async () => {
    // Payloads are full snapshots, so the newest wins. Without this, scrolling a few pages
    // would queue one progress operation per page.
    await outboxStore.enqueue('progress', 'e2', 'CREATE', { offset: 1 });
    await outboxStore.enqueue('progress', 'e2', 'UPDATE', { offset: 2 });

    const db = await getDatabase();
    const all = await db.getAllAsync<OutboxRow>(
      `SELECT * FROM outbox WHERE entity_id = ?`,
      ['e2'],
    );
    expect(all).toHaveLength(1);
    expect(JSON.parse(all[0].payload).offset).toBe(2);
  });

  it('supersedes a DEAD operation, giving a fresh payload a fresh budget', async () => {
    await outboxStore.enqueue('progress', 'e3', 'CREATE', { offset: 1 });
    let row = await rowFor('e3');
    for (let i = 0; i < MAX_PUSH_RETRIES; i += 1) {
      await outboxStore.markFailed(row, 'rejected');
      row = await rowFor('e3');
    }
    expect(row.status).toBe('DEAD');

    await outboxStore.enqueue('progress', 'e3', 'UPDATE', { offset: 9 });

    const fresh = await rowFor('e3');
    expect(fresh.status).toBe('PENDING');
    expect(fresh.retry_count).toBe(0);
    expect(JSON.parse(fresh.payload).offset).toBe(9);
  });
});

describe('markFailed', () => {
  it('backs the operation off rather than dropping it', async () => {
    await outboxStore.enqueue('progress', 'f1', 'CREATE', {});
    await outboxStore.markFailed(await rowFor('f1'), 'validation error');

    const row = await rowFor('f1');
    expect(row.status).toBe('FAILED');
    expect(row.retry_count).toBe(1);
    expect(row.last_error).toBe('validation error');
    expect(row.next_retry_at).not.toBeNull();
  });

  it('lengthens the backoff on each successive failure', async () => {
    await outboxStore.enqueue('progress', 'f2', 'CREATE', {});
    await outboxStore.markFailed(await rowFor('f2'), 'first');
    const first = await rowFor('f2');
    await outboxStore.markFailed(first, 'second');
    const second = await rowFor('f2');

    expect(Date.parse(second.next_retry_at!)).toBeGreaterThan(
      Date.parse(first.next_retry_at!),
    );
  });

  it('parks the operation as DEAD once it exhausts MAX_PUSH_RETRIES', async () => {
    // A payload the server will never accept must not block the queue forever.
    await outboxStore.enqueue('progress', 'f3', 'CREATE', {});
    for (let i = 0; i < MAX_PUSH_RETRIES; i += 1) {
      await outboxStore.markFailed(await rowFor('f3'), `attempt ${i}`);
    }

    const row = await rowFor('f3');
    expect(row.status).toBe('DEAD');
    expect(row.retry_count).toBe(MAX_PUSH_RETRIES);
    // No retry time: DEAD is parked, not scheduled.
    expect(row.next_retry_at).toBeNull();
  });

  it('truncates a runaway error message rather than storing it whole', async () => {
    await outboxStore.enqueue('progress', 'f4', 'CREATE', {});
    await outboxStore.markFailed(await rowFor('f4'), 'x'.repeat(2000));

    expect((await rowFor('f4')).last_error).toHaveLength(500);
  });
});

describe('listPending', () => {
  it('returns oldest first, so operations replay in the order the user made them', async () => {
    await outboxStore.enqueue('progress', 'l1', 'CREATE', {});
    await outboxStore.enqueue('bookmarks', 'l2', 'CREATE', {});
    await outboxStore.enqueue('highlights', 'l3', 'CREATE', {});

    const ids = (await outboxStore.listPending()).map((r) => r.entity_id);
    expect(ids).toEqual(['l1', 'l2', 'l3']);
  });

  it('skips a FAILED operation until its backoff has elapsed', async () => {
    await outboxStore.enqueue('progress', 'l4', 'CREATE', {});
    await outboxStore.markFailed(await rowFor('l4'), 'rejected');

    const pending = await outboxStore.listPending();
    expect(pending.map((r) => r.entity_id)).not.toContain('l4');
  });

  it('excludes DEAD operations entirely', async () => {
    await outboxStore.enqueue('progress', 'l5', 'CREATE', {});
    for (let i = 0; i < MAX_PUSH_RETRIES; i += 1) {
      await outboxStore.markFailed(await rowFor('l5'), 'nope');
    }

    expect((await outboxStore.listPending()).map((r) => r.entity_id)).not.toContain('l5');
  });

  it('honours the limit', async () => {
    for (let i = 0; i < 5; i += 1) {
      await outboxStore.enqueue('progress', `lim-${i}`, 'CREATE', {});
    }
    expect(await outboxStore.listPending(3)).toHaveLength(3);
  });
});

describe('countPending', () => {
  it('counts PENDING and FAILED but not DEAD', async () => {
    await outboxStore.enqueue('progress', 'c1', 'CREATE', {});

    await outboxStore.enqueue('bookmarks', 'c2', 'CREATE', {});
    await outboxStore.markFailed(await rowFor('c2'), 'retryable');

    await outboxStore.enqueue('highlights', 'c3', 'CREATE', {});
    for (let i = 0; i < MAX_PUSH_RETRIES; i += 1) {
      await outboxStore.markFailed(await rowFor('c3'), 'permanent');
    }

    // c1 PENDING + c2 FAILED, c3 DEAD excluded.
    expect(await outboxStore.countPending()).toBe(2);
  });

  it('is zero on an empty queue', async () => {
    expect(await outboxStore.countPending()).toBe(0);
  });
});

describe('revive', () => {
  it('brings FAILED and DEAD operations back with a clean budget', async () => {
    await outboxStore.enqueue('progress', 'r1', 'CREATE', {});
    await outboxStore.markFailed(await rowFor('r1'), 'retryable');

    await outboxStore.enqueue('bookmarks', 'r2', 'CREATE', {});
    for (let i = 0; i < MAX_PUSH_RETRIES; i += 1) {
      await outboxStore.markFailed(await rowFor('r2'), 'permanent');
    }

    const revived = await outboxStore.revive();
    expect(revived).toBe(2);

    for (const id of ['r1', 'r2']) {
      const row = await rowFor(id);
      expect(row.status).toBe('PENDING');
      expect(row.retry_count).toBe(0);
      expect(row.next_retry_at).toBeNull();
    }
    expect((await outboxStore.listPending()).map((r) => r.entity_id).sort()).toEqual([
      'r1',
      'r2',
    ]);
  });

  it('leaves an already-PENDING operation untouched and reports zero', async () => {
    await outboxStore.enqueue('progress', 'r3', 'CREATE', {});
    expect(await outboxStore.revive()).toBe(0);
  });
});

describe('remove', () => {
  it('deletes acknowledged operations', async () => {
    await outboxStore.enqueue('progress', 'x1', 'CREATE', {});
    const row = await rowFor('x1');

    await outboxStore.remove([row.id]);

    expect(await outboxStore.countPending()).toBe(0);
  });

  it('is a no-op for an empty id list', async () => {
    await outboxStore.enqueue('progress', 'x2', 'CREATE', {});
    await outboxStore.remove([]);
    expect(await outboxStore.countPending()).toBe(1);
  });
});
