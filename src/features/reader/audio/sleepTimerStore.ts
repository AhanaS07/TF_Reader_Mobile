// Owner: Reader (Ahana & Team).
//
// SLEEP TIMER STORE. New, in-memory only, un-synced — a per-session, this-device-only concept, so
// it does not belong in the frozen `SharedPrefs` contract (see SLEEP_TIMER_PLAN.md §3). Mirrors
// audioQueueStore.ts's shape: plain Zustand store, no `persist` middleware, plus a plain-object
// export for imperative (non-React) call sites — sleepTimerEngine.ts and audioTtsCoordinator.ts
// both read/write through that export rather than the hook.

import { create } from 'zustand';

export type SleepTimerPhase = 'idle' | 'running' | 'fired';

export interface SleepTimerState {
  phase: SleepTimerPhase;
  /** The armed duration, for display ("5:00 selected"). */
  durationSeconds: number | null;
  /** Date.now() + durationSeconds*1000 — a wall-clock target, not "playback time elapsed" (see
   * this file's own header note below on why). */
  deadlineAt: number | null;
  /** Ticked once/sec for the UI, derived from deadlineAt. */
  remainingSeconds: number;
  /** True only when audioTtsCoordinator's guardTtsEnableForSleepTimer paused audio for a TTS
   * toggle-on — never set for an ordinary manual pause. */
  pausedForTts: boolean;
  arm: (durationSeconds: number, deadlineAt: number) => void;
  tick: (remainingSeconds: number) => void;
  fire: () => void;
  cancel: () => void;
  setPausedForTts: (value: boolean) => void;
}

// WALL-CLOCK DEADLINE, NOT "PLAYBACK TIME ELAPSED": the timer counts down in real time regardless
// of whether audio is actively playing at every instant, matching "irrespective of whether audio
// is still actively playing" (SLEEP_TIMER_PLAN.md §3). Pausing the countdown when the user manually
// pauses mid-session would be a different, simpler-sounding feature — this is deliberately not
// that one.
export const useSleepTimerStore = create<SleepTimerState>((set) => ({
  phase: 'idle',
  durationSeconds: null,
  deadlineAt: null,
  remainingSeconds: 0,
  pausedForTts: false,

  arm: (durationSeconds, deadlineAt) =>
    set({
      phase: 'running',
      durationSeconds,
      deadlineAt,
      remainingSeconds: durationSeconds,
      pausedForTts: false,
    }),

  tick: (remainingSeconds) => set({ remainingSeconds }),

  // pausedForTts is cleared UNCONDITIONALLY here, not left as whatever it was — once the sleep
  // timer has genuinely ended, resumeAudioIfPausedForSleepTimerTts() must become a no-op even if
  // TTS is switched off later (SLEEP_TIMER_PLAN.md §7).
  fire: () => set({ phase: 'fired', remainingSeconds: 0, pausedForTts: false }),

  cancel: () =>
    set({
      phase: 'idle',
      durationSeconds: null,
      deadlineAt: null,
      remainingSeconds: 0,
      pausedForTts: false,
    }),

  setPausedForTts: (value) => set({ pausedForTts: value }),
}));

/** Imperative handle for non-React call sites (sleepTimerEngine.ts, audioTtsCoordinator.ts). */
export const sleepTimerStore = {
  getState: useSleepTimerStore.getState,
  setState: useSleepTimerStore.setState,
  subscribe: useSleepTimerStore.subscribe,
};
