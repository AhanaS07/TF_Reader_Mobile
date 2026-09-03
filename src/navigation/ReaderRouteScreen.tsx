// The Reader route: reads `{ bookId, format }` from navigation params and renders ReaderScreen,
// replacing App.tsx's old inline mount (`<ReaderScreen key={bookId} bookId={bookId} />`) plus its
// header-row DevPreferencesMenu. This screen owns no book-selection state of its own — native-stack
// gives it a fresh instance (and a working back button to BookList) per navigate() call, which is
// exactly what ReaderScreen's own "callers must key on bookId" contract asks for; here that key
// comes from being a distinct route push rather than a hand-written `key` prop.
//
// PROGRESS WIRING LIVES HERE, NOT IN ReaderScreen. `progressStore` (durable, synced, via
// `readerProgressStore.ts`'s conversions) is a navigation-session concern, and ReaderScreen's own
// `initialTarget`/`onRelocated` props are deliberately ignorant of where a target comes from or
// where a position goes — see their doc comments in ReaderScreen.tsx. Mirrors
// AudioPlayerRouteScreen.tsx's shape for AUDIO exactly now — see below for why an earlier version
// of this file did not.
//
// THERE IS NO IN-MEMORY SESSION CACHE HERE ANY MORE, ON PURPOSE. An earlier version kept one
// (`sessionProgress.ts`, since deleted) as a same-app-run fast path, reasoning that `progressStore`
// was only needed as a cold-start/cross-device fallback. That was wrong for a reason worth stating
// so it doesn't come back: the cache had no way to learn about a fresher position written
// elsewhere — another device syncing in a further-along position while this book sat merely
// BACKGROUNDED (not relaunched) on this one — so a stale in-memory value could outrank the
// genuinely current row in `progressStore` for the rest of this app run. `progressStore` is the
// only source of truth now, matching AUDIO, at the cost of always paying its async read (and
// showing the loading gate below) rather than only on a cold start.
//
// AND THE LOCAL `progressStore` ROW ITSELF CAN BE STALE, WHICH IS WHY THE RESOLVE EFFECT BELOW
// ALSO CALLS `syncEngine.run()` FIRST. `src/features/sync/useAutoSync.ts` (mounted once, at the
// app root) only re-syncs on an actual NetInfo offline->online EDGE — backgrounding and
// foregrounding the app while the connection never actually drops (the common case) fires no such
// edge, so nothing pulls in a position another device wrote while this device was merely
// backgrounded. Awaiting `syncEngine.run()` here — before reading `currentLocator()`, not before
// rendering unconditionally — closes that gap at the one moment it actually matters: resolving a
// resume target. `syncEngine.run()` is public exactly for this (concurrent calls share one run
// rather than racing, so this costs nothing extra if `useAutoSync`'s own trigger already has one
// in flight) and never rejects (`execute()` catches internally), so no `.catch()` is needed. This
// calls `src/features/sync/`'s existing public API rather than changing anything inside it, but it
// is a new coupling Karthik should know about — noted in CLAUDE.md's "Reading-position resume"
// section rather than left to be discovered from a git blame.
//
// SCOPED TO RESOLVING A RESUME TARGET, DELIBERATELY NOT TO AN ALREADY-OPEN SCREEN. If this screen
// stays mounted across a background/foreground cycle (the reader never navigated away), nothing
// re-checks `progressStore` mid-session — the resolve effect only reruns on a `bookId`/`routeTarget`
// change. Silently yanking an active reader to a position synced from another device while they
// might already be several pages past it would be its own defect; the fix here is "the NEXT time
// this book is opened resumes correctly," not "two devices reading the same book stay converged
// live." A future cross-device nudge (a non-blocking "also read to page N elsewhere" affordance,
// the way most reading apps handle this) is a product decision, not something to do silently here.
//
// DevPreferencesMenu GOES THROUGH `toolbarExtra`, NOT a sibling overlay. Two earlier shapes each
// broke something: `headerRight` got clipped by react-native-screens' native header (no visible
// dropdown), and a same-tree absolutely-positioned overlay landed on top of — and ate touches for —
// ReaderScreen's own right-aligned toolbar (search/TTS), since both anchored to the same corner.
// Passing it INTO ReaderScreen's own toolbar row is what makes "share one row, preferences
// rightmost" a layout guarantee instead of two files' pixel math staying in sync by luck.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ActivityIndicator, AppState, StyleSheet, View } from 'react-native';

import type { ReaderPosition, ReaderTarget } from '@/features/reader/readerBridge';
import { ReaderScreen } from '@/features/reader/ReaderScreen';
import { targetFromLocator, toLocator } from '@/features/reader/readerProgressStore';
import { syncEngine } from '@/features/sync/syncEngine';
import { progressStore } from '@/features/sync/stores/progressStore';
import type { BookId } from '@/shared/contracts';

