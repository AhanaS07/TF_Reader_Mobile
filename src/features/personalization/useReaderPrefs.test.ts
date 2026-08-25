// src/features/personalization/useReaderPrefs.test.ts
// The seam between the preferences screen and a store that does not exist yet.
//
// EVERY TEST DRIVES A FAKE `PrefsSource`. None of them touches AsyncStorage,
// zustand, or the in-memory stub the hook falls back to — that fallback exists so
// the screen renders in a dev build, not so it can be asserted on. Injecting the
// source is the reason these tests can exercise a rejected write at all, which
// is the same reason `useCatalogueSearch` injects its pipeline.
//
// WHAT IS NOT TESTED HERE: persistence, `updatedAt` stamping, LWW resolution and
// sync flags. All four belong to Keshav's `prefsStore` and none of them is
// expressible through this interface. A test for them would be a test of an
// invention.
//
// TWO RTL 14 TRAPS, BOTH OF WHICH FAIL AS "Cannot read properties of null":
//
//   1. `await renderHook(...)`, and `await unmount()`. Both are typed as
//      promises — `renderHook` returns `Promise<RenderHookResult>` — the same
//      async-render change the component suites note as "`await render(...)` is
//      required". Without the await, `result` itself is undefined.
//
//   2. `await act(async () => { ... })`, NEVER a bare synchronous
//      `act(() => ...)`. RTL 14's `act` is async, and an un-awaited one leaves an
//      open scope that corrupts EVERY LATER RENDER IN THE FILE — the first test
//      passes and every one after it reads `result.current` as null. This is the
//      same trap ItemDetailScreen.test.tsx records for two `fireEvent.press`
//      calls in one test: "overlapping `act()` scopes ... corrupt every render
//      after it in the file". Verified here rather than assumed: converting one
//      sync `act` was the difference between 1 passing test and 18.
//
// Because `await renderHook` flushes effects, a resolving `getPrefs` has already
// landed by the time it returns — so 'loading' and "before the write comes back"
// are only observable against a promise deliberately held open. Two tests below
// do exactly that.
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { DEFAULT_PREFS } from '@/shared/contracts';

import { useReaderPrefs, type PrefsSource, type PrefsValues } from './useReaderPrefs';

// A font group carrying BOTH fields, so the spread-before-patch assertion below
// has something to lose. `customFontUri` is the field a naive
// `savePrefs({ font: { family } })` would silently drop.
const STORED: PrefsValues = {
  ...DEFAULT_PREFS,
  theme: 'sepia',
  font: { family: 'Lora', customFontUri: 'file:///fonts/custom.ttf' },
};

/**
 * A fake source with per-method overrides. Defaults resolve; hand it a rejecting
 * `savePrefs` to exercise the rollback.
 */
