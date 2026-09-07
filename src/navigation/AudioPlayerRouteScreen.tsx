// The AudioPlayer route: reads `{ bookId, title }` from navigation params and renders
// AudioPlayerScreen — same split ReaderRouteScreen.tsx uses for the WebView reader (this file
// owns navigation concerns, AudioPlayerScreen.tsx owns none). Progress wiring lives HERE, not in
// AudioPlayerScreen, for the same reason ReaderRouteScreen.tsx's own header gives: resuming a book
// is a routing concern (which position does THIS push start at), and AudioPlayerScreen's own
// initialPosition/onPositionChange/onPositionCommit props are deliberately ignorant of where a
// position comes from or where it goes.
//
// AUDIO PHASE 4, TASK B — LANDED. Progress now goes through `progressStore` (SQLite + the sync
// outbox) — the same durable, synced store EPUB/PDF use — instead of the local, unsynced JSON file
// `audioSessionProgress.ts` used to be (deleted with this change). See
// CONTRACTS_GATE_PROPOSAL_AUDIO_PROGRESS.md for why that file existed and what unblocked this.
//
// WHY THIS SCREEN NOW HAS A LOADING GATE, WHEN IT DIDN'T BEFORE: `progressStore.currentLocator()`
// queries SQLite and is genuinely async, unlike the old JSON file's synchronous `textSync()`. A
// render-time read is no longer possible, so `AudioPlayerScreen` cannot mount with a resume
// position until the query resolves — the same reason `AudioPlayerScreen` itself already gates on
// `audioAssetResolver.resolveAudioAssetUri()` before mounting a player.
//
// WHY THE RESOLVED POSITION CARRIES ITS OWN `bookId` INSTEAD OF BEING RESET WHEN `bookId` CHANGES:
// this screen does NOT remount per book — navigating to a different audiobook while already on this
// route updates `route.params` on the SAME instance (that is exactly why `AudioPlayerScreen` below
// needs its own `key={bookId}`). Resetting state synchronously at the top of the effect body, before
// the query resolves, is exactly what this repo's `react-hooks/set-state-in-effect` lint rule
// forbids. Tagging the resolved value with the `bookId` it belongs to and comparing against the
// current `bookId` avoids that: the only `setState` call is the one inside the (async) `.then()`.
//
// WHY THE RESOLVE EFFECT AWAITS `syncEngine.run()` BEFORE READING `currentLocator()`: the local
// SQLite row can itself be stale. `src/features/sync/useAutoSync.ts` (mounted once, at the app
// root) only re-syncs on an actual NetInfo offline->online EDGE — backgrounding and foregrounding
// this app while the connection never drops (the common case) fires no such edge, so nothing pulls
// in a position another device wrote while this device was merely backgrounded, not relaunched.
// `syncEngine.run()` is public for exactly this (concurrent calls share one run rather than racing,
// so this costs nothing extra if `useAutoSync`'s own trigger already has one in flight) and never
// rejects (`execute()` catches internally). Same fix, same reasoning, as
// `ReaderRouteScreen.tsx`'s equivalent effect for EPUB/PDF.
//
// CROSS-DEVICE CONFLICTS ARE CAUGHT AT THE PLAY BUTTON, NOT BY A BACKGROUND SUBSCRIPTION — AND
// THAT IS THE POINT, NOT A SIMPLER FALLBACK. An earlier version of this file subscribed to
// `progressStore.subscribe()` and compared on every notification, the same shape
// `ReaderRouteScreen.tsx` uses for EPUB/PDF. That shape is wrong for audio specifically: text only
// moves on a discrete `relocated` event, so comparing against "what is on screen" is stable between
// events. Audio's position drifts continuously WHILE PLAYING, and this device's own throttled
// writes (`AUDIO_PROGRESS_WRITE_THROTTLE_MS`) still land during that time — so a background
// subscription watching for divergence would flag its own device's advancing playback as a
// conflict roughly every throttle interval, and a genuinely idle SECOND device with the same book
// open would see the SAME false alarms every time its own sync engine happened to pull. The
// question that actually matters for audio is not "has this row changed since a moment ago" but
// "am I about to resume playback from a position that might already be stale" — which is exactly
// the moment `onBeforePlay` intercepts. The check only runs when the transport is at rest (the
// player is paused — nothing plays until this resolves `true`), and splits on `CONFLICT_THRESHOLD_MS`:
// within it, the difference is adopted SILENTLY (last-write-wins — `syncEngine.run()` already
// resolved local-vs-remote for this row, so `incoming` is simply the correct value; adopting it is
// bookkeeping, not a decision) rather than merely ignored, because leaving this device's stale
// value on record would make the NEXT comparison wrong too. Past the threshold, it escalates to
// the same prompt `ReaderRouteScreen.tsx` uses for EPUB/PDF.
//
// THE IN-APP GATE ABOVE IS NOT THE ONLY WAY PLAYBACK CAN RESUME, AND THE OTHER ONE BYPASSES IT
// ENTIRELY. `AudioPlayerScreen.tsx`'s `setActiveForLockScreen` wires the OS lock-screen/
// Control-Center/media-notification Play and Toggle commands to expo-audio's NATIVE player
// directly — resuming from there never calls `beginPlayback`, so `onBeforePlay` never runs. A
// conflict written by another device while this device sits paused can start playing again from
// the lock screen with no check and no prompt. Confirmed present, not fixed: closing it needs
// either patching expo-audio to route the remote command through JS first, or dropping lock-screen
// transport controls — both are product trade-offs on top of this file, not something to change
// here unilaterally. See CLAUDE.md's "Reading-position resume" section.

