// src/features/personalization/prefsStore.ts
// STUB — real implementation lands later today (Tuesday 25 Aug).
// Exposes the correct TypeScript signatures so Khushi's preferences screen
// skeleton and the useReaderPrefs hook compile immediately. Replace with
// AsyncStorage persistence once this stub is pushed.
import type { SharedPrefs } from '@/shared/contracts/prefs';
import { DEFAULT_PREFS } from '@/shared/contracts/prefs';

export function getPrefs(): Omit<SharedPrefs, 'id' | 'userId' | 'updatedAt' | 'isDeleted' | 'synced'> {
  return DEFAULT_PREFS;
}

export function savePrefs(
  _partial: Partial<Omit<SharedPrefs, 'id' | 'userId' | 'updatedAt' | 'isDeleted' | 'synced'>>,
): void {}

export function resetPrefs(): void {}

export function subscribe(_listener: () => void): () => void {
  return () => {};
}
