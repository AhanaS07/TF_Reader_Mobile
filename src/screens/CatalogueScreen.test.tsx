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
import homeCatalogueFixture from '@model/fixtures/OPDS-samples/01-home-catalogue.json';

import { normalizeCatalogue } from '@/model/opds/normalize';
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
            licenceModel: 'SUBSCRIPTION',
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
            licenceModel: 'OPEN_ACCESS',
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
  // shelves, shown under their own heading — not filtered by which category card
  // was tapped. A shelf is not a filter (AGENTS.md L-5, settled 16 Aug 2026), so
  // there is no selection to build here; tapping a card opens that shelf.
  it('renders one section per shelf, each with its own publications', async () => {
    setCatalogueSource(fakeSource(async () => FAKE_CATALOGUE));

    await render(<CatalogueScreen />);

    await waitFor(() => expect(screen.getByText('New this term')).toBeTruthy());
    expect(screen.getByText('Rights for Robots')).toBeTruthy();
    expect(screen.getByText('Free to read')).toBeTruthy();
    expect(screen.getByText('Ethnographies of Waiting')).toBeTruthy();
  });

  // The Shelf route exists in the navigator, so a category card sends the user
  // to that shelf — see ShelfScreen.test.tsx for its own screen tests. `title`
  // travels with the id so the pushed screen's app bar can name the shelf before
  // its feed has loaded.
  it('navigates to the Shelf route with the shelfId and title when a category card is pressed', async () => {
    setCatalogueSource(fakeSource(async () => FAKE_CATALOGUE));

    await render(<CatalogueScreen />);

    await waitFor(() => expect(screen.getByText('eBooks')).toBeTruthy());
    fireEvent.press(screen.getByRole('button', { name: 'eBooks' }));

    expect(mockNavigate).toHaveBeenCalledWith('Shelf', {
      shelfId: 'ebooks',
      title: 'eBooks',
    });
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

// An administrator configures the shelves per institution, so the category row
// has to render whatever arrives — any count, any titles, any ids (AGENTS.md,
// settled decisions, L-5). The fixtures can only ever show one institution's
// choice, so the range is proven here by handing the screen navigation arrays
// directly. This is the claim the fixtures deliberately do NOT make.
describe('CatalogueScreen renders whatever navigation arrives', () => {
  function catalogueWithNavigation(titles: string[]): Catalogue {
    return {
      ...FAKE_CATALOGUE,
      navigation: titles.map((title, index) => ({
        title,
        // Ids in reverse order to the titles, so anything that sorted the row or
        // derived a label from an id would fail here rather than look correct.
        href: `https://x/groups/s${titles.length - index}`,
        shelfId: `s${titles.length - index}`,
      })),
    };
  }

  it('renders every row that arrives, in order', async () => {
    const titles = [
      'All titles',
      'Nineteenth-century literary criticism',
      'Audio picks',
      'Reading lists, Michaelmas',
      'Open monographs',
      'Theses and dissertations',
      'Reference and dictionaries',
      'Recently returned',
    ];
    setCatalogueSource(fakeSource(async () => catalogueWithNavigation(titles)));

    await render(<CatalogueScreen />);

    await waitFor(() => expect(screen.getByText(titles[0])).toBeTruthy());
    // Read out of the tree in tree order, so reordering the row would fail here.
    // Checking presence one title at a time would not: it passes on any permutation.
    const rendered = screen
      .getAllByTestId('category-card-title')
      .map((node) => node.props.children);

    expect(rendered).toEqual(titles);
  });

  it('renders a single row without treating it as special', async () => {
    setCatalogueSource(fakeSource(async () => catalogueWithNavigation(['All titles'])));

    await render(<CatalogueScreen />);

    await waitFor(() => expect(screen.getByText('All titles')).toBeTruthy());
  });

  // Not reachable from a real feed — the contract requires at least one entry —
  // but the screen must not crash if one ever arrives, and this is the only place
  // the case can be expressed at all.
  it('renders no rows at all without crashing', async () => {
    setCatalogueSource(fakeSource(async () => catalogueWithNavigation([])));

    await render(<CatalogueScreen />);

    // The sections below the row still arrive, which is how we know the screen
    // rendered rather than died on an empty array.
    await waitFor(() => expect(screen.getByText('New this term')).toBeTruthy());
    expect(screen.queryByText('All titles')).toBeNull();
  });

  it('renders the real home-catalogue fixture correctly', async () => {
    setCatalogueSource(fakeSource(async () => normalizeCatalogue(homeCatalogueFixture)));

    await render(<CatalogueScreen />);

    await waitFor(() => expect(screen.getByText('All titles')).toBeTruthy());
    const rendered = screen.getAllByTestId('category-card-title').map((node) => node.props.children);
    expect(rendered).toEqual([
      'All titles',
      'New this month',
      'Nineteenth-century literary criticism',
      'Audio picks',
    ]);

    // shelf_2's nav entry and its own shelf feed disagree on the title on
    // purpose — the card above must show the nav label, the section below it
    // must show the shelf's own title, and both must be on screen at once.
    expect(screen.getByText('Criticism & theory, 1800–1899')).toBeTruthy();
  });

});
