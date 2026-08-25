// Owner: Reader (Ahana).
//
// AUDIO PHASE 3 — REAL-DEVICE FIX. A module-level singleton audio player, DELIBERATELY NOT owned
// by AudioPlayerScreen's own component lifecycle.
//
// WHY THIS FILE EXISTS AT ALL: `useAudioPlayer` (the hook) auto-releases its underlying native
// player the moment the component that called it unmounts (its own doc: "ensures it's properly
// disposed when no longer needed"). That is exactly backwards for background playback — the whole
// point of `shouldPlayInBackground` (useAudioPlayerSetup.ts) is that navigating back to BookList
// while a book is still playing must NOT stop it. Using the hook meant the native player, and the
// audio session it owned, were torn down the instant AudioPlayerScreen unmounted — confirmed on a
// real device as `ERR_NATIVE_SHARED_OBJECT_NOT_FOUND` when this file's own unmount cleanup then
// tried to call a method on the now-gone object, but the REAL bug was one level up: even without
// that crash, background playback would have silently stopped on every "back" navigation, which
// defeats this phase's entire point.
//
// `createAudioPlayer()` — expo-audio's own "doesn't release automatically" variant, explicitly
// documented as the escape hatch from `useAudioPlayer`'s auto-release — is the fix. Held here, at
// module scope, it survives exactly as long as the JS process does, independent of which screen
// (if any) is currently mounted.
//
// ONE PLAYER AT A TIME, matching this phase's explicit single-file scope (no queue, no chapters).
// Opening a DIFFERENT book releases whatever was playing before. Reopening the SAME book — leave
// the screen while it plays, come back — returns the SAME player, still mid-playback, rather than
// restarting it: that is what a real audiobook app does, and is also what makes "isNew" below
// necessary (AudioPlayerScreen must not re-seek to a stale resume position on top of a player
// that has been quietly continuing to play the whole time it was away).

import { createAudioPlayer, type AudioPlayer } from 'expo-audio';

import type { BookId } from '@/shared/contracts';

let current: { bookId: BookId; player: AudioPlayer } | null = null;

/**
 * Returns the player for `bookId` — the existing one if it's already the active book (still
 * mid-playback, or paused where it was left), or a fresh one (releasing whatever was active
 * before) otherwise.
 *
 * `isNew` tells the caller whether this is a brand-new player, safe to seek to a resume position,
 * or a reused, possibly-still-playing one that must NOT be seeked — see this file's header.
 */
export function getAudioPlayerFor(bookId: BookId): { player: AudioPlayer; isNew: boolean } {
  if (current && current.bookId === bookId) {
    return { player: current.player, isNew: false };
  }

  current?.player.remove();
  // `keepAudioSessionActive: true` is LOCK-SCREEN CORRECTNESS, not a performance knob. Left at its
  // default of `false`, expo-audio's own `Function("pause")` calls `deactivateSession()` on every
  // pause, and the constructor's `onPlaybackComplete` does the same at end of track
  // (AudioModule.swift). Deactivating the AVAudioSession tears down the Now Playing card, so an
  // audiobook — where pausing is constant and the card must survive it — must opt out. iOS-only
  // per expo-audio's own types; a no-op elsewhere.
  const player = createAudioPlayer(null, { updateInterval: 250, keepAudioSessionActive: true });
  current = { bookId, player };
  return { player, isNew: true };
}
