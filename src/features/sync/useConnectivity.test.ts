// Exercises useConnectivity's subscription lifecycle against a mocked NetInfo, since real
// NetInfo has no JS-only implementation for Jest to fall back on.

import { renderHook, waitFor } from '@testing-library/react-native';
import NetInfo from '@react-native-community/netinfo';
import { useConnectivity } from './useConnectivity';

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn(),
    fetch: jest.fn(),
  },
}));

describe('useConnectivity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('unsubscribes the NetInfo listener on unmount, not just leaving it attached', async () => {
    const unsubscribe = jest.fn();
    (NetInfo.addEventListener as jest.Mock).mockReturnValue(unsubscribe);
    (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: true });

    const { unmount } = await renderHook(() => useConnectivity());
    expect(unsubscribe).not.toHaveBeenCalled();

    unmount();
    await waitFor(() => expect(unsubscribe).toHaveBeenCalledTimes(1));
  });

  it('a fetch() that resolves after unmount does not throw or update a torn-down subscription', async () => {
    (NetInfo.addEventListener as jest.Mock).mockReturnValue(jest.fn());
    let resolveFetch: (state: { isConnected: boolean }) => void = () => {};
    (NetInfo.fetch as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const { unmount } = await renderHook(() => useConnectivity());
    unmount();

    // The in-flight fetch() from before unmount resolves late - this must not throw.
    expect(() => resolveFetch({ isConnected: true })).not.toThrow();
  });

  it('reflects NetInfo.isConnected, including null (treated as offline)', async () => {
    (NetInfo.addEventListener as jest.Mock).mockImplementation((cb: (s: any) => void) => {
      cb({ isConnected: null });
      return jest.fn();
    });
    (NetInfo.fetch as jest.Mock).mockResolvedValue({ isConnected: null });

    const { result } = await renderHook(() => useConnectivity());
    expect(result.current).toBe(false);
  });
});
