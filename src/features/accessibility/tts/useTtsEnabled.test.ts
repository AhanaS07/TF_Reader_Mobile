// Owner: Accessibility (Hruthik).
//
// Pins the four properties Reader relies on when it uses this to decide whether to mount the TTS
// controls: it starts closed, it reflects the stored preference, a failed read stays closed
// rather than opening, and it does not update after unmount.
//
// `@/features/sync/sharedPrefs` is mocked rather than exercised — this hook's job is the
// default/failure behaviour around that read, not SQLite. Every `act` is awaited for the reason
// spelled out at the top of useTtsSession.test.ts.

import { act, renderHook, waitFor } from '@testing-library/react-native';

import { prefsStore } from '@/features/personalization/prefsStore';
import { readSharedPrefs } from '@/features/sync/sharedPrefs';
import { DEFAULT_ACCESSIBILITY_PREFS, DEFAULT_PREFS } from '@/shared/contracts';
import type { PrefsListener } from '@/features/personalization/prefsStore';
import type { SharedPrefs } from '@/shared/contracts';

import { useTtsEnabled } from './useTtsEnabled';

jest.mock('@/features/sync/sharedPrefs', () => ({
  readSharedPrefs: jest.fn(),
}));

// Only `subscribe` is exercised: this hook never writes, and the store's own tests cover the
// notify path. What matters here is that the hook registers, reacts, and unregisters.
jest.mock('@/features/personalization/prefsStore', () => ({
  prefsStore: { subscribe: jest.fn() },
}));

const readSharedPrefsMock = readSharedPrefs as jest.Mock;
const subscribeMock = prefsStore.subscribe as jest.Mock;

/** Hand back the listener the hook registered, so a test can drive a prefs change through it. */
function lastListener(): PrefsListener {
  const call = subscribeMock.mock.calls.at(-1);
  if (!call) throw new Error('useTtsEnabled did not subscribe to prefsStore');
  return call[0] as PrefsListener;
}

function makeSharedPrefs(enabled: boolean): SharedPrefs {
  return {
    id: 'a11y-test',
    userId: 'test-user',
    updatedAt: 0,
    isDeleted: false,
    synced: true,
    ...structuredClone(DEFAULT_PREFS),
    accessibility: {
      ...structuredClone(DEFAULT_ACCESSIBILITY_PREFS),
      tts: { ...DEFAULT_ACCESSIBILITY_PREFS.tts, enabled },
    },
  };
}

describe('useTtsEnabled', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    subscribeMock.mockReturnValue(() => undefined);
  });

  it('reports the stored preference once the read resolves', async () => {
    readSharedPrefsMock.mockResolvedValue(makeSharedPrefs(true));

    const { result } = await renderHook(() => useTtsEnabled());

    await waitFor(() => expect(result.current).toBe(true));
  });

  it('stays false while the read is still in flight', async () => {
    // Never resolves: the first render must not show controls on the strength of a pending read.
    readSharedPrefsMock.mockReturnValue(new Promise<SharedPrefs>(() => undefined));

    const { result } = await renderHook(() => useTtsEnabled());

    expect(result.current).toBe(false);
  });

  it('stays at the contract default when the read rejects, rather than opting the user in', async () => {
    readSharedPrefsMock.mockRejectedValue(new Error('database is locked'));

    const { result } = await renderHook(() => useTtsEnabled());

    // Flush the rejection handler, then assert nothing flipped.
    await waitFor(() => expect(readSharedPrefsMock).toHaveBeenCalled());
    expect(result.current).toBe(DEFAULT_ACCESSIBILITY_PREFS.tts.enabled);
    expect(result.current).toBe(false);
  });

  it('does not set state after unmount', async () => {
    let resolveRead: (prefs: SharedPrefs) => void = () => undefined;
    readSharedPrefsMock.mockReturnValue(
      new Promise<SharedPrefs>((resolve) => {
        resolveRead = resolve;
      }),
    );

    const errorSpy = jest.spyOn(console, 'error');
    const { unmount } = await renderHook(() => useTtsEnabled());

    unmount();
    resolveRead(makeSharedPrefs(true));
    await Promise.resolve();

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  describe('the live channel — a toggle in an open book', () => {
    // THE POINT OF THESE: this boolean is the kill switch. It collapses ReaderScreen's
    // `ttsProvider` to null, which is useTtsSession's only dependency, so its cleanup runs and
    // calls Tts.stop(). If the hook stops tracking the preference, switching TTS off stops
    // stopping speech — and nothing else in the chain would fail to make that visible.
    it('goes false when the user switches TTS off, without a remount', async () => {
      readSharedPrefsMock.mockResolvedValue(makeSharedPrefs(true));

      const { result } = await renderHook(() => useTtsEnabled());
      await waitFor(() => expect(result.current).toBe(true));

      await act(async () => {
        lastListener()(makeSharedPrefs(false));
      });

      expect(result.current).toBe(false);
    });

    it('goes true on the same channel, so the toggle works in both directions', async () => {
      readSharedPrefsMock.mockResolvedValue(makeSharedPrefs(false));

      const { result } = await renderHook(() => useTtsEnabled());
      await waitFor(() => expect(readSharedPrefsMock).toHaveBeenCalled());

      await act(async () => {
        lastListener()(makeSharedPrefs(true));
      });

      expect(result.current).toBe(true);
    });

    it('a slow seed read cannot overwrite a toggle that landed first', async () => {
      // The seed is issued at mount and the user can toggle before SQLite answers. Were the late
      // read allowed to win, switching TTS off would silently switch itself back on — and on a
      // real device that means speech resuming after the user asked for silence.
      let resolveRead: (prefs: SharedPrefs) => void = () => undefined;
      readSharedPrefsMock.mockReturnValue(
        new Promise<SharedPrefs>((resolve) => {
          resolveRead = resolve;
        }),
      );

      const { result } = await renderHook(() => useTtsEnabled());

      await act(async () => {
        lastListener()(makeSharedPrefs(false));
      });
      expect(result.current).toBe(false);

      // The read finally lands, carrying the pre-toggle value.
      await act(async () => {
        resolveRead(makeSharedPrefs(true));
      });

      expect(result.current).toBe(false);
    });

    it('unsubscribes on unmount', async () => {
      const unsubscribe = jest.fn();
      subscribeMock.mockReturnValue(unsubscribe);
      readSharedPrefsMock.mockResolvedValue(makeSharedPrefs(false));

      const { unmount } = await renderHook(() => useTtsEnabled());
      // `act`, or React never flushes the effect cleanup and this passes vacuously — a bare
      // `unmount()` leaves the unsubscribe uncalled and the assertion below at zero.
      await act(async () => {
        unmount();
      });

      expect(unsubscribe).toHaveBeenCalledTimes(1);
    });
  });
});
