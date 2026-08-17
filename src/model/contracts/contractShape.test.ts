// Unit tests for the shape comparison itself, with hand-written inputs.
//
// These matter more than they look: if collectShapePaths is wrong, every
// fixture test built on it passes for the wrong reason and the whole
// conformance suite becomes decoration.
import { collectShapePaths, compareShape } from '@model/contracts/contractShape';

describe('collectShapePaths', () => {
  it('records each leaf as its path and value type', () => {
    const paths = collectShapePaths({ title: 'All titles', numberOfItems: 12 });

    expect([...paths].sort()).toEqual(['numberOfItems :number', 'title :string']);
  });

  it('joins nested object keys with a dot', () => {
    const paths = collectShapePaths({ metadata: { title: 'All titles' } });

    expect([...paths]).toEqual(['metadata.title :string']);
  });

  // The point of the whole exercise: two links are the same shape, so a
  // fixture with more rows than the example must not read as a difference.
  it('collapses array indices so every element shares one path', () => {
    const paths = collectShapePaths({
      links: [{ rel: 'self' }, { rel: 'next' }, { rel: 'search' }],
    });

    expect([...paths]).toEqual(['links[].rel :string']);
  });

  it('unions the paths when array elements differ in shape', () => {
    const paths = collectShapePaths({ links: [{ rel: 'self' }, { templated: true }] });

    expect([...paths].sort()).toEqual(['links[].rel :string', 'links[].templated :boolean']);
  });

  it('reports null as its own type rather than as an object', () => {
    const paths = collectShapePaths({ copies: null });

    expect([...paths]).toEqual(['copies :null']);
  });

  // An empty list has no children to describe, so it is a leaf. Left as a
  // visible difference on purpose rather than silently matching anything.
  it('treats an empty array as a leaf', () => {
    const paths = collectShapePaths({ publications: [] });

    expect([...paths]).toEqual(['publications :empty-array']);
  });
});

describe('compareShape', () => {
  it('finds no differences between identical shapes', () => {
    const result = compareShape({ title: 'ours' }, { title: 'theirs' });

    expect(result.missingFromFixture).toEqual([]);
    expect(result.extraInFixture).toEqual([]);
  });

  // The hard failure: the contract carries a field we do not.
  it('reports a path the example has and the fixture lacks', () => {
    const result = compareShape({ title: 'ours' }, { title: 'theirs', numberOfItems: 3 });

    expect(result.missingFromFixture).toEqual(['numberOfItems :number']);
    expect(result.extraInFixture).toEqual([]);
  });

  it('reports a path the fixture has and the example lacks', () => {
    const result = compareShape({ title: 'ours', modified: 'now' }, { title: 'theirs' });

    expect(result.missingFromFixture).toEqual([]);
    expect(result.extraInFixture).toEqual(['modified :string']);
  });

  it('ignores a fixture-only path that was declared allowed', () => {
    const result = compareShape({ title: 'ours', modified: 'now' }, { title: 'theirs' }, {
      allowedExtraPaths: ['modified :string'],
    });

    expect(result.extraInFixture).toEqual([]);
  });

  // Allowing an extra must never hide a missing one, or the allowlist
  // becomes a way to switch the check off.
  it('still reports a missing path when an allowance is given', () => {
    const result = compareShape({ modified: 'now' }, { numberOfItems: 3 }, {
      allowedExtraPaths: ['modified :string'],
    });

    expect(result.missingFromFixture).toEqual(['numberOfItems :number']);
    expect(result.extraInFixture).toEqual([]);
  });

  it('reports a changed value type on both sides', () => {
    const result = compareShape({ numberOfItems: '3' }, { numberOfItems: 3 });

    expect(result.missingFromFixture).toEqual(['numberOfItems :number']);
    expect(result.extraInFixture).toEqual(['numberOfItems :string']);
  });
});

// A fixture that exercises a narrower case than the example — a new institution
// with no shelves, an audiobook with no page count — legitimately omits a whole
// optional block. Naming the branch beats listing its 28 leaves.
describe('compareShape with an omitted branch', () => {
  it('ignores every missing path underneath the named branch', () => {
    const result = compareShape(
      { metadata: { title: 'ours' } },
      { metadata: { title: 'theirs' }, groups: [{ metadata: { title: 'Shelf' } }] },
      { omittedBranches: ['groups'] },
    );

    expect(result.missingFromFixture).toEqual([]);
  });

  it('ignores the branch when it sits deep inside arrays', () => {
    const result = compareShape(
      { publications: [{ title: 'ours' }] },
      { publications: [{ title: 'theirs', properties: { copies: { total: 4 } } }] },
      { omittedBranches: ['publications[].properties.copies'] },
    );

    expect(result.missingFromFixture).toEqual([]);
  });

  // Prefix matching must respect field boundaries, or omitting `copies` would
  // also silently omit a future `copiesAvailable`.
  it('does not treat a branch as a prefix of a longer field name', () => {
    const result = compareShape({}, { copiesAvailable: 2 }, { omittedBranches: ['copies'] });

    expect(result.missingFromFixture).toEqual(['copiesAvailable :number']);
  });

  // Omitting a branch says "we do not send this here", so finding it in the
  // fixture anyway is a contradiction worth surfacing.
  it('still reports the branch as extra if the fixture does carry it', () => {
    const result = compareShape({ groups: [{ title: 'ours' }] }, {}, {
      omittedBranches: ['groups'],
    });

    expect(result.extraInFixture).toEqual(['groups[].title :string']);
  });
});
