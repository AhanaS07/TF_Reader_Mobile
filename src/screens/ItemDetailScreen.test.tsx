// src/screens/ItemDetailScreen.test.tsx
// Screen 05 (book) and Screen 04 (article). Same seam as CatalogueScreen.test.tsx
// and ShelfScreen.test.tsx: inject a fake DataSource through `setCatalogueSource`
// rather than hitting MockAdapter's fixtures, so these tests pin the screen's own
// wiring (loading -> data -> error -> retry) independently of what the fixtures
// contain.
//
// THE ARTICLE TESTS RENDER `renderArticleContent` DIRECTLY, NOT THE FULL SCREEN.
// The fetch below always resolves `workType: 'book'` — see the header comment in
// ItemDetailScreen.tsx — so there is no fake `DataSource` response that makes the
// full screen choose the article presentation today. Testing the exported
// presentation function against a hand-built `ItemDetail` is the honest
// alternative: it proves the branch works without pretending the fetch can
// select it yet.
//
// `await render(...)` is required — RTL 14's render is async.
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { resolveAccess } from '@access/resolveAccess';
import type { DataSource } from '@adapters/InstitutionSource';
import { setCatalogueSource } from '@config/catalogue';
import { buildItemDetail } from '@model/detail';
import { CatalogueError, CatalogueFailure } from '@model/errors';
import type { Acquisition, Publication } from '@model/types';

import ItemDetailScreen, {
  ARTICLE_WORK_TYPE,
  BOOK_WORK_TYPE,
  renderArticleContent,
  renderBookContent,
} from './ItemDetailScreen';

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

// Every optional field populated, same reason as `aBook`. No `isbn`,
// `numberOfPages`, `publisher`, `subtitle` or `coverUrl` — real articles do not
// carry these on the model any more than a book publication is required to, and
// leaving them off here means a test that finds one anyway is finding a real
// leak rather than a fixture accident.
function anArticle(over: Partial<Publication> = {}): Publication {
  return {
    id: 'item_article_1',
    title: 'Rights for Robots: A Legal Framework',
    authors: ['Joshua C. Gellers'],
    published: '2021-03-15',
    subjects: ['Law', 'Technology'],
    description: 'An examination of legal personhood for artificial agents.',
    format: 'PDF',
    acquisition: anAcquisition({ licenceModel: 'OPEN_ACCESS' }),
    ...over,
  };
}

