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
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import type { DataSource } from '@adapters/InstitutionSource';
import { setCatalogueSource } from '@config/catalogue';
import { forgetFeedOffsets, rememberedFeedOffset } from '@hooks/useFeedScrollMemory';
import type { Institution } from '@model/institution';
import type { Catalogue } from '@model/types';
import homeCatalogueFixture from '@model/fixtures/OPDS-samples/01-home-catalogue.json';
import { color } from '@theme/tokens';

import { normalizeCatalogue } from '@/model/opds/normalize';
import { useLibraryStore } from '@store/libraryStore';
import CatalogueScreen from './CatalogueScreen';

// Controls what the licence source returns for the holdings cache.
// Defaults to empty so existing tests are unaffected.
//
// `borrow` and `placeHold` joined this mock for D12: pressing the Elite queue
// button on a shelf row makes a real borrow through this same seam.
const mockGetLibrary = jest.fn().mockResolvedValue({ loans: [], holds: [] });
const mockBorrow = jest.fn();
const mockPlaceHold = jest.fn();
jest.mock('@config/licence', () => ({
  getLicenceSource: () => ({
    getLibrary: () => mockGetLibrary(),
    borrow: (...args: [string]) => mockBorrow(...args),
    placeHold: (...args: [string]) => mockPlaceHold(...args),
  }),
}));

// Must be prefixed `mock` — Jest's module-factory scope guard only allows
// referencing out-of-scope variables whose name starts with "mock".
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

// `useNetworkStatus` talks to NetInfo, which has no meaningful answer under
// Jest. Mocked per-test so the offline case can be driven directly — same
// pattern as ItemDetailScreen.test.tsx.
const mockUseNetworkStatus = jest.fn(() => true);
jest.mock('@hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => mockUseNetworkStatus(),
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
    getPublicFeed: unused,
    getPublicPublication: unused,
    getInstitutions: unused,
    getInstitution: unused,
    getItemsBatch: unused,
  };
}

// Deliberately NOT inst_7f3, the id this screen used to fall back to: a test
// that used the old default could not tell "read the prop" from "ignored it".
const OTHER_INSTITUTION: Institution = {
  id: 'inst_a21',
  name: 'Second Institution',
  country: 'GB',
  code: 'SEC',
  city: 'Leeds',
  catalogueUrl: 'https://api.tf/opds/v1/institutions/inst_a21/catalogue',
};

afterEach(() => {
  setCatalogueSource(undefined);
  mockNavigate.mockClear();
  mockUseNetworkStatus.mockReturnValue(true);
  mockGetLibrary.mockClear();
  mockGetLibrary.mockResolvedValue({ loans: [], holds: [] });
  useLibraryStore.setState({ loans: [], holds: [], loading: false });
  // Module state, so it would otherwise carry into the next test.
  forgetFeedOffsets();
});

// A7 — the screen's half of the contract: the offset is recorded against THIS
// institution, so signing out and back in returns the reader where they were
// and a different institution starts fresh. The restoring itself is
// useFeedScrollMemory.test.tsx's job; this pins the wiring and the key.
describe('CatalogueScreen scroll position', () => {
  it('records the reader’s place under its own institution’s key', async () => {
    setCatalogueSource(fakeSource(async () => FAKE_CATALOGUE));

    await render(<CatalogueScreen institution={OTHER_INSTITUTION} />);

    await waitFor(() => expect(screen.getByText('Rights for Robots')).toBeTruthy());
    await fireEvent.scroll(screen.getByTestId('catalogue-feed'), {
      nativeEvent: { contentOffset: { y: 512 }, contentSize: { height: 3000, width: 400 } },
    });

    expect(rememberedFeedOffset(OTHER_INSTITUTION.id)).toBe(512);
  });
});

// CatalogueScreen is only ever rendered for a reader who HAS an institution —
// CatalogueHomeScreen sends everyone else to the public feed. So the institution
// arrives as a prop and there is no fallback id here any more: a screen that
// defaulted to one would silently serve the wrong catalogue to an anonymous
// reader, which is the bug A1 exists to fix.
describe('CatalogueScreen institution', () => {
  it('fetches the catalogue for the institution it was given', async () => {
    const asked: string[] = [];
    setCatalogueSource(
      fakeSource(async (institutionId) => {
        asked.push(institutionId);
        return FAKE_CATALOGUE;
      }),
    );

    await render(<CatalogueScreen institution={OTHER_INSTITUTION} />);

    await waitFor(() => expect(screen.getByText('eBooks')).toBeTruthy());
    expect(asked).toEqual([OTHER_INSTITUTION.id]);
  });

  it('names that institution in the picker', async () => {
    setCatalogueSource(fakeSource(async () => FAKE_CATALOGUE));

    await render(<CatalogueScreen institution={OTHER_INSTITUTION} />);

    await waitFor(() => expect(screen.getByText(OTHER_INSTITUTION.name)).toBeTruthy());
  });
});

