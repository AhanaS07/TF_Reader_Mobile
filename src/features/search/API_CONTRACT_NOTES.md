# API_CONTRACT_NOTES.md — Search

**Owner: Vaishnavi. Status as of `83f4e2e` (2026-08-17).**

Where in-book Search meets the wokay/flambeau contracts. Short version: **your query logic is
untouched by both contracts** — it runs over a decrypted per-book index, not over HTTP — but three
things reach you anyway, and one of them is a change somebody else made in your file.

**Read alongside** `README.md` (your design note) — that stays the source of truth for the index
shape and the build/query flow; this only records contract-driven items. Nothing here has been
changed in your code.

- Ledger and cross-capability view: `src/shared/contracts/CONTRACT_ALIGNMENT.md`
- Full evidence: `src/shared/contracts/API_CONTRACT_REVIEW_CONTEXT.md`

---

## 1. Someone edited `queryIndex.ts` and flagged it for you

`84f2476` (Abhinav) added a guard to `cfiSteps()`: a **range CFI** — comma-separated
`parent,start,end` — now **throws** instead of falling through the regex. Previously every digit from
both range endpoints was concatenated into one nonsense step array, so it sorted wrong and never
told anyone.

It is unreachable today: `extractor.ts` emits only point CFIs. The change converts a future silent
sort bug into a loud one. It does **not** add range-CFI support, and his own comment says that's a
design decision that isn't his to make in your file.

**Your call, and there's a real decision behind it:**

- If ranges will never be emitted, the throw is the right permanent answer and the comment can lose
  its "pending review" framing.
- If a multi-word or highlight-spanning feature will emit them, `cfiSteps()` needs a real comparator
  (compare the parent path, then the start offset), not a guard — and `queryIndex.rangeCfi.test.ts`
  is where that gets pinned.

Either way it should stop being flagged as provisional in your directory. Note the contract angle:
`Posting.locator` uses the same `Locator` union as bookmarks and highlights, so if annotations ever
grow ranges, search inherits them.

---

## 2. `C3` 🟠 — catalogue search is unowned, and people will assume it's you

**This is the item most likely to land on you by accident.** wokay publishes nine app-facing
catalogue endpoints and the mobile app implements **zero**:

```
GET /opds/v1/institutions/{id}/catalogue      GET /opds/v1/public/catalogue
GET /opds/v1/institutions/{id}/groups/{gid}   GET /opds/v1/public/search
GET /opds/v1/institutions/{id}/search         GET /opds/v1/public/publications/{itemId}
GET /opds/v1/institutions/{id}/publications/{itemId}
GET /api/v1/institutions  ·  GET /api/v1/institutions/{id}
POST /api/v1/catalogue/items:batch
```

There is no OPDS feed parser, no institution picker, no `items:batch` call anywhere. The reader's
only book identity is `DEV_SAMPLE_BOOK_ID` from `devContentSeed.ts`, mounted directly in `App.tsx`.

**`src/features/search/` is in-book full-text search over a decrypted per-book index. It is not
catalogue search and it touches neither contract.** The ownership table in `CLAUDE.md` assigns you
"search", which reads as covering both — and consuming wokay's OPDS feeds is genuinely unassigned in
CAP-7's table. Two different capabilities, one word.

**Action: get it assigned explicitly at the Gate, one way or the other.** If it becomes yours, it is
a large piece of work (feed parsing, pagination, institution state, cover art) and nothing about
your existing index code carries over. If it doesn't, say so in writing, because it blocks:

- `B12` — the read path no longer hardcodes `format` (2026-08-17: Reader routes it from
  `SessionHandle.format`), but nothing can supply the TRUE value, because the contract's intended
  source is wokay's `contentType` on the catalogue record and there is nowhere to read it from.
- `B1` step 1 — signing in needs `GET /api/v1/institutions` to pick an institution first.
- `hasSearchIndex`, `accessTier`, `totalCopies`, cover art — all catalogue-only fields.

If you do take it on, one constraint is already known: **`C4`** — wokay caps `items:batch` at 100
ids (`400 TOO_MANY_IDS`), and flambeau's `GET /api/v1/library` deliberately doesn't paginate
*because* of that cap. A shelf longer than 100 must use the paged `GET /api/v1/loans` instead. Design
for both at once rather than discovering it.

---

## 3. `hasSearchIndex` — the capability hint you should be asking wokay for

wokay's catalogue record carries `hasSearchIndex`, explicitly `false` for audio and for books whose
text couldn't be extracted. Nothing in this app reads it, because there's no catalogue client
(`C3`).

**Why it matters to you specifically:** without it, the UI can't distinguish "this book has no index"
from "your search found nothing". Today `queryBookIndex` returns `[]` for both, and the search panel
shows the same empty state. Once a catalogue client exists, that's the field that fixes it.

The same pattern is the review's recommended answer to `B11` (a 25 MB client-side ceiling that no
contract knows about): a capability hint on the catalogue record, so the client can know before
downloading. `hasSearchIndex` is the precedent being cited. Worth supporting that ask — it's the same
mechanism.

---

## 4. `IndexUrl` fields are optional now, and that's correct

`84f2476` relaxed `IndexUrl.url` and `.encrypted` to optional in `shared/contracts/reading-session.ts`,
matching wokay's real schema and its stated convention: *"a null field is omitted rather than sent as
null; test for presence, not length."* `downloadManager.ts` was updated to gate on
`session.index?.url` rather than on `session.index`.

Consequences for you, all fine:

- An index is only present when the caller asked for it (`wantSearchIndex`) **and** the book actually
  has one. Absent index ⇒ `queryBookIndex` returns `[]`. That's the designed behaviour, not a bug.
- **`B_ok6` — an index fetch failure does not fail the book**, and that's deliberate: nothing in
  either contract requires an index for a book to be readable. Do not "fix" it into a hard failure.
- `IndexUrl.termCount` is mirrored from wokay and **nothing reads it**. Keeping it is right
  (`B_ok5` — dropping a contract field silently diverges). If you ever want a "searching N terms"
  progress signal, it's already on the wire.

---

## 5. Scaffolding that has to disappear together

Not a contract item, but it lives at your boundary and `CLAUDE.md` already tracks it: the dev search
index (`assets/reader/sample-search-index.json` + four other pieces) exists only so the search UI can
be exercised on a device, because nothing ships an index for the seeded book. It goes when
`devContentSeed.ts` goes — five items, listed in `CLAUDE.md`.

`SearchPanel.tsx`, `useBookSearch.ts` and the search wiring in `ReaderScreen.tsx` are **not** on that
list. The UI is permanent and doesn't know the fixture exists. Removing the five must leave it
compiling and green, with on-device searches simply returning `[]` again.

Separately: `assets/reader/sample-plaintext.epub` is now a **shared fixture** — `extractor.ts:43`
hard-codes its path, so deleting it breaks `search.test.ts`. Its removal needs you looped in,
separately from and later than `devContentSeed.ts`.
