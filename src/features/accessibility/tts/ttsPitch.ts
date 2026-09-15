// Owner: Accessibility (Hruthik).
//
// Unlike rate, pitch needs no platform-specific mapping — `Tts.setDefaultPitch(pitch)` takes the
// contract's raw multiplier on both platforms (see useTtsSession.ts). This file exists only to
// give the UI's discrete stops a symmetrical home next to ttsRate.ts.

import { TTS_PITCH_MAX } from '@/shared/contracts';

/** Discrete stops for a preset UI (chips), mirroring RATE_LADDER's pattern. */
export const PITCH_LADDER = [0.5, 0.75, 1.0, 1.25, 1.5, TTS_PITCH_MAX] as const;