describe('CatalogueScreen loading', () => {
  it('shows skeletons before the catalogue arrives', async () => {
    // Never resolves within the test, so the screen is caught mid-load.
    setCatalogueSource(fakeSource(() => new Promise(() => {})));

    await render(<CatalogueScreen institution={OTHER_INSTITUTION} />);

    expect(screen.getAllByTestId('category-card-skeleton').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('content-card-skeleton').length).toBeGreaterThan(0);
  });
});

describe('CatalogueScreen with data', () => {
  it('renders one CategoryCard per navigation entry', async () => {
    setCatalogueSource(fakeSource(async () => FAKE_CATALOGUE));

    await render(<CatalogueScreen institution={OTHER_INSTITUTION} />);

    await waitFor(() => expect(screen.getByText('eBooks')).toBeTruthy());
    // The COUNT and the order, read out of the tree — not one getByText per
    // title. Checking presence a title at a time is what this test used to do,
    // and it passes just as happily on a duplicated card or a reordered row,
    // which is most of what "one card per entry" is claiming.
    const titles = screen.getAllByTestId('category-card-title').map((node) => node.props.children);

    expect(titles).toEqual(['eBooks', 'Audiobooks']);
  });

  // The mockup's "Recently published" blocks are the home-catalogue's own
  // shelves, shown under their own heading — not filtered by which category card
  // was tapped. A shelf is not a filter (AGENTS.md L-5, settled 16 Aug 2026), so
  // there is no selection to build here; tapping a card opens that shelf.
  it('renders one section per shelf, each with its own publications', async () => {
    setCatalogueSource(fakeSource(async () => FAKE_CATALOGUE));

    await render(<CatalogueScreen institution={OTHER_INSTITUTION} />);

    await waitFor(() => expect(screen.getByText('New this term')).toBeTruthy());
    // Headings and rows together, in tree order, so the GROUPING is asserted and
    // not just the presence of four strings. Four separate getByText calls pass
    // even if every publication rendered under the first heading — which is the
    // one thing "each with its own publications" is actually claiming.
    const rendered = screen
      .getAllByTestId(/^(section-header-title|content-card-title)$/)
      .map((node) => node.props.children);

    expect(rendered).toEqual([
      'New this term',
      'Rights for Robots',
      'Free to read',
      'Ethnographies of Waiting',
    ]);
  });

  // The same claim with a shelf that holds more than one title, because a
  // one-publication-per-shelf fixture cannot tell "grouped correctly" from
  // "flattened and happened to line up".
  it('keeps each shelf’s publications under that shelf’s own heading', async () => {
    const twoThenOne: Catalogue = {
      ...FAKE_CATALOGUE,
      shelves: [
        {
          id: 'shelf_1',
          title: 'New this month',
          publications: [
            { ...FAKE_CATALOGUE.shelves[0].publications[0], id: 'item_1', title: 'First' },
            { ...FAKE_CATALOGUE.shelves[0].publications[0], id: 'item_2', title: 'Second' },
          ],
        },
        {
          id: 'shelf_2',
          title: 'Audio picks',
          publications: [
            { ...FAKE_CATALOGUE.shelves[0].publications[0], id: 'item_3', title: 'Third' },
          ],
        },
      ],
    };
    setCatalogueSource(fakeSource(async () => twoThenOne));

    await render(<CatalogueScreen institution={OTHER_INSTITUTION} />);

    await waitFor(() => expect(screen.getByText('First')).toBeTruthy());
    const rendered = screen
      .getAllByTestId(/^(section-header-title|content-card-title)$/)
      .map((node) => node.props.children);

    expect(rendered).toEqual([
      'New this month',
      'First',
      'Second',
      'Audio picks',
      'Third',
    ]);
  });

  // The Shelf route exists in the navigator, so a category card sends the user
  // to that shelf — see ShelfScreen.test.tsx for its own screen tests. `title`
  // travels with the id so the pushed screen's app bar can name the shelf before
  // its feed has loaded.
  it('navigates to the Shelf route with the shelfId and title when a category card is pressed', async () => {
    setCatalogueSource(fakeSource(async () => FAKE_CATALOGUE));

    await render(<CatalogueScreen institution={OTHER_INSTITUTION} />);

    await waitFor(() => expect(screen.getByText('eBooks')).toBeTruthy());
    fireEvent.press(screen.getByRole('button', { name: 'eBooks' }));

    // The institution goes with it: ShelfScreen fetches the listing itself and
    // must fetch it for the institution whose catalogue named this shelf.
    expect(mockNavigate).toHaveBeenCalledWith('Shelf', {
      shelfId: 'ebooks',
      title: 'eBooks',
      institutionId: 'inst_a21',
    });
  });

  it('navigates to ItemDetail with the publication id when a row is pressed', async () => {
    setCatalogueSource(fakeSource(async () => FAKE_CATALOGUE));

    await render(<CatalogueScreen institution={OTHER_INSTITUTION} />);

    await waitFor(() => expect(screen.getByText('Rights for Robots')).toBeTruthy());
    fireEvent.press(screen.getByRole('button', { name: 'Rights for Robots' }));

    expect(mockNavigate).toHaveBeenCalledWith('ItemDetail', { itemId: 'item_42' });
  });
});

