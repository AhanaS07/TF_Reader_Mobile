// src/screens/InstitutionListScreen.test.tsx
// C8: the offline institution cache. Behaviours under test:
//   1. A successful page-0 unfiltered fetch writes the cache.
//   2. When offline and the cache is populated, the list renders from it without
//      calling the network.
//   3. When offline and the cache is empty, the screen shows an error (no cache
//      to serve, so an error is still the honest state).
//   4. When a mid-flight fetch fails and the cache is populated, the screen
//      falls back to the cache rather than showing an error.
//   5. Bug: a previous fetchError is cleared before the offline check, so going
//      offline with a populated cache shows the cache — not the old error screen.
//   6. Bug: a network error on getInstitution does not prune the recently-used
//      ID (only NOT_FOUND prunes); the ID can be retried after reconnecting.
//
// useNetworkStatus is mocked at the module level so individual tests can flip
// the online/offline flag without touching NetInfo. The data source goes in via
// setCatalogueSource, following the same pattern as InstitutionDetailScreen.test.tsx.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import type { DataSource } from '@adapters/InstitutionSource';
import { setCatalogueSource } from '@config/catalogue';
import { CatalogueError, CatalogueFailure } from '@model/errors';
import type { Institution } from '@model/institution';
import { useInstitutionStore } from '@store/institutionStore';
import { useNetworkStatus } from '@hooks/useNetworkStatus';

import InstitutionListScreen from './InstitutionListScreen';

const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack }),
}));

jest.mock('@hooks/useNetworkStatus');
const mockIsOnline = useNetworkStatus as jest.MockedFunction<typeof useNetworkStatus>;

const IMPERIAL: Institution = {
  id: 'inst_7f3',
  name: 'Imperial College London',
  country: 'United Kingdom',
  code: 'ICL',
  city: 'London',
  catalogueUrl: 'https://api.tf/opds/v1/institutions/inst_7f3/catalogue',
  branding: { logoUrl: 'https://cdn.tf/crests/inst_7f3.png' },
};

const MANCHESTER: Institution = {
  id: 'inst_a21',
  name: 'University of Manchester',
  country: 'United Kingdom',
  code: 'UOM',
  city: 'Manchester',
  catalogueUrl: 'https://api.tf/opds/v1/institutions/inst_a21/catalogue',
  branding: { logoUrl: 'https://cdn.tf/crests/inst_a21.png' },
};

function fakeSource(
  getInstitutions: DataSource['getInstitutions'],
  getInstitution?: DataSource['getInstitution'],
): DataSource {
  const unused = () => Promise.reject(new Error('not stubbed for this test'));
  return {
    getHomeCatalogue: unused,
    getShelf: unused,
    getPublication: unused,
    getInstitutions,
    getInstitution: getInstitution ?? unused,
  };
}

afterEach(() => {
  setCatalogueSource(undefined);
  useInstitutionStore.setState({
    selectedInstitution: null,
    recentlyUsedIds: [],
    cachedInstitutions: [],
  });
  mockGoBack.mockClear();
  mockIsOnline.mockReset();
});

describe('InstitutionListScreen offline cache — write', () => {
  it('stores the first page of the unfiltered list after a successful fetch', async () => {
    mockIsOnline.mockReturnValue(true);
    setCatalogueSource(fakeSource(async () => [IMPERIAL, MANCHESTER]));

    await render(<InstitutionListScreen />);

    await waitFor(() =>
      expect(useInstitutionStore.getState().cachedInstitutions).toEqual([IMPERIAL, MANCHESTER]),
    );
  });
});

