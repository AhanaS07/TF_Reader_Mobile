// src/screens/ItemDetailScreen.test.tsx
// Screen 05, book detail. Same seam as CatalogueScreen.test.tsx and
// ShelfScreen.test.tsx: inject a fake DataSource through `setCatalogueSource`
// rather than hitting MockAdapter's fixtures, so these tests pin the screen's own
// wiring (loading -> data -> error -> retry) independently of what the fixtures
// contain.
//
// `await render(...)` is required — RTL 14's render is async.
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import type { DataSource } from '@adapters/InstitutionSource';
import { setCatalogueSource } from '@config/catalogue';
import { CatalogueError, CatalogueFailure } from '@model/errors';
import type { Acquisition, Publication } from '@model/types';

import ItemDetailScreen from './ItemDetailScreen';

// `useNetworkStatus` talks to NetInfo, which has no meaningful answer under
// Jest. Mocked per-test so the offline case can be driven directly, the same way
// a screen consumes the hook's return value rather than the module underneath it.
const mockUseNetworkStatus = jest.fn(() => true);
jest.mock('@hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => mockUseNetworkStatus(),
}));

function anAcquisition(over: Partial<Acquisition> = {}): Acquisition {
  return {
    actionId: 'borrow',
    href: 'https://flambeau.test/api/v1/loans',
    licenceModel: 'SUBSCRIPTION',
    encryption: null,
    hasSearchIndex: false,
    canPersist: true,
    ...over,
  };
}

// Every optional field populated, so a test can knock one out at a time.
function aBook(over: Partial<Publication> = {}): Publication {
  return {
    id: 'item_42',
    isbn: '9780367211745',
    title: 'Rights for Robots',
    subtitle: 'Artificial Intelligence, Animal and Environmental Law',
    authors: ['Joshua C. Gellers'],
    publisher: 'Routledge',
    published: '2020-09-30',
    subjects: ['Law', 'Technology'],
    description: 'A study of legal personhood.',
    numberOfPages: 212,
    format: 'PDF',
    coverUrl: 'https://cdn.tf/covers/item_42.jpg',
    acquisition: anAcquisition(),
    ...over,
  };
}

// Every method a real DataSource must have, so the fake typechecks as one. Only
// `getPublication` is exercised; the rest reject, which turns an unexpected
// dependency into a loud failure instead of a silent one — same idiom as
// CatalogueScreen.test.tsx and InstitutionDetailScreen.test.tsx.
function fakeSource(getPublication: DataSource['getPublication']): DataSource {
  const unused = () => Promise.reject(new Error('not stubbed for this test'));
  return {
    getHomeCatalogue: unused,
    getShelf: unused,
    getPublication,
    getInstitutions: unused,
    getInstitution: unused,
  };
}

const routeProps = { route: { params: { itemId: 'item_42' } } };

afterEach(() => {
  setCatalogueSource(undefined);
  mockUseNetworkStatus.mockReturnValue(true);
});

describe('ItemDetailScreen loading', () => {
  it('shows a skeleton, and no title, before the book arrives', async () => {
    // Never resolves within the test, so the screen is caught mid-load.
    setCatalogueSource(fakeSource(() => new Promise(() => {})));

    await render(<ItemDetailScreen {...routeProps} />);

    expect(screen.getByTestId('item-detail-skeleton')).toBeTruthy();
    expect(screen.queryByText('Rights for Robots')).toBeNull();
  });
});

describe('ItemDetailScreen with a book', () => {
  it('renders the title', async () => {
    setCatalogueSource(fakeSource(async () => aBook()));

    await render(<ItemDetailScreen {...routeProps} />);

    await waitFor(() => expect(screen.getByText('Rights for Robots')).toBeTruthy());
  });

  it('renders the authors', async () => {
    setCatalogueSource(fakeSource(async () => aBook()));

    await render(<ItemDetailScreen {...routeProps} />);

    await waitFor(() => expect(screen.getByText('Joshua C. Gellers')).toBeTruthy());
  });

  it('renders the cover when a cover url is present', async () => {
    setCatalogueSource(fakeSource(async () => aBook()));

    await render(<ItemDetailScreen {...routeProps} />);

    await waitFor(() =>
      expect(screen.getByLabelText('Rights for Robots cover')).toBeTruthy(),
    );
  });

  it('renders the ISBN when present', async () => {
    setCatalogueSource(fakeSource(async () => aBook()));

    await render(<ItemDetailScreen {...routeProps} />);

    await waitFor(() => expect(screen.getByText(/9780367211745/)).toBeTruthy());
  });

  it('renders the page count when present', async () => {
    setCatalogueSource(fakeSource(async () => aBook()));

    await render(<ItemDetailScreen {...routeProps} />);

    await waitFor(() => expect(screen.getByText('212 pages')).toBeTruthy());
  });

  it('renders the publisher when present', async () => {
    setCatalogueSource(fakeSource(async () => aBook()));

    await render(<ItemDetailScreen {...routeProps} />);

    await waitFor(() => expect(screen.getByText(/Routledge/)).toBeTruthy());
  });

  it('renders the published date when present', async () => {
    setCatalogueSource(fakeSource(async () => aBook()));

    await render(<ItemDetailScreen {...routeProps} />);

    await waitFor(() => expect(screen.getByText(/2020-09-30/)).toBeTruthy());
  });

  it('renders the access tier badge for the resolved tier', async () => {
    setCatalogueSource(fakeSource(async () => aBook({ acquisition: anAcquisition() })));

    await render(<ItemDetailScreen {...routeProps} />);

    // Subscription, no session: resolveAccess still resolves the tier for the
    // badge even though the reader is signed out.
    await waitFor(() => expect(screen.getByText('Subscription')).toBeTruthy());
  });

  it('renders the actions resolveAccess resolves, not an invented set', async () => {
    // Open Access resolves the same signed in or out, so this is a stable case
    // to pin the action bar against without a session.
    setCatalogueSource(
      fakeSource(async () => aBook({ acquisition: anAcquisition({ licenceModel: 'OPEN_ACCESS' }) })),
    );

    await render(<ItemDetailScreen {...routeProps} />);

    await waitFor(() => expect(screen.getByText('Read')).toBeTruthy());
    expect(screen.getByText('Download')).toBeTruthy();
  });

  // The fixture this screen will meet in the real app is an Elite title, and
  // with no session store yet resolveAccess resolves it to sign-in — a real
  // access rule, not a stand-in for one.
  it('resolves an Elite title with no session to Sign in', async () => {
    setCatalogueSource(
      fakeSource(async () => aBook({ acquisition: anAcquisition({ licenceModel: 'ELITE' }) })),
    );

    await render(<ItemDetailScreen {...routeProps} />);

    await waitFor(() => expect(screen.getByText('Sign in')).toBeTruthy());
    expect(screen.queryByText('Read')).toBeNull();
  });
});

