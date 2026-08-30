// Owner: Reader (Ahana).
//
// The CFI range grammar, exercised by CALLING it — which is the whole reason this arithmetic is a
// pure module rather than a few lines inside epub.entry.ts. Every case here is a shape a real book
// produces: epub.js hands a range CFI to `selected`, `highlightStore` stores two point CFIs, and the
// two have to survive a round trip in both directions or a saved highlight paints in the wrong place
// (or not at all), which no unit test that stopped at the entry's door could see.

import { cfiHasBase, expandPointCfi, joinCfiRange, splitCfiRange } from './epubCfiRange';

const RANGE = 'epubcfi(/6/4[chap01]!/4/2,/2/1:0,/6/1:10)';
const START = 'epubcfi(/6/4[chap01]!/4/2/2/1:0)';
const END = 'epubcfi(/6/4[chap01]!/4/2/6/1:10)';

describe('splitting a range CFI into its two ends', () => {
  it('gives each end the common prefix plus its own tail', () => {
    expect(splitCfiRange(RANGE)).toEqual({ startCfi: START, endCfi: END });
  });

  it('keeps the indirection step with the base, not with the path', () => {
    // The `!` is what separates "which document" from "where inside it". Splitting on the wrong side
    // of it produces two CFIs that address nothing, and epub.js resolves them to no spine item.
    const ends = splitCfiRange(RANGE);
    expect(ends?.startCfi).toContain('/6/4[chap01]!');
    expect(ends?.endCfi).toContain('/6/4[chap01]!');
  });

  it('refuses a point CFI, which has no ends to split', () => {
    expect(splitCfiRange(START)).toBeNull();
  });

  it('refuses anything that is not an epubcfi', () => {
    expect(splitCfiRange('/6/4!/4/2,/2/1:0,/6/1:10')).toBeNull();
    expect(splitCfiRange('')).toBeNull();
  });

  it('refuses a range with an empty side', () => {
    // `epubcfi(base!path,,tail)` is not a span, and half a highlight is worse than none.
    expect(splitCfiRange('epubcfi(/6/4!/4/2,,/6/1:10)')).toBeNull();
  });
});

describe('joining two point CFIs back into a range', () => {
  it('round-trips the split', () => {
    expect(joinCfiRange(START, END)).toBe(RANGE);
  });

  it('shares as much of the path as the two ends agree on', () => {
    // Both ends inside the SAME text node — the common case for a short selection, where everything
    // up to the terminal is shared and only the character offsets differ.
    expect(joinCfiRange('epubcfi(/6/4!/4/2/1:3)', 'epubcfi(/6/4!/4/2/1:9)')).toBe(
      'epubcfi(/6/4!/4/2,/1:3,/1:9)',
    );
  });

  it('never consumes every step of a side, which would leave it with no tail', () => {
    // One end a strict prefix of the other. Stopping one step short is what keeps both tails
    // non-empty — the alternative is the `,,` form the splitter refuses above.
    const joined = joinCfiRange('epubcfi(/6/4!/4/2)', 'epubcfi(/6/4!/4/2/6/1:10)');
    expect(joined).toBe('epubcfi(/6/4!/4,/2,/2/6/1:10)');
    expect(splitCfiRange(joined ?? '')).not.toBeNull();
  });

  it('is bracket-aware, so an id assertion containing a slash stays one step', () => {
    // `[part/two]` is legal in a CFI assertion. A naive split on '/' turns one step into three and
    // silently mis-computes the common prefix, which puts the highlight on the wrong element.
    expect(joinCfiRange('epubcfi(/6/4[part/two]!/4/2/1:0)', 'epubcfi(/6/4[part/two]!/4/6/1:5)')).toBe(
      'epubcfi(/6/4[part/two]!/4,/2/1:0,/6/1:5)',
    );
  });

  it('refuses two ends in different documents', () => {
    // A range CFI has exactly one base by construction. epub.js cannot produce a cross-document
    // selection either, so this is checked rather than assumed.
    expect(joinCfiRange('epubcfi(/6/4!/4/2/1:0)', 'epubcfi(/6/8!/4/2/1:5)')).toBeNull();
  });

  it('refuses a collapsed span', () => {
    expect(joinCfiRange(START, START)).toBeNull();
  });

  it('refuses anything that is not an epubcfi', () => {
    expect(joinCfiRange('/6/4!/4/2/1:0', END)).toBeNull();
    expect(joinCfiRange(START, 'nonsense')).toBeNull();
  });
});

