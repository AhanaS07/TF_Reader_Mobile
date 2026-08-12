// Exercises outboxRepository.ts against real SQLite (node:sqlite via __mocks__/expo-sqlite.js).

import { outboxRepository } from './outboxRepository';

describe('outboxRepository', () => {
  it('enqueue -> listPending -> remove', async () => {
    const id = await outboxRepository.enqueue('progress', 'book-1', 'CREATE', { offset: 5 });
    expect(typeof id).toBe('string');

    const pending = await outboxRepository.listPending();
    expect(pending.some((op) => op.id === id)).toBe(true);

    await outboxRepository.remove([id]);
    const afterRemove = await outboxRepository.listPending();
    expect(afterRemove.some((op) => op.id === id)).toBe(false);
  });

  it('a second enqueue for the same entity supersedes the first (no duplicate PENDING ops)', async () => {
    await outboxRepository.enqueue('progress', 'book-2', 'CREATE', { offset: 1 });
    await outboxRepository.enqueue('progress', 'book-2', 'UPDATE', { offset: 2 });

    const pending = await outboxRepository.listPending(1000);
    const forBook2 = pending.filter((op) => op.entity_id === 'book-2');
    expect(forBook2).toHaveLength(1);
    expect(JSON.parse(forBook2[0].payload)).toEqual({ offset: 2 });
  });

  it('markFailed backs off and eventually goes DEAD after MAX_PUSH_RETRIES', async () => {
    const id = await outboxRepository.enqueue('progress', 'book-3', 'CREATE', { offset: 1 });
    let all = await outboxRepository.listAll();
    let row = all.find((op) => op.id === id)!;

    for (let i = 0; i < 6; i++) {
      await outboxRepository.markFailed(row, `attempt ${i}`);
      all = await outboxRepository.listAll();
      row = all.find((op) => op.id === id)!;
    }

    expect(row.status).toBe('DEAD');
    expect(row.retry_count).toBe(6);
  });

  it('revive() resets FAILED/DEAD ops back to PENDING', async () => {
    const id = await outboxRepository.enqueue('progress', 'book-4', 'CREATE', { offset: 1 });
    const all = await outboxRepository.listAll();
    const row = all.find((op) => op.id === id)!;
    await outboxRepository.markFailed(row, 'boom');

    const revived = await outboxRepository.revive();
    expect(revived).toBeGreaterThanOrEqual(1);

    const pending = await outboxRepository.listPending(1000);
    expect(pending.find((op) => op.id === id)?.status).toBe('PENDING');
  });

  it('countPending only counts PENDING/FAILED, not DEAD', async () => {
    const before = await outboxRepository.countPending();
    const id = await outboxRepository.enqueue('progress', 'book-5', 'CREATE', { offset: 1 });
    expect(await outboxRepository.countPending()).toBe(before + 1);

    await outboxRepository.remove([id]);
    expect(await outboxRepository.countPending()).toBe(before);
  });
});
