// Owner: Accessibility (Hruthik).
//
// Mutates the real Platform.OS directly rather than jest.mock('react-native', ...) — same
// reasoning as ttsRate.test.ts: this only needs one property flipped between cases.

import { Platform } from 'react-native';

import { normalizeTtsProgressEvent } from './ttsProgress';

describe('normalizeTtsProgressEvent', () => {
  afterEach(() => {
    (Platform as { OS: string }).OS = 'ios';
  });

  it('reads location/length on iOS, converting length into an end offset', () => {
    expect(normalizeTtsProgressEvent({ location: 10, length: 4 })).toEqual({
      start: 10,
      end: 14,
    });
  });

  it('defaults missing iOS fields to 0 rather than throwing', () => {
    expect(normalizeTtsProgressEvent({})).toEqual({ start: 0, end: 0 });
  });

  it('reads start/end directly on Android, ignoring the redundant length field', () => {
    (Platform as { OS: string }).OS = 'android';
    expect(normalizeTtsProgressEvent({ start: 10, end: 14, length: 4 })).toEqual({
      start: 10,
      end: 14,
    });
  });

  it('defaults missing Android fields to 0 rather than throwing', () => {
    (Platform as { OS: string }).OS = 'android';
    expect(normalizeTtsProgressEvent({})).toEqual({ start: 0, end: 0 });
  });
});
