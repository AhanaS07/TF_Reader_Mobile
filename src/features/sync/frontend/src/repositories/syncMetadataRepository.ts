import { getDatabase, nowIso } from '../db/database';
import type { SyncMetadataRow } from '../db/types';

/**
 * The pull checkpoint store. This is what lets the device ask the server
 * "what changed since I last looked?" instead of downloading everything.
 */
export const syncMetadataRepository = {
  async get(key: string): Promise<string | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<SyncMetadataRow>(
      `SELECT * FROM sync_metadata WHERE key = ?`,
      [key],
    );
    return row?.value ?? null;
  },

  async set(key: string, value: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      `INSERT INTO sync_metadata (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, value, nowIso()],
    );
  },

  async listAll(): Promise<SyncMetadataRow[]> {
    const db = await getDatabase();
    return db.getAllAsync<SyncMetadataRow>(`SELECT * FROM sync_metadata ORDER BY key`);
  },
};
