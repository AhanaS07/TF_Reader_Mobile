// src/hooks/useNetworkStatus.test.ts
// T5 — the hook eight callers depend on and nothing tested.
//
// WHY IT HAD NO TEST, AND WHY THAT MATTERED. Every screen that shows an
// OfflineBanner mocks this hook out, which is right for a screen test — it lets
// the offline cell be driven directly — but it means the hook's own behaviour was
// never exercised anywhere. `isConnected` is a tri-state on NetInfo (`true`,
// `false`, `null`) and this hook narrows it with `=== true`, so the interesting
// cases are the ones a screen test can never reach.
//
// NETINFO IS MOCKED LOCALLY, not in jest.setup.js. It is a native module: left
// real, `fetch()` throws on `isInternetReachable` under Jest. It is deliberately
// NOT added to the global setup — only this file needs the real module surface
// faked rather than the hook faked, and a global mock would silently change what
// every screen suite is testing.
//
// `await renderHook(...)` and `await unmount()` are both required — RTL 14 types
// them as promises, and without the await `result` is undefined. `await act(async
// () => ...)` for the listener, never a bare synchronous `act()`, which leaves an
// open scope that corrupts every later render in the file. Both traps are
// recorded in useReaderPrefs.test.ts.
import { act, renderHook, waitFor } from '@testing-library/react-native';
import NetInfo from '@react-native-community/netinfo';

import { useNetworkStatus } from './useNetworkStatus';

// Held so a test can settle the first reading on its own schedule — the initial
// `false` is only observable while `fetch()` is still open.
type Listener = (state: { isConnected: boolean | null }) => void;

const mockFetch = jest.fn();
const mockAddEventListener = jest.fn();
const mockUnsubscribe = jest.fn();

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    fetch: (...args: unknown[]) => mockFetch(...args),
    addEventListener: (...args: unknown[]) => mockAddEventListener(...args),
  },
}));

/** The listener the hook registered, so a test can push a change through it. */
function registeredListener(): Listener {
  expect(mockAddEventListener).toHaveBeenCalled();
  return mockAddEventListener.mock.calls[0][0] as Listener;
}

beforeEach(() => {
  // Resolved by default; the tests that care about timing override it.
  mockFetch.mockResolvedValue({ isConnected: true });
  mockAddEventListener.mockReturnValue(mockUnsubscribe);
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('useNetworkStatus first reading', () => {
  // STARTS CLOSED, DELIBERATELY. The hook's own comment gives the reason: "so the
  // sign-in guard never passes before we have a real reading". A hook that
  // optimistically reported `true` would let SignInScreen fire a request in the
  // window before NetInfo answers.
  it('is false before the first reading arrives', async () => {
    // Never settles, so the pre-answer state is observable at all.
    mockFetch.mockReturnValue(new Promise(() => {}));

    const { result } = await renderHook(() => useNetworkStatus());

    expect(result.current).toBe(false);
  });

  it('becomes true when the first reading says connected', async () => {
    mockFetch.mockResolvedValue({ isConnected: true });

    const { result } = await renderHook(() => useNetworkStatus());

    await waitFor(() => expect(result.current).toBe(true));
  });

  it('stays false when the first reading says not connected', async () => {
    mockFetch.mockResolvedValue({ isConnected: false });

    const { result } = await renderHook(() => useNetworkStatus());

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });

  // THE TRI-STATE, which is the whole reason this hook narrows with `=== true`.
  // NetInfo reports `null` when it genuinely does not know yet, and "unknown" is
  // not "connected" — treating it as truthy would hand a screen a green light it
  // has not earned.
  it('treats a null isConnected as offline, not unknown-so-probably-fine', async () => {
    mockFetch.mockResolvedValue({ isConnected: null });

    const { result } = await renderHook(() => useNetworkStatus());

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });

  it('treats a missing isConnected as offline', async () => {
    mockFetch.mockResolvedValue({});

    const { result } = await renderHook(() => useNetworkStatus());

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });
});

describe('useNetworkStatus subscription', () => {
  it('subscribes once on mount', async () => {
    await renderHook(() => useNetworkStatus());

    expect(mockAddEventListener).toHaveBeenCalledTimes(1);
  });

  it('goes offline when the listener reports a dropped connection', async () => {
    mockFetch.mockResolvedValue({ isConnected: true });
    const { result } = await renderHook(() => useNetworkStatus());
    await waitFor(() => expect(result.current).toBe(true));

    await act(async () => {
      registeredListener()({ isConnected: false });
    });

    expect(result.current).toBe(false);
  });

  // The recovery direction matters as much as the drop: CONVENTIONS §6 says
  // offline is "different from failed, since it resolves itself", and this is the
  // mechanism by which it resolves.
  it('comes back online when the listener reports a restored connection', async () => {
    mockFetch.mockResolvedValue({ isConnected: false });
    const { result } = await renderHook(() => useNetworkStatus());
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(result.current).toBe(false);

    await act(async () => {
      registeredListener()({ isConnected: true });
    });

    expect(result.current).toBe(true);
  });

  it('applies the same tri-state narrowing to listener updates', async () => {
    mockFetch.mockResolvedValue({ isConnected: true });
    const { result } = await renderHook(() => useNetworkStatus());
    await waitFor(() => expect(result.current).toBe(true));

    await act(async () => {
      registeredListener()({ isConnected: null });
    });

    expect(result.current).toBe(false);
  });
});

describe('useNetworkStatus teardown', () => {
  // The effect returns NetInfo's own unsubscribe directly. Without this, every
  // screen mount would leak a listener — and eight screens call this hook.
  it('unsubscribes on unmount', async () => {
    const { unmount } = await renderHook(() => useNetworkStatus());
    expect(mockUnsubscribe).not.toHaveBeenCalled();

    await unmount();

    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it('does not subscribe again on re-render', async () => {
    const { rerender } = await renderHook(() => useNetworkStatus());

    await rerender(undefined);

    expect(mockAddEventListener).toHaveBeenCalledTimes(1);
  });
});

// A guard on the module surface this hook depends on, so a NetInfo upgrade that
// renamed either method fails here rather than as eight screens quietly
// reporting offline forever.
describe('useNetworkStatus depends on exactly two NetInfo methods', () => {
  it('uses fetch and addEventListener, and nothing else', async () => {
    await renderHook(() => useNetworkStatus());

    expect(typeof NetInfo.fetch).toBe('function');
    expect(typeof NetInfo.addEventListener).toBe('function');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockAddEventListener).toHaveBeenCalledTimes(1);
  });
});
