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

describe('institutionStore — clearSelectedInstitution', () => {
  it('sets selectedInstitution back to null', () => {
    useInstitutionStore.getState().setSelectedInstitution(IMPERIAL);
    expect(useInstitutionStore.getState().selectedInstitution).toEqual(IMPERIAL);

    useInstitutionStore.getState().clearSelectedInstitution();

    expect(useInstitutionStore.getState().selectedInstitution).toBeNull();
  });
});

describe('institutionStore — removeRecentlyUsedId', () => {
  it('removes the specified ID while leaving other IDs intact', () => {
    const store = useInstitutionStore.getState();
    store.setSelectedInstitution({ ...IMPERIAL, id: 'inst_a' });
    store.setSelectedInstitution({ ...IMPERIAL, id: 'inst_b' });
    store.setSelectedInstitution({ ...IMPERIAL, id: 'inst_c' });

    useInstitutionStore.getState().removeRecentlyUsedId('inst_b');

    expect(useInstitutionStore.getState().recentlyUsedIds).toEqual(['inst_c', 'inst_a']);
  });

  it('is a no-op when the ID is not in the list', () => {
    useInstitutionStore.setState({ recentlyUsedIds: ['inst_x'] });

    useInstitutionStore.getState().removeRecentlyUsedId('inst_missing');

    expect(useInstitutionStore.getState().recentlyUsedIds).toEqual(['inst_x']);
  });
});

describe('institutionStore — migration', () => {
  it('resets cachedInstitutions when upgrading from version < 2 (old crestUrl shape)', async () => {
    // Version 1 data used the old `crestUrl` field; the migration drops the
    // cache so the first online session re-fetches in the new `branding.logoUrl` shape.
    const v1Stored = {
      state: {
        selectedInstitution: IMPERIAL,
        recentlyUsedIds: ['inst_7f3'],
        cachedInstitutions: [{ ...IMPERIAL, crestUrl: 'https://old.cdn/crests/inst_7f3.png' }],
      },
      version: 1,
    };
    mockGetItem.mockResolvedValue(JSON.stringify(v1Stored));

    useInstitutionStore.persist.rehydrate();

    await waitFor(() =>
      expect(useInstitutionStore.getState()._hasHydrated).toBe(true),
    );
    // Migration must clear the stale cache regardless of what was stored.
    expect(useInstitutionStore.getState().cachedInstitutions).toEqual([]);
    // Non-cache fields should survive the migration.
    expect(useInstitutionStore.getState().selectedInstitution).toEqual(IMPERIAL);
  });
});