// --- expanding a search hit's point CFI into something paintable --------------------------------
//
// The search index stores a COLLAPSED CFI at the matched token's start (extractor.ts builds the
// range with `setStart`/`setEnd` at the same point), because navigation only ever needed a place to
// seek to. Painting needs a span. Every case below is a shape the extractor or epub.js actually
// produces — the failures matter more than the successes here, because a wrong expansion paints a
// confident outline around the wrong words rather than failing visibly.

describe('expanding a point CFI to cover a match', () => {
  it('advances the terminal character offset by the length of the term', () => {
    expect(expandPointCfi('epubcfi(/6/4[chap01]!/4/2/6/1:10)', 7)).toBe(
      'epubcfi(/6/4[chap01]!/4/2/6,/1:10,/1:17)',
    );
  });

  it('splits at the LAST differing step, so the common path is shared once', () => {
    // The two ends differ only in their offset, so everything above the text node is common —
    // which is what makes the range CFI shorter than either endpoint rather than longer.
    const range = expandPointCfi('epubcfi(/6/2!/4/4/1:0)', 5);
    expect(range).toBe('epubcfi(/6/2!/4/4,/1:0,/1:5)');
  });

  it('keeps a bracket assertion containing a slash intact', () => {
    // `toSteps` is bracket-aware for this exact reason: an id assertion may legally contain `/`,
    // and a naive split would turn one step into two and corrupt the path.
    expect(expandPointCfi('epubcfi(/6/4[part/one]!/4/2/1:3)', 4)).toBe(
      'epubcfi(/6/4[part/one]!/4/2,/1:3,/1:7)',
    );
  });

  it('does not carry a text-location assertion onto the END offset', () => {
    // A `[pre,post]` assertion describes the characters either side of the offset it is attached
    // to. Copying it onto a different offset would assert something false about the document, so
    // the start keeps it and the end goes bare.
    expect(expandPointCfi('epubcfi(/6/4!/4/2/1:10[the,re])', 5)).toBe(
      'epubcfi(/6/4!/4/2,/1:10[the,re],/1:15)',
    );
  });

  it('reads only a TOP-LEVEL colon as the terminal offset', () => {
    // A colon inside an assertion is text, not grammar. Splitting on the first one found would read
    // `post` as the offset and produce nonsense.
    expect(expandPointCfi('epubcfi(/6/4!/4/2/1:4[pre:post])', 2)).toBe(
      'epubcfi(/6/4!/4/2,/1:4[pre:post],/1:6)',
    );
  });

  it('handles a path of a single step, where there is no common prefix at all', () => {
    expect(expandPointCfi('epubcfi(/6/4!/1:5)', 4)).toBe('epubcfi(/6/4!,/1:5,/1:9)');
  });

  it('refuses a CFI addressing an ELEMENT rather than a character position', () => {
    // No `:offset` terminal means there is no character to advance from. This is the shape a TOC
    // href-style CFI has, and it must not be guessed at.
    expect(expandPointCfi('epubcfi(/6/4!/4/2/6)', 5)).toBeNull();
    expect(expandPointCfi('epubcfi(/6/4!/4/2/6[id])', 5)).toBeNull();
  });

  it('refuses a term with no length — an empty query paints nothing', () => {
    expect(expandPointCfi('epubcfi(/6/4!/4/2/1:10)', 0)).toBeNull();
    expect(expandPointCfi('epubcfi(/6/4!/4/2/1:10)', -3)).toBeNull();
    expect(expandPointCfi('epubcfi(/6/4!/4/2/1:10)', 1.5)).toBeNull();
  });

  it('refuses anything that is not an epubcfi', () => {
    expect(expandPointCfi('/6/4!/4/2/1:10', 5)).toBeNull();
    expect(expandPointCfi('', 5)).toBeNull();
  });

  it('round-trips back through splitCfiRange to the point it started from', () => {
    // The strongest statement of correctness available without a book: whatever this builds, the
    // inverse has to recover the original start. `highlightStore` relies on that pairing for user
    // highlights, and the search layer now mints ranges into the same annotation store.
    const start = 'epubcfi(/6/4[chap01]!/4/2/6/1:10)';
    const range = expandPointCfi(start, 7);
    expect(range).not.toBeNull();
    expect(splitCfiRange(range as string)?.startCfi).toBe(start);
  });
});