import { useCallback, useEffect, useRef, useState } from 'react';

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';

import { AudioPlayerScreen } from '@/features/reader/audio/AudioPlayerScreen';
import { syncEngine } from '@/features/sync/syncEngine';
import { progressStore } from '@/features/sync/stores/progressStore';
import type { Locator } from '@/shared/contracts';

import type { RootStackParamList } from './RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'AudioPlayer'>;

// Ticks arrive every 250ms (audioPlayerInstance.ts's updateInterval). Writing to SQLite (and
// enqueueing an outbox row) on each one would be ~4 writes a second for a value nobody reads until
// the next launch or another device pulls it. The throttle only gates onPositionChange — the
// pause/seek/unmount edge (onPositionCommit) always writes through immediately, same as before.
const AUDIO_PROGRESS_WRITE_THROTTLE_MS = 5_000;

// Below this, two positions count as "the same place" — clock/rounding noise between devices, not
// a real divergence. Chosen to be well above the ~1s round-trip a seek+commit can introduce, and
// well below anything a listener would notice as "picked up somewhere I didn't leave off."
const CONFLICT_THRESHOLD_MS = 5_000;

export function AudioPlayerRouteScreen({ route }: Props): React.JSX.Element {
  const { bookId, title } = route.params;

  const [resolved, setResolved] = useState<{ bookId: string; positionSeconds?: number } | null>(
    null,
  );
  // Bumped only by "Resume from there" below, to force `AudioPlayerScreen` to remount with the
  // adopted `initialPosition` — its own `key={bookId}` already forces one on a genuine book change,
  // this extends that to "the same book, a newly adopted position."
  const [resumeGeneration, setResumeGeneration] = useState(0);
  const lastWriteAtRef = useRef(0);
  // The freshest PAUSED/settled position this device knows — set by onPositionCommit only (pause,
  // seek, unmount), NOT by the continuous onPositionChange ticks. This is deliberately narrower
  // than ReaderRouteScreen's equivalent ref: `onBeforePlay` only ever fires while paused (Play is
  // only reachable from a paused state), so this is always "the position about to be resumed from"
  // when it matters, never a live-playing value the comparison would need to unwind.
  const lastPausedPositionSecondsRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Reset to "not yet written this run" for the NEW book — the throttle is per-book, and a stale
    // timestamp from a previous book must not swallow this book's first write.
    lastWriteAtRef.current = 0;
    lastPausedPositionSecondsRef.current = null;

    void syncEngine
      .run()
      .then(() => progressStore.currentLocator(undefined, bookId))
      .then((locator) => {
        if (cancelled) return;
        const positionSeconds = locator?.type === 'AUDIO' ? locator.positionMs / 1000 : undefined;
        lastPausedPositionSecondsRef.current = positionSeconds ?? null;
        setResolved({ bookId, positionSeconds });
      });

    return () => {
      cancelled = true;
    };
  }, [bookId]);

  const writeProgress = useCallback(
    (positionSeconds: number) => {
      void progressStore.savePosition(
        { type: 'AUDIO', positionMs: Math.round(positionSeconds * 1000) },
        bookId,
      );
    },
    [bookId],
  );

  const handlePositionChange = useCallback(
    (positionSeconds: number) => {
      const now = Date.now();
      if (now - lastWriteAtRef.current < AUDIO_PROGRESS_WRITE_THROTTLE_MS) return;
      lastWriteAtRef.current = now;
      writeProgress(positionSeconds);
    },
    [writeProgress],
  );

  // The pause/seek/unmount edges: a tick may never arrive to report this position, so this bypasses
  // the throttle rather than waiting for it. Also the ONLY place `lastPausedPositionSecondsRef`
  // updates — see that ref's own comment for why tracking every tick would be the wrong signal.
  const handlePositionCommit = useCallback(
    (positionSeconds: number) => {
      lastPausedPositionSecondsRef.current = positionSeconds;
      lastWriteAtRef.current = Date.now();
      writeProgress(positionSeconds);
    },
    [writeProgress],
  );

  const resolveConflictJumpThere = useCallback(
    (locator: Locator & { type: 'AUDIO' }) => {
      // Cleared, not left stale: this resolves to a REMOUNT below, and nothing has reported a
      // fresh paused position for the new instance yet.
      lastPausedPositionSecondsRef.current = null;
      setResolved({ bookId, positionSeconds: locator.positionMs / 1000 });
      setResumeGeneration((generation) => generation + 1);
    },
    [bookId],
  );

  // The play-gate: see this file's header for why this replaces a background subscription for
  // AUDIO specifically. Runs a fresh sync + read on every Play press — cheap relative to the
  // alternative (playing from a position another device has already moved past) — and only
  // escalates past `CONFLICT_THRESHOLD_MS`.
  const handleBeforePlay = useCallback(async (): Promise<boolean> => {
    const displayedSeconds = lastPausedPositionSecondsRef.current;
    if (displayedSeconds === null) return true; // nothing paused-and-known yet to compare against

    await syncEngine.run();
    const incoming = await progressStore.currentLocator(undefined, bookId);
    if (incoming === null || incoming.type !== 'AUDIO') return true;

    const displayedMs = Math.round(displayedSeconds * 1000);
    const diffMs = Math.abs(incoming.positionMs - displayedMs);

    if (diffMs <= CONFLICT_THRESHOLD_MS) {
      // Last-write-wins, SILENTLY, for a difference too small to bother a listener over.
      // `incoming` is not a guess — the `syncEngine.run()` above already resolved local-vs-remote
      // for this exact row (`syncableTable.ts`'s own row-level LWW), so it IS the correct value;
      // the only thing left undone was updating THIS device's bookkeeping to match. Adopting it
      // here (rather than leaving `displayedSeconds` on record) is what makes the NEXT play-gate
      // check, and the NEXT write, compare against/build on the winning position instead of the
      // one that just lost. No reseek, no remount — a sub-5s difference is inaudible on resume,
      // so playback proceeds from wherever the player already sits paused.
      lastPausedPositionSecondsRef.current = incoming.positionMs / 1000;
      return true;
    }

    return new Promise<boolean>((resolve) => {
      Alert.alert(
        'Playback progress updated',
        'Your progress in this audiobook was updated on another device. Resume from there, or continue playing here?',
        [
          {
            text: 'Continue here',
            style: 'cancel',
            onPress: () => {
              // Re-confirms THIS device's position with a fresh, later timestamp, so it wins the
              // next comparison anywhere else this book syncs to — same reasoning as
              // ReaderRouteScreen.tsx's "Continue here".
              writeProgress(displayedSeconds);
              resolve(true);
            },
          },
          {
            text: 'Resume from there',
            onPress: () => {
              resolveConflictJumpThere(incoming);
              // The screen is about to remount at the adopted position — this specific Play press
              // targets a position that is going away, so it does not proceed.
              resolve(false);
            },
          },
        ],
      );
    });
  }, [bookId, writeProgress, resolveConflictJumpThere]);

  const positionReady = resolved?.bookId === bookId;

  if (!positionReady) {
    return (
      <View style={styles.container}>
        <ActivityIndicator style={styles.loadingIndicator} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <AudioPlayerScreen
        key={`${bookId}:${resumeGeneration}`}
        bookId={bookId}
        title={title}
        initialPosition={resolved.positionSeconds}
        onPositionChange={handlePositionChange}
        onPositionCommit={handlePositionCommit}
        onBeforePlay={handleBeforePlay}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
  loadingIndicator: { flex: 1, alignSelf: 'center' },
});
