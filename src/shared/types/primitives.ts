// src/shared/types/primitives.ts
// Base primitives — CAP-7 Reader & Offline (Team t4targaryen)
//
// Owner: Reader (Ahana). SINGLE SOURCE for these types. Everything else imports
// from here so decryptBook()/getBook() and every id/timestamp/format field agree
// by construction. Not covered by the OPDS source-of-truth — our TS conventions,
// EXCEPT ContentFormat, whose values are taken verbatim from wokay (PDF|EPUB|AUDIO).

// A content/book identifier. Backend keys books by itemId ("item_42"); the reader
// calls it bookId. PLAIN string alias (not branded) so it drops into teammate
// files that already use `bookId: string` with no casts.
export type BookId = string;

// Whole decrypted book (or index) held in RAM. Uint8Array, never a path/stream —
// enforces "never write plaintext to disk" at the type level. epub.js wants an
// ArrayBuffer for book.open(...); get it via `bytes.buffer`.
export type Bytes = Uint8Array;

// Epoch milliseconds (client wall-time). Wire/JSON timestamps from the grant and
// licence are ISO-8601 UTC strings — those stay `string`, not Timestamp.
export type Timestamp = number;

// Content/asset format from the backend (source-of-truth contentType enum).
// SINGLE SOURCE — Locator discriminants and search index format reference this
// casing. AUDIO never has a search index. It CAN be encrypted (reversed 3 Sep
// 2026 — backend team confirmed audio will ship encrypted, contradicting the
// original "audio is always plaintext" assumption baked into content-provider.ts).
export type ContentFormat = 'PDF' | 'EPUB' | 'AUDIO';
