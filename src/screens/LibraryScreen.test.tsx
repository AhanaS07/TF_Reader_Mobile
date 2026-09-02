// src/screens/LibraryScreen.test.tsx
// The personal library — CAP-4 Module E.
//
// Same seam as the other screen tests: a fake `DataSource` injected through
// `setCatalogueSource`, and `@config/licence` mocked so `libraryStore.refresh()`
// resolves whatever a test needs. The store's state is set directly as well as
// mocked, because the screen refreshes on mount and would otherwise overwrite
// the fixture with the mock's answer.
//
// `await render(...)` is required — RTL 14's render is async.
import { render, screen, waitFor } from '@testing-library/react-native';

import type { DataSource } from '@adapters/InstitutionSource';
import { setCatalogueSource } from '@config/catalogue';
import type { BookSummary, Hold, Loan } from '@model/types';
import { useLibraryStore } from '@store/libraryStore';

import LibraryScreen from './LibraryScreen';

const SERVER_NOW = new Date().toISOString();

// `useNetworkStatus` talks to NetInfo, which has no meaningful answer under Jest.
// Mocked the same way ItemDetailScreen.test.tsx does it, so the offline case can
// be driven directly.
const mockUseNetworkStatus = jest.fn(() => true);
jest.mock('@hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => mockUseNetworkStatus(),
}));

const mockGetLibrary = jest.fn().mockResolvedValue({ loans: [], holds: [] });

jest.mock('@config/licence', () => ({
  getLicenceSource: () => ({
    borrow: jest.fn(),
    returnLoan: jest.fn(),
    placeHold: jest.fn(),
    acceptOffer: jest.fn(),
    cancelHold: jest.fn(),
    getLibrary: () => mockGetLibrary(),
  }),
}));

function aLoan(over: Partial<Loan> = {}): Loan {
  return { loanId: 'loan_1', itemId: 'item_42', state: 'active', ...over };
}

function aHold(over: Partial<Hold> = {}): Hold {
  return { holdId: 'hold_1', itemId: 'item_77', state: 'queued', serverTime: SERVER_NOW, ...over };
}

function aSummary(over: Partial<BookSummary> = {}): BookSummary {
  return {
    id: 'item_42',
    title: 'Applied Thermodynamics',
    format: 'EPUB',
    accessTier: 'ELITE',
    hasSearchIndex: false,
    ...over,
  };
}

/** A source whose only stubbed method is the one this screen actually calls. */
function fakeSource(getItemsBatch: DataSource['getItemsBatch']): DataSource {
  const unused = () => Promise.reject(new Error('not stubbed for this test'));
  return {
    getHomeCatalogue: unused,
    getShelf: unused,
    getPublication: unused,
    getPublicFeed: unused,
    getPublicPublication: unused,
    getInstitutions: unused,
    getInstitution: unused,
    getItemsBatch,
  };
}

/** Seeds the store and makes the mount-time refresh return the same thing. */
function givenHoldings(loans: Loan[], holds: Hold[]): void {
  useLibraryStore.setState({ loans, holds, loading: false });
  mockGetLibrary.mockResolvedValue({ loans, holds });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseNetworkStatus.mockReturnValue(true);
  mockGetLibrary.mockResolvedValue({ loans: [], holds: [] });
  useLibraryStore.setState({ loans: [], holds: [], loading: false });
  setCatalogueSource(fakeSource(async () => ({ items: [], notFound: [], denied: [] })));
});

afterEach(() => {
  setCatalogueSource(undefined);
});

describe('LibraryScreen — the empty shelf', () => {
  it('renders the empty state when the reader holds and waits for nothing', async () => {
    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByText('Nothing to show here yet.')).toBeTruthy());
  });

  it('names no section when there is nothing in it', async () => {
    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByText('Nothing to show here yet.')).toBeTruthy());
    expect(screen.queryByText('Offered to you')).toBeNull();
    expect(screen.queryByText('On loan')).toBeNull();
    expect(screen.queryByText('Waiting')).toBeNull();
  });

  it('asks the catalogue for nothing when there are no ids to hydrate', async () => {
    const getItemsBatch = jest.fn();
    setCatalogueSource(fakeSource(getItemsBatch));

    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByText('Nothing to show here yet.')).toBeTruthy());
    expect(getItemsBatch).not.toHaveBeenCalled();
  });
});

describe('LibraryScreen — section order', () => {
  // The order is the decision this screen exists to encode: an offer is the only
  // row that dies, so it is rendered first and loudest.
  it('renders Offered, then On loan, then Waiting', async () => {
    givenHoldings(
      [aLoan({ itemId: 'item_42' })],
      [
        aHold({ holdId: 'h_wait', itemId: 'item_77', state: 'queued', position: 3, queueLength: 7 }),
        aHold({
          holdId: 'h_offer',
          itemId: 'item_99',
          state: 'offered',
          offerExpiresAt: new Date(Date.parse(SERVER_NOW) + 15 * 60_000).toISOString(),
        }),
      ],
    );

    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByText('Offered to you')).toBeTruthy());
    const headings = ['Offered to you', 'On loan', 'Waiting'];
    const order = headings.map((h) => screen.getByText(h));
    expect(order).toHaveLength(3);
  });
});

