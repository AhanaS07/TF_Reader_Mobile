// src/features/library/ports.ts
// The SEAM between the Library screen and the sync/download/reader stack.
//
// Four teams build this app and everything merges into one tree. The reader,
// the encrypted content store, the SQLite sync engine and the download gate are
// Team 4's (Abhinav/Ahana/Vaishnavi/Karthik) and are NOT in this repo yet. Rather
// than block on that merge, the Library screen depends only on the interfaces
// below — never on `@/features/sync/...` or `@/features/download/...` directly.
//
// TODAY a stand-in provider backs these with this repo's own stores, and the
// opener is a no-op (rows stay inert, exactly as they render now). AT MERGE a
// single adapter maps these ports onto the real modules — `downloadTable`,
// `bookmarkTable`, `openBook`, and the `Reader` route — and the screen does not
// change. See INTEGRATION.md.
//
// The view-models are deliberately this app's shapes (camelCase, `itemId`), so
// the adapter is where Team 4's snake_case rows and ISO timestamps get mapped.
// See INTEGRATION.md for the exact field mapping.
import type { Bookmark } from '@/shared/contracts';
import type { BookId, ContentFormat } from '@/shared/types/primitives';

/**
 * Where a tapped row should land in the reader, mirroring Team 4's `ReaderTarget`
 * (`@/features/reader/readerBridge`) WITHOUT importing it — this repo has no
 * reader yet. EPUB anchors by CFI (`href`), PDF by page. AUDIO has no target
 * (its own route), so a bookmark into an audiobook yields `undefined` here.
 *
 * The shape is kept byte-identical to `ReaderTarget` so the merge adapter can
 * pass it straight through with a cast, not a rebuild.
 */
export type ReaderTargetLike =
  | { kind: 'href'; href: string }
  | { kind: 'page'; page: number };

/**
 * One downloaded book, as the shelf needs it.
 *
 * `itemId` NOT `bookId`: this screen, its hydration (`getItemsBatch`) and its
 * catalogue all speak `itemId`; Team 4's `DownloadRow.book_id` is the same
 * identity under the content layer's name, mapped in the adapter.
 *
 * `sizeBytes` is this repo's stand-in field (Team 4's row carries no size) and
 * `format`/`isValid` are Team 4's (the stand-in has neither) — both optional, so
 * either provider satisfies the shape and the screen degrades gracefully when a
 * field is absent (it already does: no size → "Downloaded" with no MB).
 */
export interface DownloadView {
  itemId: string;
  /** Epoch ms. The adapter parses Team 4's ISO `downloaded_at` into this. */
  downloadedAt: number;
  /** Bytes on disk, when known. Absent on the common path. */
  sizeBytes?: number;
  /** The file type, when known — needed to open, present once Team 4 backs this. */
  format?: ContentFormat;
  /** Team 4's `is_valid`: whether the licence behind the download still holds. */
  isValid?: boolean;
}

/**
 * One bookmark, as the shelf needs it — this repo's frozen `Bookmark` contract
 * (`@/shared/contracts`), unchanged. Team 4's `BookmarkRow` maps onto it in the
 * adapter (`parseLocator` for the JSON `locator`, `is_deleted` → `isDeleted`,
 * etc.), so every existing helper — `sortedBookmarks`, `bookmarkLocationLabel` —
 * keeps working untouched across the merge.
 */
export type BookmarkView = Bookmark;

/**
 * The reads the shelf makes. Async because the real source is SQLite/Mongo, not
 * an in-memory store — so at merge the screen fetches (and refreshes on focus /
 * connectivity change) rather than subscribing. The stand-in resolves
 * synchronously-backed data through the same async contract, so the screen's
 * data flow is already what the merge needs.
 */
export interface LibraryReads {
  listDownloads(userId: string): Promise<DownloadView[]>;
  /** Online/offline source selection (Mongo vs SQLite) is hidden inside the impl. */
  listBookmarks(userId: string): Promise<BookmarkView[]>;
}

/**
 * Opening a book — the ONE licence choke-point. The shelf never decides access
 * itself (Design Spec §5.1 / CONVENTIONS §3); it calls `openBook`, which at
 * merge is Team 4's `checkLicense → decrypt` gate.
 */
export interface BookOpener {
  /**
   * Run the licence gate + decrypt for a book, then leave it open for the reader.
   * Resolves when the book is ready to read; REJECTS on denial/network/offline.
   *
   * At merge this is `openBook(bookId, format)` (returns bytes there; the port
   * hides that — the screen only needs "did it open"). The stand-in rejects with
   * a "reader not available yet" error so rows can render a real disabled state.
   */
  openBook(itemId: string, format: ContentFormat): Promise<void>;
  /**
   * Navigate into the reader at an optional saved position. At merge this is
   * `navigation.navigate('Reader', { bookId, format, initialTarget })`; the
   * stand-in is a no-op (there is no Reader route in this repo yet).
   */
  openReader(target: { itemId: string; format: ContentFormat; initialTarget?: ReaderTargetLike }): void;
}

/** Everything the Library screen needs from the outside world, in one object. */
export interface LibraryProvider extends LibraryReads, BookOpener {}

/**
 * `openBook` throws this when there is no reader to open into — the state this
 * repo is in until Team 4's stack merges. It is part of the SEAM CONTRACT (not
 * the stand-in's private detail) so the screen can catch exactly this and let
 * every other error — a real network/licence failure once the reader is wired —
 * propagate instead of being mistaken for "not built yet".
 */
export class ReaderUnavailableError extends Error {
  constructor() {
    super('Reading is not available in this build yet.');
    this.name = 'ReaderUnavailableError';
    Object.setPrototypeOf(this, ReaderUnavailableError.prototype);
  }
}

// Re-exported so callers that only touch ids stay off `@/shared/types` directly.
export type { BookId, ContentFormat };
