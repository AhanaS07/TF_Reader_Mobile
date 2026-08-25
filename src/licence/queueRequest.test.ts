// src/licence/queueRequest.test.ts
// D12 — the Elite queue request that the card surfaces and the item detail
// screen now share.
//
// `borrowOrPlaceHold` IS TESTED DIRECTLY, with a hand-built source, because the
// rule it encodes is the dangerous one: falling through to a hold on the WRONG
// failure would enqueue a reader off the back of a network error. The narrow
// catch gets a test per failure shape rather than one happy path.
//
// `await renderHook(...)` and `await act(async () => ...)` — both are promises in
// RTL 14, and a bare synchronous `act()` corrupts every later render in the file.
// See useReaderPrefs.test.ts, which records why.
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { LicenceError, LicenceFailure, type LicenceSource } from '@/licence/LicenceSource';
import { useLibraryStore } from '@store/libraryStore';

import { borrowOrPlaceHold, offersQueue, QUEUE_ACTION, useQueueRequest } from './queueRequest';

const mockBorrow = jest.fn();
const mockPlaceHold = jest.fn();
const mockGetLibrary = jest.fn();

// The hook reads its source through `@config/licence`, the same indirection every
// other licence caller uses, so the mock goes there rather than into the hook.
jest.mock('@config/licence', () => ({
  getLicenceSource: () => ({
    borrow: (...args: [string]) => mockBorrow(...args),
    placeHold: (...args: [string]) => mockPlaceHold(...args),
    getLibrary: () => mockGetLibrary(),
    returnLoan: jest.fn(),
    acceptOffer: jest.fn(),
    cancelHold: jest.fn(),
  }),
}));

const LOAN = { loanId: 'loan_1', itemId: 'item_42', state: 'active' as const, expiresAt: 9_999 };
const HELD = {
  holdId: 'hold_1',
  itemId: 'item_42',
  state: 'queued' as const,
  position: 3,
  queueLength: 5,
  serverTime: '',
};

/** A source built by hand, for the pure function's own tests. */
function source(over: Partial<LicenceSource> = {}): LicenceSource {
  return {
    borrow: jest.fn().mockResolvedValue(LOAN),
    placeHold: jest.fn().mockResolvedValue(HELD),
    returnLoan: jest.fn(),
    acceptOffer: jest.fn(),
    cancelHold: jest.fn(),
    getLibrary: jest.fn(),
    ...over,
  } as unknown as LicenceSource;
}

const noCopies = () =>
  new LicenceFailure(LicenceError.REFUSED, { errorCode: 'NO_COPIES_AVAILABLE' });

beforeEach(() => {
  mockBorrow.mockResolvedValue(LOAN);
  mockPlaceHold.mockResolvedValue(HELD);
  mockGetLibrary.mockResolvedValue({ loans: [], holds: [] });
});

afterEach(() => {
  jest.clearAllMocks();
  useLibraryStore.setState({ loans: [], holds: [], loading: false });
});

describe('borrowOrPlaceHold', () => {
  it('borrows, and does not touch the queue, when a copy is free', async () => {
    const s = source();

    await borrowOrPlaceHold(s, 'item_42');

    expect(s.borrow).toHaveBeenCalledWith('item_42');
    expect(s.placeHold).not.toHaveBeenCalled();
  });

  it('falls through to the queue when the refusal is NO_COPIES_AVAILABLE', async () => {
    const s = source({ borrow: jest.fn().mockRejectedValue(noCopies()) });

    await borrowOrPlaceHold(s, 'item_42');

    expect(s.placeHold).toHaveBeenCalledWith('item_42');
  });

  // THE IMPORTANT HALF. Each of these is a failure that says nothing about
  // availability, so none of them may put the reader in a queue.
  it('does NOT queue on a refusal with a different error code', async () => {
    const err = new LicenceFailure(LicenceError.REFUSED, { errorCode: 'LICENCE_EXPIRED' });
    const s = source({ borrow: jest.fn().mockRejectedValue(err) });

    await expect(borrowOrPlaceHold(s, 'item_42')).rejects.toBe(err);
    expect(s.placeHold).not.toHaveBeenCalled();
  });

  it('does NOT queue on a non-REFUSED licence failure', async () => {
    // The case that matters most: offline is not "no copies available", and
    // queueing off the back of it would enqueue a reader who asked for nothing.
    const err = new LicenceFailure(LicenceError.NETWORK_UNAVAILABLE);
    const s = source({ borrow: jest.fn().mockRejectedValue(err) });

    await expect(borrowOrPlaceHold(s, 'item_42')).rejects.toBe(err);
    expect(s.placeHold).not.toHaveBeenCalled();
  });

  it('does NOT queue on a plain Error that is not a licence failure at all', async () => {
    const err = new Error('boom');
    const s = source({ borrow: jest.fn().mockRejectedValue(err) });

    await expect(borrowOrPlaceHold(s, 'item_42')).rejects.toBe(err);
    expect(s.placeHold).not.toHaveBeenCalled();
  });
});

