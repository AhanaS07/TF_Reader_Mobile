// Exercises startAccessMonitor's timer/policy logic against a mocked verifyReadingAccess —
// same "mock the module, not the network" reasoning readingSessionClient.test.ts uses for
// verifyReadingAccess's own fail-open policy, applied one level up: this file's whole job is the
// interval/pause/resume/stop state machine, not re-proving verifyReadingAccess's own behavior.

import { startAccessMonitor, ACCESS_CHECK_INTERVAL_MS } from './readingAccessMonitor';
import { verifyReadingAccess } from './readingSessionClient';
import { DownloadError, DownloadFailure } from './errors';

jest.mock('./readingSessionClient', () => ({
  verifyReadingAccess: jest.fn(),
}));

const mockVerify = verifyReadingAccess as jest.MockedFunction<typeof verifyReadingAccess>;

// Flushes the microtask queue so a rejected/resolved promise created inside a timer callback
// (tick() calls verifyReadingAccess().catch(...), both async) settles before assertions run —
// jest.advanceTimersByTime alone only runs macrotask (timer) callbacks, not the microtasks they
// schedule.
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  jest.useFakeTimers();
  mockVerify.mockReset();
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('startAccessMonitor', () => {
  it('does not check immediately — verifyReadingAccess already ran once at open time', () => {
    startAccessMonitor('book-001', 'EPUB', jest.fn());
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it('re-checks every ACCESS_CHECK_INTERVAL_MS while left running', async () => {
    mockVerify.mockResolvedValue(undefined);
    startAccessMonitor('book-001', 'EPUB', jest.fn());

    jest.advanceTimersByTime(ACCESS_CHECK_INTERVAL_MS);
    await flushMicrotasks();
    expect(mockVerify).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(ACCESS_CHECK_INTERVAL_MS);
    await flushMicrotasks();
    expect(mockVerify).toHaveBeenCalledTimes(2);
    expect(mockVerify).toHaveBeenCalledWith('book-001', 'EPUB');
  });

  it('calls onRevoked and stops ticking on the first explicit denial', async () => {
    const failure = new DownloadFailure(DownloadError.ENTITLEMENT_REVOKED, 'book-001');
    mockVerify.mockRejectedValue(failure);
    const onRevoked = jest.fn();

    startAccessMonitor('book-001', 'EPUB', onRevoked);

    jest.advanceTimersByTime(ACCESS_CHECK_INTERVAL_MS);
    await flushMicrotasks();
    expect(onRevoked).toHaveBeenCalledTimes(1);
    expect(onRevoked).toHaveBeenCalledWith(failure);

    // Stopped itself — a further interval must not tick again, and must not call onRevoked twice.
    jest.advanceTimersByTime(ACCESS_CHECK_INTERVAL_MS * 3);
    await flushMicrotasks();
    expect(mockVerify).toHaveBeenCalledTimes(1);
    expect(onRevoked).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onRevoked for a non-DownloadFailure rejection (defense in depth)', async () => {
    mockVerify.mockRejectedValue(new Error('unexpected'));
    const onRevoked = jest.fn();

    startAccessMonitor('book-001', 'EPUB', onRevoked);
    jest.advanceTimersByTime(ACCESS_CHECK_INTERVAL_MS);
    await flushMicrotasks();

    expect(onRevoked).not.toHaveBeenCalled();
    // And ticking continues — this wasn't treated as a stop-worthy denial.
    jest.advanceTimersByTime(ACCESS_CHECK_INTERVAL_MS);
    await flushMicrotasks();
    expect(mockVerify).toHaveBeenCalledTimes(2);
  });

  it('stop() prevents any further tick', async () => {
    mockVerify.mockResolvedValue(undefined);
    const handle = startAccessMonitor('book-001', 'EPUB', jest.fn());

    handle.stop();
    jest.advanceTimersByTime(ACCESS_CHECK_INTERVAL_MS * 3);
    await flushMicrotasks();
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it('pause() suspends ticking and resume() restarts a full interval (not a resumed partial one)', async () => {
    mockVerify.mockResolvedValue(undefined);
    const handle = startAccessMonitor('book-001', 'EPUB', jest.fn());

    // Most of the way through the first interval, then paused.
    jest.advanceTimersByTime(ACCESS_CHECK_INTERVAL_MS - 1000);
    handle.pause();
    jest.advanceTimersByTime(10_000); // well past where the original interval would have fired
    await flushMicrotasks();
    expect(mockVerify).not.toHaveBeenCalled();

    handle.resume();
    // The remaining 1s from before the pause must NOT count — resume starts a fresh full window.
    jest.advanceTimersByTime(1000);
    await flushMicrotasks();
    expect(mockVerify).not.toHaveBeenCalled();

    jest.advanceTimersByTime(ACCESS_CHECK_INTERVAL_MS - 1000);
    await flushMicrotasks();
    expect(mockVerify).toHaveBeenCalledTimes(1);
  });

  it('resume() is a no-op once stopped', async () => {
    mockVerify.mockResolvedValue(undefined);
    const handle = startAccessMonitor('book-001', 'EPUB', jest.fn());

    handle.stop();
    handle.resume();
    jest.advanceTimersByTime(ACCESS_CHECK_INTERVAL_MS * 2);
    await flushMicrotasks();
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it('resume() while already running does not double the interval', async () => {
    mockVerify.mockResolvedValue(undefined);
    const handle = startAccessMonitor('book-001', 'EPUB', jest.fn());

    handle.resume(); // already running from startAccessMonitor's own initial resume() — must be inert
    jest.advanceTimersByTime(ACCESS_CHECK_INTERVAL_MS);
    await flushMicrotasks();
    expect(mockVerify).toHaveBeenCalledTimes(1);
  });
});
