// src/search/voiceErrorCopy.ts
// The single VoiceErrorCode → copy map, doing for screen 11 exactly what
// `@model/errorCopy` does for the catalogue-backed screens: one list, so a
// code's wording only ever changes in one place and a new `VoiceErrorCode`
// member is a compile error here rather than an overlay quietly falling back
// to nothing.
//
// IT LIVES BESIDE THE MACHINE, NOT IN `@model`. `errorCopy.ts` is keyed on
// `CatalogueError`, which is the adapter layer's vocabulary; `src/model` may
// not import from `src/search`, so a voice map there would either invert the
// dependency or force the voice codes into an enum about network failures.
// See the note on `VoiceErrorCode`.
//
// PLAIN STRINGS, NEVER AN `Error`. Design Spec §4.2 — no stack trace can reach
// a reader. `VoiceOverlay.errorMessage` takes a string for the same reason.
import type { VoiceErrorCode } from './voiceState';

export const VOICE_ERROR_COPY: Record<VoiceErrorCode, string> = {
  // Names the fix and where it lives. A refusal is the one failure the reader
  // can definitely resolve, so the copy says how rather than just reporting it.
  // This is the wording the gallery has carried since the overlay landed.
  permission_denied: 'Microphone access is off. Turn it on in Settings to search by voice.',

  // Not a failure the reader caused, and worded so it does not read as one.
  no_speech: 'No speech was heard. Try again.',

  // A device with no speech service, or one that cannot handle our locale.
  // Retrying will not help, so the copy points at the other way in rather than
  // inviting another attempt.
  no_recogniser: 'Voice search is not available on this device. Type your search instead.',

  // The same fact `CatalogueError.NETWORK_UNAVAILABLE` reports, worded the same
  // way, because it is the same condition seen from a different subsystem.
  network: 'You appear to be offline.',

  // Everything the recogniser reports that a reader can do nothing specific
  // about. Generic on purpose — a blank overlay is worse, and naming the
  // native code would tell them nothing.
  unknown: 'Voice search could not be completed. Try again.',
};
