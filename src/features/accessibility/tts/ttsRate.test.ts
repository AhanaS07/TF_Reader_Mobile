// Owner: Accessibility (Hruthik).
//
// Mutates the real Platform.OS directly rather than jest.mock('react-native', ...) — the latter
// would replace jest-expo's own RN environment mock wholesale for this file, for a module that
// only needs one property flipped between tests.

import { Platform } from 'react-native';

import { TTS_RATE_MAX, TTS_RATE_MIN } from '@/shared/contracts';

import { mapRate } from './ttsRate';

describe('mapRate', () => {
  afterEach(() => {
    (Platform as { OS: string }).OS = 'ios';
  });

  it('maps the 1.0x default to AVSpeechUtteranceDefaultSpeechRate on iOS', () => {
    expect(mapRate(1.0)).toEqual({ value: 0.5, clamped: false });
  });

  it('clamps rates iOS cannot reach, rather than exceeding the native maximum', () => {
    const mapping = mapRate(TTS_RATE_MAX);
    expect(mapping.clamped).toBe(true);
    expect(mapping.value).toBeLessThan(1.0);
    expect(mapping.note).toBeDefined();
  });

  it('clamps the multiplier itself into TTS_RATE_MIN..MAX before conversion', () => {
    expect(mapRate(TTS_RATE_MIN - 1).value).toBe(mapRate(TTS_RATE_MIN).value);
  });

  it("inverts Android's own transform by default, so the multiplier round-trips", () => {
    (Platform as { OS: string }).OS = 'android';
    expect(mapRate(1.0)).toEqual({ value: 0.5, clamped: false }); // (1+1)/4
    expect(mapRate(0.5)).toEqual({ value: 0.25, clamped: false }); // 0.5/2
  });

  it('passes the multiplier straight through on Android when skipTransform is set', () => {
    (Platform as { OS: string }).OS = 'android';
    expect(mapRate(1.5, true)).toEqual({ value: 1.5, clamped: false });
  });
});
