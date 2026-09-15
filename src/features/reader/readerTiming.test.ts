// Owner: Reader (Ahana).
//
// The property worth a test here is NOT the arithmetic — it is that the probes are SILENT unless
// explicitly switched on. These lines report payload sizes from a path that holds decrypted
// licensed content, so "off by default" is a security property, not a preference, and a regression
// to always-on would otherwise be invisible in review.

import { heapUsedMb, isTimingEnabled, logEvent, logSpan, now } from './readerTiming';

// Literal member access throughout, matching readerTiming.ts — see the comment on
// isTimingEnabled() for why the key must never become a computed lookup. `expo/no-dynamic-env-var`
// fails the build on the computed form, which is how this file caught the mistake in the first place.
describe('readerTiming gating', () => {
  const original = process.env.EXPO_PUBLIC_READER_TIMING;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    if (original === undefined) {
      delete process.env.EXPO_PUBLIC_READER_TIMING;
    } else {
      process.env.EXPO_PUBLIC_READER_TIMING = original;
    }
  });

  it('emits nothing when the flag is unset', () => {
    delete process.env.EXPO_PUBLIC_READER_TIMING;

    expect(isTimingEnabled()).toBe(false);
    logSpan('decrypt', now());
    logEvent('ready');

    expect(logSpy).not.toHaveBeenCalled();
  });

  // Guards against a truthiness check creeping in — `'0'` and `'false'` are both truthy strings, so
  // `if (process.env[FLAG])` would enable timing for either. Only the exact '1' should.
  it.each(['0', 'false', '', 'yes', 'true'])(
    'emits nothing when the flag is %j rather than exactly "1"',
    (value) => {
      process.env.EXPO_PUBLIC_READER_TIMING = value;

      expect(isTimingEnabled()).toBe(false);
      logSpan('decrypt', now());

      expect(logSpy).not.toHaveBeenCalled();
    }
  );

  it('emits a prefixed line with the label and extras when the flag is exactly "1"', () => {
    process.env.EXPO_PUBLIC_READER_TIMING = '1';

    expect(isTimingEnabled()).toBe(true);
    logSpan('decrypt', now(), { bytes: 20_971_520 });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = String(logSpy.mock.calls[0][0]);
    expect(line).toContain('[TFPERF]');
    expect(line).toContain('decrypt');
    // Thousands-separated so a 27M-char payload is readable at a glance in the Metro console.
    expect(line).toContain('bytes=20,971,520');
    expect(line).toMatch(/\d+ms/);
  });

  it('reports a heap figure or null, never a bogus number', () => {
    // Under Jest this runs on V8, where RN's Hermes-backed performance.memory does not exist, so
    // null is the expected answer here. The assertion is deliberately shaped to pass on-device too,
    // where Hermes does report it — this documents the contract, not the current runtime.
    const heap = heapUsedMb();
    expect(heap === null || (typeof heap === 'number' && heap > 0)).toBe(true);
  });
});
