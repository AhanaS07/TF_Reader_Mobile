// Owner: Reader (Ahana).
//
// Reclaims `tf-reader-audio-scratch/` — the plaintext copies `audioAssetResolver.ts` writes so a
// native player has a URI to open.
//
// WHY THIS FILE EXISTS: that directory is private to `audioAssetResolver.ts`. Nothing else in the
// app knows the path, which means none of the things that revoke access to a book reach it —
// `contentStore.destroy()` erases Encryption's stored package, licence expiry makes `decryptBook()`
// refuse, and a revocation lock destroys the BEK, and all three leave the decrypted audio sitting
// in the cache directory exactly where it was. The resolver already sweeps on every resolve, which
// bounds the SIZE of the leak, but "bounded at one book" is a disk-space answer to what is now an
// entitlement question: a SUBSCRIPTION-tier audio fixture exists, so the last-played audiobook can
// be licensed content whose plaintext outlives the licence.
//
// This file is only the wiring. The file operations live in `audioAssetResolver.ts` (which owns the
// directory and stays ignorant of app lifecycle), and the "what is playing right now" question is
// answered by `audioPlayerInstance.ts` (which owns the player and stays ignorant of files). Keeping
// all three apart is what lets the resolver's guards — no player imports, no lifecycle imports —
// stay true.
//
// ─── WHAT THIS DOES AND DOES NOT REACH ───────────────────────────────────────────────────────
// Deleting a file does not stop a native player that already has it open — on POSIX the unlinked
// inode stays readable through the existing descriptor. So revocation releases the PLAYER first and
// then deletes; a file sweep alone would have let a revoked book play on to the end. That is a
// deliberate escalation beyond what `offline-lock.ts` requires (its signals are advisory, and
// ENCRYPTION owns enforcement), taken because continuing to play content whose licence was revoked
// is worse than the interruption.
//
// STILL NOT REACHED: `contentStore.destroy(bookId)` called directly, by anything other than a Sync
// lock. It emits no event, so there is nothing for this file to subscribe to, and adding one means
// editing Encryption's code. The recommended hook is written up in AUDIO_PLAYER_DECISION.md Part 4;
// until it exists, a directly-destroyed book's scratch file is cleaned up by the next app-state
// sweep rather than at the moment of destruction.

import { AppState } from 'react-native';

import { OFFLINE_LOCK_EVENTS } from '@/shared/contracts';
import type { OfflineLockSignal } from '@/shared/contracts';
import { eventBus } from '@/shared/eventBus';

import { clearAudioScratch, deleteAudioScratchFor } from './audioAssetResolver';
import {
  currentAudioBookId,
  isAudioPlaying,
  releaseCurrentAudioPlayer,
} from './audioPlayerInstance';

/**
 * Drops the scratch copy of a book that just lost its entitlement.
 *
 * Fires for BOTH lock reasons, and the difference between them does not matter here even though it
 * matters a great deal to Encryption. `'revoked'` is the privileged signal that asks Encryption to
 * destroy the BEK; `'expired'` is advisory, because Encryption already refuses an expired licence
 * from the licence itself. But that asymmetry is about CIPHERTEXT, which is useless without a key.
 * This directory holds PLAINTEXT, which no key check protects — so for these files, expiry and
 * revocation are the same event and both must delete.
 *
 * STOPS PLAYBACK FIRST when the locked book is the one playing, then deletes. Order matters and the
 * two halves solve different problems:
 *  - Releasing the player is what actually cuts the user off. Unlinking alone does not: a native
 *    player holding an open descriptor keeps reading the unlinked file to the end. This used to be
 *    documented here as an accepted gap; it is closed now.
 *  - Deleting is what stops the plaintext being readable by anything else, and is still needed
 *    after the release, since the file survives the player.
 *
 * Releasing BEFORE unlinking, rather than after, so there is never a moment where a live player is
 * reading a file that has been removed from the filesystem — the state this file's own app-state
 * sweep goes out of its way to avoid.
 */
function handleLock(signal: OfflineLockSignal): void {
  // The bus types every handler against the full OfflineLockSignal union regardless of which event
  // it subscribed to, so narrow rather than assume. Belt and braces: an unlock reaching this
  // handler would mean a book REGAINED entitlement, and deleting its plaintext on that would be
  // precisely backwards.
  if (signal.type !== OFFLINE_LOCK_EVENTS.LOCK) return;

  try {
    if (currentAudioBookId() === signal.bookId) {
      releaseCurrentAudioPlayer();
    }
    deleteAudioScratchFor(signal.bookId);
  } catch (error) {
    // Never let a sweep failure propagate into Sync's pull loop, which is what emits this. Losing
    // one cleanup is recoverable — the app-state sweep below will catch the same file — whereas
    // throwing here would fail a pull that was otherwise fine.
    console.warn(`[audioScratchReclaimer] failed to clear scratch for ${signal.bookId}`, error);
  }
}

/**
 * Clears everything except a file something is actively reading, on both app-state edges.
 *
 * BOTH edges, not just one, because they close different halves of the window:
 *  - Leaving the foreground is when the plaintext would otherwise sit unattended for hours. This is
 *    the edge that matters for exposure, and it is also the last callback the OS reliably delivers
 *    before it may kill the process outright.
 *  - Returning to the foreground catches everything the first edge could not: the app was killed
 *    while backgrounded, or the file was spared because it was playing and playback has since ended
 *    with no screen mounted to notice.
 *
 * SPARES ONLY A PLAYING BOOK — `isAudioPlaying()`, not `currentAudioBookId()` alone. A paused or
 * finished player still HOLDS its book, and an earlier version of this spared it on that basis. It
 * should not: the only reason to keep decrypted audio on disk is that a native player is reading it
 * this instant.
 *
 * Deleting a merely-held book's file costs nothing, because the resolver rewrites the file on every
 * resolve regardless — `AudioPlayerScreen` re-resolves on every mount, and `openBook()` re-acquires
 * the bytes whether they come from the local encrypted package or the network. So sparing a paused
 * book would buy no work back and would leave decrypted licensed content sitting in a cache
 * directory for as long as the user leaves the app alone.
 *
 * This is also what covers the STREAMED path specifically. Nothing on the device can re-derive an
 * ephemeral book's bytes — there is no local ciphertext — so its scratch file is the only decrypted
 * copy in existence and it must not outlive the listening session. It does not need its own branch:
 * "delete unless it is playing" already says it.
 */
function handleAppStateChange(): void {
  try {
    clearAudioScratch(isAudioPlaying() ? currentAudioBookId() : null);
  } catch (error) {
    console.warn('[audioScratchReclaimer] scratch sweep failed', error);
  }
}

/**
 * Subscribes both reclaim triggers. Returns an unsubscribe for the caller's own teardown.
 *
 * Runs one sweep immediately, on the same reasoning as the foreground edge: at the moment this is
 * installed — app start — nothing is playing yet, so anything in the directory is a leftover from a
 * previous run that ended without a clean exit.
 */
export function installAudioScratchReclaimer(): () => void {
  handleAppStateChange();

  const appStateSubscription = AppState.addEventListener('change', handleAppStateChange);
  const unsubscribeLock = eventBus.on(OFFLINE_LOCK_EVENTS.LOCK, handleLock);

  return () => {
    appStateSubscription.remove();
    unsubscribeLock();
  };
}
