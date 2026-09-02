// personalizationStore.ts used to hardcode USER_ID inside current()/update(), same gap
// bookmarkStore/progressStore/downloadStore already closed for multi-user/verification-harness
// use. Confirms the optional userId param is genuinely wired through, not just added to the
// signature: two different users get two independent rows, and the default stays USER_ID.

import { getDatabase } from '../localDb/database';
import { USER_ID } from '../syncConfig';
import { personalizationId, personalizationStore } from './personalizationStore';

const OTHER_USER = 'user-002';

async function resetTable(): Promise<void> {
  const db = await getDatabase();
  await db.execAsync(`DELETE FROM personalization; DELETE FROM outbox;`);
}

beforeEach(resetTable);

describe('personalizationStore multi-user', () => {
  it('defaults to USER_ID when no userId is passed - unchanged behaviour for every existing caller', async () => {
    const row = await personalizationStore.update({ theme: 'dark' });
    expect(row.user_id).toBe(USER_ID);
    expect(row.id).toBe(personalizationId(USER_ID));
  });

  it('an explicit userId gets its own row, independent of the default user', async () => {
    await personalizationStore.update({ theme: 'dark' }); // default user
    const other = await personalizationStore.update({ theme: 'sepia' }, OTHER_USER);

    expect(other.user_id).toBe(OTHER_USER);
    expect(other.id).toBe(personalizationId(OTHER_USER));
    expect(other.theme).toBe('sepia');

    // Each user's own current() sees only their own row.
    expect((await personalizationStore.current())?.theme).toBe('dark');
    expect((await personalizationStore.current(OTHER_USER))?.theme).toBe('sepia');
  });

  it('a second update for the same explicit userId updates that user\'s row in place, not a new one', async () => {
    const first = await personalizationStore.update({ theme: 'dark' }, OTHER_USER);
    const second = await personalizationStore.update({ zoom: 2 }, OTHER_USER);

    expect(second.id).toBe(first.id);
    expect(second.theme).toBe('dark'); // untouched field survives
    expect(second.zoom).toBe(2);
  });
});
