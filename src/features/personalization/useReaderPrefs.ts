// src/features/personalization/useReaderPrefs.ts
// The one seam between the reader-preferences screen and the store that will
// eventually back it.
//
// ─── WHY THIS FILE EXISTS AT ALL ─────────────────────────────────────────────
//
// `prefsStore` does not exist yet — Keshav builds it Tuesday to Wednesday, and
// `src/features/personalization/` holds nothing but a `.gitkeep` as this lands.
// The screen is built now regardless, so it needs something to read and write
// through. That something is `PrefsSource` below: an interface THIS file owns,
// which the real store will satisfy structurally.
//
// NOTHING ABOVE THIS FILE IMPORTS THE STORE. Not the screen, not either section.
// They call the hook, the hook calls whatever `PrefsSource` it was handed. So
// when the store lands, the change is one argument at one call site — see
// "WIRING THE REAL STORE" at the bottom of this comment block.
//
// THE STORE'S API IS NOT INVENTED HERE. The four members below are the four the
// Week 3 plan states Keshav is building — `getPrefs`, `savePrefs`, `resetPrefs`,
// `subscribe` — and nothing else. If his signatures differ, the fix is an
// adapter object literal in this file, and nothing above it moves.
//
// INJECTED, NOT IMPORTED, and the reason is the one `useCatalogueSearch` already
// gives for injecting its pipeline: "so a test or a gallery entry can drive this
// with latency, an injected failure, or a stub, without touching a process-wide
// singleton." Every test in useReaderPrefs.test.ts is a fake source; none of
// them touches storage.
//
// ─── WHAT THE HOOK GUARANTEES, SO NO SECTION HAS TO ──────────────────────────
//
// NESTED GROUPS ARE SPREAD BEFORE THEY ARE PATCHED. `SharedPrefs.font` is an
// object, and `savePrefs({ font: { family } })` would drop `customFontUri` —
// the store replaces a group wholesale rather than merging into it. That rule is
// easy to get right once and easy to forget at the fourth call site, so the
// spread happens in here and a section only ever names the field it changed.
// The same protection is available to Keshav's Layout and Prayas's Typography
// sections if they route their writes through this hook.
//
// WRITES ARE OPTIMISTIC AND REVERT ON FAILURE. A settings control that waits on
// a promise before moving feels broken, and prefs are local-first by contract —
// the client stamps `updatedAt` at edit time, offline, before any sync. So the
// value moves immediately and rolls back if the write rejects, with `saveFailed`
// raised for the screen to report. The alternative — awaiting each write — makes
// every tap feel like a network call for data that never leaves the device.
//
// ─── WIRING THE REAL STORE (Keshav) ──────────────────────────────────────────
//
// 1. Delete `IN_MEMORY_STUB` and the `?? IN_MEMORY_STUB` fallback below.
// 2. Make `source` required in `UseReaderPrefsOptions`, or default it to the
//    real store: `source = prefsStore`.
// 3. Nothing else in this file changes, and nothing outside it changes at all
//    unless step 2 is skipped — in which case the single call site in
//    ReaderPreferencesScreen.tsx passes the store in.
//
// There is deliberately no third path. The stub does not persist, so there is no
// migration to write and no stale data to clear.
import { useCallback, useEffect, useRef, useState } from 'react';

import { DEFAULT_PREFS, type SharedPrefs, type Theme } from '@/shared/contracts';

// ─── The values, without the plumbing ────────────────────────────────────────

/**
 * Everything on `SharedPrefs` except the identity and sync fields.
 *
 * `id`, `userId`, `updatedAt`, `isDeleted` and `synced` come from
 * `SyncRecordBase` and belong to the store and the sync layer. The screen must
 * never render them and must never write them — `updatedAt` in particular is the
 * LWW resolution key, stamped by whoever performs the write, not by the UI that
 * asked for it. Omitting them here means a section cannot reach one by accident.
 *
 * This is the same Omit `DEFAULT_PREFS` is typed against, so the contract's own
 * defaults are a valid `PrefsValues` with no cast.
 */
export type PrefsValues = Omit<SharedPrefs, 'id' | 'userId' | 'updatedAt' | 'isDeleted' | 'synced'>;

// ─── The seam ────────────────────────────────────────────────────────────────

/**
 * What this hook needs from a preferences store. Keshav's `prefsStore` satisfies
 * it structurally — there is no base class to extend and nothing to register.
 */