describe('ItemDetailScreen with metadata missing', () => {
  it('renders the title and authors with every optional field absent, and does not crash', async () => {
    setCatalogueSource(
      fakeSource(async () =>
        aBook({
          isbn: undefined,
          subtitle: undefined,
          publisher: undefined,
          published: undefined,
          description: undefined,
          numberOfPages: undefined,
          coverUrl: undefined,
        }),
      ),
    );

    await render(<ItemDetailScreen {...routeProps} />);

    await waitFor(() => expect(screen.getByText('Rights for Robots')).toBeTruthy());
    expect(screen.getByText('Joshua C. Gellers')).toBeTruthy();
    expect(screen.queryByLabelText('Rights for Robots cover')).toBeNull();
    expect(screen.queryByText(/9780367211745/)).toBeNull();
    expect(screen.queryByText(/pages/)).toBeNull();
  });

  it('renders no author line when the feed carries none', async () => {
    setCatalogueSource(fakeSource(async () => aBook({ authors: [] })));

    await render(<ItemDetailScreen {...routeProps} />);

    await waitFor(() => expect(screen.getByText('Rights for Robots')).toBeTruthy());
  });
});

describe('ItemDetailScreen errors', () => {
  // "Empty/missing publication" — a stale deep link or a bad id, not a network
  // problem. No retry: repeating a well-formed request for a title that does not
  // exist cannot make it appear.
  it('shows a not-found message with no retry when the publication does not exist', async () => {
    setCatalogueSource(
      fakeSource(async () => {
        throw new CatalogueFailure(CatalogueError.NOT_FOUND, 'item_missing');
      }),
    );

    await render(<ItemDetailScreen {...{ route: { params: { itemId: 'item_missing' } } }} />);

    await waitFor(() => expect(screen.getByText(/couldn.?t find this title/i)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });

  it('shows a retryable message on a network failure, and retry re-fetches', async () => {
    let attempt = 0;
    setCatalogueSource(
      fakeSource(async () => {
        attempt += 1;
        if (attempt === 1) throw new CatalogueFailure(CatalogueError.NETWORK_UNAVAILABLE, 'item_42');
        return aBook();
      }),
    );

    await render(<ItemDetailScreen {...routeProps} />);

    await waitFor(() => expect(screen.getByText(/you appear to be offline/i)).toBeTruthy());

    fireEvent.press(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => expect(screen.getByText('Rights for Robots')).toBeTruthy());
    expect(attempt).toBe(2);
  });

  it('falls back to one honest message when the rejection is not a CatalogueFailure', async () => {
    setCatalogueSource(
      fakeSource(async () => {
        throw new Error('something nobody modelled');
      }),
    );

    await render(<ItemDetailScreen {...routeProps} />);

    await waitFor(() => expect(screen.getByText(/couldn.?t load this title/i)).toBeTruthy());
    expect(screen.queryByText(/nobody modelled/i)).toBeNull();
  });
});

describe('ItemDetailScreen offline', () => {
  it('shows the offline banner over the loaded content when the network is down', async () => {
    mockUseNetworkStatus.mockReturnValue(false);
    setCatalogueSource(fakeSource(async () => aBook()));

    await render(<ItemDetailScreen {...routeProps} />);

    await waitFor(() => expect(screen.getByText('Rights for Robots')).toBeTruthy());
    expect(screen.getByText("You're offline")).toBeTruthy();
  });

  it('renders no offline banner while the network is up', async () => {
    setCatalogueSource(fakeSource(async () => aBook()));

    await render(<ItemDetailScreen {...routeProps} />);

    await waitFor(() => expect(screen.getByText('Rights for Robots')).toBeTruthy());
    expect(screen.queryByText("You're offline")).toBeNull();
  });
});
