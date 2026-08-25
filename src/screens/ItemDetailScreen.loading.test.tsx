// src/screens/ItemDetailScreen.loading.test.tsx
// Subtask 2 — ActionButton's loading state, wired at this call site.
//
// WHAT CHANGED IN THE SCREEN. Every licence call here used to be
// fire-and-forget: `source.borrow(itemId).then(refresh)` with nothing tracking
// that a call was open, so the button stayed idle for as long as flambeau took
// and Read could be tapped four times for four borrows. The screen now holds a
// `pendingAction` and hands it to `ActionBar`, whose `pending` prop was built for
// exactly this and had no caller.
//
// WHY THIS IS A SEPARATE FILE FROM ItemDetailScreen.test.tsx, and not a describe
// block appended to it. That suite has eight pre-existing failures whose tests
// leave licence promises unresolved at teardown, and an unresolved promise leaves
// an open act() scope that corrupts every render after it in the same file — the
// trap that file's own comments already document for two presses in one test.
// Tests appended there failed for that reason and passed in isolation. A separate
// file gets its own module registry and its own clean tree, and it also means
// this work touches none of the failing suite.
//
// OPEN ACCESS THROUGHOUT, deliberately. It resolves to Read + Download without a
// session, a loan or a hold, so these tests exercise the pending wiring rather
// than re-testing the Elite resolve.
//
// `await render(...)` is required — RTL 14's render is async. See App.test.tsx.
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import type { DataSource } from '@adapters/InstitutionSource';
import { setCatalogueSource } from '@config/catalogue';
import { buildItemDetail } from '@model/detail';
import type { Acquisition, Publication } from '@model/types';
import { resolveAccess } from '@access/resolveAccess';
import { useLibraryStore } from '@store/libraryStore';

import ItemDetailScreen, { ARTICLE_WORK_TYPE, renderArticleContent } from './ItemDetailScreen';

// Must be prefixed `mock` — Jest's module-factory scope guard only allows
// referencing out-of-scope variables whose name starts with "mock".
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

const mockUseNetworkStatus = jest.fn(() => true);
jest.mock('@hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => mockUseNetworkStatus(),
}));

const mockBorrow = jest.fn();
const mockGetLibrary = jest.fn();
jest.mock('@config/licence', () => ({
  getLicenceSource: () => ({
    borrow: (...args: [string]) => mockBorrow(...args),
    getLibrary: () => mockGetLibrary(),
    returnLoan: jest.fn(),
    placeHold: jest.fn(),
    acceptOffer: jest.fn(),
    cancelHold: jest.fn(),
  }),
}));

const LOAN = { loanId: 'loan_1', itemId: 'item_42', state: 'active' as const, expiresAt: 9_999 };

function anAcquisition(over: Partial<Acquisition> = {}): Acquisition {
  return {
    actionId: 'openAccess',
    href: 'https://flambeau.test/api/v1/loans',
    licenceModel: 'OPEN_ACCESS',
    encryption: null,
    hasSearchIndex: false,
    canPersist: true,
    ...over,
  };
}

function anOpenAccessBook(over: Partial<Publication> = {}): Publication {
  return {
    id: 'item_42',
    title: 'Rights for Robots',
    authors: ['Joshua C. Gellers'],
    publisher: 'Routledge',
    subjects: [],
    format: 'PDF',
    acquisition: anAcquisition(),
    ...over,
  } as Publication;
}

function fakeSource(getPublication: () => Promise<Publication>): DataSource {
  const unused = () => Promise.reject(new Error('not stubbed for this test'));
  return {
    getHomeCatalogue: unused,
    getShelf: unused,
    getPublication,
    getPublicPublication: getPublication,
    getPublicFeed: unused,
    getInstitutions: unused,
    getInstitution: unused,
    getItemsBatch: unused,
  } as unknown as DataSource;
}

const routeProps = {
  route: { params: { itemId: 'item_42' } },
  navigation: { navigate: mockNavigate },
} as unknown as Parameters<typeof ItemDetailScreen>[0];

beforeEach(() => {
  mockBorrow.mockResolvedValue(LOAN);
  mockGetLibrary.mockResolvedValue({ loans: [], holds: [] });
  setCatalogueSource(fakeSource(async () => anOpenAccessBook()));
});

afterEach(() => {
  setCatalogueSource(undefined);
  jest.clearAllMocks();
  mockUseNetworkStatus.mockReturnValue(true);
  useLibraryStore.setState({ loans: [], holds: [], loading: false });
});

describe('ItemDetailScreen — the bar before anything is tapped', () => {
  it('renders Read idle, with no spinner', async () => {
    await render(<ItemDetailScreen {...routeProps} />);

    await waitFor(() => expect(screen.getByText('Read')).toBeTruthy());
    expect(screen.getByTestId('action-button-read').props.accessibilityState).toEqual({
      disabled: false,
      busy: false,
    });
    expect(screen.queryByTestId('action-button-spinner')).toBeNull();
  });
});

