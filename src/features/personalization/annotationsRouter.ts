// src/features/personalization/annotationsRouter.ts
// Owner: Personalization (Vaishnavi).
//
// The one seam the facades call. Its ONLY job is to pick online vs offline and delegate to Karthik's
// existing code — it stores nothing itself and owns no sync.
//
//   ONLINE  → Karthik's Mongo endpoint directly (his `syncApi` client + his wire mappers). Writes land
//             in Mongo immediately and never touch SQLite, so a non-downloaded book (openable only while
//             online) never pollutes the offline store.
//   OFFLINE → Karthik's `bookmarkStore` / `highlightStore` (his offline feature). They write the SQLite
//             store, and HIS sync engine pushes to Mongo on reconnect — none of that is our concern.
//             Only downloaded books are openable offline, so only their annotations ever reach SQLite.
//
// Why a router at all: without it, every write would go through his offline-first `saveLocal` and land in
// SQLite even for online-only (non-downloaded) books. Splitting online→Mongo-direct is what keeps SQLite
// to downloaded books only. We deliberately do NOT reimplement his store, mappers, or sync — we call
// them.

import NetInfo from '@react-native-community/netinfo';

import { api } from '@/features/sync/syncApi';
import { bookmarkMapper, highlightMapper } from '@/features/sync/localDb/mappers';
import { bookmarkStore } from '@/features/sync/stores/bookmarkStore';
import { highlightStore, type SelectionRange } from '@/features/sync/stores/highlightStore';
import { newId, nowIso } from '@/features/sync/localDb/database';
import { USER_ID } from '@/features/sync/syncConfig';
import type { BookmarkRow, HighlightRow, Locator } from '@/features/sync/localDb/types';

/** Current route state. Imperative NetInfo read — the facades aren't React hooks. */
async function isOnline(): Promise<boolean> {
  const state = await NetInfo.fetch();
  return Boolean(state.isConnected);
}

const rowBase = (bookId: string, userId: string) => {
  const now = nowIso();
  return {
    id: newId(),
    user_id: userId,
    book_id: bookId,
    created_at: now,
    updated_at: now,
    is_deleted: 0 as const,
    synced: 0 as const,
  };
};

// ------------------------------------------------------------------ bookmarks

const bookmarks = {
  async list(bookId: string, userId: string = USER_ID): Promise<BookmarkRow[]> {
    if (await isOnline()) {
      const res = await api.list<any>('bookmarks', { userId, bookId });
      // api.list includes tombstones; the offline `listActive` shows only live rows, so match it.
      return (res.data ?? []).map(bookmarkMapper.toRow).filter((r) => r.is_deleted === 0);
    }
    return bookmarkStore.list(userId, bookId);
  },

  async addForCfi(
    cfi: string,
    chapterId: string | null,
    name: string | undefined,
    bookId: string,
    userId: string = USER_ID,
  ): Promise<void> {
    const locator: Locator = { type: 'EPUB', cfi };
    if (await isOnline()) {
      const row: BookmarkRow = {
        ...rowBase(bookId, userId),
        chapter_id: chapterId,
        locator: JSON.stringify(locator),
        name: name ?? null,
      };
      await api.create('bookmarks', bookmarkMapper.toServer(row));
      return;
    }
    await bookmarkStore.addForCfi(cfi, chapterId ?? undefined, name, bookId, userId);
  },

  async addForPage(
    page: number,
    name: string | undefined,
    bookId: string,
    userId: string = USER_ID,
  ): Promise<void> {
    if (await isOnline()) {
      const row: BookmarkRow = {
        ...rowBase(bookId, userId),
        chapter_id: `page-${page}`,
        locator: JSON.stringify({ type: 'PDF', page, offset: 0 } satisfies Locator),
        name: name ?? `Page ${page}`,
      };
      await api.create('bookmarks', bookmarkMapper.toServer(row));
      return;
    }
    await bookmarkStore.addForPage(page, name, bookId, userId);
  },

  async remove(id: string): Promise<void> {
    if (await isOnline()) {
      await api.remove('bookmarks', id);
      return;
    }
    await bookmarkStore.remove(id);
  },

  async rename(id: string, name: string): Promise<void> {
    if (await isOnline()) {
      const current = await api.findById<any>('bookmarks', id);
      await api.update('bookmarks', id, { ...current.data, name });
      return;
    }
    await bookmarkStore.rename(id, name);
  },
};

// ----------------------------------------------------------------- highlights

const highlights = {
  async list(bookId: string, userId: string = USER_ID): Promise<HighlightRow[]> {
    if (await isOnline()) {
      const res = await api.list<any>('highlights', { userId, bookId });
      return (res.data ?? []).map(highlightMapper.toRow).filter((r) => r.is_deleted === 0);
    }
    return highlightStore.list(userId, bookId);
  },

  async addFromCfi(
    startCfi: string,
    endCfi: string,
    color: string | undefined,
    bookId: string,
    userId: string = USER_ID,
  ): Promise<void> {
    if (await isOnline()) {
      const row: HighlightRow = {
        ...rowBase(bookId, userId),
        start_locator: JSON.stringify({ type: 'EPUB', cfi: startCfi } satisfies Locator),
        end_locator: JSON.stringify({ type: 'EPUB', cfi: endCfi } satisfies Locator),
        color: color ?? 'yellow',
      };
      await api.create('highlights', highlightMapper.toServer(row));
      return;
    }
    await highlightStore.addFromCfi(startCfi, endCfi, color, bookId, userId);
  },

  async addFromSelection(
    selection: SelectionRange,
    color: string | undefined,
    bookId: string,
    userId: string = USER_ID,
  ): Promise<void> {
    if (await isOnline()) {
      const row: HighlightRow = {
        ...rowBase(bookId, userId),
        start_locator: JSON.stringify({
          type: 'PDF',
          page: selection.page,
          offset: selection.startOffset,
        } satisfies Locator),
        end_locator: JSON.stringify({
          type: 'PDF',
          page: selection.page,
          offset: selection.endOffset,
        } satisfies Locator),
        color: color ?? 'yellow',
      };
      await api.create('highlights', highlightMapper.toServer(row));
      return;
    }
    await highlightStore.addFromSelection(selection, color, bookId, userId);
  },

  async remove(id: string): Promise<void> {
    if (await isOnline()) {
      await api.remove('highlights', id);
      return;
    }
    await highlightStore.remove(id);
  },
};

export const annotationsRouter = { bookmarks, highlights };
