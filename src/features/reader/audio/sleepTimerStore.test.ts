// Owner: Reader (Ahana & Team).
//
// Unit tests for sleepTimerStore: proves the state transitions SLEEP_TIMER_PLAN.md §3 specifies,
// same style as audioQueueStore.test.ts.

import { useSleepTimerStore } from './sleepTimerStore';

describe('sleepTimerStore', () => {
  beforeEach(() => {
    useSleepTimerStore.getState().cancel();
  });

  it('initializes idle', () => {
    const state = useSleepTimerStore.getState();
    expect(state.phase).toBe('idle');
    expect(state.durationSeconds).toBeNull();
    expect(state.deadlineAt).toBeNull();
    expect(state.remainingSeconds).toBe(0);
    expect(state.pausedForTts).toBe(false);
  });

  it('arm() moves to running, sets duration/deadline, and seeds remainingSeconds from duration', () => {
    const store = useSleepTimerStore.getState();
    const deadlineAt = Date.now() + 60_000;
    store.arm(60, deadlineAt);

    const updated = useSleepTimerStore.getState();
    expect(updated.phase).toBe('running');
    expect(updated.durationSeconds).toBe(60);
    expect(updated.deadlineAt).toBe(deadlineAt);
    expect(updated.remainingSeconds).toBe(60);
    expect(updated.pausedForTts).toBe(false);
  });

  it('arm() clears any stale pausedForTts from a previous run', () => {
    const store = useSleepTimerStore.getState();
    store.arm(30, Date.now() + 30_000);
    store.setPausedForTts(true);
    expect(useSleepTimerStore.getState().pausedForTts).toBe(true);

    store.arm(60, Date.now() + 60_000);
    expect(useSleepTimerStore.getState().pausedForTts).toBe(false);
  });

  it('tick() updates remainingSeconds only', () => {
    const store = useSleepTimerStore.getState();
    store.arm(60, Date.now() + 60_000);
    store.tick(42);

    const updated = useSleepTimerStore.getState();
    expect(updated.remainingSeconds).toBe(42);
    expect(updated.phase).toBe('running');
  });

  it('fire() moves to fired, zeroes remainingSeconds, and clears pausedForTts unconditionally', () => {
    const store = useSleepTimerStore.getState();
    store.arm(60, Date.now() + 60_000);
    store.setPausedForTts(true);

    store.fire();

    const updated = useSleepTimerStore.getState();
    expect(updated.phase).toBe('fired');
    expect(updated.remainingSeconds).toBe(0);
    // The SLEEP_TIMER_PLAN.md §7 rule: once fired, pausedForTts must not survive — otherwise
    // turning TTS off later would incorrectly resume audio after the sleep session already ended.
    expect(updated.pausedForTts).toBe(false);
  });

  it('cancel() resets everything to idle, from running', () => {
    const store = useSleepTimerStore.getState();
    store.arm(60, Date.now() + 60_000);
    store.setPausedForTts(true);

    store.cancel();

    const updated = useSleepTimerStore.getState();
    expect(updated.phase).toBe('idle');
    expect(updated.durationSeconds).toBeNull();
    expect(updated.deadlineAt).toBeNull();
    expect(updated.remainingSeconds).toBe(0);
    expect(updated.pausedForTts).toBe(false);
  });

  it('cancel() resets everything to idle, from fired', () => {
    const store = useSleepTimerStore.getState();
    store.arm(60, Date.now() + 60_000);
    store.fire();

    store.cancel();

    expect(useSleepTimerStore.getState().phase).toBe('idle');
  });

  it('setPausedForTts() toggles independently of phase', () => {
    const store = useSleepTimerStore.getState();
    store.arm(60, Date.now() + 60_000);

    store.setPausedForTts(true);
    expect(useSleepTimerStore.getState().pausedForTts).toBe(true);

    store.setPausedForTts(false);
    expect(useSleepTimerStore.getState().pausedForTts).toBe(false);
  });
});