import { DevPreferencesMenu } from '../../DevPreferencesMenu';
import type { RootStackParamList } from './RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Reader'>;

// Reading is user-paced far below AUDIO's 250ms tick rate, but PDF's scroll-mode `virtualize()`
// (pdf.entry.ts) posts `relocated` on every rAF during a continuous drag — unthrottled writes there
// would be dozens of SQLite writes a second for a value nobody reads until the next launch or
// another device pulls it. 3s keeps it well under 1/s while still landing well inside a reader's
// dwell time on any position that matters.
const READER_PROGRESS_WRITE_THROTTLE_MS = 3_000;

export function ReaderRouteScreen({ route, navigation }: Props): React.JSX.Element {
  const { bookId, format, initialTarget: routeTarget } = route.params;

  // Title only. DevPreferencesMenu is NOT headerRight — see this file's header note for why.
  useLayoutEffect(() => {
    navigation.setOptions({ title: format });
  }, [navigation, format]);

  // Tagged with the bookId it resolved for, so a resolution in flight for a PREVIOUS book cannot
  // leak into this book's initialTarget — this screen persists across bookId param changes (see
  // ReaderScreen's own `key={bookId}` below), it does not remount. Same race-guard
  // AudioPlayerRouteScreen.tsx uses for its own `progressStore.currentLocator()` call, and the same
  // reason: setting state synchronously at the top of the effect body, before the query resolves,
  // is exactly what this repo's `react-hooks/set-state-in-effect` lint rule forbids.
  const [resolved, setResolved] = useState<{ bookId: BookId; target?: ReaderTarget } | null>(null);

  useEffect(() => {
    let cancelled = false;
    // A caller-supplied target (e.g. a tapped bookmark elsewhere in the app) is a deliberate
    // "go here" instruction, not a fallback to query around — skip the read entirely, but still
    // resolve it through a `.then()` rather than synchronously: `setState` directly in an effect
    // body is exactly what this repo's `react-hooks/set-state-in-effect` lint rule forbids, and
    // routing both branches through the same microtask keeps this one function, not two shapes.
    const target: Promise<ReaderTarget | undefined> =
      routeTarget !== undefined
        ? Promise.resolve(routeTarget)
        : syncEngine
            .run()
            .then(() => progressStore.currentLocator(undefined, bookId))
            .then((locator) => targetFromLocator(locator) ?? undefined);
    void target.then((resolvedTarget) => {
      if (cancelled) return;
      setResolved({ bookId, target: resolvedTarget });
    });
    return () => {
      cancelled = true;
    };
  }, [bookId, routeTarget]);

  const resolvedReady = resolved?.bookId === bookId;

  // The latest position, tracked outside React state so the throttle/flush logic below can read it
  // without re-rendering on every relocate.
  const lastPositionRef = useRef<ReaderPosition | null>(null);
  const lastWriteAtRef = useRef(0);

  const flushProgress = useCallback(() => {
    const position = lastPositionRef.current;
    if (position === null) return;
    const locator = toLocator(position);
    if (locator === null) return; // an EPUB `relocated` before its rendition produced a CFI
    void progressStore.savePosition(locator, bookId);
  }, [bookId]);

  const handleRelocated = useCallback(
    (position: ReaderPosition) => {
      lastPositionRef.current = position;
      const now = Date.now();
      if (now - lastWriteAtRef.current < READER_PROGRESS_WRITE_THROTTLE_MS) return;
      lastWriteAtRef.current = now;
      flushProgress();
    },
    [flushProgress],
  );

  // Resets the throttle for a new book — a stale timestamp from a previous book must not swallow
  // this book's first write — and flushes on the way out, covering both a genuine unmount (normal
  // back-navigation) and a bookId change on this same persistent instance (switching books without
  // this screen itself being torn down).
  useEffect(() => {
    lastWriteAtRef.current = 0;
    lastPositionRef.current = null;
    return () => {
      flushProgress();
    };
  }, [bookId, flushProgress]);

  // The backgrounding edge: catches a position recorded inside the current throttle window before
  // a possible force-quit. Text position cannot change once backgrounded, so — unlike
  // audioPlayerInstance.ts's equivalent — there is no "still playing" case to keep tracking, and no
  // reason to host this in a separate singleton module reachable after this screen is gone.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') flushProgress();
    });
    return () => subscription.remove();
  }, [flushProgress]);

  if (!resolvedReady) {
    return (
      <View style={styles.container}>
        <ActivityIndicator style={styles.loadingIndicator} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ReaderScreen
        key={bookId}
        bookId={bookId}
        initialTarget={resolved.target}
        onRelocated={handleRelocated}
        toolbarExtra={<DevPreferencesMenu format={format} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
  loadingIndicator: { flex: 1, alignSelf: 'center' },
});
