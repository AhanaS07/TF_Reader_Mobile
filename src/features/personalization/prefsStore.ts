// src/features/personalization/prefsStore.ts
// Persistent reader preferences — AsyncStorage via Zustand persist.
//
// ─── WHAT IS STORED AND WHY ──────────────────────────────────────────────────
//
// The store holds PrefsValues (theme, font, typography, layout, zoom,
// accessibility) plus `updatedAt` — the client wall-time ms stamped on every
// write, which is the LWW comparison key per sync-record.ts. The sync fields
// (id, userId, isDeleted, synced) are the sync layer's job and are not stored
// here — they arrive when Karthik's sync layer runs.
//
// ─── SIGNATURES MATCH PrefsSource ────────────────────────────────────────────
//
// All four exported functions match the PrefsSource interface in useReaderPrefs.ts
// exactly: async getPrefs/savePrefs/resetPrefs and a subscribe that passes the
// new values to its listener. `useReaderPrefs` imports this module as its
// default `PrefsSource` — every real screen is wired to this store already;
// only tests pass a fake source instead.
//
// ─── WRITES ARE SYNCHRONOUS, PROMISE WRAPPING IS FOR THE SEAM ───────────────
//
// savePrefs and resetPrefs apply the change to Zustand in-memory immediately
// (the hook's optimistic update lands before they return) and resolve instantly.
// The AsyncStorage write happens in the background via Zustand's persist
// middleware. If AsyncStorage fails, the in-memory state is still correct — the
// hook's rollback path is available if a future version makes this async-aware.
//
// ─── HYDRATION GUARD IN getPrefs ─────────────────────────────────────────────
//
// On cold start, AsyncStorage is read asynchronously. Until `_hasHydrated` flips
// true, the in-memory values are the Zustand defaults, not the stored ones.
// getPrefs() blocks until hydration completes so the screen never shows stale
// defaults — same pattern institutionStore uses for RootNavigator's splash.
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { DEFAULT_PREFS, type SharedPrefs } from '@/shared/contracts/prefs';
import storage from '@storage/storage';

// Matches the PrefsValues type in useReaderPrefs.ts — same Omit, structural
// identity. Not imported from there to avoid a circular dependency (the hook
// is supposed to import the store, not the reverse).
type PrefsValues = Omit<SharedPrefs, 'id' | 'userId' | 'updatedAt' | 'isDeleted' | 'synced'>;

interface PrefsStoreState {
  values: PrefsValues;
  // Client wall-time ms, stamped on every write. LWW resolution key.
  updatedAt: number;
  // True once AsyncStorage has loaded. getPrefs() waits on this before returning.
  _hasHydrated: boolean;

  _patch: (partial: Partial<PrefsValues>) => void;
  _reset: () => void;
  _setHasHydrated: (value: boolean) => void;
}

