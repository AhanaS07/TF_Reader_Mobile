// Covers highlightStore.add()'s dedup guard: two devices (or two taps) highlighting the exact
// same span must not silently accumulate duplicate rows - see the note on add() itself for what
// this can and cannot catch (same-device only; a genuine concurrent cross-device create still
// needs a server-side constraint).

import { getDatabase } from '../localDb/database';
import { highlightStore } from './highlightStore';

async function resetTable(): Promise<void> {
  const db = await getDatabase();
  await db.execAsync(`DELETE FROM highlights; DELETE FROM outbox;`);
}

beforeEach(resetTable);

describe('add() dedup', () => {
  it('returns the existing row instead of creating a duplicate at the same span', async () => {
    const start = { type: 'PDF' as const, page: 1, offset: 0 };
    const end = { type: 'PDF' as const, page: 1, offset: 10 };

    const first = await highlightStore.add(start, end, 'yellow');
    const second = await highlightStore.add(start, end, 'yellow');

    expect(second.id).toBe(first.id);
    expect(await highlightStore.list()).toHaveLength(1);
  });

  it('creates a genuinely new row for a different span', async () => {
    await highlightStore.add({ type: 'PDF', page: 1, offset: 0 }, { type: 'PDF', page: 1, offset: 10 });
    await highlightStore.add({ type: 'PDF', page: 2, offset: 0 }, { type: 'PDF', page: 2, offset: 10 });

    expect(await highlightStore.list()).toHaveLength(2);
  });

  it('allows re-adding at a span whose only prior highlight was removed', async () => {
    const start = { type: 'PDF' as const, page: 1, offset: 0 };
    const end = { type: 'PDF' as const, page: 1, offset: 10 };

    const first = await highlightStore.add(start, end);
    await highlightStore.remove(first.id);

    const second = await highlightStore.add(start, end);

    expect(second.id).not.toBe(first.id);
    expect(await highlightStore.list()).toHaveLength(1);
  });
});
