// Owner: Reader (Ahana).
//
// Unit tests for sleepTimerEngine.ts: the countdown/fire/cancel state machine and the
// AppState catch-up path (checkSleepTimerDeadlinePassed), against mocked audioPlayerInstance and
// sleepTimerNotifications — same "mock the module, not the native side" reasoning
// readingAccessMonitor.test.ts uses for verifyReadingAccess, applied here for pauseCurrentAudioPlayer
// and the expo-notifications wrapper.

import {
  cancelSleepTimer,
  checkSleepTimerDeadlinePassed,
  startSleepTimer,
} from './sleepTimerEngine';
import { pauseCurrentAudioPlayer } from './audioPlayerInstance';
import {
  cancelSleepTimerNotification,
  scheduleSleepTimerNotification,
} from './sleepTimerNotifications';
import { useSleepTimerStore } from './sleepTimerStore';

jest.mock('./audioPlayerInstance', () => ({
  pauseCurrentAudioPlayer: jest.fn(),
}));

jest.mock('./sleepTimerNotifications', () => ({
  scheduleSleepTimerNotification: jest.fn().mockResolvedValue(undefined),
  cancelSleepTimerNotification: jest.fn().mockResolvedValue(undefined),
}));

const mockPause = pauseCurrentAudioPlayer as jest.MockedFunction<typeof pauseCurrentAudioPlayer>;
const mockSchedule = scheduleSleepTimerNotification as jest.MockedFunction<
  typeof scheduleSleepTimerNotification
>;
const mockCancelNotification = cancelSleepTimerNotification as jest.MockedFunction<
  typeof cancelSleepTimerNotification
>;

// Same reasoning as readingAccessMonitor.test.ts's own helper: flushes the microtask queue so the
// fire-and-forget `void scheduleSleepTimerNotification(...)`/`void cancelSleepTimerNotification()`
// calls settle before assertions run.
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  jest.useFakeTimers();
  mockPause.mockClear();
  mockSchedule.mockClear();
  mockCancelNotification.mockClear();
  useSleepTimerStore.getState().cancel();
});

afterEach(() => {
  cancelSleepTimer();
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('startSleepTimer', () => {
  it('arms the store and schedules a notification for the deadline', async () => {
    startSleepTimer(60);
    await flushMicrotasks();

    const state = useSleepTimerStore.getState();
    expect(state.phase).toBe('running');
    expect(state.durationSeconds).toBe(60);
    expect(mockSchedule).toHaveBeenCalledTimes(1);
    expect(mockSchedule.mock.calls[0][0]).toBeInstanceOf(Date);
  });

  it('does not pause audio or fire before the duration elapses', async () => {
    startSleepTimer(60);
    jest.advanceTimersByTime(59_000);
    await flushMicrotasks();

    expect(mockPause).not.toHaveBeenCalled();
    expect(useSleepTimerStore.getState().phase).toBe('running');
  });

  it('pauses audio and moves to fired when the duration elapses', async () => {
    startSleepTimer(60);
    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();

    expect(mockPause).toHaveBeenCalledTimes(1);
    expect(useSleepTimerStore.getState().phase).toBe('fired');
  });

  it('ticks remainingSeconds down once per second', async () => {
    startSleepTimer(10);
    jest.advanceTimersByTime(3_000);
    await flushMicrotasks();

    // Ticked value is derived from the wall-clock deadline, not a naive decrement — allow either
    // 6 or 7 depending on rounding at the tick boundary, same tolerance the plan's own tick()
    // rounding implies.
    expect(useSleepTimerStore.getState().remainingSeconds).toBeLessThanOrEqual(7);
    expect(useSleepTimerStore.getState().remainingSeconds).toBeGreaterThanOrEqual(6);
  });

  it('replaces rather than stacks a second call while one is already running', async () => {
    startSleepTimer(60);
    await flushMicrotasks();
    startSleepTimer(300);
    await flushMicrotasks();

    expect(mockCancelNotification).toHaveBeenCalled();
    expect(useSleepTimerStore.getState().durationSeconds).toBe(300);

    // The FIRST timer's own deadline (60s) must not fire the pause — it was replaced.
    jest.advanceTimersByTime(61_000);
    await flushMicrotasks();
    expect(mockPause).not.toHaveBeenCalled();
    expect(useSleepTimerStore.getState().phase).toBe('running');
  });
});

describe('cancelSleepTimer', () => {
  it('stops the countdown, cancels the notification, and resets the store to idle', async () => {
    startSleepTimer(60);
    await flushMicrotasks();

    cancelSleepTimer();
    await flushMicrotasks();

    expect(useSleepTimerStore.getState().phase).toBe('idle');
    expect(mockCancelNotification).toHaveBeenCalled();

    jest.advanceTimersByTime(120_000);
    await flushMicrotasks();
    expect(mockPause).not.toHaveBeenCalled();
  });

  it('is a safe no-op when no timer is running', () => {
    expect(() => cancelSleepTimer()).not.toThrow();
    expect(useSleepTimerStore.getState().phase).toBe('idle');
  });
});

describe('checkSleepTimerDeadlinePassed — AppState catch-up path', () => {
  it('is a no-op when idle', () => {
    checkSleepTimerDeadlinePassed();
    expect(mockPause).not.toHaveBeenCalled();
    expect(useSleepTimerStore.getState().phase).toBe('idle');
  });

  it('is a no-op while running with time still remaining', async () => {
    startSleepTimer(60);
    await flushMicrotasks();

    checkSleepTimerDeadlinePassed();
    expect(mockPause).not.toHaveBeenCalled();
    expect(useSleepTimerStore.getState().phase).toBe('running');
  });

  it('fires early when the wall clock has already passed the deadline — the suspended-JS-timer case', async () => {
    startSleepTimer(60);
    await flushMicrotasks();

    // Simulates the JS timer having been suspended (SLEEP_TIMER_PLAN.md §4's Android note) —
    // jest.setSystemTime moves the clock without running the pending setTimeout itself, so this
    // is genuinely exercising the catch-up path, not the ordinary setTimeout firing.
    jest.setSystemTime(Date.now() + 61_000);

    checkSleepTimerDeadlinePassed();
    expect(mockPause).toHaveBeenCalledTimes(1);
    expect(useSleepTimerStore.getState().phase).toBe('fired');
  });

  it('is idempotent once already fired — a later AppState transition does not double-pause', async () => {
    startSleepTimer(60);
    await flushMicrotasks();
    jest.setSystemTime(Date.now() + 61_000);

    checkSleepTimerDeadlinePassed();
    checkSleepTimerDeadlinePassed();
    checkSleepTimerDeadlinePassed();

    expect(mockPause).toHaveBeenCalledTimes(1);
  });

  it('does not double-fire when the original setTimeout still runs after a catch-up fire', async () => {
    startSleepTimer(60);
    await flushMicrotasks();
    jest.setSystemTime(Date.now() + 61_000);
    checkSleepTimerDeadlinePassed();
    expect(mockPause).toHaveBeenCalledTimes(1);

    // The underlying setTimeout scheduled by startSleepTimer is still pending until this advance —
    // fire()'s own clearTimeout is what stops it from calling fire() a second time here.
    jest.advanceTimersByTime(60_000);
    await flushMicrotasks();
    expect(mockPause).toHaveBeenCalledTimes(1);
  });
});
