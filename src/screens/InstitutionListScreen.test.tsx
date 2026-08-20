// src/screens/InstitutionListScreen.test.tsx
// C8: the offline institution cache. Four behaviours under test:
//   1. A successful page-0 unfiltered fetch writes the cache.
//   2. When offline and the cache is populated, the list renders from it without
//      calling the network.
//   3. When offline and the cache is empty, the screen shows an error (no cache
//      to serve, so an error is still the honest state).
//   4. When a mid-flight fetch fails and the cache is populated, the screen
//      falls back to the cache rather than showing an error.
//
// useNetworkStatus is mocked at the module level so individual tests can flip
// the online/offline flag without touching NetInfo. The data source goes in via
// setCatalogueSource, following the same pattern as InstitutionDetailScreen.test.tsx.
import { render, screen, waitFor } from '@testing-library/react-native';

import type { DataSource } from '@adapters/InstitutionSource';
import { setCatalogueSource } from '@config/catalogue';
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
