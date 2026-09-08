import { PUSH_ON_ENQUEUE_DEBOUNCE_MS } from './syncConfig';
import { requestSync, setSyncRunner } from './syncTrigger';

describe('syncTrigger', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    // Leaves no registered runner behind for whichever test file happens to run next in this
    // worker - setSyncRunner(null as any) would fight the type, so an inert no-op stands in.
    setSyncRunner(() => {});
  });

  it('is a safe no-op before any runner has ever been registered', () => {
    expect(() => {
      requestSync();
      jest.advanceTimersByTime(PUSH_ON_ENQUEUE_DEBOUNCE_MS);
    }).not.toThrow();
  });

  it('does nothing until the debounce window elapses', () => {
    const runner = jest.fn();
    setSyncRunner(runner);

    requestSync();
    jest.advanceTimersByTime(PUSH_ON_ENQUEUE_DEBOUNCE_MS - 1);

    expect(runner).not.toHaveBeenCalled();
  });

  it('calls the registered runner once the debounce window elapses', () => {
    const runner = jest.fn();
    setSyncRunner(runner);

    requestSync();
    jest.advanceTimersByTime(PUSH_ON_ENQUEUE_DEBOUNCE_MS);

    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('collapses a burst into ONE call, timed from the LAST request', () => {
    const runner = jest.fn();
    setSyncRunner(runner);

    requestSync();
    jest.advanceTimersByTime(PUSH_ON_ENQUEUE_DEBOUNCE_MS - 1);
    requestSync(); // resets the window - the first request must not fire on its own schedule
    jest.advanceTimersByTime(PUSH_ON_ENQUEUE_DEBOUNCE_MS - 1);
    expect(runner).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(runner).toHaveBeenCalledTimes(1);
  });
});
