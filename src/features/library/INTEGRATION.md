# Library ↔ sync/download/reader integration

**Scope:** how the Library module in *this* repo (`_team1`) connects to Team 4's
sync/download/reader stack when the four-team codebases merge. This is **only**
the Library seam — it says nothing about merging auth, catalogue, navigation, or
the encryption layer, which are separate, larger efforts.

> ⚠️ **Point-in-time snapshot.** Every signature below was read from
> `AhanaS07/TF_Reader_Mobile` branch `origin/dev_T4`, read-only, on **2026-09-08**.
> That branch is active and may change. **Re-verify each signature against the
> branch at merge time** — treat this as a map, not a frozen contract. It is a
> code-shape guide; the merged app has not been run.

## The idea

`LibraryScreen` depends only on `LibraryProvider` (see `ports.ts`), never on any
concrete module. Today the default is `standInLibraryProvider` (reads this repo's
own stores; `openBook` refuses). At merge you write **one adapter** over Team 4's
real modules and mount it — the screen does not change.

## Step 1 — write the adapter (`syncProvider.ts`)

Implement `LibraryProvider` against Team 4's modules:

```ts
// src/features/library/syncProvider.ts  (NEW, at merge)
import { downloadTable } from '@/features/sync/stores/downloadStore';
import { bookmarkTable, parseLocator } from '@/features/sync/stores/bookmarkStore';
import { openBook as gateOpenBook } from '@/features/download/openBook';
import { api } from '@/features/sync/syncApi';
// + connectivity + a navigation ref for openReader

export function makeSyncLibraryProvider(deps): LibraryProvider {
  return {
    async listDownloads(userId) {
      const rows = await downloadTable.listActive(userId);
      return rows.map(downloadRowToView);
    },
    async listBookmarks(userId) {
      if (deps.isOnline()) {
        const res = await api.list('bookmarks', { userId });
        return (res.data ?? []).map(bookmarkDocToView).filter((b) => !b.isDeleted);
      }
      const rows = await bookmarkTable.listActive(userId);
      return rows.map(bookmarkRowToView);
    },
    async openBook(itemId, format) {
      await gateOpenBook(itemId, format);   // throws DownloadFailure on denial
      // gateOpenBook returns Uint8Array + leaves a session open; the port hides
      // the bytes. Ensure the Reader owns closing the session (contentStore.close).
    },
    openReader({ itemId, format, initialTarget }) {
      deps.navigate('Reader', { bookId: itemId, format, initialTarget });
    },
  };
}
```

`openReader`'s `initialTarget` is `ReaderTargetLike`, which is byte-identical to
Team 4's `ReaderTarget` (`@/features/reader/readerBridge`) — pass it straight
through (a cast at most).

## Step 2 — field mapping (the fiddly part)

| view-model (`ports.ts`) | Team 4 source (`dev_T4`) | note |
|---|---|---|
| `DownloadView.itemId` | `DownloadRow.book_id` | rename |
| `DownloadView.downloadedAt` (number, ms) | `Date.parse(DownloadRow.downloaded_at)` | ISO string → ms; `downloaded_at` is nullable |
| `DownloadView.format` | `DownloadRow.format` | string → `ContentFormat` |
| `DownloadView.isValid` | `DownloadRow.is_valid === 1` | 0/1 → boolean |
| `DownloadView.sizeBytes` | — | Team 4 row has no size; leave undefined |
| `BookmarkView.bookId` | `BookmarkRow.book_id` | rename |
| `BookmarkView.locator` | `parseLocator(BookmarkRow.locator)` | JSON string → `Locator`; drop the row if it returns null |
| `BookmarkView.chapterId` | `BookmarkRow.chapter_id` | `null` → undefined |
| `BookmarkView.name` | `BookmarkRow.name` | `null` → undefined |
| `BookmarkView.updatedAt` | `Date.parse(BookmarkRow.updated_at)` | for sort |
| `BookmarkView.isDeleted` | `BookmarkRow.is_deleted === 1` | 0/1 → boolean |
| `ReaderTargetLike` | Team 4 `ReaderTarget` | identical shape, pass through |

Locator note: this repo's `Locator` is EPUB/PDF only; Team 4's is the same union
via `@/shared/contracts`. `bookmarkTarget()` in `LibraryScreen.tsx` already
mirrors Team 4's `toTarget()` — or import `toTarget` and delete the local copy.

## Step 3 — mount the real provider (the ONLY screen-adjacent edit)

```tsx
<LibraryProviderContext.Provider value={makeSyncLibraryProvider(deps)}>
  {/* Library stack / app root */}
</LibraryProviderContext.Provider>
```

`LibraryScreen.tsx` is untouched. `openBook`/`openReader` now succeed, so the
rows that already tap open the reader for real.

## Step 4 — add the `Reader` route

`_team1`'s navigator has no `Reader` route. Bring Team 4's `ReaderRouteScreen`
over and register:

```ts
Reader: { bookId: BookId; format: ContentFormat; initialTarget?: ReaderTarget };
```

## Step 5 — delete the redundant stand-ins (one source of truth)

Once the adapter is live, remove — otherwise there are two download/bookmark
sources of truth:

- `src/features/library/standInProvider.ts`
- `src/store/downloadStore.ts` and its tests
- `src/store/bookmarkStore.ts` and its tests
- the `markDownloaded(...)` call added in `src/screens/ItemDetailScreen.tsx`
  (the real download layer records downloads; borrowing no longer should)
- update `LibraryScreen.tsx`'s `useDownloadStore`/`useBookmarkStore` reads to go
  through `provider.listDownloads/listBookmarks` (the reads-seam deferred from the
  original plan — this is where it lands)

## Step 6 — error mapping

Replace the stand-in's generic catch in `openItem` with Team 4's
`DownloadFailure.code` → user copy, e.g.:

| `DownloadError` | copy |
|---|---|
| `OFFLINE_LICENSE_UNAVAILABLE` | "You're offline and this book isn't downloaded." |
| `ENTITLEMENT_EXPIRED` / `ENTITLEMENT_REVOKED` | "Your access to this book has ended." |
| `DEVICE_LIMIT_REACHED` | "You're reading on too many devices. Close one to continue." |
| `DOWNLOAD_NOT_PERMITTED` | "This title is read online only." |
| (default) | the current generic line |

## Verification at merge

- Unit: swap the provider in `LibraryScreen.test.tsx` for a fake implementing
  `LibraryProvider` (see `ports.ts`) and assert tap → `openBook`/`openReader`.
- Runtime: on device, tap a downloaded book → reader opens; tap a bookmark →
  reader lands on the saved position; offline → bookmarks fall back to SQLite.
