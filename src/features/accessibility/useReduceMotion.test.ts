// Owner: Accessibility (Hruthik).
//
// Pins the resolved-boolean contract: the stored tri-state preference and the live OS signal are
// both tracked, and 'system' defers to the OS while 'on'/'off' override it outright. Every `act`
// is awaited for the reason spelled out at the top of useTtsSession.test.ts.
//
// `@/features/personalization/prefsStore` is mocked rather than exercised — this hook's job is the
// resolve/merge behaviour around its two reads (`getPrefs`/`subscribe`), not SQLite. Only
// `prefsStore` is mocked, never `@/features/sync/sharedPrefs` directly — see
// `accessibility-db-functions-for-hrithik.md`'s import rule, which this hook follows for both its
// seed and its live channel. `AccessibilityInfo` is spied on directly (matching
// useScreenReaderEnabled.test.ts's own convention), not module-mocked — mocking the whole
// `react-native` module re-triggers its own setup and breaks unrelated native-module registration
// under jest-expo.

import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { prefsStore } from '@/features/personalization/prefsStore';
import { DEFAULT_ACCESSIBILITY_PREFS, DEFAULT_PREFS } from '@/shared/contracts';
import type { PrefsListener } from '@/features/personalization/prefsStore';
import type { ReduceMotion, SharedPrefs } from '@/shared/contracts';

import { useReduceMotion } from './useReduceMotion';

jest.mock('@/features/personalization/prefsStore', () => ({
  prefsStore: { getPrefs: jest.fn(), subscribe: jest.fn() },
}));

const getPrefsMock = prefsStore.getPrefs as jest.Mock;
const subscribeMock = prefsStore.subscribe as jest.Mock;

/** Hand back the listener the hook registered on prefsStore, so a test can drive a change through it. */
function lastPrefsListener(): PrefsListener {
  const call = subscribeMock.mock.calls.at(-1);
  if (!call) throw new Error('useReduceMotion did not subscribe to prefsStore');
  return call[0] as PrefsListener;
}

/** Hand back the listener the hook registered on AccessibilityInfo's reduceMotionChanged event. */
function lastOsListener(): (enabled: boolean) => void {
  const addEventListenerMock = AccessibilityInfo.addEventListener as jest.Mock;
  const call = addEventListenerMock.mock.calls.find(([event]) => event === 'reduceMotionChanged');
  if (!call) throw new Error('useReduceMotion did not listen for reduceMotionChanged');
  return call[1] as (enabled: boolean) => void;
}

function makeSharedPrefs(reduceMotion: ReduceMotion): SharedPrefs {
  return {
    id: 'a11y-test',
    userId: 'test-user',
    updatedAt: 0,
    isDeleted: false,
    synced: true,
    ...structuredClone(DEFAULT_PREFS),
    accessibility: {
      ...structuredClone(DEFAULT_ACCESSIBILITY_PREFS),
      display: { ...DEFAULT_ACCESSIBILITY_PREFS.display, reduceMotion },
    },
  };
}

describe('useReduceMotion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    subscribeMock.mockReturnValue(() => undefined);
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(false);
    jest
      .spyOn(AccessibilityInfo, 'addEventListener')
      .mockReturnValue({ remove: () => undefined } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('resolves true when the stored preference is "on", regardless of OS state', async () => {
    getPrefsMock.mockResolvedValue(makeSharedPrefs('on'));
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);

    const { result } = await renderHook(() => useReduceMotion());

    await waitFor(() => expect(result.current).toBe(true));
  });

  it('resolves false when the stored preference is "off", regardless of OS state', async () => {
    getPrefsMock.mockResolvedValue(makeSharedPrefs('off'));
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);

    const { result } = await renderHook(() => useReduceMotion());

    await waitFor(() => expect(getPrefsMock).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });

  it('follows the OS signal when the stored preference is "system"', async () => {
    getPrefsMock.mockResolvedValue(makeSharedPrefs('system'));
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);

    const { result } = await renderHook(() => useReduceMotion());

    await waitFor(() => expect(result.current).toBe(true));
  });

  it('stays at the least-surprising default while both reads are in flight', async () => {
    getPrefsMock.mockReturnValue(new Promise<SharedPrefs>(() => undefined));
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockReturnValue(new Promise<boolean>(() => undefined));

    const { result } = await renderHook(() => useReduceMotion());

    expect(result.current).toBe(false);
  });

  describe('the live channels — a change while a screen is open', () => {
    it('updates when prefsStore notifies a new stored preference', async () => {
      getPrefsMock.mockResolvedValue(makeSharedPrefs('system'));
      jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);

      const { result } = await renderHook(() => useReduceMotion());
      await waitFor(() => expect(result.current).toBe(false));

      await act(async () => {
        lastPrefsListener()(makeSharedPrefs('on'));
      });

      expect(result.current).toBe(true);
    });

    it('updates when the OS reduceMotionChanged event fires', async () => {
      getPrefsMock.mockResolvedValue(makeSharedPrefs('system'));
      jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);

      const { result } = await renderHook(() => useReduceMotion());
      await waitFor(() => expect(result.current).toBe(false));

      await act(async () => {
        lastOsListener()(true);
      });

      expect(result.current).toBe(true);
    });

    it('a slow seed read cannot overwrite a prefsStore update that landed first', async () => {
      let resolveRead: (prefs: SharedPrefs) => void = () => undefined;
      getPrefsMock.mockReturnValue(
        new Promise<SharedPrefs>((resolve) => {
          resolveRead = resolve;
        }),
      );
      jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);

      const { result } = await renderHook(() => useReduceMotion());

      await act(async () => {
        lastPrefsListener()(makeSharedPrefs('on'));
      });
      expect(result.current).toBe(true);

      await act(async () => {
        resolveRead(makeSharedPrefs('off'));
      });

      expect(result.current).toBe(true);
    });

    it('unsubscribes both channels on unmount', async () => {
      const unsubscribePrefs = jest.fn();
      const removeOsListener = jest.fn();
      subscribeMock.mockReturnValue(unsubscribePrefs);
      jest
        .spyOn(AccessibilityInfo, 'addEventListener')
        .mockReturnValue({ remove: removeOsListener } as never);
      getPrefsMock.mockResolvedValue(makeSharedPrefs('system'));
      jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);

      const { unmount } = await renderHook(() => useReduceMotion());

      await act(async () => {
        unmount();
      });

      expect(unsubscribePrefs).toHaveBeenCalledTimes(1);
      expect(removeOsListener).toHaveBeenCalledTimes(1);
    });
  });

  it('does not set state after unmount', async () => {
    let resolveRead: (prefs: SharedPrefs) => void = () => undefined;
    getPrefsMock.mockReturnValue(
      new Promise<SharedPrefs>((resolve) => {
        resolveRead = resolve;
      }),
    );
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);

    const errorSpy = jest.spyOn(console, 'error');
    const { unmount } = await renderHook(() => useReduceMotion());

    unmount();
    resolveRead(makeSharedPrefs('on'));
    await Promise.resolve();

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