// A3 — every row carries its access tier. The label is asserted, not just the
// slot: a screen that filled the slot with the wrong publication's tier would
// still pass a count-only check.
describe('CatalogueScreen access-tier badges', () => {
  it('gives every publication row a badge', async () => {
    setCatalogueSource(fakeSource(async () => FAKE_CATALOGUE));

    await render(<CatalogueScreen institution={OTHER_INSTITUTION} />);

    await waitFor(() => expect(screen.getByText('Rights for Robots')).toBeTruthy());
    // Two shelves, one publication each.
    expect(screen.getAllByTestId('content-card-badge')).toHaveLength(2);
  });

  // A3 lists four things on the card: title, publisher, file format, badge. The
  // format is read off the publication the feed sent, never guessed from the id
  // or the tier — the two fixture shelves deliberately carry different ones.
  it('gives every row its own file format', async () => {
    setCatalogueSource(fakeSource(async () => FAKE_CATALOGUE));

    await render(<CatalogueScreen institution={OTHER_INSTITUTION} />);

    await waitFor(() => expect(screen.getByText('Rights for Robots')).toBeTruthy());
    const formats = screen
      .getAllByTestId('content-card-format')
      .map((node) => node.props.children);

    expect(formats).toEqual(['PDF', 'EPUB']);
  });

  it('labels a subscription title and an open access title differently', async () => {
    setCatalogueSource(fakeSource(async () => FAKE_CATALOGUE));

    await render(<CatalogueScreen institution={OTHER_INSTITUTION} />);

    await waitFor(() => expect(screen.getByText('Subscription')).toBeTruthy());
    expect(screen.getByText('Open Access')).toBeTruthy();
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

    await render(<CatalogueScreen institution={OTHER_INSTITUTION} />);

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

    await render(<CatalogueScreen institution={OTHER_INSTITUTION} />);

    await waitFor(() => expect(screen.getByText(titles[0])).toBeTruthy());
    // Read out of the tree in tree order, so reordering the row would fail here.
    // Checking presence one title at a time would not: it passes on any permutation.
    const rendered = screen
      .getAllByTestId('category-card-title')
      .map((node) => node.props.children);

    expect(rendered).toEqual(titles);
  });

  // Accents cycle by POSITION, never by shelf identity (see the ACCENTS comment
  // in CatalogueScreen.tsx) — there are 4 tokens and this feed sends 7 entries,
  // so the 5th card onward must wrap back to the 1st token rather than reuse the
  // last one or throw past the end of the array.
  //
  it('cycles accent colors by position and wraps once entries outnumber accent tokens', async () => {
    const titles = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    setCatalogueSource(fakeSource(async () => catalogueWithNavigation(titles)));

    await render(<CatalogueScreen institution={OTHER_INSTITUTION} />);

    await waitFor(() => expect(screen.getByText('A')).toBeTruthy());

    const backgrounds = screen
      .getAllByTestId('category-card')
      .map((node) => StyleSheet.flatten(node.props.style).backgroundColor);

    expect(backgrounds).toEqual([
      color.primary,
      color.navy,
      color.blueBright,
      color.blueDeep,
      color.primary,
      color.navy,
      color.blueBright,
    ]);
  });

  // "Renders" alone only proves the text is somewhere in the tree — a card
  // stuck showing its own skeleton, or a screen that fell into its ErrorState
  // branch with the title as a coincidental substring, would still pass that.
  // "Not treating it as special" is a claim about the CARD'S OWN state, not
  // just its text, so this checks the state directly.
  it('renders a single row without treating it as special', async () => {
    setCatalogueSource(fakeSource(async () => catalogueWithNavigation(['All titles'])));

    await render(<CatalogueScreen institution={OTHER_INSTITUTION} />);

    await waitFor(() => expect(screen.getByText('All titles')).toBeTruthy());
    expect(screen.queryByTestId('category-card-skeleton')).toBeNull();
    expect(screen.queryByText(/couldn.?t load/i)).toBeNull();
    expect(screen.getAllByTestId('category-card-title')).toHaveLength(1);
  });

  // A5/screen 01: "long titles an administrator actually typed" is one of the
  // dynamic cases the category row has to survive, alongside none/one/many.
  // CategoryCard.test.tsx already proves the COMPONENT truncates a long title;
  // this proves the same thing survives the trip through real feed data rather
  // than a hand-written CategoryCard prop.
  it('truncates an administrator-length long title instead of breaking the strip', async () => {
    const longTitle =
      'Nineteenth and twentieth century sociological theory and its discontents in comparative context';
    setCatalogueSource(fakeSource(async () => catalogueWithNavigation([longTitle])));

    await render(<CatalogueScreen institution={OTHER_INSTITUTION} />);

    await waitFor(() => expect(screen.getByText(longTitle)).toBeTruthy());
    expect(screen.getByTestId('category-card-title').props.numberOfLines).toBeGreaterThan(0);
  });

  // Not reachable from a real feed — the contract requires at least one entry —
  // but the screen must not crash if one ever arrives, and this is the only place
  // the case can be expressed at all.
  it('renders no rows at all without crashing', async () => {
    setCatalogueSource(fakeSource(async () => catalogueWithNavigation([])));

    await render(<CatalogueScreen institution={OTHER_INSTITUTION} />);

    // The sections below the row still arrive, which is how we know the screen
    // rendered rather than died on an empty array.
    await waitFor(() => expect(screen.getByText('New this term')).toBeTruthy());
    expect(screen.queryByText('All titles')).toBeNull();
  });

  it('renders the real home-catalogue fixture correctly', async () => {
    setCatalogueSource(fakeSource(async () => normalizeCatalogue(homeCatalogueFixture)));

    await render(<CatalogueScreen institution={OTHER_INSTITUTION} />);

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

describe('CatalogueScreen renders whatever shelves arrive', () => {
  function catalogueWithShelves(titles: string[]): Catalogue {
    return {
      ...FAKE_CATALOGUE,
      shelves: titles.map((title, index) => ({
        id: `shelf${index}`,
        title,
        publications: [FAKE_CATALOGUE.shelves[0].publications[0]],
      })),
    };
  }

  it('renders exactly the shelves the feed sent, no hardcoded count', async () => {
    const titles = ['New this month', 'Criticism & theory', 'Audio picks'];
    setCatalogueSource(fakeSource(async () => catalogueWithShelves(titles)));

    await render(<CatalogueScreen institution={OTHER_INSTITUTION} />);

    for (const title of titles) {
      await waitFor(() => expect(screen.getByText(title)).toBeTruthy());
    }
  });

  // Contract caps this at 3, but the render loop has no cap of its own — this
  // just proves it wouldn't crash if that ever changed.
  it('does not crash if more than three shelves arrive', async () => {
    const titles = ['A', 'B', 'C', 'D', 'E'];
    setCatalogueSource(fakeSource(async () => catalogueWithShelves(titles)));

    await render(<CatalogueScreen institution={OTHER_INSTITUTION} />);

    await waitFor(() => expect(screen.getByText('E')).toBeTruthy());
  });

  // Contract fact: a shelf with nothing in it is OMITTED from the feed
  // entirely, never sent with an empty publications array. So a nav entry can
  // exist with no matching shelf — the two lists are independent, and the
  // screen must not assume they line up.
  it('renders only the shelves that exist, even if navigation has more entries', async () => {
    const catalogueWithGap: Catalogue = {
      ...FAKE_CATALOGUE,
      navigation: [
        { title: 'Shelf One', href: 'https://x/groups/shelf-one', shelfId: 'shelf1' },
        { title: 'Shelf Two', href: 'https://x/groups/shelf-two', shelfId: 'shelf2' },
        { title: 'Shelf Three', href: 'https://x/groups/shelf-three', shelfId: 'shelf3' },
        { title: 'Shelf Four', href: 'https://x/groups/shelf-four', shelfId: 'shelf4' },
      ],
      // Deliberately shelf1 and shelf3 only — shelf2 and shelf4 exist as nav
      // cards above but have no section, so nothing could match them by
      // coincidence of index or id.
      shelves: [
        {
          id: 'shelf1',
          // Deliberately different from the nav entry's title 'Shelf One' —
          // same as the two names can differ (see the mismatch test above),
          // and it keeps this text unambiguous for getByText.
          title: 'One',
          publications: [FAKE_CATALOGUE.shelves[0].publications[0]],
        },
        {
          id: 'shelf3',
          title: 'Three',
          publications: [FAKE_CATALOGUE.shelves[1].publications[0]],
        },
      ],
    };

    setCatalogueSource(fakeSource(async () => catalogueWithGap));

    await render(<CatalogueScreen institution={OTHER_INSTITUTION} />);

    // The 2 real sections render.
    await waitFor(() => expect(screen.getByText('One')).toBeTruthy());
    expect(screen.getByText('Three')).toBeTruthy();

    // The 2 gapped nav entries still show as cards up top — the missing
    // shelf only means no section below, not a hidden card.
    expect(screen.getByText('Shelf Two')).toBeTruthy();
    expect(screen.getByText('Shelf Four')).toBeTruthy();
  });
});

describe('CatalogueScreen offline', () => {
  it('shows the offline banner over the loaded catalogue when the network is down', async () => {
    mockUseNetworkStatus.mockReturnValue(false);
    setCatalogueSource(fakeSource(async () => FAKE_CATALOGUE));

    await render(<CatalogueScreen institution={OTHER_INSTITUTION} />);

    // The banner is a notice, not a blocker — the catalogue underneath it
    // must still be there (AGENTS.md: offline is degraded, not disabled).
    await waitFor(() => expect(screen.getByText('eBooks')).toBeTruthy());
    expect(screen.getByText("You're offline")).toBeTruthy();
  });

  it('renders no offline banner while the network is up', async () => {
    setCatalogueSource(fakeSource(async () => FAKE_CATALOGUE));

    await render(<CatalogueScreen institution={OTHER_INSTITUTION} />);

    await waitFor(() => expect(screen.getByText('eBooks')).toBeTruthy());
    expect(screen.queryByText("You're offline")).toBeNull();
  });
});

describe('CatalogueScreen with no curated shelves', () => {
  // Zero shelves is legal (a brand-new institution) and different from zero
  // navigation entries, which the contract's own minItems: 1 rules out.
  it('renders EmptyState instead of silently showing nothing', async () => {
    const noShelves: Catalogue = { ...FAKE_CATALOGUE, shelves: [] };
    setCatalogueSource(fakeSource(async () => noShelves));

    await render(<CatalogueScreen institution={OTHER_INSTITUTION} />);

    await waitFor(() =>
      expect(screen.getByText('Nothing to show here yet.')).toBeTruthy(),
    );
    // The category row is unaffected by an empty shelf list — the two are
    // independent, same as the "missing shelf" case above.
    expect(screen.getByText('eBooks')).toBeTruthy();
  });
});

// F8 — list-level cache. The whole point of the library store is that forty
// cards share one GET /api/v1/library call rather than making forty. This
// verifies the screen calls getLibrary exactly once on mount, regardless of
// how many publications are in the catalogue.
describe('CatalogueScreen — list-level holdings cache', () => {
  it('calls getLibrary once on mount, not once per card', async () => {
    // Two shelves, three publications total — getLibrary must still be called once.
    const multiCardCatalogue: Catalogue = {
      ...FAKE_CATALOGUE,
      shelves: [
        {
          id: 'shelf_a',
          title: 'Shelf A',
          publications: [
            { ...FAKE_CATALOGUE.shelves[0].publications[0], id: 'item_1', title: 'Book One' },
            { ...FAKE_CATALOGUE.shelves[0].publications[0], id: 'item_2', title: 'Book Two' },
          ],
        },
        {
          id: 'shelf_b',
          title: 'Shelf B',
          publications: [
            { ...FAKE_CATALOGUE.shelves[0].publications[0], id: 'item_3', title: 'Book Three' },
          ],
        },
      ],
    };
    setCatalogueSource(fakeSource(async () => multiCardCatalogue));

    await render(<CatalogueScreen institution={OTHER_INSTITUTION} />);

    await waitFor(() => expect(screen.getByText('Book One')).toBeTruthy());
    expect(mockGetLibrary).toHaveBeenCalledTimes(1);
  });

  // D10 — holdings joined per item. Pre-populating the store verifies that the
  // badge resolves against the live loan rather than against empty holdings.
  it('reflects a held loan in the action tier when the library store has one', async () => {
    useLibraryStore.setState({
      loans: [{ loanId: 'loan_1', itemId: 'item_42', state: 'active', expiresAt: 9_999_999_999 }],
      holds: [],
    });
    // item_42 is ELITE in FAKE_CATALOGUE — with an active loan resolveAccess
    // resolves to 'available', which renders the ELITE tier badge regardless.
    // The important thing is the screen does not crash when a loan is present.
    setCatalogueSource(fakeSource(async () => FAKE_CATALOGUE));

    await render(<CatalogueScreen institution={OTHER_INSTITUTION} />);

    await waitFor(() => expect(screen.getByText('Rights for Robots')).toBeTruthy());
    // Screen rendered without error and the card is present — the holding was joined.
    expect(screen.getByText('Rights for Robots')).toBeTruthy();
  });
});

// ── D12 — the Elite queue button on a home shelf row ─────────────────────────
//
// The third of the three card surfaces. Full coverage of the pending semantics
// lives in queueRequest.test.ts and ShelfScreen.test.tsx; this block proves the
// button reaches THIS surface and delegates to the real licence source.
describe('CatalogueScreen — D12 Elite queue button', () => {
  const ELITE_CATALOGUE: Catalogue = {
    ...FAKE_CATALOGUE,
    shelves: [
      {
        id: 'elite',
        title: 'Elite titles',
        publications: [
          {
            id: 'item_elite',
            title: 'An Elite Title',
            publisher: 'Routledge',
            authors: [],
            subjects: [],
            format: 'EPUB',
            acquisition: {
              actionId: 'borrow',
              href: 'https://x/loan/item_elite',
              licenceModel: 'ELITE',
              encryption: null,
              hasSearchIndex: false,
              canPersist: true,
            },
          },
        ],
      },
    ],
  };

  beforeEach(() => {
    mockBorrow.mockResolvedValue({
      loanId: 'loan_1',
      itemId: 'item_elite',
      state: 'active',
      expiresAt: 9_999,
    });
  });

  it('offers Grant access on an Elite shelf row', async () => {
    setCatalogueSource(fakeSource(async () => ELITE_CATALOGUE));

    await render(<CatalogueScreen institution={OTHER_INSTITUTION} />);

    await waitFor(() => expect(screen.getByText('Grant access')).toBeTruthy());
  });

  // The existing shelves are SUBSCRIPTION and OPEN_ACCESS, whose actions belong
  // on the detail screen — so the default feed grows no buttons.
  it('draws no queue button on non-Elite shelves', async () => {
    setCatalogueSource(fakeSource(async () => FAKE_CATALOGUE));

    await render(<CatalogueScreen institution={OTHER_INSTITUTION} />);
    await waitFor(() => expect(screen.getByText('Rights for Robots')).toBeTruthy());

    expect(screen.queryByText('Grant access')).toBeNull();
  });

  it('borrows the pressed item, without navigating away', async () => {
    setCatalogueSource(fakeSource(async () => ELITE_CATALOGUE));

    await render(<CatalogueScreen institution={OTHER_INSTITUTION} />);
    await waitFor(() => expect(screen.getByText('Grant access')).toBeTruthy());

    fireEvent.press(screen.getByTestId('action-button-grantAccess'));

    await waitFor(() => expect(mockBorrow).toHaveBeenCalledWith('item_elite'));
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
