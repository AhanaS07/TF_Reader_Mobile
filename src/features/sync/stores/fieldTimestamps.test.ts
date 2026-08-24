import { parseFieldTimestamps, stampChangedFields, stringifyFieldTimestamps } from './fieldTimestamps';

describe('parseFieldTimestamps', () => {
  it('returns an empty map for null, undefined, or an empty string', () => {
    expect(parseFieldTimestamps(null)).toEqual({});
    expect(parseFieldTimestamps(undefined)).toEqual({});
    expect(parseFieldTimestamps('')).toEqual({});
  });

  it('returns an empty map rather than throwing on unparseable JSON', () => {
    // A row written by a future version, or corrupted - the merge must not crash on it, and
    // "no field ever recorded" is the safe fallback: every field then falls back to the row's
    // own updated_at, which is what a pre-migration row looks like anyway.
    expect(parseFieldTimestamps('not json')).toEqual({});
    expect(parseFieldTimestamps('null')).toEqual({});
    expect(parseFieldTimestamps('42')).toEqual({});
    expect(parseFieldTimestamps('"a string"')).toEqual({});
  });

  it('parses a real map back out', () => {
    expect(parseFieldTimestamps('{"theme":"2026-08-20T10:00:00.000Z"}')).toEqual({
      theme: '2026-08-20T10:00:00.000Z',
    });
  });
});

describe('stringifyFieldTimestamps', () => {
  it('round-trips through parseFieldTimestamps', () => {
    const map = { theme: '2026-08-20T10:00:00.000Z', font_family: '2026-08-19T09:00:00.000Z' };
    expect(parseFieldTimestamps(stringifyFieldTimestamps(map))).toEqual(map);
  });
});

describe('stampChangedFields', () => {
  const FIELDS = ['theme', 'font_family', 'zoom'] as const;
  const NOW = '2026-08-20T12:00:00.000Z';

  it('stamps only the fields present in the patch', () => {
    const result = stampChangedFields({}, { theme: 'dark' }, FIELDS, NOW);
    expect(result).toEqual({ theme: NOW });
  });

  it('leaves every other field untouched', () => {
    const previous = { theme: '2026-08-01T00:00:00.000Z', zoom: '2026-08-02T00:00:00.000Z' };
    const result = stampChangedFields(previous, { theme: 'dark' }, FIELDS, NOW);
    expect(result.zoom).toBe('2026-08-02T00:00:00.000Z');
  });

  it('stamps every touched field when the patch spans more than one', () => {
    const result = stampChangedFields({}, { theme: 'dark', zoom: 2 }, FIELDS, NOW);
    expect(result).toEqual({ theme: NOW, zoom: NOW });
  });

  it('ignores a patch key that is not in the mergeable fields list', () => {
    // e.g. a caller patching `updated_at` or `id` directly - meta columns are never part of
    // the merge and must not get a per-field timestamp of their own.
    const result = stampChangedFields({}, { id: 'new-id', theme: 'dark' }, FIELDS, NOW);
    expect(result).toEqual({ theme: NOW });
  });

  it('is a no-op when the patch touches nothing mergeable', () => {
    const previous = { theme: '2026-08-01T00:00:00.000Z' };
    expect(stampChangedFields(previous, {}, FIELDS, NOW)).toEqual(previous);
  });
});