function fakeSource(overrides: Partial<PrefsSource> = {}) {
  const listeners = new Set<(next: PrefsValues) => void>();

  const source: PrefsSource = {
    getPrefs: jest.fn(() => Promise.resolve(STORED)),
    savePrefs: jest.fn(() => Promise.resolve()),
    resetPrefs: jest.fn(() => Promise.resolve()),
    subscribe: jest.fn((listener: (next: PrefsValues) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    ...overrides,
  };

  // Lets a test act as a second device, or as a sibling section writing its own
  // group — a change the hook did not make and must still pick up.
  return {
    source,
    emit: (next: PrefsValues) => listeners.forEach((listener) => listener(next)),
    listenerCount: () => listeners.size,
  };
}

/** Mounts the hook and waits for the first read to settle. */
async function renderReady(overrides: Partial<PrefsSource> = {}) {
  const fake = fakeSource(overrides);
  const view = await renderHook(() => useReaderPrefs({ source: fake.source }));

  await waitFor(() => expect(view.result.current.state).toBe('ready'));

  return { ...fake, ...view };
}

describe('useReaderPrefs reading', () => {
  // A read that never settles, because `await renderHook` flushes effects — by
  // the time it returns, a resolving `getPrefs` has already landed and 'loading'
  // is gone. Holding the promise open is the only way to observe the state the
  // screen actually renders skeletons for.
  it('reports loading, with no values, while the first read is in flight', async () => {
    const fake = fakeSource({ getPrefs: jest.fn(() => new Promise<PrefsValues>(() => {})) });
    const { result } = await renderHook(() => useReaderPrefs({ source: fake.source }));

    expect(result.current.state).toBe('loading');
    expect(result.current.prefs).toBeNull();
  });

  it('resolves to ready with the stored values', async () => {
    const fake = fakeSource();
    const { result } = await renderHook(() => useReaderPrefs({ source: fake.source }));

    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(result.current.prefs).toEqual(STORED);
  });

  it('resolves to error, with no values, when the read rejects', async () => {
    const fake = fakeSource({ getPrefs: jest.fn(() => Promise.reject(new Error('nope'))) });
    const { result } = await renderHook(() => useReaderPrefs({ source: fake.source }));

    await waitFor(() => expect(result.current.state).toBe('error'));
    expect(result.current.prefs).toBeNull();
  });

  it('re-reads on retry, and recovers when the second read succeeds', async () => {
    const getPrefs = jest
      .fn()
      .mockRejectedValueOnce(new Error('nope'))
      .mockResolvedValueOnce(STORED);
    const fake = fakeSource({ getPrefs });
    const { result } = await renderHook(() => useReaderPrefs({ source: fake.source }));

    await waitFor(() => expect(result.current.state).toBe('error'));

    await act(async () => {
      result.current.onRetry();
    });

    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(result.current.prefs).toEqual(STORED);
    expect(getPrefs).toHaveBeenCalledTimes(2);
  });

  // 'empty' and 'offline' are not lifecycle values here — prefs are a singleton
  // with DEFAULT_PREFS as a floor, and they are written locally before any sync.
  // See the `state` doc comment on UseReaderPrefs.
  it('never reports empty or offline as a state', async () => {
    const { result } = await renderReady();

    expect(['loading', 'ready', 'error']).toContain(result.current.state);
  });
});

describe('useReaderPrefs theme', () => {
  it('saves only the theme key, because theme is a top-level scalar', async () => {
    const { result, source } = await renderReady();

    await act(async () => {
      result.current.onSelectTheme('dark');
    });

    expect(source.savePrefs).toHaveBeenCalledWith({ theme: 'dark' });
  });

  // OPTIMISM, asserted against a write that has NOT come back. A settings
  // control that waits on a promise before moving feels broken, and prefs are
  // local-first by contract, so the value has to land before the store confirms.
  // The write is held open so "before" is observable at all.
  it('moves the value while the write is still in flight', async () => {
    const { result } = await renderReady({
      savePrefs: jest.fn(() => new Promise<void>(() => {})),
    });

    await act(async () => {
      result.current.onSelectTheme('dark');
    });

    expect(result.current.prefs?.theme).toBe('dark');
    expect(result.current.saving).toBe(true);
    expect(result.current.saveFailed).toBe(false);
  });
});

describe('useReaderPrefs font', () => {
  // THE MOST LOAD-BEARING TEST IN THIS FILE. `savePrefs` replaces a top-level
  // group wholesale rather than merging into it, so a patch built as
  // `{ font: { family } }` drops `customFontUri` — a user's own font file, gone
  // because they picked a theme option. The spread lives in the hook precisely
  // so no section can get this wrong.
  it('spreads the existing font group, keeping customFontUri', async () => {
    const { result, source } = await renderReady();

    await act(async () => {
      result.current.onSelectFontFamily('Merriweather');
    });

    expect(source.savePrefs).toHaveBeenCalledWith({
      font: { family: 'Merriweather', customFontUri: 'file:///fonts/custom.ttf' },
    });
  });

  it('accepts a family outside the picker list, because the contract types it as a string', async () => {
    const { result, source } = await renderReady();

    await act(async () => {
      result.current.onSelectFontFamily('Georgia');
    });

    expect(source.savePrefs).toHaveBeenCalledWith(
      expect.objectContaining({ font: expect.objectContaining({ family: 'Georgia' }) }),
    );
  });
});

describe('useReaderPrefs restore defaults', () => {
  it('calls resetPrefs once rather than saving each group separately', async () => {
    const { result, source } = await renderReady();

    await act(async () => {
      result.current.onRestoreDefaults();
    });

    expect(source.resetPrefs).toHaveBeenCalledTimes(1);
    // Eight writes would be eight `updatedAt` stamps and a partial reset if one
    // of them failed.
    expect(source.savePrefs).not.toHaveBeenCalled();
  });

  it('returns every value to the contract defaults', async () => {
    const { result } = await renderReady();

    await act(async () => {
      result.current.onRestoreDefaults();
    });

    expect(result.current.prefs).toEqual(DEFAULT_PREFS);
  });

  it('rolls back to the previous values when the reset rejects', async () => {
    const { result } = await renderReady({
      resetPrefs: jest.fn(() => Promise.reject(new Error('nope'))),
    });

    await act(async () => {
      result.current.onRestoreDefaults();
    });

    await waitFor(() => expect(result.current.saveFailed).toBe(true));
    expect(result.current.prefs).toEqual(STORED);
    // Still usable — a failed write is not a broken screen.
    expect(result.current.state).toBe('ready');
  });
});

describe('useReaderPrefs failed writes', () => {
  it('reverts the optimistic value and raises saveFailed', async () => {
    const { result } = await renderReady({
      savePrefs: jest.fn(() => Promise.reject(new Error('nope'))),
    });

    await act(async () => {
      result.current.onSelectTheme('dark');
    });

    // No mid-flight assertion here: `await act` flushes the rejection too, so by
    // this point the rollback has already happened. The optimistic half is
    // covered by "moves the value while the write is still in flight" above,
    // which holds its promise open specifically to observe it.
    await waitFor(() => expect(result.current.saveFailed).toBe(true));
    expect(result.current.prefs?.theme).toBe('sepia');
  });

  it('clears saveFailed on the next write', async () => {
    const savePrefs = jest
      .fn()
      .mockRejectedValueOnce(new Error('nope'))
      .mockResolvedValueOnce(undefined);
    const { result } = await renderReady({ savePrefs });

    await act(async () => {
      result.current.onSelectTheme('dark');
    });
    await waitFor(() => expect(result.current.saveFailed).toBe(true));

    await act(async () => {
      result.current.onSelectTheme('light');
    });
    await waitFor(() => expect(result.current.saveFailed).toBe(false));
    expect(result.current.prefs?.theme).toBe('light');
  });

  it('reports saving while a write is in flight and clears it after', async () => {
    let release: () => void = () => {};
    const savePrefs = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const { result } = await renderReady({ savePrefs });

    await act(async () => {
      result.current.onSelectTheme('dark');
    });
    expect(result.current.saving).toBe(true);

    await act(async () => {
      release();
    });
    expect(result.current.saving).toBe(false);
  });
});

describe('useReaderPrefs external changes', () => {
  // A second device settling LWW, or Keshav's Layout section writing its own
  // group through the same store. Neither goes through this hook's callbacks.
  it('adopts values pushed by the store without re-reading', async () => {
    const { result, source, emit } = await renderReady();
    const external: PrefsValues = { ...STORED, theme: 'light' };

    await act(async () => {
      emit(external);
    });

    expect(result.current.prefs).toEqual(external);
    // The listener is handed the new values, so no second read is needed.
    expect(source.getPrefs).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes on unmount', async () => {
    const { unmount, listenerCount } = await renderReady();

    expect(listenerCount()).toBe(1);
    await unmount();
    expect(listenerCount()).toBe(0);
  });
});
