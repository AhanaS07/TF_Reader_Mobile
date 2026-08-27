// Owner: Reader (Ahana).
//
// The CFI range grammar, exercised by CALLING it — which is the whole reason this arithmetic is a
// pure module rather than a few lines inside epub.entry.ts. Every case here is a shape a real book
// produces: epub.js hands a range CFI to `selected`, `highlightStore` stores two point CFIs, and the
// two have to survive a round trip in both directions or a saved highlight paints in the wrong place
// (or not at all), which no unit test that stopped at the entry's door could see.

import { joinCfiRange, splitCfiRange } from './epubCfiRange';

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
