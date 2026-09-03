// Owner: Reader (Ahana).
//
// Pure logic, unit-tested directly — no DOM, no bridge, just conversion/comparison functions
// between this feature's ReaderPosition/ReaderTarget and Sync's Locator.

import { locatorsEqual, targetFromLocator, toLocator } from './readerProgressStore';

describe('toLocator', () => {
  it('converts a page position into a PDF locator, unchanged', () => {
    expect(toLocator({ kind: 'page', page: 12, pageCount: 40 })).toEqual({
      type: 'PDF',
      page: 12,
    });
  });

  it('converts a resolved CFI position into an EPUB locator', () => {
    expect(toLocator({ kind: 'cfi', cfi: 'epubcfi(/6/4!/4/2/2)' })).toEqual({
      type: 'EPUB',
      cfi: 'epubcfi(/6/4!/4/2/2)',
    });
  });

  it('returns null for a CFI position that has not resolved yet — nothing durable to save', () => {
    expect(toLocator({ kind: 'cfi', cfi: null })).toBeNull();
  });
});

describe('targetFromLocator', () => {
  it('returns null when there is nothing stored', () => {
    expect(targetFromLocator(null)).toBeNull();
  });

  it('converts a PDF locator into a page target', () => {
    expect(targetFromLocator({ type: 'PDF', page: 12 })).toEqual({ kind: 'page', page: 12 });
  });

  it('converts an EPUB locator into an href target — a CFI IS a valid epub.js display() argument', () => {
    expect(targetFromLocator({ type: 'EPUB', cfi: 'epubcfi(/6/4!/4/2/2)' })).toEqual({
      kind: 'href',
      href: 'epubcfi(/6/4!/4/2/2)',
    });
  });

  it('returns null for an AUDIO locator — it belongs to a different book than the one reading it', () => {
    expect(targetFromLocator({ type: 'AUDIO', positionMs: 90_000 })).toBeNull();
  });
});

describe('locatorsEqual', () => {
  it('treats two nulls as equal, and null against a value as unequal', () => {
    expect(locatorsEqual(null, null)).toBe(true);
    expect(locatorsEqual(null, { type: 'PDF', page: 1 })).toBe(false);
    expect(locatorsEqual({ type: 'PDF', page: 1 }, null)).toBe(false);
  });

  it('compares EPUB locators by cfi only', () => {
    expect(locatorsEqual({ type: 'EPUB', cfi: 'a' }, { type: 'EPUB', cfi: 'a' })).toBe(true);
    expect(locatorsEqual({ type: 'EPUB', cfi: 'a' }, { type: 'EPUB', cfi: 'b' })).toBe(false);
  });

  it('compares PDF locators by page, ignoring the optional offset field', () => {
    expect(locatorsEqual({ type: 'PDF', page: 5 }, { type: 'PDF', page: 5, offset: 999 })).toBe(
      true,
    );
    expect(locatorsEqual({ type: 'PDF', page: 5 }, { type: 'PDF', page: 6 })).toBe(false);
  });

  it('compares AUDIO locators by positionMs only', () => {
    expect(
      locatorsEqual({ type: 'AUDIO', positionMs: 1000 }, { type: 'AUDIO', positionMs: 1000 }),
    ).toBe(true);
    expect(
      locatorsEqual({ type: 'AUDIO', positionMs: 1000 }, { type: 'AUDIO', positionMs: 2000 }),
    ).toBe(false);
  });

  it('treats different locator types as unequal even with overlapping-looking fields', () => {
    expect(locatorsEqual({ type: 'PDF', page: 1 }, { type: 'EPUB', cfi: '1' })).toBe(false);
  });
});
