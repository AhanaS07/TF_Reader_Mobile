// useServerClock — the only place the device clock and the server clock meet.
//
// Every countdown the Library screen renders is a difference against the
// `serverTime` that arrived with the holdings. This hook is what makes that
// possible without any component reading a clock: it samples the device clock
// on a timer and hands back the offset between the two, so the screen does pure
// arithmetic and `QueueNotification` receives a plain number of minutes.
//
// WHY THE DEVICE CLOCK CAN BE TRUSTED HERE AND NOWHERE ELSE. It is used only to
// measure an INTERVAL between two of its own readings — `anchorMs` when the
// response arrived, `nowMs` on each tick. A device whose absolute clock is
// wrong carries the same error in both, and it cancels. What must never happen
// is the device clock being used as the reference instant itself: a phone five
// minutes fast would show an offer dying five minutes early, and the reader
// abandons a copy that is still theirs.
//
// `ready` IS FALSE UNTIL THE FIRST SAMPLE LANDS, and callers must render no
// countdown while it is. Reporting an offset of zero would silently mean "the
// device clock is correct", which is the assumption this file exists to avoid —
// and it fails in the over-showing direction, which is the one that costs a
// reader a copy rather than a refresh.
//
// THE CLOCK IS READ IN CALLBACKS, NEVER IN RENDER. `Date.now()` in a component
// or hook body is impure and the lint rules reject it, correctly: a value that
// changes on every render makes the output depend on when React happened to
// re-run. Both reads below sit inside a timer callback, which is neither render
// nor a synchronous effect body.
import { useEffect, useState } from 'react';

export interface ServerClock {
  /**
   * Milliseconds to add to a device reading to get the server's clock. Zero
   * while `ready` is false — meaningless until then, not "no skew".
   */
  offsetMs: number;
  /** The device reading this render's countdowns are measured from. */
  nowMs: number;
  /** False until the first sample lands. Render no countdown while false. */
  ready: boolean;
}

/**
 * How far the server's clock is ahead of this device's, in milliseconds.
 *
 * Exported for its own tests: this is the one line where a wrong answer makes
 * every countdown on the screen wrong, so it is worth asserting directly rather
 * than only through a rendered component.
 *
 * FALLS BACK TO 0 — the device's own clock — only when the response carried no
 * readable `serverTime`. The contract marks it required on every loan and hold,
 * so this is a malformed-response path rather than an expected one.
 */
export function serverOffsetMs(serverTime: string | undefined, anchorMs: number): number {
  if (serverTime === undefined) return 0;
  const parsed = Date.parse(serverTime);
  return Number.isNaN(parsed) ? 0 : parsed - anchorMs;
}

interface Sample {
  /** Which response this sample is anchored to. */
  key: string;
  /** Device clock when that response arrived. */
  anchorMs: number;
  /** Device clock as at the most recent tick. */
  nowMs: number;
}

/**
 * @param serverTime the `serverTime` carried by the response now on screen
 * @param resetKey   changes when a new response arrives, re-anchoring the clock.
 *                   The caller supplies it because only the caller knows what
 *                   counts as a new response — for the shelf it is the set of
 *                   item ids, which is stable across a refresh that changed
 *                   nothing.
 * @param tickMs     how often to re-sample. Match the resolution actually
 *                   displayed: sampling faster re-renders for a label that
 *                   cannot change.
 */
export function useServerClock(
  serverTime: string | undefined,
  resetKey: string,
  tickMs: number,
): ServerClock {
  const [sample, setSample] = useState<Sample | null>(null);

  useEffect(() => {
    // SEEDED ON THE NEXT MACROTASK rather than in the effect body. A setState
    // called synchronously inside an effect cascades a second render within the
    // same commit, which the lint rules reject and which would re-run every
    // consumer of this hook twice per response.
    const seed = setTimeout(() => {
      const t = Date.now();
      setSample({ key: resetKey, anchorMs: t, nowMs: t });
    }, 0);

    const ticker = setInterval(() => {
      // Advances `nowMs` only. Re-reading the anchor here would reset the
      // interval being measured on every tick and freeze every countdown.
      setSample((current) => (current === null ? current : { ...current, nowMs: Date.now() }));
    }, tickMs);

    return () => {
      clearTimeout(seed);
      clearInterval(ticker);
    };
  }, [resetKey, tickMs]);

  // A sample anchored to a previous response is not usable: its `anchorMs`
  // belongs to a different `serverTime`, so the offset computed from the two
  // would be arbitrary. Derived rather than cleared in an effect — comparing
  // here is pure, whereas resetting state on a dependency change is the
  // cascading-render pattern again.
  const fresh = sample !== null && sample.key === resetKey;
  if (!fresh) return { offsetMs: 0, nowMs: 0, ready: false };

  return {
    offsetMs: serverOffsetMs(serverTime, sample.anchorMs),
    nowMs: sample.nowMs,
    ready: true,
  };
}
