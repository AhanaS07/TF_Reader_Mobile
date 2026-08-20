// src/store/institutionStore.test.ts
//
// Two concerns:
//   1. Rehydration — all paths (error, corrupt, success) must flip _hasHydrated=true.
//      A stuck flag means a permanent white screen in RootNavigator (the bug this fixes).
//   2. setSelectedInstitution — deduplication and the 3-ID cap, since a broken cap
//      causes the recently-used row to grow unboundedly.
//
// @storage/storage is mocked (not AsyncStorage directly) because it is the seam
// institutionStore depends on via createJSONStorage. Mocking here means each test
// can control what getItem returns without touching the global AsyncStorage mock.
import { waitFor } from '@testing-library/react-native';
import type { Institution } from '@model/institution';
import { useInstitutionStore } from './institutionStore';

const mockGetItem = jest.fn<Promise<string | null>, [string]>();

jest.mock('@storage/storage', () => ({
  __esModule: true,
  default: {
    getItem: (...args: [string]) => mockGetItem(...args),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  },
}));

const IMPERIAL: Institution = {
  id: 'inst_7f3',
  name: 'Imperial College London',
  country: 'United Kingdom',
  code: 'ICL',
  city: 'London',
  catalogueUrl: 'https://api.tf/opds/v1/institutions/inst_7f3/catalogue',
  branding: { logoUrl: 'https://cdn.tf/crests/inst_7f3.png' },
};

afterEach(() => {
  useInstitutionStore.setState({
    selectedInstitution: null,
    recentlyUsedIds: [],
    cachedInstitutions: [],
    _hasHydrated: false,
  });
  mockGetItem.mockReset();
});

describe('institutionStore — rehydration', () => {
  // The critical bug: if the error branch was missing, _hasHydrated stayed false
  // forever and RootNavigator rendered only the splash screen with no way out.
  it('flips _hasHydrated=true even when storage rejects', async () => {
    mockGetItem.mockRejectedValue(new Error('AsyncStorage unavailable'));

    useInstitutionStore.persist.rehydrate();

    await waitFor(() =>
      expect(useInstitutionStore.getState()._hasHydrated).toBe(true),
    );
    expect(useInstitutionStore.getState().selectedInstitution).toBeNull();
  });

  it('flips _hasHydrated=true when the stored value is corrupt JSON', async () => {
    mockGetItem.mockResolvedValue('{ definitely not json {{');

    useInstitutionStore.persist.rehydrate();

    await waitFor(() =>
      expect(useInstitutionStore.getState()._hasHydrated).toBe(true),
    );
    expect(useInstitutionStore.getState().selectedInstitution).toBeNull();
  });

  it('restores selectedInstitution and recentlyUsedIds from a valid stored value', async () => {
    const stored = {
      state: {
        selectedInstitution: IMPERIAL,
        recentlyUsedIds: ['inst_7f3'],
        cachedInstitutions: [],
      },
      version: 2,
    };
    mockGetItem.mockResolvedValue(JSON.stringify(stored));

    useInstitutionStore.persist.rehydrate();

    await waitFor(() =>
      expect(useInstitutionStore.getState()._hasHydrated).toBe(true),
    );
    expect(useInstitutionStore.getState().selectedInstitution).toEqual(IMPERIAL);
    expect(useInstitutionStore.getState().recentlyUsedIds).toEqual(['inst_7f3']);
  });
});

describe('institutionStore — setSelectedInstitution', () => {
  it('deduplicates: re-selecting an institution moves it to the front', () => {
    const store = useInstitutionStore.getState();
    store.setSelectedInstitution({ ...IMPERIAL, id: 'inst_a' });
    store.setSelectedInstitution({ ...IMPERIAL, id: 'inst_b' });
    store.setSelectedInstitution({ ...IMPERIAL, id: 'inst_a' });

    expect(useInstitutionStore.getState().recentlyUsedIds).toEqual(['inst_a', 'inst_b']);
  });

  it('caps recentlyUsedIds at 3, oldest entry evicted first', () => {
    const store = useInstitutionStore.getState();
    store.setSelectedInstitution({ ...IMPERIAL, id: 'inst_1' });
    store.setSelectedInstitution({ ...IMPERIAL, id: 'inst_2' });
    store.setSelectedInstitution({ ...IMPERIAL, id: 'inst_3' });
    store.setSelectedInstitution({ ...IMPERIAL, id: 'inst_4' });

    expect(useInstitutionStore.getState().recentlyUsedIds).toEqual([
      'inst_4',
      'inst_3',
      'inst_2',
    ]);
  });
});