describe('QUEUE_ACTION and offersQueue', () => {
  it('names the contract action, not a local string', () => {
    expect(QUEUE_ACTION).toBe('grantAccess');
  });

  it('is true only when the resolve actually offered the queue', () => {
    expect(offersQueue({ actions: ['grantAccess'] })).toBe(true);
    // The four other Elite answers, none of which is a queue offer.
    expect(offersQueue({ actions: [] })).toBe(false);
    expect(offersQueue({ actions: ['signIn'] })).toBe(false);
    expect(offersQueue({ actions: ['read', 'revokeLicence'] })).toBe(false);
    expect(offersQueue({ actions: ['acceptOffer', 'rejectOffer'] })).toBe(false);
  });
});

describe('useQueueRequest', () => {
  it('starts with nothing pending', async () => {
    const { result } = await renderHook(() => useQueueRequest());

    expect(result.current.pendingItemId).toBeNull();
  });

  it('marks the requested item pending while the borrow is in flight', async () => {
    // Held open so "in flight" is observable at all — `await act` would otherwise
    // flush the resolution before the assertion.
    mockBorrow.mockReturnValue(new Promise(() => {}));
    const { result } = await renderHook(() => useQueueRequest());

    await act(async () => {
      result.current.requestQueue('item_42');
    });

    expect(result.current.pendingItemId).toBe('item_42');
  });

  it('clears pending and refreshes the holdings after a successful borrow', async () => {
    const { result } = await renderHook(() => useQueueRequest());

    await act(async () => {
      result.current.requestQueue('item_42');
    });

    await waitFor(() => expect(result.current.pendingItemId).toBeNull());
    expect(mockBorrow).toHaveBeenCalledWith('item_42');
    expect(mockGetLibrary).toHaveBeenCalled();
  });

  it('queues, then clears pending, when no copy is free', async () => {
    mockBorrow.mockRejectedValue(noCopies());
    const { result } = await renderHook(() => useQueueRequest());

    await act(async () => {
      result.current.requestQueue('item_42');
    });

    await waitFor(() => expect(result.current.pendingItemId).toBeNull());
    expect(mockPlaceHold).toHaveBeenCalledWith('item_42');
    expect(mockGetLibrary).toHaveBeenCalled();
  });

  // A stuck spinner is the worst outcome of a failed request, so failure gets its
  // own test rather than riding on the success path.
  it('clears pending after a failure, and still refreshes', async () => {
    mockBorrow.mockRejectedValue(new Error('boom'));
    const { result } = await renderHook(() => useQueueRequest());

    await act(async () => {
      result.current.requestQueue('item_42');
    });

    await waitFor(() => expect(result.current.pendingItemId).toBeNull());
    expect(mockPlaceHold).not.toHaveBeenCalled();
    // A borrow that threw may still have created the loan, so the cache is stale
    // either way.
    expect(mockGetLibrary).toHaveBeenCalled();
  });

  it('ignores a second request for the same item while the first is in flight', async () => {
    mockBorrow.mockReturnValue(new Promise(() => {}));
    const { result } = await renderHook(() => useQueueRequest());

    await act(async () => {
      result.current.requestQueue('item_42');
      result.current.requestQueue('item_42');
      result.current.requestQueue('item_42');
    });

    expect(mockBorrow).toHaveBeenCalledTimes(1);
  });

  // The list-wide rule: twenty Elite rows must not be able to fire twenty
  // borrows. See the note on useQueueRequest.
  it('ignores a request for a DIFFERENT item while one is in flight', async () => {
    mockBorrow.mockReturnValue(new Promise(() => {}));
    const { result } = await renderHook(() => useQueueRequest());

    await act(async () => {
      result.current.requestQueue('item_42');
      result.current.requestQueue('item_99');
    });

    expect(mockBorrow).toHaveBeenCalledTimes(1);
    expect(mockBorrow).toHaveBeenCalledWith('item_42');
    expect(result.current.pendingItemId).toBe('item_42');
  });

  it('accepts a new request once the previous one has settled', async () => {
    const { result } = await renderHook(() => useQueueRequest());

    await act(async () => {
      result.current.requestQueue('item_42');
    });
    await waitFor(() => expect(result.current.pendingItemId).toBeNull());

    await act(async () => {
      result.current.requestQueue('item_99');
    });

    expect(mockBorrow).toHaveBeenCalledTimes(2);
    expect(mockBorrow).toHaveBeenLastCalledWith('item_99');
  });
});
