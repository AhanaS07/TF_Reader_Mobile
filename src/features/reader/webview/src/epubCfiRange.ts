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

/**
 * The last step's character offset, split from the step around it — or null if it carries none.
 *
 * BRACKET-AWARE for the same reason `toSteps` is: a text-location assertion may legally contain a
 * `:` (`[pre:post]`), and splitting on the first one found would turn a valid CFI into a nonsense
 * offset. Only a top-level `:` is the terminal.
 */
function splitTerminalOffset(step: string): { head: string; offset: number } | null {
  let depth = 0;
  let at = -1;

  for (let i = 0; i < step.length; i++) {
    const char = step[i];
    if (char === '[') depth++;
    else if (char === ']') depth--;
    else if (char === ':' && depth === 0) at = i;
  }

  if (at === -1) return null;

  // The digits run to the end of the step or to the assertion that follows them. Anything else
  // after the colon (an empty offset, a non-numeric one) is not a terminal we can do arithmetic on.
  const rest = step.slice(at + 1);
  const digits = /^\d+/.exec(rest);
  if (!digits) return null;

  return { head: step.slice(0, at), offset: Number.parseInt(digits[0], 10) };
}

/**
 * A POINT CFI + a character count -> the range CFI covering that many characters from it.
 *
 * >>> WHY THE READER EXPANDS RATHER THAN THE INDEX STORING A RANGE. <<< `extractor.ts` emits a
 * COLLAPSED range at the matched token's start (`range.setStart(node, offset)` then `setEnd` to the
 * same point) — a "seek here" locator, which is all navigation ever needed. Painting needs a span,
 * and `highlightSeam.add` takes a range CFI. Storing range CFIs instead would grow every posting in
 * every book's index to give the reader something it can derive; this is Decision A in the
 * search-match brief, and it is why the payload carries `matchText` at all.
 *
 * Null rather than a throw, in four cases that are all "there is no span here":
 *
 *  - `length` is not a positive integer (an empty term paints nothing);
 *  - the CFI is not an `epubcfi(...)`, or has no steps;
 *  - its last step carries no `:offset` terminal, so there is no character position to advance from
 *    — a CFI addressing an ELEMENT rather than a point inside a text node;
 *  - `joinCfiRange` refuses the pair.
 *
 * >>> THE LENGTH IS THE QUERY'S, NOT THE DOCUMENT'S, AND FOR A PHRASE THOSE CAN DIFFER. <<<
 * `queryIndex` emits a multi-word hit at the phrase's FIRST token, and the document may separate
 * those tokens with punctuation the reader did not type — so a phrase's box can end a character or
 * two short or long. MEASURED through the real pipeline on this repo's sample book (chapter 1, every
 * two-word phrase the text actually contains, 713 hits): **616 cover the exact phrase, 97 differ,
 * none are in the wrong place, none overrun.** Every one of the 97 is punctuation the query omits —
 * `"One Opening"` drawn over `"One: Openin"`, `"book paragraph"` over `"book — paragra"`. The box
 * always STARTS on the match.
 *
 * Sizing it from the document instead would mean walking the DOM to find the phrase's end, which is
 * the round trip through the book this file exists to avoid — for a box that is already in the right
 * place and the right size to within a comma. Single-word matches, the overwhelming majority, are
 * exact: 713 of 713 on the same chapter.
 *
 * NO CLAMP AGAINST THE TEXT NODE'S OWN LENGTH — this is pure string arithmetic and cannot know it.
 * A match running past the end of its text node yields a range epub.js cannot resolve, which is why
 * `epub.entry.ts` paints inside a `try` and reports `searchMatchPainted: false` rather than assuming
 * a non-null return here means a visible box.
 */
export function expandPointCfi(startCfi: string, length: number): string | null {
  if (!Number.isInteger(length) || length <= 0) return null;

  const inner = unwrap(startCfi);
  if (inner === null) return null;

  const { base, path } = splitBase(inner);
  const steps = toSteps(path);
  const last = steps[steps.length - 1];
  if (last === undefined) return null;

  const terminal = splitTerminalOffset(last);
  if (terminal === null) return null;

  // The start keeps whatever assertion it arrived with; the END drops it. A text-location assertion
  // describes the characters around the offset it is attached to, so copying the start's onto a
  // different offset would assert something false about the document.
  const endSteps = [...steps.slice(0, -1), `${terminal.head}:${String(terminal.offset + length)}`];
  return joinCfiRange(startCfi, `epubcfi(${base}${endSteps.join('')})`);
}

