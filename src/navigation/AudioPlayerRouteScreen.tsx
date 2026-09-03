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
// `ReaderRouteScreen.tsx`'s equivalent effect for EPUB/PDF — see that file's header for the fuller
// account, including why this is scoped to resolving a resume target and not to an already-open
// screen.

import { useCallback, useEffect, useRef, useState } from 'react';

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AudioPlayerScreen } from '@/features/reader/audio/AudioPlayerScreen';
import { syncEngine } from '@/features/sync/syncEngine';
import { progressStore } from '@/features/sync/stores/progressStore';

import type { RootStackParamList } from './RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'AudioPlayer'>;

// Ticks arrive every 250ms (audioPlayerInstance.ts's updateInterval). Writing to SQLite (and
// enqueueing an outbox row) on each one would be ~4 writes a second for a value nobody reads until
// the next launch or another device pulls it. The throttle only gates onPositionChange — the
// pause/seek/unmount edge (onPositionCommit) always writes through immediately, same as before.
const AUDIO_PROGRESS_WRITE_THROTTLE_MS = 5_000;

export function AudioPlayerRouteScreen({ route }: Props): React.JSX.Element {
  const { bookId, title } = route.params;

  const [resolved, setResolved] = useState<{ bookId: string; positionSeconds?: number } | null>(
    null,
  );
  const lastWriteAtRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    // Reset to "not yet written this run" for the NEW book — the throttle is per-book, and a stale
    // timestamp from a previous book must not swallow this book's first write.
    lastWriteAtRef.current = 0;

    void syncEngine
      .run()
      .then(() => progressStore.currentLocator(undefined, bookId))
      .then((locator) => {
        if (cancelled) return;
        setResolved({
          bookId,
          positionSeconds: locator?.type === 'AUDIO' ? locator.positionMs / 1000 : undefined,
        });
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
  // the throttle rather than waiting for it.
  const handlePositionCommit = useCallback(
    (positionSeconds: number) => {
      lastWriteAtRef.current = Date.now();
      writeProgress(positionSeconds);
    },
    [writeProgress],
  );

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
        key={bookId}
        bookId={bookId}
        title={title}
        initialPosition={resolved.positionSeconds}
        onPositionChange={handlePositionChange}
        onPositionCommit={handlePositionCommit}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
  loadingIndicator: { flex: 1, alignSelf: 'center' },
});
