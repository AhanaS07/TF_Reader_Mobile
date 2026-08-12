// src/search/tokenise.ts
// Turning free text into comparable terms. Used on BOTH sides of a match — the
// reader's query and the publication's fields — because a query normalised one
// way and a corpus normalised another silently fails to match, and does it worst
// on exactly the accented author names people search for.
//
// OURS, NOT OPDS'. The Foundation Spec is explicit: matching, tokenisation and
// ranking are all ours; OPDS supplies at most a search link and its template.
// Q-E (search link template vs fetch-and-filter) is unresolved, and this is the
// fetch-and-filter half — it works either way and is the fallback needed
// regardless, so nothing here waits on wokay.

// Combining marks left behind by NFD decomposition, written as escapes rather
// than literal characters so the range is legible in a diff. An explicit range
// rather than a \p{Diacritic} property escape, whose Hermes support is not worth
// betting the search box on.
const COMBINING_MARKS = /[\u0300-\u036f]/g;

// Anything that is not a letter or a digit separates terms. Deliberately blunt:
// hyphens, colons and en-dashes are all word separators in a title, so
// "Post-Colonial" has to find "colonial" and "AI: A Survey" has to find "survey".
const SEPARATORS = /[^\p{L}\p{N}]+/gu;

/**
 * Lower-cases, strips accents, and splits on anything that is not a letter or
 * digit.
 *
 * Accent folding is one-directional on purpose: "Bronte" finds "Brontë" and
 * "Brontë" finds "Brontë", because both sides pass through here. A reader on a
 * UK keyboard cannot easily type the diaeresis and should not have to.
 */
export function tokenise(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .split(SEPARATORS)
    .filter((token) => token.length > 0);
}

/**
 * True when `term` opens `token`.
 *
 * PREFIX, NOT SUBSTRING. "eco" should find "ecology", but "log" should not —
 * substring matching turns every three-letter query into noise, and a reader
 * typing forwards only ever needs the prefix.
 */
export function isPrefixMatch(token: string, term: string): boolean {
  return token.startsWith(term);
}
