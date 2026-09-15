// Identical gap to personalizationStore.multiUser.test.ts's own header, on the twin table.

import { getDatabase } from '../localDb/database';
import { USER_ID } from '../syncConfig';
import { accessibilityId, accessibilityStore } from './accessibilityStore';

const OTHER_USER = 'user-002';

async function resetTable(): Promise<void> {
  const db = await getDatabase();
  await db.execAsync(`DELETE FROM accessibility; DELETE FROM outbox;`);
}

beforeEach(resetTable);

describe('accessibilityStore multi-user', () => {
  it('defaults to USER_ID when no userId is passed - unchanged behaviour for every existing caller', async () => {
    const row = await accessibilityStore.update({ bold_text: 1 });
    expect(row.user_id).toBe(USER_ID);
    expect(row.id).toBe(accessibilityId(USER_ID));
  });

  it('an explicit userId gets its own row, independent of the default user', async () => {
    await accessibilityStore.update({ bold_text: 1 }); // default user
    const other = await accessibilityStore.update({ high_contrast: 1 }, OTHER_USER);

    expect(other.user_id).toBe(OTHER_USER);
    expect(other.id).toBe(accessibilityId(OTHER_USER));
    expect(other.high_contrast).toBe(1);

    expect((await accessibilityStore.current())?.bold_text).toBe(1);
    expect((await accessibilityStore.current(OTHER_USER))?.high_contrast).toBe(1);
  });
});