export interface PrefsSource {
  /** Resolves the current values. Rejects if they cannot be read. */
  getPrefs: () => Promise<PrefsValues>;
  /**
   * Merges a patch. Top-level keys replace wholesale, which is why this hook
   * spreads nested groups before calling — see the header.
   */
  savePrefs: (patch: Partial<PrefsValues>) => Promise<void>;
  /** Back to `DEFAULT_PREFS`. A rewrite plus an `updatedAt` bump, not a delete. */
  resetPrefs: () => Promise<void>;
  /**
   * Notifies on any change, including one this hook did not make — a second
   * device settling LWW, or Keshav's Layout section writing its own group.
   * Returns its own unsubscribe.
   */
  subscribe: (listener: (next: PrefsValues) => void) => () => void;
}

// ─── The stub ────────────────────────────────────────────────────────────────

/**
 * TEMPORARY. Delete when `prefsStore` lands — see "WIRING THE REAL STORE".
 *
 * IN MEMORY AND NOWHERE ELSE. No AsyncStorage, no `zustand/persist`, no
 * `updatedAt` stamping, no sync flags. Values live in this module for the life
 * of the JS context and are gone on reload.
 *
 * THAT IS THE POINT, NOT A SHORTCUT. A stub that persisted would make the screen
 * look finished and let the missing store go unnoticed; one that forgets on
 * reload is obvious the first time anybody uses it. It exists so the screen
 * compiles, renders, and can be driven in a dev build — not so it can ship.
 *
 * It does not fail, delay, or reject. Failure paths are exercised by fake
 * sources in the tests, which is where an injected failure belongs.
 */
