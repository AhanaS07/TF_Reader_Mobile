// Owner: Reader (Ahana).
//
// AUDIO PHASE 3, TASK E. SESSION-ONLY playback-position cache for audio — the audio counterpart
// to sessionProgress.ts, mirroring its exact pattern (an in-memory Map, nothing persisted), but
// with its OWN position type: a plain number of seconds, not a ReaderPosition. Audio has no
// CFI-vs-page addressing ambiguity the way EPUB/PDF do — one number is the whole position model,
// so this does not need sessionProgress.ts's discriminated-union/targetFromPosition machinery.
//
// SCOPE DECISION FOR THIS PHASE (flagged per the Phase 3 brief): this is the minimal version —
// resume within the SAME app run only, exactly like sessionProgress.ts. Durable, cross-device
// audio position (a new addressing mode on the frozen progress.ts contract, per
// AUDIO_PHASE0_FINDINGS.md §6) is real work — a new Contracts-Gate conversation with
// Personalization/Sync, not a few extra lines here — and is deferred to a later phase rather than
// attempted as a drive-by. This module does NOT touch progress.ts, and per B15
// (CONTRACT_ALIGNMENT.md) an in-memory, relaunch-clearing cache adds no new PERSISTENCE behavior
// for audio to answer for.
//
// Not persisted anywhere: module state, gone on relaunch, on purpose — same as sessionProgress.ts.

import type { BookId } from '@/shared/contracts';

const positions = new Map<BookId, number>();

export function getAudioSessionPosition(bookId: BookId): number | undefined {
  return positions.get(bookId);
}

export function setAudioSessionPosition(bookId: BookId, positionSeconds: number): void {
  positions.set(bookId, positionSeconds);
}
