// src/store/libraryStore.test.ts
// Three concerns:
//   1. refresh() populates loans and holds from getLibrary.
//   2. A failed refresh leaves the last-known data in place — stale data is
//      better than blanking the UI mid-session.
//   3. loading flag is true while the call is in flight and false after.
import { useLibraryStore } from './libraryStore';

const mockGetLibrary = jest.fn();

jest.mock('@config/licence', () => ({
  getLicenceSource: () => ({ getLibrary: () => mockGetLibrary() }),
}));

const ACTIVE_LOAN = {
  loanId: 'loan_1',
  itemId: 'item_42',
  state: 'active' as const,
  expiresAt: 9_999_999_999,
};

const QUEUED_HOLD = {
  holdId: 'hold_1',
  itemId: 'item_99',
  state: 'queued' as const,
  position: 2,
  queueLength: 5,
  serverTime: '2026-08-21T10:00:00.000Z',
};

afterEach(() => {
  useLibraryStore.setState({ loans: [], holds: [], loading: false });
  mockGetLibrary.mockReset();
});

describe('libraryStore — refresh', () => {
  it('populates loans from getLibrary', async () => {
    mockGetLibrary.mockResolvedValue({ loans: [ACTIVE_LOAN], holds: [] });

    await useLibraryStore.getState().refresh();

    expect(useLibraryStore.getState().loans).toEqual([ACTIVE_LOAN]);
  });

  it('populates holds from getLibrary', async () => {
    mockGetLibrary.mockResolvedValue({ loans: [], holds: [QUEUED_HOLD] });

    await useLibraryStore.getState().refresh();

    expect(useLibraryStore.getState().holds).toEqual([QUEUED_HOLD]);
  });

  it('clears loans from a previous refresh when the reader holds nothing', async () => {
    useLibraryStore.setState({ loans: [ACTIVE_LOAN], holds: [] });
    mockGetLibrary.mockResolvedValue({ loans: [], holds: [] });

    await useLibraryStore.getState().refresh();

    expect(useLibraryStore.getState().loans).toEqual([]);
  });

  it('leaves existing loans in place when getLibrary rejects', async () => {
    useLibraryStore.setState({ loans: [ACTIVE_LOAN], holds: [] });
    mockGetLibrary.mockRejectedValue(new Error('network error'));

    await useLibraryStore.getState().refresh();

    // Stale data is better than a blank action bar mid-session.
    expect(useLibraryStore.getState().loans).toEqual([ACTIVE_LOAN]);
  });

  it('leaves existing holds in place when getLibrary rejects', async () => {
    useLibraryStore.setState({ loans: [], holds: [QUEUED_HOLD] });
    mockGetLibrary.mockRejectedValue(new Error('network error'));

    await useLibraryStore.getState().refresh();

    expect(useLibraryStore.getState().holds).toEqual([QUEUED_HOLD]);
  });

  it('clears loading after a successful refresh', async () => {
    mockGetLibrary.mockResolvedValue({ loans: [], holds: [] });

    await useLibraryStore.getState().refresh();

    expect(useLibraryStore.getState().loading).toBe(false);
  });

  it('clears loading even when getLibrary rejects', async () => {
    mockGetLibrary.mockRejectedValue(new Error('timeout'));

    await useLibraryStore.getState().refresh();

    expect(useLibraryStore.getState().loading).toBe(false);
  });

  it('sets loading=true while the call is in flight', async () => {
    let resolve!: (v: { loans: never[]; holds: never[] }) => void;
    mockGetLibrary.mockReturnValue(
      new Promise<{ loans: never[]; holds: never[] }>((res) => {
        resolve = res;
      }),
    );

    const inFlight = useLibraryStore.getState().refresh();
    expect(useLibraryStore.getState().loading).toBe(true);

    resolve({ loans: [], holds: [] });
    await inFlight;
    expect(useLibraryStore.getState().loading).toBe(false);
  });
});
