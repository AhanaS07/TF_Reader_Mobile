// src/screens/CatalogueScreen.test.tsx
// Wires CategoryCard (top strip, one per navigation entry) and ContentCard
// (one section per home-catalogue shelf) to the real DataSource seam.
//
// Injects a fake DataSource through `setCatalogueSource` — the test seam
// `src/config/catalogue.ts` was built with for exactly this — rather than
// hitting MockAdapter's fixtures, so these tests pin the screen's own wiring
// (loading → data → error → retry, and the press → navigate contract)
// independently of what the fixtures happen to contain.
//
// `await render(...)` is required — RTL 14's render is async. See
// ContentCard.test.tsx for why forgetting it fails silently.
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import type { DataSource } from '@adapters/InstitutionSource';
import { setCatalogueSource } from '@config/catalogue';
import type { Catalogue } from '@model/types';

import CatalogueScreen from './CatalogueScreen';

// Must be prefixed `mock` — Jest's module-factory scope guard only allows
// referencing out-of-scope variables whose name starts with "mock".
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

const FAKE_CATALOGUE: Catalogue = {
  title: 'Test Institution',
  navigation: [
    { title: 'eBooks', href: 'https://x/groups/ebooks', shelfId: 'ebooks' },
    { title: 'Audiobooks', href: 'https://x/groups/audiobooks', shelfId: 'audiobooks' },
  ],
  shelves: [
    {
      id: 'new-this-term',
      title: 'New this term',
      publications: [
        {
          id: 'item_42',
          title: 'Rights for Robots',
          publisher: 'Routledge',
          authors: ['Joshua C. Gellers'],
          subjects: [],
          format: 'PDF',
          acquisition: {
            actionId: 'borrow',
            href: 'https://x/loan/item_42',
            encryption: null,
            hasSearchIndex: true,
            canPersist: true,
          },
        },
      ],
    },
    {
      id: 'open-access',
      title: 'Free to read',
      publications: [
        {
          id: 'item_ab6',
          title: 'Ethnographies of Waiting',
          authors: [],
          subjects: [],
          format: 'EPUB',
          acquisition: {
            actionId: 'openAccess',
            href: 'https://x/download/item_ab6',
            encryption: null,
            hasSearchIndex: false,
            canPersist: true,
          },
        },
      ],
    },
  ],
};

// Every method a real DataSource must have, so the fake typechecks as one.
// Only `getHomeCatalogue` is exercised — the rest throw if the screen ever
// reaches for them, which would mean it grew a dependency this suite does not
// know to fake.
function fakeSource(getHomeCatalogue: DataSource['getHomeCatalogue']): DataSource {
  const unused = () => Promise.reject(new Error('not stubbed for this test'));
  return {
    getHomeCatalogue,
    getShelf: unused,
    getPublication: unused,
    getInstitutions: unused,
    getInstitution: unused,
  };
}

afterEach(() => {
  setCatalogueSource(undefined);
  mockNavigate.mockClear();
});

describe('CatalogueScreen loading', () => {
  it('shows skeletons before the catalogue arrives', async () => {
    // Never resolves within the test, so the screen is caught mid-load.
    setCatalogueSource(fakeSource(() => new Promise(() => {})));

    await render(<CatalogueScreen />);

    expect(screen.getAllByTestId('category-card-skeleton').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('content-card-skeleton').length).toBeGreaterThan(0);
  });
});

describe('CatalogueScreen with data', () => {
  it('renders one CategoryCard per navigation entry', async () => {
    setCatalogueSource(fakeSource(async () => FAKE_CATALOGUE));

    await render(<CatalogueScreen />);

    await waitFor(() => expect(screen.getByText('eBooks')).toBeTruthy());
    expect(screen.getByText('Audiobooks')).toBeTruthy();
  });

  // The mockup's "Recently published" blocks are the home-catalogue's own
  // shelves, shown under their own heading — not filtered by which category
  // card was tapped. Tab/chip selection (CLAUDE.md L-5) is not built yet.
  it('renders one section per shelf, each with its own publications', async () => {
    setCatalogueSource(fakeSource(async () => FAKE_CATALOGUE));

    await render(<CatalogueScreen />);

    await waitFor(() => expect(screen.getByText('New this term')).toBeTruthy());
    expect(screen.getByText('Rights for Robots')).toBeTruthy();
    expect(screen.getByText('Free to read')).toBeTruthy();
    expect(screen.getByText('Ethnographies of Waiting')).toBeTruthy();
  });

  // No shelf-detail screen exists in the navigator yet (RootNavigator /
  // navigation/types.ts are Keshav's — P0-6), so a category card has nowhere to
  // send the user. It must not claim otherwise: no press handler, no chevron.
  it('does not make a category card pressable, since no destination screen exists yet', async () => {
    setCatalogueSource(fakeSource(async () => FAKE_CATALOGUE));

    await render(<CatalogueScreen />);

    await waitFor(() => expect(screen.getByText('eBooks')).toBeTruthy());
    expect(screen.queryByTestId('category-card-chevron')).toBeNull();
  });

  it('navigates to ItemDetail with the publication id when a row is pressed', async () => {
    setCatalogueSource(fakeSource(async () => FAKE_CATALOGUE));

    await render(<CatalogueScreen />);

    await waitFor(() => expect(screen.getByText('Rights for Robots')).toBeTruthy());
    fireEvent.press(screen.getByRole('button', { name: 'Rights for Robots' }));

    expect(mockNavigate).toHaveBeenCalledWith('ItemDetail', { itemId: 'item_42' });
  });
});

describe('CatalogueScreen error', () => {
  it('shows a retry affordance when the catalogue fails to load, and retrying re-fetches', async () => {
    let attempt = 0;
    setCatalogueSource(
      fakeSource(async () => {
        attempt += 1;
        if (attempt === 1) throw new Error('network down');
        return FAKE_CATALOGUE;
      }),
    );

    await render(<CatalogueScreen />);

    await waitFor(() => expect(screen.getByText(/couldn.?t load/i)).toBeTruthy());

    fireEvent.press(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => expect(screen.getByText('eBooks')).toBeTruthy());
    expect(attempt).toBe(2);
  });
});