const IN_MEMORY_STUB: PrefsSource = (() => {
  let values: PrefsValues = { ...DEFAULT_PREFS };
  const listeners = new Set<(next: PrefsValues) => void>();

  const emit = () => {
    listeners.forEach((listener) => listener(values));
  };

  return {
    getPrefs: () => Promise.resolve(values),
    savePrefs: (patch) => {
      values = { ...values, ...patch };
      emit();
      return Promise.resolve();
    },
    resetPrefs: () => {
      values = { ...DEFAULT_PREFS };
      emit();
      return Promise.resolve();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
})();

// ─── The hook ────────────────────────────────────────────────────────────────

export interface UseReaderPrefsOptions {
  /**
   * The store to read and write through. Optional only while `prefsStore` does
   * not exist; it becomes required (or defaulted to the real store) the moment
   * it does.
   */
  source?: PrefsSource;
}

export interface UseReaderPrefs {
  /**
   * Lifecycle. `state`, not `status`, to match the component convention.
   *
   * THERE IS NO 'empty', and it is not an omission (CONVENTIONS §6 — "if a state
   * is impossible, say so"). Prefs are a per-user singleton with `DEFAULT_PREFS`
   * as a floor, so "no preferences yet" cannot occur: a first read either
   * resolves values or fails.
   *
   * THERE IS NO 'offline' EITHER. Offline is not a state of this data. Prefs are
   * written locally and reconciled later by LWW on `updatedAt`, so the screen
   * stays fully usable with no connection — the banner is informational and
   * nothing is disabled behind it. The screen owns that banner via
   * `useNetworkStatus`; this hook has no opinion on connectivity.
   */
  state: 'loading' | 'ready' | 'error';
  /** Null while loading, and after a failed read. Never null at `state: 'ready'`. */
  prefs: PrefsValues | null;
  /** A write is in flight. Controls stay live — see the optimism note in the header. */
  saving: boolean;
  /** The last write rejected and its value was rolled back. Cleared by the next write. */
  saveFailed: boolean;
  onSelectTheme: (theme: Theme) => void;
  /**
   * `string`, not a union, because `FontPrefs.family` is a string in the
   * contract — the reader accepts faces our picker does not list.
   */
  onSelectFontFamily: (family: string) => void;
  onRestoreDefaults: () => void;
  /** Re-reads after a failed read. */
  onRetry: () => void;
}

export function useReaderPrefs({ source }: UseReaderPrefsOptions = {}): UseReaderPrefs {
  // A PLAIN VALUE, NOT A REF. Writing `sourceRef.current` during render is what
  // `react-hooks/refs` flags, and it is a real hazard rather than a lint
  // preference — a ref mutated in render is not part of the render's own output.
  //
  // The consequence is that `source` MUST BE STABLE ACROSS RENDERS. A caller
  // that builds one inline (`source={{ getPrefs: ... }}`) re-subscribes on every
  // render. Every real caller passes a module singleton — the store, or one fake
  // built once per test — so this is a documented requirement, not a trap.
  const activeSource = source ?? IN_MEMORY_STUB;

  const [prefs, setPrefs] = useState<PrefsValues | null>(null);
  const [state, setState] = useState<UseReaderPrefs['state']>('loading');
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  // Guards every `setState` in an async continuation. Without it, a read that
  // resolves after the screen is popped warns about updating an unmounted tree.
  const mounted = useRef(true);

  // NO SYNCHRONOUS setState IN HERE — only inside the async continuations, which
  // is why this is separate from `onRetry` below. `react-hooks/set-state-in-effect`
  // rejects a `setState` in an effect body, and the initial 'loading' does not
  // need one: that is already the initial state. Same split, and the same
  // reasoning, as ItemDetailScreen's `fetchItem` versus its `retry`.
  const load = useCallback(() => {
    activeSource
      .getPrefs()
      .then((next) => {
        if (!mounted.current) return;
        setPrefs(next);
        setState('ready');
      })
      .catch(() => {
        if (!mounted.current) return;
        setPrefs(null);
        setState('error');
      });
  }, [activeSource]);

  // The one path that resets to 'loading', and it runs from a press handler
  // rather than an effect — which is what makes the synchronous setState legal
  // here and not above.
  const onRetry = useCallback(() => {
    setState('loading');
    setPrefs(null);
    load();
  }, [load]);

  useEffect(() => {
    mounted.current = true;
    load();

    // Picks up writes this hook did not make: another device settling LWW, or a
    // sibling section writing its own group. Nothing here re-reads — the
    // listener is handed the new values directly.
    const unsubscribe = activeSource.subscribe((next) => {
      if (!mounted.current) return;
      setPrefs(next);
      setState('ready');
    });

    return () => {
      mounted.current = false;
      unsubscribe();
    };
  }, [activeSource, load]);

  // THE ONE WRITE PATH. Every callback below goes through here, so the optimistic
  // update, the rollback and the `saving` flag are defined once.
  //
  // `patch` is built by the caller from the CURRENT values, which is where the
  // nested-group spread happens — see each callback.
  const write = useCallback(
    (patch: Partial<PrefsValues>) => {
      const previous = prefs;
      if (previous === null) return;

      setPrefs({ ...previous, ...patch });
      setSaving(true);
      setSaveFailed(false);

      activeSource
        .savePrefs(patch)
        .then(() => {
          if (!mounted.current) return;
          setSaving(false);
        })
        .catch(() => {
          if (!mounted.current) return;
          // Back to exactly what was on screen before the tap. Reverting to the
          // whole previous object rather than the one field keeps this correct if
          // a second write landed in between.
          setPrefs(previous);
          setSaving(false);
          setSaveFailed(true);
        });
    },
    [activeSource, prefs],
  );

  const onSelectTheme = useCallback(
    (theme: Theme) => {
      // A top-level scalar, so there is no group to spread.
      write({ theme });
    },
    [write],
  );

  const onSelectFontFamily = useCallback(
    (family: string) => {
      if (prefs === null) return;
      // SPREAD FIRST. `font` also carries `customFontUri`, and a patch of
      // `{ font: { family } }` would drop it — the store replaces the group, it
      // does not merge into it.
      write({ font: { ...prefs.font, family } });
    },
    [prefs, write],
  );

  const onRestoreDefaults = useCallback(() => {
    const previous = prefs;
    if (previous === null) return;

    // NOT eight `savePrefs` calls. `resetPrefs` is one write and therefore one
    // `updatedAt` stamp, which is what LWW compares; eight writes would be eight
    // stamps and a partial reset if one failed.
    setPrefs({ ...DEFAULT_PREFS });
    setSaving(true);
    setSaveFailed(false);

    activeSource
      .resetPrefs()
      .then(() => {
        if (!mounted.current) return;
        setSaving(false);
      })
      .catch(() => {
        if (!mounted.current) return;
        setPrefs(previous);
        setSaving(false);
        setSaveFailed(true);
      });
  }, [activeSource, prefs]);

  return {
    state,
    prefs,
    saving,
    saveFailed,
    onSelectTheme,
    onSelectFontFamily,
    onRestoreDefaults,
    onRetry,
  };
}

export default useReaderPrefs;
