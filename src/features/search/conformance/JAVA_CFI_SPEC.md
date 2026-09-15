# EPUB CFI generation — Java implementation spec & conformance protocol

**Audience:** the wokay engineer porting the search-index builder to Java (`tf-reader-backend`).
**Owner of this spec + the oracle:** Search (Vaishnavi), team t4targaryen.
**Status:** Strategy A, in progress. This is the target the Java builder is validated against.

---

## 0. The one rule that matters

**The golden fixture is the normative spec. Your Java output must match it byte-for-byte.**

The golden lives next to this file:

```
src/features/search/conformance/<book>.cfi-golden.jsonl
```

It is produced by the reference implementation — this repo's epub.js-under-jsdom extractor, frozen by
`scripts/cfiOracle.ts`. epub.js is the authority on CFIs because the *client also resolves them with
epub.js*; a CFI that doesn't match the golden will not resolve on the device (search finds the hit,
tapping navigates nowhere). This doc explains the algorithm to help you implement it, but when the
prose and the golden disagree, **the golden wins.**

The reference implementation runs at **test time only** — it never runs in `tf-reader-backend`, so
your "no Node in production" constraint is untouched.

---

## 1. Golden format

One JSON object per line, in **reading order** (the order tokens appear in the book). Keys in this
exact order; UTF-8; one object per line; trailing newline:

```json
{"seq":0,"word":"chapter","chapterId":"ch1","cfi":"epubcfi(/6/2[ch1]!/4/2/1:0)","snippet":"Chapter One: Opening the Book"}
```

| Field | Meaning |
| --- | --- |
| `seq` | Token ordinal in reading order, assigned by the builder. Must match the golden. |
| `word` | The normalized token (see §4). |
| `chapterId` | The spine item's id. |
| `cfi` | The EPUB CFI for the token's **start** (see §2–§3). **The risky field.** |
| `snippet` | Preview text around the hit (see §4). |

Conformance = your builder emits the same lines, same order, same key order, and `diff` is empty.

---

## 2. Anatomy of a CFI

`epubcfi(/6/2[ch1]!/4/2/1:8)` has three parts:

```
  /6/2[ch1]        cfiBase — path through the PACKAGE document (OPF) to the spine item
  !                the indirection step — "now enter the content document"
  /4/2/1:8         path through the CONTENT document's DOM to a text node, at char offset 8
```

- **cfiBase** is pure arithmetic over the OPF. Straightforward in Java (§3.1).
- **The in-document path** is DOM node-counting. This is where Java diverges from epub.js if careless
  (§3.2). It is the whole reason Strategy A carries risk.

---

## 3. The algorithm

### 3.1 cfiBase — from the OPF (easy)

1. Read `META-INF/container.xml` → `<rootfile full-path>` to locate the OPF. **Do not assume
   `OEBPS/`.**
2. Parse the OPF. Walk the `<spine>` in document order; each `<itemref idref="…">` is one chapter, in
   reading order.
3. Each step in the base uses the **even-index rule** over its **element** siblings:
   `step = (elementIndexAmongSiblings + 1) * 2`.
   - The spine element resolves to `/6` in a standard OPF (it is the 3rd element child of `<package>`
     → `(2+1)*2 = 6`). **Compute it; do not hardcode `/6`** — a non-standard OPF can differ.
   - The itemref resolves to `(itemrefIndex + 1) * 2` among the spine's `<itemref>` children.
4. Append the id as an assertion: `[idref]`.
   - Example: first spine item with `idref="ch1"` → `cfiBase = /6/2[ch1]`.

### 3.2 In-document path — DOM node-counting (the hard part)

For each token, produce the path from the content document root to the **text node containing the
token's first character**, then append `:offset`.

**Node-step rule (this is where fidelity lives):**
- Count **all** child nodes of each element in document order — **both element and text nodes**.
- **Element** nodes get **even** steps; **text** nodes get **odd** steps. epub.js interleaves them:
  the Nth child contributes step `N*2` if it's counted as an element position, `N*2−1` if text. In
  practice: walk children, and assign steps so elements land on even numbers and the text nodes
  between/around them land on the adjacent odd numbers.
- **Whitespace-only text nodes count.** Do not trim or skip them — a dropped whitespace text node
  shifts every subsequent step and every CFI after it is wrong.
- `:offset` is the **0-based character offset within that single text node**, measured the same way
  the token was located during extraction (§4).

**Do not hand-roll this from memory.** The reference implementation deliberately delegates the
in-document path to epub.js's `Range → EpubCFI` precisely because hand-deriving the even/odd numbering
is the most common CFI bug. In Java, build the path by walking the parsed DOM with the rules above and
**verify every token against the golden**, not by eyeballing.

### 3.3 Parse mode — must match, or refuse the book

Parse each content document as **XML (`application/xhtml+xml`)**, matching epub.js's build-time mode.

The reference builder has a guard (`chapterEntriesChecked`): it generates CFIs under **both**
`application/xhtml+xml` and `text/html` and **throws if they diverge**, refusing to index that book —
because the client renders into an HTML document at runtime, so a book whose CFIs differ by parse mode
would have build-time CFIs that don't resolve at runtime. **Port this guard.** You only need to match
the golden for books that *pass* it; ambiguous books are refused, not indexed. This shrinks your
target to the well-behaved case.

---

## 4. Tokenization & snippet (must match `src/features/search/text.ts`)

CFIs won't line up unless tokenization does, because `:offset` and `seq` are defined by it.

- **Normalize:** lowercase, strip punctuation, whole-word, **no stemming**.
- **`seq`:** assigned in reading order as tokens are emitted; must match the golden exactly.
- **`snippet`:** ~40 characters each side of the hit, trimmed to word boundaries. Match `text.ts`.
- **`chapterId`:** the spine item's `idref`.

When in doubt, read `text.ts` — it is the reference tokenizer, and matching it is part of conformance.

---

## 5. Conformance protocol

1. **Generate/refresh the golden** (Search side, already done for the sample):
   ```
   npx tsx src/features/search/scripts/cfiOracle.ts "<book.epub>" "<bookId>"
   ```
2. **Your Java builder emits the same JSONL** (same fields, key order, normalization, reading order).
3. **Diff.** Zero diff = pass. A single changed line points to the exact divergent token.
4. **Anchor check (must pass):** the sample golden contains Ahana's device-verified CFIs
   `epubcfi(/6/2[ch1]!/4/4/1:0)` and `epubcfi(/6/2[ch1]!/4/4/1:113)`. If those two don't match, the
   base or the stepping is wrong — start there.
5. **Grow the corpus.** Run the oracle on more real EPUBs, commit each golden here, and require Java
   to pass all of them before ship. One 3-chapter sample is a smoke test, not proof.

**Do not ship the Java builder until the corpus diff is clean.** Unverified CFIs are the exact failure
(hits that don't navigate) this whole exercise exists to prevent.

---

## 6. Out of scope

- **PDF** locators are `{ page, offset }` — no CFI, trivial in Java, no golden needed.
- **Encryption / storage / bundling** of the index is wokay's, and the index is an opaque blob to it —
  see the interface contract (`My_Reports/in-book-search-index-contract.md`).

---

## 7. Files

| File | Role |
| --- | --- |
| `scripts/cfiOracle.ts` | Reference generator — freezes epub.js output as a golden. Test-time only. |
| `conformance/*.cfi-golden.jsonl` | The goldens. Normative. Java must match byte-for-byte. |
| `extractor.ts` (`chapterEntriesChecked`, `readSpine`) | The reference algorithm in code. |
| `text.ts` | The reference tokenizer + snippet rules. |
