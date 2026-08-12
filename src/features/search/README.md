# In-book Search — design note (Day 3)

Owner: **Search (Vaishnavi)**. Scope: CAP-7 Reader & Offline (Team t4targaryen).

This is a **design-only** document. Day-3 scope is the search-index build **design** plus the
build/query signatures; the plaintext prototype implementation is **Day 4**. No extraction or
query logic ships with this note — only the shape of it and the decisions behind it.

The frozen contract this design serves lives in `src/shared/contracts/search.ts`
(`Posting`, `IndexEntry`, `SearchIndex`, `BookSearchIndex`, `SearchHit`, `BuildIndex`,
`QueryIndex`). Nothing here changes those shapes; this note explains how they are produced and
consumed, and records the two cross-owner items still open.

Scope reminder (from the contract): **in-book keyword search only** — no cross-book, no semantic,
no elastic. One index per book, built **once** at ingestion.

---

## Flow

```
INGESTION (server-side, once per book)
  plaintext book (RAM)
    └─ extract all text in ONE pass ─────────▶ IndexEntry[]  (word + Posting)
    └─ group by normalized word ─────────────▶ SearchIndex   (word → Posting[])
    └─ wrap ─────────────────────────────────▶ BookSearchIndex {bookId, format, version, index}
    └─ JSON → bytes → AES-256-GCM (own nonce, SAME BEK as the book)
    └─ ship as EncryptedPackage.index, BUNDLED beside the encrypted book

DOWNLOAD / DECRYPT (Abhinav's pass — see OPEN ITEM 1)
  EncryptedPackage.content ──▶ decryptBook()  ──▶ book bytes (RAM, zeroed on close)
  EncryptedPackage.index   ──▶ decryptIndex() ──▶ BookSearchIndex (RAM, zeroed on close)  ← Abhinav

QUERY (identical online & offline)
  QueryIndex(bookId, term)
    └─ look up the session's in-RAM BookSearchIndex (by bookId)
    └─ queryIndex(index, term)  ← pure function
    └─ SearchHit[]  (reading order)
```

Online reads the index server-side; offline reads the copy shipped to the device and decrypted
into RAM. Same shape, same logic → **results are identical by construction; there is no separate
index to keep in sync.** The index never touches disk in plaintext, and its lifetime follows the
BEK — destroyed with it (`contentStore.destroy()` deletes `.index.bin`; deleting the wrapped BEK
turns it into noise).

---

## Build

`BuildIndex` keeps its frozen signature `(bookId) => Promise<BookSearchIndex>`. The build needs
the plaintext bytes, but the Day-4 prototype runs locally with no server to fetch from. Resolved
by introducing an **`Extractor` seam** behind the frozen façade:

- **Server impl** (production): fetches the book by `bookId` from server storage.
- **Prototype impl** (Day 4): reads a local sample from `samples/`.

No contract change; the `__typecheck__.ts` canary stays green.

The extractor makes **one pass** over the whole book (small prototype books, whole thing in
memory — no per-chapter / windowed extraction) and emits `IndexEntry[]`. Those are grouped by
normalized `word` into the `SearchIndex`, ordered by reading position so hits return in book
order.

**Both PDF and EPUB are in the final deliverable** (the full 8-week protocol ships both;
personalization already supports both). `BookSearchIndex.format` allows `'EPUB' | 'PDF'`
accordingly. The **Day-4 prototype starts PDF-first** — PDF `{page, offset}` locators are
producible server-side with no extra tooling — while **EPUB CFI is committed, not deferred**; only
the _how_ of generating CFIs at ingestion is still to align with Ahana (see OPEN ITEM 2).

### Tokenization & postings

- **Normalization** (from the contract): lowercase, trim surrounding punctuation, whole-word,
  **no stemming**. The index key is the normalized word.
- **PDF `offset`**: the char offset of the matched word within **that page's extracted text
  string**. Deterministic from the single extraction pass; the Reader maps it back to a position
  on the page. (`Locator` for PDF is `{ type: 'PDF'; page; offset? }`.)
- **Snippet**: **~40 characters each side** of the hit, trimmed to word boundaries. Fixed,
  predictable size for a results list.

---

## Query

`QueryIndex(bookId, term)` keeps its frozen signature. Two layers:

1. **Session lookup** — resolves the in-RAM `BookSearchIndex` for `bookId`. The index is
   decrypted **alongside the book into the same `bookId`-keyed session** and zeroed on
   `close()`, exactly like the plaintext book buffer. It dies with the BEK/session automatically —
   Search does **not** keep its own separate registry that could outlive `close()`.
