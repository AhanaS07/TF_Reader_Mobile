// Owner: Search (Vaishnavi).
//
// The tokenization + snippet rules from the Day-3 design note (README.md), as
// pure string functions with NO I/O and no dependency on the index shape. Both
// the build side (indexing a chapter) and the query side (normalizing the search
// term) must tokenize IDENTICALLY, so the rule lives in exactly one place here.
//
// Rules (frozen by the design, not invented here):
//   • lowercase, strip surrounding punctuation, whole-word, NO stemming.
//   • a token is a maximal run of [A-Za-z0-9]; everything else is a separator.
//     "don't" -> "don","t" and "epub.js" -> "epub","js". That over-splits a few
//     words, but it is deterministic and matches "strip punctuation, whole-word"
//     for the prototype — real stemming/possessive handling is out of scope.

/** One word occurrence: the normalized word and where it started in the source. */
export interface Token {
  word: string;
  offset: number; // char offset of the word within the source text
}

const WORD = /[A-Za-z0-9]+/g;

/**
 * Split `text` into normalized tokens, each carrying its char offset in `text`.
 * The offset is what becomes a PDF `Locator.offset` on the build side and what
 * lets the snippet be cut around the exact hit.
 */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  // A fresh regex would also work; reusing one module-level regex means resetting
  // lastIndex, so construct locally to stay reentrant across concurrent calls.
  const re = new RegExp(WORD.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    tokens.push({ word: m[0].toLowerCase(), offset: m.index });
  }
  return tokens;
}

/**
 * Normalize a raw query `term` into its constituent tokens (words only). A
 * multi-word term yields multiple tokens; the query layer ANDs them.
 */
export function termTokens(term: string): string[] {
  return tokenize(term).map((t) => t.word);
}

// ~40 chars of context on each side of the hit — a fixed, predictable size for a
// results list (design note, "Tokenization & postings").
const SNIPPET_PAD = 40;

/**
 * Build the preview snippet around the hit spanning [start, end) in `text`,
 * padded by ~SNIPPET_PAD each side and trimmed inward to word boundaries so the
 * preview never begins or ends mid-word.
 */
export function makeSnippet(text: string, start: number, end: number): string {
  let from = Math.max(0, start - SNIPPET_PAD);
  let to = Math.min(text.length, end + SNIPPET_PAD);

  // If the left pad landed inside a word, walk forward to the next boundary.
  while (from < start && /[A-Za-z0-9]/.test(text[from - 1] ?? '')) from++;
  // If the right pad landed inside a word, walk back to the previous boundary.
  while (to > end && /[A-Za-z0-9]/.test(text[to] ?? '')) to--;

  return text.slice(from, to).trim();
}
