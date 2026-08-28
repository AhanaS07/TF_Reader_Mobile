// Owner: Reader (Ahana).
//
// EPUB CFI range arithmetic — the two conversions the user-highlight path needs, as PURE string
// functions so they can be tested by calling them rather than by opening a book.
//
// >>> WHY THIS EXISTS AT ALL: THE TWO HALVES OF A HIGHLIGHT SPEAK DIFFERENT CFI DIALECTS. <<<
// epub.js reports a selection as ONE range CFI — `epubcfi(/6/4[c01]!/4/2,/2/1:0,/6/1:10)`, where the
// part before the first comma is the path both ends share and the two parts after it are the ends'
// own tails. Storage (`highlightStore.addFromCfi`) wants TWO independent point CFIs, because a
// `Locator` addresses a point, not a span. And `rendition.annotations.add` wants the range form back
// again to paint it. So every highlight crosses this boundary twice: split on the way in, join on
// the way out.
//
// DONE AS STRING ARITHMETIC RATHER THAN THROUGH `EpubCFI`, deliberately. epub.js's `EpubCFI` can
// collapse a range to one end (`collapse(toStart)`), but it has NO join — building the range back
// from two points would mean resolving both to DOM ranges through `book.getRange()` (async, loads
// the section) and re-deriving a CFI from the combined range. That is a round trip through the book
// for something that is pure text manipulation on a grammar the CFI spec already pins down, and it
// would be unreachable from a unit test.
//
// WHAT IS ASSUMED, AND IT IS THE SPEC'S OWN GRAMMAR: a step is `/` + digits + optional `[assertion]`,
// a terminal may carry `:offset`, and `[` `]` may contain anything including `/` and `,`. The
// tokeniser below is bracket-aware for exactly that reason — an id assertion like `[part/one]` would
// otherwise be split into two steps.

/** Strip the `epubcfi(...)` wrapper. Returns null for anything that is not one. */
function unwrap(cfi: string): string | null {
  const trimmed = cfi.trim();
  if (!trimmed.startsWith('epubcfi(') || !trimmed.endsWith(')')) return null;
  return trimmed.slice('epubcfi('.length, -1);
}

/**
 * Split an unwrapped CFI at the LAST `!` — the indirection step, which separates the spine
 * component (which document) from the local path (where inside it).
 *
 * The last, not the first: a CFI can carry more than one indirection (a document referencing
 * another), and it is always the final one that opens the path the range's ends live in.
 */
function splitBase(inner: string): { base: string; path: string } {
  const at = inner.lastIndexOf('!');
  return at === -1 ? { base: '', path: inner } : { base: inner.slice(0, at + 1), path: inner.slice(at + 1) };
}

/**
 * A local path -> its steps, each keeping its leading `/`.
 *
 * BRACKET-AWARE: `[...]` assertions may legally contain `/`, so a naive `path.split('/')` turns
 * `/4[part/two]/2` into three steps and silently corrupts every CFI that carries an id assertion
 * with a slash in it.
 */
function toSteps(path: string): string[] {
  const steps: string[] = [];
  let current = '';
  let depth = 0;

  for (const char of path) {
    if (char === '[') depth++;
    else if (char === ']') depth--;

    if (char === '/' && depth === 0) {
      if (current !== '') steps.push(current);
      current = '/';
      continue;
    }
    current += char;
  }

  if (current !== '') steps.push(current);
  return steps;
}

/**
 * Two point CFIs -> the one range CFI that spans them, or null if they cannot form a range.
 *
 * Null rather than a throw, and null in three cases that are all "this is not a span":
 *
 *  - either side is not an `epubcfi(...)`;
 *  - the two sides live in DIFFERENT documents (their bases disagree). A range CFI has exactly one
 *    base by construction, so a cross-chapter selection has no range form — epub.js cannot produce
 *    one either, so this is unreachable from a real selection and is checked rather than assumed;
 *  - the two sides are the same point, or one is a prefix of the other. A range needs a non-empty
 *    tail on BOTH sides (`epubcfi(base!common,,tail)` is not valid), and a collapsed range is not a
 *    highlight anyone asked for.
 */
export function joinCfiRange(startCfi: string, endCfi: string): string | null {
  const startInner = unwrap(startCfi);
  const endInner = unwrap(endCfi);
  if (startInner === null || endInner === null) return null;

  const start = splitBase(startInner);
  const end = splitBase(endInner);
  if (start.base !== end.base) return null;

  const startSteps = toSteps(start.path);
  const endSteps = toSteps(end.path);

  // Capped at one BELOW the shorter side: consuming every step of one end would leave it with an
  // empty tail, which is the invalid `,,` form above rather than a range.
  const maxCommon = Math.min(startSteps.length, endSteps.length) - 1;
  let common = 0;
  while (common < maxCommon && startSteps[common] === endSteps[common]) common++;

  const startTail = startSteps.slice(common).join('');
  const endTail = endSteps.slice(common).join('');
  if (startTail === '' || endTail === '' || startTail === endTail) return null;

  return `epubcfi(${start.base}${startSteps.slice(0, common).join('')},${startTail},${endTail})`;
}

/**
 * A range CFI -> the two point CFIs at its ends, or null if it is not a range.
 *
 * The inverse of `joinCfiRange`, and the direction a selection arrives in: epub.js's `selected`
 * event hands over a range CFI, and `highlightStore` stores two `Locator`s.
 *
 * Splits on TOP-LEVEL commas only, for the same bracket reason `toSteps` is bracket-aware.
 */
export function splitCfiRange(cfiRange: string): { startCfi: string; endCfi: string } | null {
  const inner = unwrap(cfiRange);
  if (inner === null) return null;

  const parts: string[] = [];
  let current = '';
  let depth = 0;
  for (const char of inner) {
    if (char === '[') depth++;
    else if (char === ']') depth--;

    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);

  if (parts.length !== 3) return null;
  const [common, startTail, endTail] = parts;
  if (startTail === '' || endTail === '') return null;

  return {
    startCfi: `epubcfi(${common}${startTail})`,
    endCfi: `epubcfi(${common}${endTail})`,
  };
}