describe('InstitutionListScreen offline cache — read', () => {
  it('renders cached institutions when offline, without calling the network', async () => {
    mockIsOnline.mockReturnValue(false);
    useInstitutionStore.setState({ cachedInstitutions: [IMPERIAL, MANCHESTER] });
    const getInstitutions = jest.fn();
    setCatalogueSource(fakeSource(getInstitutions));

    await render(<InstitutionListScreen />);

    await waitFor(() => expect(screen.getByText('Imperial College London')).toBeTruthy());
    expect(screen.getByText('University of Manchester')).toBeTruthy();
    expect(getInstitutions).not.toHaveBeenCalled();
  });

  it('shows an error when offline and the cache is empty', async () => {
    mockIsOnline.mockReturnValue(false);
    // cachedInstitutions defaults to [] in afterEach reset — no pre-seeding needed
    const getInstitutions = jest.fn();
    setCatalogueSource(fakeSource(getInstitutions));

    await render(<InstitutionListScreen />);

    await waitFor(() =>
      expect(screen.getByText(/couldn.?t load institutions/i)).toBeTruthy(),
    );
    expect(getInstitutions).not.toHaveBeenCalled();
  });
});

describe('InstitutionListScreen offline cache — mid-flight fallback', () => {
  it('shows cached institutions when a network call fails and a cache exists', async () => {
    mockIsOnline.mockReturnValue(true);
    useInstitutionStore.setState({ cachedInstitutions: [IMPERIAL] });
    setCatalogueSource(fakeSource(async () => { throw new Error('network dropped'); }));

    await render(<InstitutionListScreen />);

    await waitFor(() => expect(screen.getByText('Imperial College London')).toBeTruthy());
  });

  it('shows an error when a network call fails and there is no cache', async () => {
    mockIsOnline.mockReturnValue(true);
    setCatalogueSource(fakeSource(async () => { throw new Error('network dropped'); }));

    await render(<InstitutionListScreen />);

    await waitFor(() =>
      expect(screen.getByText(/couldn.?t load institutions/i)).toBeTruthy(),
    );
  });
});

describe('InstitutionListScreen offline cache — bug regressions', () => {
  // Bug: setFetchError(false) was inside the online branch, so a previous error
  // was never cleared when going offline with a populated cache — the ErrorState
  // stayed up instead of giving way to the cache.
  //
  // Sequence: offline with no cache → fetchError=true shown. Cache then arrives
  // in the store (e.g. AsyncStorage hydrates). Pressing Retry re-runs fetchPage
  // — fix ensures setFetchError(false) runs at the top, before the offline
  // branch checks the cache, so the error clears and the cache is displayed.
  it('clears a previous fetch error and shows the cache on retry', async () => {
    mockIsOnline.mockReturnValue(false); // offline, no cache
    setCatalogueSource(fakeSource(jest.fn()));

    await render(<InstitutionListScreen />);

    await waitFor(() =>
      expect(screen.getByText(/couldn.?t load institutions/i)).toBeTruthy(),
    );

    // Cache arrives — flush effects so cachedRef picks up the new value.
    await act(async () => {
      useInstitutionStore.setState({ cachedInstitutions: [IMPERIAL] });
    });

    // Retry re-runs fetchPage; fix ensures setFetchError(false) fires first.
    fireEvent.press(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => expect(screen.getByText('Imperial College London')).toBeTruthy());
    expect(screen.queryByText(/couldn.?t load institutions/i)).toBeNull();
  });

  // Bug: resolvedRef marked IDs before the fetch, so a network error permanently
  // suppressed the ID for the rest of the session. Only NOT_FOUND should prune.
  it('does not prune a recently-used ID after a network error — only NOT_FOUND prunes', async () => {
    mockIsOnline.mockReturnValue(true);
    useInstitutionStore.setState({ recentlyUsedIds: ['inst_7f3'] });
    setCatalogueSource(fakeSource(
      async () => [],
      async () => { throw new Error('network error'); },
    ));

    await render(<InstitutionListScreen />);

    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());

    expect(useInstitutionStore.getState().recentlyUsedIds).toEqual(['inst_7f3']);
  });

  it('prunes a recently-used ID that the server says no longer exists (NOT_FOUND)', async () => {
    mockIsOnline.mockReturnValue(true);
    useInstitutionStore.setState({ recentlyUsedIds: ['inst_gone'] });
    setCatalogueSource(fakeSource(
      async () => [],
      async () => { throw new CatalogueFailure(CatalogueError.NOT_FOUND, 'inst_gone'); },
    ));

    await render(<InstitutionListScreen />);

    await waitFor(() =>
      expect(useInstitutionStore.getState().recentlyUsedIds).toEqual([]),
    );
  });
});
