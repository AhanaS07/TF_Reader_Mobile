// src/features/queue/QueueNotificationHost.test.tsx
// Same seam as ItemDetailScreen.test.tsx: `@config/licence` and `@config/catalogue`
// are mocked at the module boundary rather than driven through MockLicenceClient, so
// these tests pin the host's own wiring — render when live, hide when not, answer
// through the licence source and clear the store — independently of the adapters.
import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';

import type { Hold } from '@model/types';
import { useOfferStore } from '@store/offerStore';
import QueueNotificationHost from './QueueNotificationHost';

const mockGetChanges = jest.fn().mockResolvedValue({ changes: [], nextCursor: '0', hasMore: false, serverTime: '' });
const mockGetLibrary = jest.fn().mockResolvedValue({ loans: [], holds: [] });
const mockAcceptOffer = jest.fn().mockResolvedValue({ loanId: 'loan_1', itemId: 'item_42', state: 'active' });
const mockCancelHold = jest.fn().mockResolvedValue(undefined);

// The poll (useOfferPolling) reads this same mock — a real interval is started, but
// with an empty change feed it never touches the store, and the effect is torn down
// by `unmount()` at the end of every test so nothing outlives it.
jest.mock('@config/licence', () => ({
  getLicenceSource: () => ({
    getChanges: (...args: unknown[]) => mockGetChanges(...args),
    getLibrary: () => mockGetLibrary(),
    acceptOffer: (...args: unknown[]) => mockAcceptOffer(...args),
    cancelHold: (...args: unknown[]) => mockCancelHold(...args),
  }),
}));

const mockGetItemsBatch = jest.fn().mockResolvedValue({
  items: [{ id: 'item_42', title: 'Rights for Robots' }],
  notFound: [],
  denied: [],
});
jest.mock('@config/catalogue', () => ({
  getCatalogueSource: () => ({ getItemsBatch: (...args: unknown[]) => mockGetItemsBatch(...args) }),
}));

const anOfferedHold = (over: Partial<Hold> = {}): Hold => ({
  holdId: 'hold_5d1',
  offerId: 'offer_a90',
  itemId: 'item_42',
  state: 'offered',
  offerExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  serverTime: new Date().toISOString(),
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockGetChanges.mockResolvedValue({ changes: [], nextCursor: '0', hasMore: false, serverTime: '' });
  mockGetLibrary.mockResolvedValue({ loans: [], holds: [] });
  mockAcceptOffer.mockResolvedValue({ loanId: 'loan_1', itemId: 'item_42', state: 'active' });
  mockCancelHold.mockResolvedValue(undefined);
  mockGetItemsBatch.mockResolvedValue({
    items: [{ id: 'item_42', title: 'Rights for Robots' }],
    notFound: [],
    denied: [],
  });
  useOfferStore.getState().clear();
  // Rendering reads `_hasHydrated` as its own gate — forced true so the test is not
  // racing AsyncStorage's mock resolving it.
  useOfferStore.setState({ _hasHydrated: true });
});

describe('QueueNotificationHost', () => {
  it('renders nothing when the store holds no offer', async () => {
    const { unmount } = await render(<QueueNotificationHost />);
    expect(screen.queryByTestId('queue-notification')).toBeNull();
    unmount();
  });

  it('shows the banner with the resolved title once an offer is live', async () => {
    useOfferStore.getState().receiveOffer(anOfferedHold());
    const { unmount } = await render(<QueueNotificationHost />);

    await waitFor(() => expect(screen.getByText('Rights for Robots')).toBeTruthy());
    unmount();
  });

  it('falls back to the item id when the title cannot be resolved', async () => {
    mockGetItemsBatch.mockRejectedValue(new Error('offline'));
    useOfferStore.getState().receiveOffer(anOfferedHold());
    const { unmount } = await render(<QueueNotificationHost />);

    await waitFor(() => expect(screen.getByText('item_42')).toBeTruthy());
    unmount();
  });

  it('accepts through the licence source and clears the slot', async () => {
    useOfferStore.getState().receiveOffer(anOfferedHold());
    const { unmount } = await render(<QueueNotificationHost />);
    await waitFor(() => expect(screen.getByText('Rights for Robots')).toBeTruthy());

    // Awaited: this press triggers `setPending`, and per this repo's RNTL 14 setup an
    // un-awaited state-changing fireEvent leaves an unsettled act() scope that breaks
    // a LATER test rather than this one.
    await fireEvent.press(screen.getByText('Accept'));

    await waitFor(() => expect(mockAcceptOffer).toHaveBeenCalledWith('hold_5d1'));
    await waitFor(() => expect(useOfferStore.getState().offer).toBeNull());
    unmount();
  });

  it('rejects through the licence source and clears the slot', async () => {
    useOfferStore.getState().receiveOffer(anOfferedHold());
    const { unmount } = await render(<QueueNotificationHost />);
    await waitFor(() => expect(screen.getByText('Rights for Robots')).toBeTruthy());

    await fireEvent.press(screen.getByText('Reject'));

    await waitFor(() => expect(mockCancelHold).toHaveBeenCalledWith('hold_5d1'));
    await waitFor(() => expect(useOfferStore.getState().offer).toBeNull());
    unmount();
  });
});