/**
 * The SPINE POSITION a CFI addresses — epub.js's `sectionIndex` — or null if it names none.
 *
 * >>> A CFI RESOLVES AGAINST THE WRONG CHAPTER RATHER THAN FAILING, SO THIS CANNOT BE SKIPPED. <<<
 * The tempting shortcut is "just call `contents.range(cfi)` and see what happens" — and it is
 * wrong, because `EpubCFI.toRange` walks only the LOCAL path after `!` and never looks at the spine
 * component. MEASURED on this repo's own sample book: of 400 CFIs taken from other chapters and
 * resolved against chapter 1's document, **399 resolved to a real range** (one threw, none returned
 * null), several of them to different text than they name — `epubcfi(/6/6[ch3]!…)` addressing the
 * word "1" came back as ".". So anything that paints or hit-tests across chapters must scope on the
 * spine component FIRST, and cannot learn it by trying.
 *
 * >>> WHY A NUMBER AND NOT A BASE-STRING COMPARISON. THIS IS WHERE THE FEATURE DIED ON DEVICE. <<<
 * The obvious test is `cfi.startsWith(contents.cfiBase)`. It never matches, because the two things
 * that mint a base for the same chapter disagree about how to spell it:
 *
 *   `search/extractor.ts`  ->  `/6/2[ch1]`   `/${spineStep}/${itemrefStep}[${idref}]`
 *   epub.js at runtime     ->  `/6/2`        spine.js:59 passes `item.id` — the <itemref>'s own
 *                                            `id` ATTRIBUTE, not its `idref` — and
 *                                            `generateChapterComponent` appends `[…]` only `if (id)`
 *
 * An `<itemref idref="ch1"/>` with no `id` (the normal case, and this repo's sample book) therefore
 * gets a bare `/6/2` at runtime while every indexed CFI carries the assertion. Nothing fails loudly:
 * the comparison just answers "different chapter" forever, and the paint is gated off in silence.
 *
 * Stripping assertions would fix only half of it. The two producers can also disagree on the STEP
 * NUMBERS — `extractor.ts` indexes over every element child of `<spine>`, epub.js's `item.index`
 * counts only `<itemref>`s — so a spine with any other child would drift again. The spine POSITION
 * is immune to both, and it is the comparison epub.js itself makes: `Annotations.add` attaches on
 * `annotation.sectionIndex === view.index`. That is why painting was always correctly scoped while
 * everything built on base strings was not.
 *
 * The arithmetic is epub.js's `parseStep`: an even step `n` is the `n / 2 - 1`'th element child. Null
 * for a CFI with no indirection, a spine component of fewer than two steps, or an ODD second step
 * (odd means a text node, which is not a spine item and means the CFI is malformed for this use).
 */
export function cfiSpinePos(cfi: string): number | null {
  const inner = unwrap(cfi);
  if (inner === null) return null;

  // `splitBase` keeps the trailing `!`; drop it before reading steps. An empty base means the CFI
  // has no indirection at all, so it addresses no spine item.
  const { base } = splitBase(inner);
  if (base === '') return null;

  // The LAST `!` is what `splitBase` finds, so with a nested indirection this base is longer than
  // the spine component — but the first two steps are still the spine component, which is all this
  // reads. epub.js's own `getChapterComponent` splits on the FIRST `!` and lands on the same steps.
  const steps = toSteps(base.slice(0, -1));
  if (steps.length < 2) return null;

  // Digits only, ignoring any `[assertion]` that follows them — which is the entire point.
  const digits = /^\/(\d+)/.exec(steps[1]);
  if (digits === null) return null;

  const step = Number.parseInt(digits[1], 10);
  return step % 2 === 0 ? step / 2 - 1 : null;
}