// --- which chapter a CFI belongs to --------------------------------------------------------------
//
// >>> THE REASON THIS FUNCTION EXISTS IS A MEASUREMENT, NOT A HUNCH. <<< Resolving a CFI against the
// wrong chapter's document does not fail — `EpubCFI.toRange` walks only the local path after `!` and
// ignores the spine component entirely. Probed against this repo's own sample EPUB: of 400 CFIs
// taken from chapters 2 and 3 and resolved against chapter 1, 399 came back as real ranges (one
// threw, none returned null), several of them addressing different text than they name. So "just try
// it and see" is not a chapter test, and every caller that crosses chapters needs this first.

describe('matching a CFI to the chapter document it addresses', () => {
  const CH1 = 'epubcfi(/6/2[ch1]!/4/4,/1:29,/1:33)';

  it('matches its own base', () => {
    expect(cfiHasBase(CH1, '/6/2[ch1]')).toBe(true);
  });

  it('rejects another chapter, which is the whole point', () => {
    expect(cfiHasBase(CH1, '/6/4[ch2]')).toBe(false);
    expect(cfiHasBase(CH1, '/6/6[ch3]')).toBe(false);
  });

  it('compares whole steps, so /6/2 does not match /6/22', () => {
    // A bare `startsWith` on the string would pass this and mis-scope a book with twelve chapters.
    expect(cfiHasBase('epubcfi(/6/22[ch12]!/4/4,/1:0,/1:4)', '/6/2')).toBe(false);
    expect(cfiHasBase('epubcfi(/6/22[ch12]!/4/4,/1:0,/1:4)', '/6/22[ch12]')).toBe(true);
  });

  it('requires the assertion to agree too, rather than ignoring it', () => {
    expect(cfiHasBase(CH1, '/6/2')).toBe(false);
  });

  it('splits on the LAST indirection, matching splitCfiRange and joinCfiRange', () => {
    // A CFI may carry more than one `!`; the final one opens the path the ends live in, so the base
    // is everything before it.
    expect(cfiHasBase('epubcfi(/6/2[ch1]!/4/2!/4/4,/1:0,/1:4)', '/6/2[ch1]!/4/2')).toBe(true);
    expect(cfiHasBase('epubcfi(/6/2[ch1]!/4/2!/4/4,/1:0,/1:4)', '/6/2[ch1]')).toBe(false);
  });

  it('is false for an empty base and for a non-CFI, rather than matching everything', () => {
    // `Contents.cfiBase` is a plain string field; an unset one must not turn this into "yes".
    expect(cfiHasBase(CH1, '')).toBe(false);
    expect(cfiHasBase('/6/2[ch1]!/4/4', '/6/2[ch1]')).toBe(false);
  });

  it('is false for a CFI with no indirection at all', () => {
    expect(cfiHasBase('epubcfi(/6/2/4/4,/1:0,/1:4)', '/6/2[ch1]')).toBe(false);
  });
});
