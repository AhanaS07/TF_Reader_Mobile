// Owner: Accessibility (Hruthik).
//
// Converts the contract's platform-agnostic 0.5-3.0 speech-rate multiplier
// (`accessibility.tts.rate`, TTS_RATE_MIN/MAX in @/shared/contracts) into whatever value each
// platform's `Tts.setDefaultRate` actually expects. The multiplier is the only rate a caller
// should ever hold onto — this function is the single place platform arithmetic happens.

import { Platform } from 'react-native';

import { TTS_RATE_MAX, TTS_RATE_MIN } from '@/shared/contracts';

export interface RateMapping {
  /** What to pass to Tts.setDefaultRate. */
  value: number;
  /** True if `multiplier` could not be reached and was capped. */
  clamped: boolean;
  /** Human-readable explanation, present only when `clamped` is true. */
  note?: string;
}

/** Discrete stops for a preset UI (chips, stepped slider) in addition to a free slider. */
export const RATE_LADDER = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0] as const;

/**
 * `AVSpeechUtteranceMaximumSpeechRate` is 1.0, and iOS's native check against it is exclusive
 * (`rate < max`), so 1.0 itself is unreachable. Capping just under it is what makes 0.99 the
 * practical ceiling rather than a made-up safety margin.
 */
const IOS_MAX_REACHABLE_RATE = 0.99;

/** 0.5 == AVSpeechUtteranceDefaultSpeechRate: iOS defines "normal speed" at that raw value. */
const IOS_DEFAULT_RATE = 0.5;

function mapIosRate(multiplier: number): RateMapping {
  const raw = multiplier * IOS_DEFAULT_RATE;
  if (raw >= IOS_MAX_REACHABLE_RATE) {
    return {
      value: IOS_MAX_REACHABLE_RATE,
      clamped: true,
      note: `iOS cannot reach ${multiplier.toFixed(2)}x — capped near its maximum speech rate.`,
    };
  }
  return { value: raw, clamped: false };
}

/**
 * Without `skipTransform`, the native Android module applies its own piecewise fit to whatever
 * is passed to `setDefaultRate` (r<0.5 -> r*2, else r*4-1). This is that fit's inverse, so a
 * multiplier survives the round trip and 1.0 still means "normal speed" after the native side
 * transforms it back.
 */
function mapAndroidRate(multiplier: number, skipTransform: boolean): RateMapping {
  if (skipTransform) return { value: multiplier, clamped: false };
  const value = multiplier < 1 ? multiplier / 2 : (multiplier + 1) / 4;
  return { value, clamped: false };
}

/**
 * @param multiplier UI-facing rate, clamped into TTS_RATE_MIN..TTS_RATE_MAX before conversion.
 * @param skipTransform Android only. Passed straight through to `setDefaultRate`; ignored on iOS.
 */
export function mapRate(multiplier: number, skipTransform = false): RateMapping {
  const clamped = Math.min(TTS_RATE_MAX, Math.max(TTS_RATE_MIN, multiplier));
  return Platform.OS === 'ios' ? mapIosRate(clamped) : mapAndroidRate(clamped, skipTransform);
}