2. **Pure lookup** — `queryIndex(index, term): SearchHit[]`. No I/O, no crypto, no session — a
   straight in-memory lookup over an already-decrypted index. This is the unit-testable core.

### Multi-word queries — AND of tokens

A query like `machine learning` is tokenized (same normalization as the index). Semantics for the
prototype: **return hits only in the addressing unit that contains _all_ tokens.**

- Unit = **page** for PDF; **chapter** for EPUB (both are final scope — see OPEN ITEM 2).
- Compute the set of pages that contain every query token, then return the matching postings on
  those pages, in reading order. No phrase-adjacency / in-order matching in the prototype.

This stays within the frozen `term: string` signature (tokenizing happens inside the query), and
matches the "in-book keyword" framing without pulling in phrase search.

---

## Alignment with Abhinav's decrypt (Encryption)

Already frozen in `src/shared/contracts/content-provider.ts`:

- The index is its **own AES-GCM ciphertext, its own nonce**, encrypted under the **same BEK** as
  the book, shipped as a **separate `EncryptedPackage.index?: Bytes` field** (not concatenated
  into the book payload).
- `contentStore.ts` already **persists** it (`.index.bin`), tracks `hasIndex`, reads it back on
  cold start, and `destroy()` deletes it.

**DONE (2026-08-12):** `contentStore.decryptSearchIndex(bookId)` decrypts `pkg.index` — same
session as `decryptBook`, same BEK, its own nonce, zeroed on `close()` alongside the book buffer.
Works for Elite (memory-only key, never touches the keychain) and Subscription alike. Independent
decrypt pass from `decryptBook`: a tampered/corrupted index rejects on its own without taking the
book down with it. `contentProvider.getIndex(bookId)` exposes this as the one-call Search-facing
seam (parallel to `getBook`) — Search never needs to import `contentStore.ts`,
`keyStorage.ts`, or `aesGcm.ts` directly. `mockSearchIndex.ts` supplies a real, structured
`BookSearchIndex` fixture (typed exactly as `BuildIndex`) for the encrypt/decrypt round trip to
run against ahead of the real word-extraction logic — a real builder is a drop-in replacement,
nothing downstream changes shape. Tests: `contentStore`'s own `searchIndex.test.ts` +
`.edgecases.test.ts`, and `contentProvider.test.ts`'s "search index available alongside the
decrypted book" block (proves both are resident in RAM at once, under the same session, without
disturbing each other).

**Still open on Search's side:** decoding the raw bytes `getIndex` returns into a `BookSearchIndex`
and running `queryIndex(index, term)` against it — that decode/query logic is Search's own, not
built here. `mockSearchIndex.ts`'s `decodeSearchIndex` shows the shape but is explicitly a test
fixture, not the real consumer path.

---

## Open items (cross-owner)

**ITEM 1 — index decrypt path. Owner: Abhinav (Encryption). DONE — see above.**

**ITEM 2 — EPUB CFI generation (with Ahana, Reader).**
EPUB is committed final scope, so this is a planned task, not a deferral — only the _how_ is open.
`Posting.locator` uses the same `Locator` union as bookmarks/highlights so the Reader has one
navigation path. PDF `{page, offset}` is straightforward to produce server-side. EPUB `{cfi}`
normally comes from `epub.js` in the Reader's WebView — generating equivalent CFIs at
ingestion-time build is non-trivial and the output must match what the Reader's WebView expects.
To align with Ahana: how CFIs are produced at ingestion (server-side `epub.js`-equivalent) so the
build-time CFI and the runtime navigation CFI agree. Day-4 prototype starts PDF-first; EPUB
indexing follows once this is settled.

---

## Draft signatures (for reference — not implemented in this note)

From `src/shared/contracts/search.ts`:

```ts
type BuildIndex = (bookId: string) => Promise<BookSearchIndex>;
type QueryIndex = (bookId: string, term: string) => Promise<SearchHit[]>;
```

Day-4 internals this design implies (types/stubs land Day 4, not here):

```ts
// Supplies plaintext to the build behind the frozen (bookId) façade.
interface Extractor {
  extract(bookId: string): Promise<{ format: 'PDF' | 'EPUB' /* per-page/chapter text */ }>;
}

// Pure, in-memory, no crypto/session — the unit-testable query core.
function queryIndex(index: BookSearchIndex, term: string): SearchHit[];
```