describe('ItemDetailScreen — the licence call still happens', () => {
  // The pending wiring must not have changed WHAT the tap does. These two are the
  // regression guard for the refactor that moved the four calls through
  // `runLicenceCall`.
  it('borrows the item when Read is tapped', async () => {
    await render(<ItemDetailScreen {...routeProps} />);
    await waitFor(() => expect(screen.getByText('Read')).toBeTruthy());

    fireEvent.press(screen.getByTestId('action-button-read'));

    await waitFor(() => expect(mockBorrow).toHaveBeenCalledWith('item_42'));
  });

  it('invalidates the holdings cache afterwards', async () => {
    await render(<ItemDetailScreen {...routeProps} />);
    await waitFor(() => expect(screen.getByText('Read')).toBeTruthy());

    fireEvent.press(screen.getByTestId('action-button-read'));

    await waitFor(() => expect(mockGetLibrary).toHaveBeenCalled());
  });
});

describe('ItemDetailScreen — the bar settles again', () => {
  it('returns Read to idle after the call succeeds', async () => {
    await render(<ItemDetailScreen {...routeProps} />);
    await waitFor(() => expect(screen.getByText('Read')).toBeTruthy());

    fireEvent.press(screen.getByTestId('action-button-read'));
    await waitFor(() => expect(mockGetLibrary).toHaveBeenCalled());

    await waitFor(() =>
      expect(screen.getByTestId('action-button-read').props.accessibilityState).toEqual({
        disabled: false,
        busy: false,
      }),
    );
    expect(screen.queryByTestId('action-button-spinner')).toBeNull();
  });

  // A stuck spinner is the worst outcome of a failed call, so failure gets its
  // own test rather than riding on the success path.
  it('returns Read to idle after the call fails', async () => {
    mockBorrow.mockRejectedValue(new Error('boom'));

    await render(<ItemDetailScreen {...routeProps} />);
    await waitFor(() => expect(screen.getByText('Read')).toBeTruthy());

    fireEvent.press(screen.getByTestId('action-button-read'));
    // The cache is invalidated on failure too: a borrow that threw may still
    // have created the loan.
    await waitFor(() => expect(mockGetLibrary).toHaveBeenCalled());

    await waitFor(() =>
      expect(screen.getByTestId('action-button-read').props.accessibilityState).toEqual({
        disabled: false,
        busy: false,
      }),
    );
  });
});

// The two presentations share one ActionBar, so `pending` has to reach both.
// Rendered directly from a hand-built detail, the way every other article test
// in this repo does — no fetch, so no promise to leave open.
describe('ItemDetailScreen — pending reaches both presentations', () => {
  function anArticleDetail() {
    const publication = anOpenAccessBook();
    const access = resolveAccess({
      item: publication,
      institutionId: 'inst_7f3',
      session: null,
    });
    return buildItemDetail({ publication, workType: ARTICLE_WORK_TYPE, access });
  }

  it('spins the pending action in the article presentation', async () => {
    await render(renderArticleContent(anArticleDetail(), jest.fn(), 'read'));

    expect(screen.getByTestId('action-button-spinner')).toBeTruthy();
    expect(screen.getByTestId('action-button-read').props.accessibilityState).toEqual({
      disabled: true,
      busy: true,
    });
  });

  it('leaves the other buttons in the bar alone', async () => {
    await render(renderArticleContent(anArticleDetail(), jest.fn(), 'read'));

    // Download is a sibling of the pending Read and must not spin as well —
    // ActionBar marks one action pending, not the bar.
    expect(screen.getByTestId('action-button-download').props.accessibilityState).toEqual({
      disabled: false,
      busy: false,
    });
  });

  it('spins nothing when no action is pending', async () => {
    await render(renderArticleContent(anArticleDetail(), jest.fn()));

    expect(screen.queryByTestId('action-button-spinner')).toBeNull();
  });
});

// LAST IN THE FILE, DELIBERATELY. This is the only test that holds the borrow
// open — the only way to render the busy state — and an unresolved promise at
// teardown is what corrupts a following render. Nothing follows it.
describe('ItemDetailScreen — busy while the call is in flight', () => {
  it('shows Read busy and inert, and takes only one borrow', async () => {
    mockBorrow.mockReturnValue(new Promise(() => {}));

    await render(<ItemDetailScreen {...routeProps} />);
    await waitFor(() => expect(screen.getByText('Read')).toBeTruthy());

    fireEvent.press(screen.getByTestId('action-button-read'));

    await waitFor(() => expect(screen.getByTestId('action-button-spinner')).toBeTruthy());
    // `disabled: true` IS the duplicate-press guard: ActionButton withholds its
    // onPress AND disables the Pressable at `state="loading"` (see its `inert`),
    // so a second tap cannot reach the handler at all.
    expect(screen.getByTestId('action-button-read').props.accessibilityState).toEqual({
      disabled: true,
      busy: true,
    });

    fireEvent.press(screen.getByTestId('action-button-read'));
    fireEvent.press(screen.getByTestId('action-button-read'));

    expect(mockBorrow).toHaveBeenCalledTimes(1);
  });
});