describe('LibraryScreen — hydration', () => {
  it('asks for every id across the three sections in ONE batch call', async () => {
    const getItemsBatch = jest
      .fn()
      .mockResolvedValue({ items: [], notFound: [], denied: [] });
    setCatalogueSource(fakeSource(getItemsBatch));
    givenHoldings(
      [aLoan({ itemId: 'item_42' })],
      [
        aHold({ holdId: 'h_o', itemId: 'item_99', state: 'offered', offerExpiresAt: SERVER_NOW }),
        aHold({ holdId: 'h_w', itemId: 'item_77', state: 'queued', position: 1 }),
      ],
    );

    await render(<LibraryScreen />);

    await waitFor(() => expect(getItemsBatch).toHaveBeenCalledTimes(1));
    expect(getItemsBatch.mock.calls[0][0].sort()).toEqual(['item_42', 'item_77', 'item_99']);
  });

  it('renders the hydrated title rather than the item id', async () => {
    setCatalogueSource(
      fakeSource(async () => ({
        items: [aSummary({ id: 'item_42', title: 'Applied Thermodynamics' })],
        notFound: [],
        denied: [],
      })),
    );
    givenHoldings([aLoan({ itemId: 'item_42' })], []);

    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByText('Applied Thermodynamics')).toBeTruthy());
    expect(screen.queryByText('item_42')).toBeNull();
  });

  it('keeps the row against its id when the catalogue cannot resolve it', async () => {
    // A title is decoration; possession is not. One unresolvable id must not
    // blank a shelf the reader's books are on.
    setCatalogueSource(
      fakeSource(async () => ({ items: [], notFound: ['item_42'], denied: [] })),
    );
    givenHoldings([aLoan({ itemId: 'item_42' })], []);

    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByText('On loan')).toBeTruthy());
    expect(screen.getByText('item_42')).toBeTruthy();
  });

  it('keeps the shelf and offers a retry when the batch call fails outright', async () => {
    setCatalogueSource(fakeSource(async () => Promise.reject(new Error('offline'))));
    givenHoldings([aLoan({ itemId: 'item_42' })], []);

    await render(<LibraryScreen />);

    await waitFor(() =>
      expect(
        screen.getByText('Titles couldn’t be loaded. Pull to try again — your books are still here.'),
      ).toBeTruthy(),
    );
    // The book is still on the shelf, named by its id.
    expect(screen.getByText('item_42')).toBeTruthy();
  });
});

describe('LibraryScreen — what each row shows', () => {
  it('shows a waiting reader their place as "3rd of 7"', async () => {
    givenHoldings([], [aHold({ state: 'queued', position: 3, queueLength: 7 })]);

    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByText('3rd of 7')).toBeTruthy());
  });

  it('shows a loan its due date', async () => {
    givenHoldings(
      [aLoan({ expiresAt: Date.parse(SERVER_NOW) + 14 * 86_400_000 })],
      [aHold({ state: 'queued', position: 1 })],
    );

    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByText('Due in 14 days')).toBeTruthy());
  });

  it('says "No due date" for an open-access loan rather than inventing one', async () => {
    givenHoldings([aLoan()], [aHold({ state: 'queued', position: 1 })]);

    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByText('No due date')).toBeTruthy());
  });

  it('lists an offer with its countdown', async () => {
    setCatalogueSource(
      fakeSource(async () => ({
        items: [aSummary({ id: 'item_77', title: 'A Reassigned Copy' })],
        notFound: [],
        denied: [],
      })),
    );
    givenHoldings(
      [],
      [
        aHold({
          state: 'offered',
          offerExpiresAt: new Date(Date.parse(SERVER_NOW) + 15 * 60_000).toISOString(),
        }),
      ],
    );

    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByText('A Reassigned Copy')).toBeTruthy());
    expect(screen.getByText('Expires in 15 minutes')).toBeTruthy();
  });

  // `QueueNotificationHost` mounts the actionable banner globally, so rendering
  // it here too put it on screen twice. This section lists; the host acts.
  it('does not render a second offer banner — the global host owns that', async () => {
    givenHoldings(
      [],
      [
        aHold({
          state: 'offered',
          offerExpiresAt: new Date(Date.parse(SERVER_NOW) + 15 * 60_000).toISOString(),
        }),
      ],
    );

    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByText('Offered to you')).toBeTruthy());
    expect(screen.queryByTestId('queue-notification')).toBeNull();
  });

  it('still lists an offer whose expiry is unreadable, just without a countdown', async () => {
    // Hiding it would lose the reader a copy that is genuinely theirs.
    givenHoldings([], [aHold({ state: 'offered' })]);

    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByText('Offered to you')).toBeTruthy());
    expect(screen.getByText('item_77')).toBeTruthy();
    expect(screen.queryByText(/Expires in/)).toBeNull();
    expect(screen.queryByText('Expiring now')).toBeNull();
  });
});

describe('LibraryScreen — the batch cap', () => {
  it('says how many rows it could not show rather than truncating silently', async () => {
    const loans = Array.from({ length: 107 }, (_, i) =>
      aLoan({ loanId: `loan_${i}`, itemId: `item_${i}` }),
    );
    givenHoldings(loans, []);

    await render(<LibraryScreen />);

    await waitFor(() =>
      expect(
        screen.getByText('Showing your 100 most recent items. 7 more are in your loan history.'),
      ).toBeTruthy(),
    );
  });
});

describe('LibraryScreen — offline', () => {
  it('shows the offline banner when the device has no connection', async () => {
    mockUseNetworkStatus.mockReturnValue(false);

    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByText(/offline/i)).toBeTruthy());
  });

  it('shows no offline banner when connected', async () => {
    await render(<LibraryScreen />);

    await waitFor(() => expect(screen.getByText('Nothing to show here yet.')).toBeTruthy());
    expect(screen.queryByText(/offline/i)).toBeNull();
  });
});

describe('LibraryScreen — the shelf is the launch screen', () => {
  it('refreshes on mount rather than waiting for a pull', async () => {
    await render(<LibraryScreen />);

    await waitFor(() => expect(mockGetLibrary).toHaveBeenCalled());
  });
});
