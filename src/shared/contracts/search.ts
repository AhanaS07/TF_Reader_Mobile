// src/shared/contracts/search.ts
// In-book Search — CAP-7 Reader & Offline (Team t4targaryen)
//
// Owner: Search (Vaishnavi). DAY-1 = DRAFT SHAPE ONLY.
// Week-1 scope is design + a plaintext prototype (Day 4).
//
// Index shape:  word -> chapterId / page -> offset -> snippet
// Scope: in-book keyword only (no cross-book / semantic / elastic).
//
// One index per book, built ONCE at ingestion (server-side, on upload). Online
// and offline query the SAME index / SAME logic — online reads it server-side,
// offline reads the copy shipped to the device. So results are identical by
// construction; there is no separate index to keep in sync.
//
// Offline packaging: plaintext book -> build index -> encrypt index AES-GCM
//   under the SAME BEK as the book -> ship it BUNDLED with the encrypted book.
//   At download, Abhinav's decrypt pass decrypts the whole book AND the whole
//   index in one go (no client-side rebuild; no per-chapter / 3-chapter window
//   — prototype books are small). The decrypted index lives in RAM only (never
//   written to disk in plaintext). Index lifecycle follows the BEK; destroyed
//   with it.
import type { Locator } from './annotations';

// One occurrence of a word in the book — the value stored per hit in the index.
// Position uses the SAME `Locator` union as bookmarks/highlights so the Reader
// (Ahana) has ONE navigation path for annotations AND search hits:
//   EPUB -> { type:'EPUB'; cfi }   PDF -> { type:'PDF'; page; offset? }
export interface Posting {
  chapterId: string;
  locator: Locator; // where the hit is — Reader seeks to this
  snippet: string; // surrounding text for result preview
}

// Flat build-time row: a posting plus the word it belongs to. This is what the
// ingestion extractor emits; it is grouped by `word` into a SearchIndex below.
export interface IndexEntry extends Posting {
  word: string;
}

// ----- The index shape:  word -> chapterId / page -> offset -> snippet -----
//
// Inverted index (query form). Key = NORMALIZED word (lowercased, trimmed of
// punctuation; whole-word, no stemming for the prototype). Value = every
// occurrence, ordered by reading position so hits come back in book order.
export type SearchIndex = Record<string, Posting[]>;

// The full per-book artifact that gets encrypted (AES-GCM under the BEK) and
// bundled with the book at ingestion.
// RECONCILED (format casing): UPPERCASE to match ContentFormat in primitives.ts.
export interface BookSearchIndex {
  bookId: string;
  format: 'EPUB' | 'PDF'; // subset of ContentFormat (no AUDIO — no text to index)
  version: number; // index-format version, for future rebuilds/migrations
  index: SearchIndex; // word -> postings
}

// A search hit returned to the UI. Carries the same `Locator` shape as a
// Posting so the Reader navigates to it exactly like a bookmark/highlight.
export interface SearchHit {
  bookId: string;
  chapterId: string;
  locator: Locator; // Reader seeks to this
  snippet: string; // preview text (with the matched term)
}

// ----- Build + query signatures (draft) -----

// Build the per-book index from plaintext. Runs SERVER-SIDE at ingestion (book
// upload), not on the client. Emits IndexEntry[] internally, groups them into a
// BookSearchIndex, which is then encrypted under the BEK and bundled with the
// encrypted book; the client never rebuilds it.
export type BuildIndex = (bookId: string) => Promise<BookSearchIndex>;

// Query the index (NOT the content). The whole index is already decrypted in
// memory alongside the book (Abhinav's download decrypt pass), so this is a
// straight in-memory lookup — no lazy / per-chapter decryption.
export type QueryIndex = (bookId: string, term: string) => Promise<SearchHit[]>;
