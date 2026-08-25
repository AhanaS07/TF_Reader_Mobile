// src/features/personalization/useReaderPrefs.ts
// The one seam between the reader-preferences screen and `prefsStore`.
//
// ─── WHY THIS FILE EXISTS AT ALL ─────────────────────────────────────────────
//
// The screen never imports `prefsStore` directly. It calls this hook, and the
// hook calls whatever `PrefsSource` it was handed — `PrefsSource` below is an
// interface THIS file owns, which `prefsStore` satisfies structurally (same
// four function names, same signatures, no shared base type).
//
// INJECTED, NOT IMPORTED, and the reason is the one `useCatalogueSearch` already
// gives for injecting its pipeline: "so a test or a gallery entry can drive this
// with latency, an injected failure, or a stub, without touching a process-wide
// singleton." Every test in useReaderPrefs.test.ts passes a fake source; none of
// them touches AsyncStorage. The default below is the real store — see
// `UseReaderPrefsOptions.source`.
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
import { useCallback, useEffect, useRef, useState } from 'react';

import { DEFAULT_PREFS, type LayoutPrefs, type SharedPrefs, type Theme } from '@/shared/contracts';

import * as prefsStore from './prefsStore';

import { TEXT_SIZE_OPTIONS } from './prefsOptions';

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

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

// Text size is not a free-range value, so a min/max clamp is not enough — a
// clamp alone would still let 15 or 21.5 through, and the picker can never
// produce either. The numbers come from `TEXT_SIZE_OPTIONS`, the same list
// `TypographySection` renders, so the two cannot drift apart.
const TEXT_SIZE_PRESETS = TEXT_SIZE_OPTIONS.map((option) => Number(option.id));

function nearestTextSizePreset(size: number) {
  return TEXT_SIZE_PRESETS.reduce((closest, preset) =>
    Math.abs(preset - size) < Math.abs(closest - size) ? preset : closest,
  );
}

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

// ─── The hook ────────────────────────────────────────────────────────────────

export interface UseReaderPrefsOptions {
  /**
   * The store to read and write through. Defaults to the real `prefsStore`
   * (AsyncStorage-backed, LWW on `updatedAt`) — pass a fake here only in a
   * test or a gallery entry that needs to drive this with latency, an
   * injected failure, or a stub, without touching real storage.
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
  onSelectFlow: (flow: LayoutPrefs['flow']) => void;
  onSelectSpread: (spread: LayoutPrefs['spread']) => void;
  /** Snapped to the nearest of the six fixed presets (14–24pt) before it is saved. */
  onSelectTextSize: (size: number) => void;
  /** Clamped to 1.0–2.0 before it is saved. */
  onChangeLineHeight: (lineHeight: number) => void;
  /** Clamped to 0–4px before it is saved. */
  onChangeLetterSpacing: (spacing: number) => void;
  /** Clamped to 0–48px before it is saved. */
  onChangeMargins: (margins: number) => void;
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
  const activeSource = source ?? prefsStore;

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

  const onSelectFlow = useCallback(
    (flow: LayoutPrefs['flow']) => {
      if (prefs === null) return;
      // SPREAD FIRST — same rule as onSelectFontFamily: `layout` also carries
      // `spread`, and a patch of `{ layout: { flow } }` would drop it.
      write({ layout: { ...prefs.layout, flow } });
    },
    [prefs, write],
  );

  const onSelectSpread = useCallback(
    (spread: LayoutPrefs['spread']) => {
      if (prefs === null) return;
      write({ layout: { ...prefs.layout, spread } });
    },
    [prefs, write],
  );

  // THE RANGES ARE ENFORCED HERE, NOT BY THE STORE. `savePrefs` accepts any
  // number the caller hands it — the Week 3 plan is explicit that the UI is
  // the only guard, so each Typography callback constrains its value before
  // writing rather than trusting the section (or a future caller of this
  // hook) to have done so already. Text size snaps to the nearest preset,
  // because it is a fixed set rather than a range; the three sliders clamp
  // to their min/max, because a slider's own `step` already keeps them on
  // the grid.
  const onSelectTextSize = useCallback(
    (size: number) => {
      if (prefs === null) return;
      write({ typography: { ...prefs.typography, size: nearestTextSizePreset(size) } });
    },
    [prefs, write],
  );

  const onChangeLineHeight = useCallback(
    (lineHeight: number) => {
      if (prefs === null) return;
      write({ typography: { ...prefs.typography, lineHeight: clamp(lineHeight, 1.0, 2.0) } });
    },
    [prefs, write],
  );

  const onChangeLetterSpacing = useCallback(
    (spacing: number) => {
      if (prefs === null) return;
      write({ typography: { ...prefs.typography, spacing: clamp(spacing, 0, 4) } });
    },
    [prefs, write],
  );

  const onChangeMargins = useCallback(
    (margins: number) => {
      if (prefs === null) return;
      write({ typography: { ...prefs.typography, margins: clamp(margins, 0, 48) } });
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
    onSelectFlow,
    onSelectSpread,
    onSelectTextSize,
    onChangeLineHeight,
    onChangeLetterSpacing,
    onChangeMargins,
    onRestoreDefaults,
    onRetry,
  };
}

export default useReaderPrefs;
