import { renderHook } from '@testing-library/react-native';

import { syncEngine } from './syncEngine';
import { useAutoSync } from './useAutoSync';
import { useConnectivity } from './useConnectivity';

jest.mock('./useConnectivity', () => ({ useConnectivity: jest.fn() }));
jest.mock('./syncEngine', () => ({ syncEngine: { run: jest.fn() } }));

describe('useAutoSync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('runs a sync when the app mounts already online', async () => {
    (useConnectivity as jest.Mock).mockReturnValue(true);

    await renderHook(() => useAutoSync());

    expect(syncEngine.run).toHaveBeenCalledTimes(1);
  });

  it('does not sync while offline', async () => {
    (useConnectivity as jest.Mock).mockReturnValue(false);

    await renderHook(() => useAutoSync());

    expect(syncEngine.run).not.toHaveBeenCalled();
  });

  it('runs a sync on the offline -> online transition', async () => {
    (useConnectivity as jest.Mock).mockReturnValue(false);
    const { rerender } = await renderHook(() => useAutoSync());
    expect(syncEngine.run).not.toHaveBeenCalled();

    (useConnectivity as jest.Mock).mockReturnValue(true);
    await rerender({});

    expect(syncEngine.run).toHaveBeenCalledTimes(1);
  });

  it('does not re-run on a re-render that stays online', async () => {
    (useConnectivity as jest.Mock).mockReturnValue(true);
    const { rerender } = await renderHook(() => useAutoSync());
    expect(syncEngine.run).toHaveBeenCalledTimes(1);

    await rerender({});

    expect(syncEngine.run).toHaveBeenCalledTimes(1);
  });

  it('does not sync again on online -> offline -> online only once back online', async () => {
    (useConnectivity as jest.Mock).mockReturnValue(true);
    const { rerender } = await renderHook(() => useAutoSync());
    expect(syncEngine.run).toHaveBeenCalledTimes(1);

    (useConnectivity as jest.Mock).mockReturnValue(false);
    await rerender({});
    expect(syncEngine.run).toHaveBeenCalledTimes(1);

    (useConnectivity as jest.Mock).mockReturnValue(true);
    await rerender({});
    expect(syncEngine.run).toHaveBeenCalledTimes(2);
  });
});
