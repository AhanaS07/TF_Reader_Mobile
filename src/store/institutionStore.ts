// src/store/institutionStore.ts
// Persisted selection for CAP-3 — which institution the user has chosen.
//
// WHY PERSIST THE FULL OBJECT, NOT JUST THE ID:
// The institution list screen needs name and crestUrl to render the
// "recently used" row without a network call on every launch. Storing the
// full Institution avoids a getInstitution() round-trip before the header
// can render. If the shape changes in a breaking way, bump `version` below
// and supply a `migrate` function — do not silently serve stale data.
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import storage from '@storage/storage';
import type { Institution } from '@model/institution';

interface InstitutionState {
  selectedInstitution: Institution | null;
  // Last 3 selected institution IDs, most recent first. Used to pin the
  // recently-used row at the top of the institution list screen (C1).
  recentlyUsedIds: string[];
  // Last successful page-0 unfiltered fetch of the institution list. Served
  // when the device is offline so the list keeps working without a network call
  // (C8). Persisted so it survives cold starts.
  cachedInstitutions: Institution[];
  // True once AsyncStorage has finished loading persisted state. Screens read
  // this before rendering so they never flash "no institution selected" on
  // launch before the stored value has arrived (FL-5).
  _hasHydrated: boolean;

  setSelectedInstitution: (institution: Institution) => void;
  clearSelectedInstitution: () => void;
  // Remove a single ID from recentlyUsedIds — used by InstitutionListScreen to
  // prune IDs that resolve to CatalogueFailure(NOT_FOUND) (institution inactive).
  removeRecentlyUsedId: (id: string) => void;
  setCachedInstitutions: (institutions: Institution[]) => void;
  // Called internally by onRehydrateStorage — not for screens to call directly.
  setHasHydrated: (value: boolean) => void;
}

export const useInstitutionStore = create<InstitutionState>()(
  persist(
    (set) => ({
      selectedInstitution: null,
      recentlyUsedIds: [],
      cachedInstitutions: [],
      _hasHydrated: false,

      setSelectedInstitution: (institution) =>
        set((state) => ({
          selectedInstitution: institution,
          // Prepend the new id, deduplicate, and cap at 3 — most recent first.
          recentlyUsedIds: [
            institution.id,
            ...state.recentlyUsedIds.filter((id) => id !== institution.id),
          ].slice(0, 3),
        })),

      clearSelectedInstitution: () => set({ selectedInstitution: null }),

      removeRecentlyUsedId: (id) =>
        set((state) => ({
          recentlyUsedIds: state.recentlyUsedIds.filter((rid) => rid !== id),
        })),

      setCachedInstitutions: (institutions) => set({ cachedInstitutions: institutions }),

      setHasHydrated: (value) => set({ _hasHydrated: value }),
    }),
    {
      name: 'institution-selection',
      storage: createJSONStorage(() => storage),
      // Only data crosses the storage boundary — _hasHydrated resets to false
      // on every cold start (by design), and actions are never serialisable.
      partialize: (state) => ({
        selectedInstitution: state.selectedInstitution,
        recentlyUsedIds: state.recentlyUsedIds,
        cachedInstitutions: state.cachedInstitutions,
      }),
      // Flip _hasHydrated once AsyncStorage has finished loading. The optional
      // chain handles the error path: if rehydration fails, state is undefined
      // and _hasHydrated stays false, which is the safe fallback.
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
      version: 1,
    },
  ),
);
