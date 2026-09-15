// src/hooks/useServerClock.test.ts
// The offset is the one line where a wrong answer makes every countdown on the
// Library screen wrong, so it is asserted directly rather than only through a
// rendered component.
//
// `.ts` and not `.tsx`: this exercises the exported pure function and needs no
// JSX. `useFeedScrollMemory.test.tsx` is `.tsx` because driving that hook
// requires a component to host it; `serverOffsetMs` is a function call.
import { serverOffsetMs } from './useServerClock';

const SERVER_NOW = '2026-08-26T10:00:00Z';
const SERVER_NOW_MS = Date.parse(SERVER_NOW);

describe('serverOffsetMs', () => {
  it('is negative when the device runs fast — its clock reads later than the server', () => {
    const deviceFastBy = 5 * 60_000;

    expect(serverOffsetMs(SERVER_NOW, SERVER_NOW_MS + deviceFastBy)).toBe(-deviceFastBy);
  });

  it('is positive when the device runs slow', () => {
    const deviceSlowBy = 90_000;

    expect(serverOffsetMs(SERVER_NOW, SERVER_NOW_MS - deviceSlowBy)).toBe(deviceSlowBy);
  });

  it('is zero when the two clocks agree', () => {
    expect(serverOffsetMs(SERVER_NOW, SERVER_NOW_MS)).toBe(0);
  });

  it('adding the offset to a device reading recovers the server instant', () => {
    // The property every countdown on the screen depends on, stated once.
    const anchorMs = SERVER_NOW_MS + 37_000;

    expect(anchorMs + serverOffsetMs(SERVER_NOW, anchorMs)).toBe(SERVER_NOW_MS);
  });

  it('falls back to the device clock when no serverTime was sent', () => {
    expect(serverOffsetMs(undefined, SERVER_NOW_MS)).toBe(0);
  });

  it('falls back to the device clock rather than NaN when serverTime is unreadable', () => {
    // A NaN offset would poison every countdown into `undefined` silently. The
    // contract marks serverTime required on every loan and hold, so this is a
    // malformed-response path rather than an expected one.
    expect(serverOffsetMs('whenever', SERVER_NOW_MS)).toBe(0);
  });
});