// Builds a real `ItemDetail` through the same chain the screen uses —
// `resolveAccess` then `buildItemDetail` — just with `workType` fixed to
// 'article' by hand, since nothing in the fetch can choose it yet.
function anArticleDetail(over: Partial<Publication> = {}) {
  const publication = anArticle(over);
  const access = resolveAccess({ item: publication, institutionId: 'inst_7f3', session: null });
  return buildItemDetail({ publication, workType: ARTICLE_WORK_TYPE, access });
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

// Loading, not-found and offline are not repeated below for the article case.
// All three happen before `workType` is even read — they are generic screen
// states, not book or article ones, and the suites above already exercise the
// exact same code paths this screen uses regardless of which presentation it
// eventually picks.
describe('ItemDetailScreen article presentation (renderArticleContent)', () => {
  it('renders the article title', async () => {
    await render(renderArticleContent(anArticleDetail(), jest.fn()));

    expect(screen.getByText('Rights for Robots: A Legal Framework')).toBeTruthy();
  });

  it('renders the authors', async () => {
    await render(renderArticleContent(anArticleDetail(), jest.fn()));

    expect(screen.getByText('Joshua C. Gellers')).toBeTruthy();
  });

  it('renders the published date', async () => {
    await render(renderArticleContent(anArticleDetail(), jest.fn()));

    expect(screen.getByText(/2021-03-15/)).toBeTruthy();
  });

  it('renders the abstract under its own heading when present', async () => {
    await render(renderArticleContent(anArticleDetail(), jest.fn()));

    expect(screen.getByText('Abstract')).toBeTruthy();
    expect(
      screen.getByText('An examination of legal personhood for artificial agents.'),
    ).toBeTruthy();
  });

  it('renders no abstract heading when there is no description', async () => {
    await render(renderArticleContent(anArticleDetail({ description: undefined }), jest.fn()));

    expect(screen.queryByText('Abstract')).toBeNull();
  });

  it('renders the access tier badge for the resolved tier', async () => {
    const detail = anArticleDetail({ acquisition: anAcquisition({ licenceModel: 'SUBSCRIPTION' }) });

    await render(renderArticleContent(detail, jest.fn()));

    expect(screen.getByText('Subscription')).toBeTruthy();
  });

  it('renders the actions resolveAccess resolves, not an invented set', async () => {
    const detail = anArticleDetail({ acquisition: anAcquisition({ licenceModel: 'OPEN_ACCESS' }) });

    await render(renderArticleContent(detail, jest.fn()));

    expect(screen.getByText('Read')).toBeTruthy();
    expect(screen.getByText('Download')).toBeTruthy();
  });

  it('does not crash and still renders title and authors with every optional field absent', async () => {
    const detail = anArticleDetail({ published: undefined, description: undefined });

    await render(renderArticleContent(detail, jest.fn()));

    expect(screen.getByText('Rights for Robots: A Legal Framework')).toBeTruthy();
    expect(screen.getByText('Joshua C. Gellers')).toBeTruthy();
  });

  // Publication has no field for a page range, and neither backend contract
  // mentions one — see the code comment above renderArticleContent in
  // ItemDetailScreen.tsx. This documents the gap rather than papering over it:
  // there is no "Page range" label anywhere on this screen, because there is no
  // data behind one to render.
  it('renders no page-range row, because Publication has no pageRange field', async () => {
    await render(renderArticleContent(anArticleDetail(), jest.fn()));

    expect(screen.queryByText(/page range/i)).toBeNull();
  });

  // None of these six things exist in either backend contract. Rendering any of
  // them would be inventing data, which the board is explicit about not doing
  // this week.
  it('invents no DOI, citation, tab, price or table-of-contents data', async () => {
    await render(renderArticleContent(anArticleDetail(), jest.fn()));

    expect(screen.queryByText(/doi/i)).toBeNull();
    expect(screen.queryByText(/citation/i)).toBeNull();
    expect(screen.queryByText(/figures|metrics|full article/i)).toBeNull();
    expect(screen.queryByText(/table of contents/i)).toBeNull();
    expect(screen.queryByText(/paperback|ebook price/i)).toBeNull();
  });

  // ISBN, page count and publisher are on `ItemDetail` — buildItemDetail copies
  // them from any Publication that carries them — but the board's screen 04
  // field list never asked for them, so renderArticleContent must not read them
  // even when they are present on the object it was handed.
  it('renders no book-only fields even when the underlying data carries them', async () => {
    const detail = anArticleDetail({
      isbn: '9780367211745',
      numberOfPages: 212,
      publisher: 'Routledge',
    });

    await render(renderArticleContent(detail, jest.fn()));

    expect(screen.queryByText(/isbn/i)).toBeNull();
    expect(screen.queryByText(/pages/i)).toBeNull();
    expect(screen.queryByText(/publisher/i)).toBeNull();
  });
});

describe('ItemDetailScreen selects presentation by workType', () => {
  // Same underlying content, differing only in workType, rendered through each
  // exported presentation function directly — the same two calls the screen's
  // own one-line branch makes. Article-only and book-only affordances appear on
  // exactly one side each.
  it('renders the article layout for workType article and the book layout for workType book', async () => {
    const publication = aBook();
    const access = resolveAccess({ item: publication, institutionId: 'inst_7f3', session: null });
    const articleDetail = buildItemDetail({ publication, workType: ARTICLE_WORK_TYPE, access });
    const bookDetail = buildItemDetail({ publication, workType: BOOK_WORK_TYPE, access });

    const article = await render(renderArticleContent(articleDetail, jest.fn()));
    expect(screen.getByText('Abstract')).toBeTruthy();
    expect(screen.queryByText(/isbn/i)).toBeNull();
    article.unmount();

    await render(renderBookContent(bookDetail, jest.fn()));
    expect(screen.queryByText('Abstract')).toBeNull();
    expect(screen.getByText(/9780367211745/)).toBeTruthy();
  });
});
