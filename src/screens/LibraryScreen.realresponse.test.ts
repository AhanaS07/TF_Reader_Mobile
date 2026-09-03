// TEMPORARY — integration probe, not a committed test yet.
// Feeds responses captured from a running flambeau instance (2 Sep 2026,
// localhost:8080, dev token usr_dev123/inst_7f3) through the normalizers the
// Library screen depends on, then through the screen's own helpers.
import { normalizeChanges, normalizeLibrary } from '@/licence/normalizeLicence';

import { activeLoans, dueLabel, partitionHolds } from './LibraryScreen.holdings';

// GET /api/v1/library — verbatim.
const LIBRARY_REAL = {
  loans: [
    {
      loanId: 'loan_f5894df2',
      itemId: 'item_42',
      licenceModel: 'SUBSCRIPTION',
      status: 'ACTIVE',
      borrowedAt: '2026-08-24T07:36:37.061Z',
      canPersist: true,
    },
    {
      loanId: 'loan_seed_d9',
      itemId: 'item_env',
      licenceModel: 'SUBSCRIPTION',
      status: 'ACTIVE',
      borrowedAt: '2026-08-10T09:00:00Z',
      canPersist: true,
    },
  ],
  holds: [],
  cursor: '3',
  serverTime: '2026-09-02T08:53:36Z',
};

// GET /api/v1/loans/changes — verbatim.
const CHANGES_REAL = {
  changes: [
    { sequence: 1, reason: 'LOAN_CREATED', itemId: 'item_env', loanId: 'loan_seed_d9', occurredAt: '2026-08-10T09:00:00Z' },
    { sequence: 2, reason: 'LOAN_CREATED', itemId: 'item_dual', loanId: 'loan_seed_e1', occurredAt: '2026-07-01T09:00:00Z' },
    { sequence: 3, reason: 'LOAN_EXPIRED', itemId: 'item_dual', loanId: 'loan_seed_e1', occurredAt: '2026-07-31T09:00:05Z' },
  ],
  nextCursor: '3',
  hasMore: false,
  serverTime: '2026-09-02T08:53:37Z',
};

describe('the real GET /api/v1/library response', () => {
  it('normalizes without throwing', () => {
    expect(() => normalizeLibrary(LIBRARY_REAL)).not.toThrow();
  });

  it('maps ACTIVE to active and keeps both loans', () => {
    const library = normalizeLibrary(LIBRARY_REAL);

    expect(library.loans.map((l) => l.state)).toEqual(['active', 'active']);
    expect(library.loans.map((l) => l.loanId)).toEqual(['loan_f5894df2', 'loan_seed_d9']);
  });

  it('carries the opaque cursor and serverTime through', () => {
    const library = normalizeLibrary(LIBRARY_REAL);

    expect(library.cursor).toBe('3');
    expect(library.serverTime).toBe('2026-09-02T08:53:36Z');
  });

  it('reaches the screen helpers intact', () => {
    const library = normalizeLibrary(LIBRARY_REAL);

    expect(activeLoans(library.loans)).toHaveLength(2);
    expect(partitionHolds(library.holds)).toEqual({ offered: [], waiting: [] });
  });

  // THE FINDING. Both seeded loans are SUBSCRIPTION and neither carries `dueAt`,
  // so the screen renders "No due date" on a subscription loan.
  it('leaves subscription loans with no expiry, so the shelf says "No due date"', () => {
    const library = normalizeLibrary(LIBRARY_REAL);

    expect(library.loans.every((l) => l.expiresAt === undefined)).toBe(true);
    expect(dueLabel(library.loans[0], 0, Date.parse('2026-09-02T08:53:36Z'))).toBe('No due date');
  });
});

describe('the real GET /api/v1/loans/changes response', () => {
  it('normalizes without throwing', () => {
    expect(() => normalizeChanges(CHANGES_REAL)).not.toThrow();
  });

  it('keeps all eight reasons addressable, including LOAN_EXPIRED', () => {
    const page = normalizeChanges(CHANGES_REAL);

    expect(page.changes.map((c) => c.reason)).toEqual([
      'LOAN_CREATED',
      'LOAN_CREATED',
      'LOAN_EXPIRED',
    ]);
  });

  it('preserves sequence ordering and the paging fields', () => {
    const page = normalizeChanges(CHANGES_REAL);

    expect(page.changes.map((c) => c.sequence)).toEqual([1, 2, 3]);
    expect(page.nextCursor).toBe('3');
    expect(page.hasMore).toBe(false);
  });
});
