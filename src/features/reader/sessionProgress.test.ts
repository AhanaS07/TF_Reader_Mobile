// Owner: Reader (Ahana).
//
// Pure logic, unit-tested directly — same reasoning as the outline flatteners and
// readerMetrics.ts: no DOM, no bridge, just a Map and a conversion function.

import { getSessionPosition, setSessionPosition, targetFromPosition } from './sessionProgress';

describe('targetFromPosition', () => {
  it('returns null when nothing has been recorded', () => {
    expect(targetFromPosition(undefined)).toBeNull();
  });

  it('converts a page position into a page target, unchanged', () => {
    expect(targetFromPosition({ kind: 'page', page: 12, pageCount: 40 })).toEqual({
      kind: 'page',
      page: 12,
    });
  });

  it('converts a CFI position into an href target — a CFI IS a valid epub.js display() argument', () => {
    expect(targetFromPosition({ kind: 'cfi', cfi: 'epubcfi(/6/4!/4/2/2)' })).toEqual({
      kind: 'href',
      href: 'epubcfi(/6/4!/4/2/2)',
    });
  });

  it('returns null for a CFI position that has not resolved yet', () => {
    expect(targetFromPosition({ kind: 'cfi', cfi: null })).toBeNull();
  });
});

describe('session position cache', () => {
  it('is keyed per bookId and reflects the most recent set()', () => {
    setSessionPosition('book-a', { kind: 'page', page: 3, pageCount: 10 });
    setSessionPosition('book-b', { kind: 'cfi', cfi: 'epubcfi(/6/2!/4)' });

    expect(getSessionPosition('book-a')).toEqual({ kind: 'page', page: 3, pageCount: 10 });
    expect(getSessionPosition('book-b')).toEqual({ kind: 'cfi', cfi: 'epubcfi(/6/2!/4)' });
    expect(getSessionPosition('book-c')).toBeUndefined();

    setSessionPosition('book-a', { kind: 'page', page: 4, pageCount: 10 });
    expect(getSessionPosition('book-a')).toEqual({ kind: 'page', page: 4, pageCount: 10 });
  });
});
