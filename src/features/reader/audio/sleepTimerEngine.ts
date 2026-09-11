// Owner: Reader (Ahana).
//
// SLEEP TIMER ENGINE — the countdown itself. Module-scope variables, not React state/refs, so it
// survives navigation and backgrounding: the exact closure-timer shape
// src/features/download/readingAccessMonitor.ts already uses in this codebase, for the same
// reason — nothing here is tied to any component's mount lifecycle. See SLEEP_TIMER_PLAN.md §4.

import { pauseCurrentAudioPlayer } from './audioPlayerInstance';
import {
  cancelSleepTimerNotification,
  scheduleSleepTimerNotification,
} from './sleepTimerNotifications';
import { sleepTimerStore } from './sleepTimerStore';

let fireTimeout: ReturnType<typeof setTimeout> | null = null;
let tickInterval: ReturnType<typeof setInterval> | null = null;

/** Arms the timer for `durationSeconds` from now. Idempotent — replaces any existing timer rather
 * than stacking (SLEEP_TIMER_PLAN.md §9: re-arming while one is already running is a REPLACE, not
 * an "add time" affordance). */
export function startSleepTimer(durationSeconds: number): void {
  cancelSleepTimer();
  const deadlineAt = Date.now() + durationSeconds * 1000;
  sleepTimerStore.getState().arm(durationSeconds, deadlineAt);
  void scheduleSleepTimerNotification(new Date(deadlineAt));
  fireTimeout = setTimeout(fire, durationSeconds * 1000);
  tickInterval = setInterval(tickOnce, 1000);
}

/** Stops the timer and clears everything — the running countdown, the scheduled notification, and
 * the store. Safe to call when no timer is running. */
export function cancelSleepTimer(): void {
  if (fireTimeout) clearTimeout(fireTimeout);
  if (tickInterval) clearInterval(tickInterval);
  fireTimeout = null;
  tickInterval = null;
  void cancelSleepTimerNotification();
  sleepTimerStore.getState().cancel();
}

function fire(): void {
  // clearTimeout, not just nulling the variable — fire() has a SECOND caller besides its own
  // setTimeout (checkSleepTimerDeadlinePassed's catch-up path), and without this the original
  // setTimeout would still be live and invoke fire() a second time later.
  if (fireTimeout) clearTimeout(fireTimeout);
  if (tickInterval) clearInterval(tickInterval);
  fireTimeout = null;
  tickInterval = null;
  // A safe no-op if nothing is playing (e.g. TTS currently owns the audio session — see
  // SLEEP_TIMER_PLAN.md §7/§9) — pauseCurrentAudioPlayer() already guards on isLoaded && playing,
  // so firing never throws or double-pauses.
  pauseCurrentAudioPlayer();
  sleepTimerStore.getState().fire();
}

function tickOnce(): void {
  const { deadlineAt } = sleepTimerStore.getState();
  if (deadlineAt === null) return;
  sleepTimerStore.getState().tick(Math.max(0, Math.round((deadlineAt - Date.now()) / 1000)));
}

/**
 * Catch-up path for the case where the JS timer itself didn't get to run while backgrounded
 * (Android in particular may suspend timers even with a foreground service active). Wired into
 * useAudioPlayerSetup.ts's existing app-wide AppState listener, on every transition — see that
 * file for why this is extended rather than given a second listener. Idempotent: a no-op once the
 * timer has already fired or isn't running.
 */
export function checkSleepTimerDeadlinePassed(): void {
  const { phase, deadlineAt } = sleepTimerStore.getState();
  if (phase === 'running' && deadlineAt !== null && Date.now() >= deadlineAt) {
    fire();
  }
}