// Exported (matching institutionStore.ts's own convention) so a migration test
// can drive rehydration directly — everything else keeps going through the
// PrefsSource functions below, not this hook.
export const usePrefsStore = create<PrefsStoreState>()(
  persist(
    (set) => ({
      values: { ...DEFAULT_PREFS },
      updatedAt: 0,
      _hasHydrated: false,

      _patch: (partial) =>
        set((state) => ({
          values: { ...state.values, ...partial },
          updatedAt: Date.now(),
        })),

      _reset: () =>
        set({
          values: { ...DEFAULT_PREFS },
          updatedAt: Date.now(),
        }),

      _setHasHydrated: (value) => set({ _hasHydrated: value }),
    }),
    {
      name: 'reader-prefs',
      storage: createJSONStorage(() => storage),
      // Only values and the LWW timestamp cross the storage boundary.
      // _hasHydrated resets to false on every cold start by design.
      // Actions are never serialisable.
      partialize: (state) => ({
        values: state.values,
        updatedAt: state.updatedAt,
      }),
      // Flip _hasHydrated on BOTH paths — success and failure — matching the
      // institutionStore pattern. A failed rehydrate means we fall back to
      // DEFAULT_PREFS, which is safe and recoverable.
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          usePrefsStore.setState({ _hasHydrated: true });
          return;
        }
        state?._setHasHydrated(true);
      },
      // NOT `version`/`migrate` — zustand only calls `migrate` when the stored
      // blob has an explicit numeric `version` field that differs from this
      // one (node_modules/zustand's persist middleware, checked directly: the
      // check is `typeof deserializedStorageValue.version === 'number'`).
      // This store never set `version` before, so real on-disk data from
      // before the accessibility rewrite has NO version field at all —
      // `migrate` would silently never run for the actual legacy data it
      // needs to catch. `merge` runs on every rehydration unconditionally,
      // versioned or not, which is what a shape check like this needs.
      //
      // What it catches: pre-Sep-2026 data may carry `values.accessibility`
      // in the OLD FLAT shape — dyslexiaFont/highContrast/reduceMotion/
      // screenReaderHints as direct booleans, predating the rewrite into
      // text/display/announce/tts sub-groups (accessibility.ts).
      // AccessibilityScreen reads `prefs.accessibility.text.dyslexiaFont`,
      // which throws on the old shape since `text` never existed on it.
      //
      // Not hand-translated field by field: the old `reduceMotion` was a
      // plain boolean and the new one is a three-way 'system' | 'on' | 'off',
      // with no exact equivalent to map to. Falling back to
      // DEFAULT_PREFS.accessibility wholesale is the same "drop and reset"
      // choice institutionStore.ts makes for its own breaking shape change,
      // scoped to just the accessibility group — every other prefs group
      // (font, theme, layout, typography, zoom) survives untouched.
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<PrefsStoreState> | undefined;
        const persistedValues = persisted?.values as
          | (Partial<PrefsValues> & { accessibility?: { text?: unknown } })
          | undefined;
        const hasNewShape =
          persistedValues?.accessibility != null &&
          typeof persistedValues.accessibility.text === 'object' &&
          persistedValues.accessibility.text !== null;

        return {
          ...currentState,
          ...persisted,
          values: {
            ...currentState.values,
            ...persistedValues,
            accessibility: hasNewShape
              ? (persistedValues.accessibility as PrefsValues['accessibility'])
              : DEFAULT_PREFS.accessibility,
          },
        };
      },
    },
  ),
);

// ─── PrefsSource interface ────────────────────────────────────────────────────

/**
 * Resolves the current prefs values. Waits for AsyncStorage hydration on cold
 * start so the caller never receives stale defaults.
 */
export function getPrefs(): Promise<PrefsValues> {
  const state = usePrefsStore.getState();
  if (state._hasHydrated) {
    return Promise.resolve(state.values);
  }
  return new Promise((resolve) => {
    const unsub = usePrefsStore.subscribe((next) => {
      if (next._hasHydrated) {
        unsub();
        resolve(next.values);
      }
    });
  });
}

/**
 * Merges a partial patch into the current values and stamps updatedAt.
 * The hook spreads nested groups (font, layout, typography) before calling
 * here, so a top-level merge is correct — no deep merge needed.
 */
export function savePrefs(partial: Partial<PrefsValues>): Promise<void> {
  usePrefsStore.getState()._patch(partial);
  return Promise.resolve();
}

/**
 * Resets all values to DEFAULT_PREFS with a fresh updatedAt stamp.
 * One write, one timestamp — LWW settles correctly across devices.
 */
export function resetPrefs(): Promise<void> {
  usePrefsStore.getState()._reset();
  return Promise.resolve();
}

/**
 * Notifies whenever the prefs values change — including writes from other
 * sources (a second device settling LWW once the sync layer lands).
 * Returns the unsubscribe function.
 */
export function subscribe(listener: (next: PrefsValues) => void): () => void {
  return usePrefsStore.subscribe((state, prevState) => {
    // Reference equality: Zustand's immutable updates guarantee a new object
    // on every write, so this fires exactly when values actually changed.
    if (state.values !== prevState.values) {
      listener(state.values);
    }
  });
}
