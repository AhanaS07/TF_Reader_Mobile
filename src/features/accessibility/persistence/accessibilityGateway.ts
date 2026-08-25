import { accessibilityMapper } from '@/features/sync/localDb/mappers';
import type { AccessibilityRow } from '@/features/sync/localDb/types';
import { accessibilityId, accessibilityStore, accessibilityTable } from '@/features/sync/stores/accessibilityStore';
import { ApiError, api } from '@/features/sync/syncApi';

const ENTITY = 'accessibility';

/**
 * Two explicit, separately implemented persistence paths for the accessibility singleton record:
 * offline (direct SQLite calls, no HTTP) and online (Mongo REST). Both must resolve "the record"
 * the same way - via `accessibilityId(userId)` - so a caller can pick either implementation
 * without the two meaning different things by `userId`. `write` covers create-or-update, matching
 * `accessibilityStore.update()`'s own behaviour; there is no separate create/update split because
 * the SQLite side doesn't have one either.
 */
export interface AccessibilityGateway {
  read(userId: string): Promise<AccessibilityRow | null>;
  write(userId: string, patch: Partial<AccessibilityRow>): Promise<AccessibilityRow>;
  remove(userId: string): Promise<void>;
}

export const sqliteAccessibilityGateway: AccessibilityGateway = {
  read: (userId) => accessibilityTable.findById(accessibilityId(userId)),

  // accessibilityStore.update() is single-row-per-device and doesn't take a userId itself - it
  // resolves the device's own row, merges the patch, and stamps field_updated_at under its own
  // write lock. Delegating keeps that merge/stamp/lock logic in one place (Karthik's); the check
  // below is what stops this method from silently succeeding if a caller's userId ever diverges
  // from the row the store actually wrote, instead of trusting the argument decoratively.
  write: async (userId, patch) => {
    const row = await accessibilityStore.update(patch);
    if (row.user_id !== userId) {
      throw new Error(
        `sqliteAccessibilityGateway.write: row user_id (${row.user_id}) does not match requested userId (${userId})`,
      );
    }
    return row;
  },

  remove: (userId) => accessibilityTable.softDeleteLocal(accessibilityId(userId)),
};

async function readFromMongo(userId: string): Promise<AccessibilityRow | null> {
  try {
    const response = await api.findById<Record<string, unknown>>(ENTITY, accessibilityId(userId));
    return accessibilityMapper.toRow(response.data);
  } catch (error) {
    if (error instanceof ApiError && error.isNotFound) return null;
    throw error;
  }
}

export const mongoAccessibilityGateway: AccessibilityGateway = {
  read: readFromMongo,

  // toServerPayload reuses accessibilityMapper.toServer, so fieldUpdatedAt travels on the wire
  // exactly as it already does through syncEngine - this gateway does not add any merge logic of
  // its own, only a second way to reach the same endpoints syncEngine already calls. Unlike
  // accessibilityStore.update() (SQLite), there is no local defaults() fallback here, so a first
  // write with no existing remote record must be given a complete patch - a partial patch against
  // a nonexistent record will send whatever the mapper reads from the missing fields.
  write: async (userId, patch) => {
    const id = accessibilityId(userId);
    const existing = await readFromMongo(userId);
    const row: AccessibilityRow = { ...(existing ?? ({} as Partial<AccessibilityRow>)), ...patch, id, user_id: userId } as AccessibilityRow;
    const payload = accessibilityTable.toServerPayload(row);
    const response = existing
      ? await api.update<Record<string, unknown>>(ENTITY, id, payload)
      : await api.create<Record<string, unknown>>(ENTITY, payload);
    return accessibilityMapper.toRow(response.data);
  },

  remove: (userId) => api.remove(ENTITY, accessibilityId(userId)).then(() => undefined),
};
