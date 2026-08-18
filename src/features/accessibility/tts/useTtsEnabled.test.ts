// Owner: Accessibility (Hruthik).
//
// Pins the four properties Reader relies on when it uses this to decide whether to mount the TTS
// controls: it starts closed, it reflects the stored preference, a failed read stays closed
// rather than opening, and it does not update after unmount.
//
// `@/features/sync/sharedPrefs` is mocked rather than exercised — this hook's job is the
// default/failure behaviour around that read, not SQLite. Every `act` is awaited for the reason
// spelled out at the top of useTtsSession.test.ts.

import { renderHook, waitFor } from '@testing-library/react-native';

import { readSharedPrefs } from '@/features/sync/sharedPrefs';
import { DEFAULT_ACCESSIBILITY_PREFS, DEFAULT_PREFS } from '@/shared/contracts';
import type { SharedPrefs } from '@/shared/contracts';

import { useTtsEnabled } from './useTtsEnabled';

jest.mock('@/features/sync/sharedPrefs', () => ({
  readSharedPrefs: jest.fn(),
}));

const readSharedPrefsMock = readSharedPrefs as jest.Mock;

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
});
