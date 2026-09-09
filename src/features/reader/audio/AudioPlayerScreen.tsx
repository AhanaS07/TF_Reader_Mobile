// Owner: Reader (Ahana).
//
// AUDIO PHASE 3 (see AUDIO_PLAYER_DECISION.md and AUDIO_PHASE0_FINDINGS.md for the earlier
// phases this builds on). The real audiobook player — single file, standard transport
// (play/pause, scrubber, speed, skip ±15s). Deliberately NOT a mode of ReaderScreen and does NOT
// import readerBridge/anything WebView-shaped: audio has no WebView, by contract design
// (WEBVIEW_BRIDGE.md's own "targets/positions discriminated by addressing scheme, not by format"
// section explains why AUDIO was designed OUT of that surface, not just left off it by omission).
//
// PLAIN PROPS, NO NAVIGATION DEPENDENCY — same boundary ReaderScreen.tsx already draws ("ignorant
// of where a target comes from or where a position goes"). The navigation-owned
// AudioPlayerRouteScreen.tsx (src/navigation/) reads route params and session position, and hands
// this component plain values; this component doesn't know react-navigation exists. Keeping that
// split is what makes this component testable without navigation test scaffolding, same reason
// ReaderScreen.test.tsx doesn't need one either.
//
// NO SEEDING STEP, AND NO ACQUISITION STEP EITHER. This screen used to call `ensureSeeded()` before
// resolving, because the resolver assumed the book was already stored. It is not that any more: the
// audio dev seed was deleted on 2026-08-25 and `audioAssetResolver` acquires from the backend
// itself, through `openBook()` — the same licence gate `BookListScreen` runs for EPUB/PDF, serving
// the downloaded and the streaming cases through one call. Everything this screen has to know about
// that is contained in "await a URI, or render the error".
//
// RESOLVER, NOT A BUNDLED ASSET — this is the one thing that makes this the REAL player rather
// than a rerun of Phase 2's smoke test. No require(), no contentStore import, no aesGcm: this file
// depends on the audioAssetResolver.AudioAssetResolver INTERFACE only (see that file's own header
// on why), so how a URI gets produced can change without this file changing — a property already
// proven once, when the player library was swapped underneath it (AUDIO_PLAYER_DECISION.md Part 1).
// A wiring change in audioAssetResolver.ts alone.
//
// FORMAT-AGNOSTIC ON PURPOSE: nothing here assumes WAV. The resolved `file://` URI's container is
// whatever audioAssetResolver.ts decided (today: always .wav, a KNOWN limitation documented at that
// file's AUDIO_EXTENSION constant). expo-audio's native decoders handle mp3/AAC/wav identically from
// this file's point of view.

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

import { useAudioPlayerStatus } from 'expo-audio';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useContentLock } from '@/features/reader/useContentLock';
import { formatDiagnosticErrorMessage } from '@/shared/contracts';
import type { BookId } from '@/shared/contracts';

import { audioAssetResolver } from './audioAssetResolver';
import { getAudioPlayerFor } from './audioPlayerInstance';
import { AudioQueueModal } from './AudioQueueModal';
import {
  jumpToQueueIndex,
  skipToNextTrack,
  skipToPreviousTrack,
} from './audioQueueCoordinator';
import { useAudioQueueStore } from './audioQueueStore';
import { stopActiveTts } from './audioTtsCoordinator';
import { ensureAudioModeConfigured } from './useAudioPlayerSetup';

const SKIP_SECONDS = 15;
const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2] as const;
/** End-of-track tolerance (seconds). If the player is within this threshold of duration when play
 * is pressed, restart from the beginning instead of no-oping. */
const TRACK_END_EPSILON_SECONDS = 0.5;

/**
 * The one thing a caller may need to reach into this screen for from the outside: checking whether
 * playback is live and pausing it — currently only `AudioPlayerRouteScreen.tsx`'s live cross-device
 * conflict check (see that file's header). Reads straight off the native `player` object rather than
 * the `status` returned by `useAudioPlayerStatus`, deliberately: `status` only updates on this
 * component's own render cycle (a ~250ms tick), so a caller reading through it could act on a value
 * that is already stale by the time the caller's own async work (a sync round trip) finishes. `player`
 * is a stable, always-current native handle — reading it fresh at call time is what makes the
 * conflict check correct where a naive live subscription previously wasn't (see
 * AudioPlayerRouteScreen.tsx's own account of that history).
 */
export interface AudioPlayerScreenHandle {
  /** A fresh read of the player's own state, not a snapshot from the last render. */
  isPlaying(): boolean;
  /** A fresh read of the player's own position, in seconds. */
  currentPositionSeconds(): number;
  /** Pauses and commits the position it paused at (via `onPositionCommit`). No-op if already paused. */
  pause(): void;
}

export interface AudioPlayerScreenProps {
  /** CALLERS MUST KEY ON bookId — same contract ReaderScreen.tsx states outright. This component
   * assumes it gets a fresh mount per bookId (AudioPlayerRouteScreen.tsx renders it with
   * `key={bookId}`) and does not reset its own state if `bookId` changes under an existing
   * instance; it relies on the remount instead. */
  bookId: BookId;
  title: string;
  /** Seconds into the track to resume at, or undefined for "start from the top." Read once on
   * mount — see AudioPlayerRouteScreen.tsx for where this comes from. */
  initialPosition?: number;
  /** Called on every status tick once loaded, so the caller can keep a position cache warm.
   * Deliberately NOT this component's own concern where that goes — same boundary
   * ReaderScreen.tsx's onRelocated draws. */
  onPositionChange?: (positionSeconds: number) => void;
  /** AUDIO PHASE 4. Called at the edges where the next tick may never come — pause, seek, and
   * unmount — meaning "this position is worth committing NOW, don't let it sit in a throttle."
   * Separate from onPositionChange rather than folded into it precisely because the distinction is
   * about URGENCY, not about a different value: a caller that persists nothing can ignore it, and
   * this component still does not know whether anything is persisted at all. */
  onPositionCommit?: (positionSeconds: number) => void;
  /**
   * A gate the Play button awaits before actually starting playback — resolve `true` to proceed,
   * `false` to refuse. This component has no opinion on WHY a caller would refuse (a cross-device
   * progress conflict, today) — only that pressing Play can be made to wait on an async check
   * first, the same "ignorant of where it goes" boundary `onPositionCommit` already draws. Omit it
   * and Play always proceeds immediately, unchanged from before this prop existed. The button
   * disables itself while the returned promise is pending, so a caller with a slow check (a sync
   * round trip) does not race a second tap into a second concurrent check.
   */
  onBeforePlay?: () => Promise<boolean>;
}

function formatTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00';
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** A tap/drag progress bar — no slider dependency added for this. Plain onTouchStart/onTouchMove
 * handlers rather than PanResponder: PanResponder.create() itself trips this repo's
 * react-hooks/refs lint rule (it holds ref-like state internally, which the rule flags regardless
 * of whether the call site wraps it in useMemo) — onTouchStart/onTouchMove are ordinary prop-level
 * event handlers with no ref involved, and are simpler for a single-axis tap/drag bar besides. */
function Scrubber({
  positionSeconds,
  durationSeconds,
  onSeek,
}: {
  positionSeconds: number;
  durationSeconds: number;
  onSeek: (seconds: number) => void;
}): React.JSX.Element {
  const [trackWidth, setTrackWidth] = useState(0);

  const seekFromLocationX = useCallback(
    (locationX: number) => {
      if (trackWidth <= 0 || durationSeconds <= 0) return;
      const fraction = clamp(locationX / trackWidth, 0, 1);
      onSeek(fraction * durationSeconds);
    },
    [trackWidth, durationSeconds, onSeek],
  );

  const fraction = durationSeconds > 0 ? clamp(positionSeconds / durationSeconds, 0, 1) : 0;

  return (
    <View style={styles.scrubberRow}>
      <Text style={styles.timeLabel}>{formatTime(positionSeconds)}</Text>
      <View
        style={styles.scrubberTrack}
        onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
        onTouchStart={(event) => seekFromLocationX(event.nativeEvent.locationX)}
        onTouchMove={(event) => seekFromLocationX(event.nativeEvent.locationX)}
      >
        <View style={styles.scrubberBackground} />
        <View style={[styles.scrubberFill, { width: `${fraction * 100}%` }]} />
      </View>
      <Text style={styles.timeLabel}>{formatTime(durationSeconds)}</Text>
    </View>
  );
}

function AudioPlayerScreenComponent(
  { bookId, title, initialPosition, onPositionChange, onPositionCommit, onBeforePlay }: AudioPlayerScreenProps,
  ref: React.ForwardedRef<AudioPlayerScreenHandle>,
): React.JSX.Element {
  const [uri, setUri] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const hasResumedRef = useRef(false);
  const hasSetLockScreenRef = useRef(false);
  const [queueModalVisible, setQueueModalVisible] = useState(false);

  const hasNext = useAudioQueueStore((s) => s.hasNext());
  const hasPrevious = useAudioQueueStore((s) => s.hasPrevious());
  const queueLength = useAudioQueueStore((s) => s.items.length);

  /**
   * Sync's `content.lock` bus signal for THIS book, rendered — the visible half of the
   * offline-lock gating hook on the audio side. The TEARDOWN half already exists and runs
   * regardless of whether this screen is even mounted: `audioScratchReclaimer.ts`'s own
   * `handleLock` subscribes globally, releases the player if this book is the one playing, and
   * deletes its scratch file. What was missing before this hook is only the visible state — the
   * player just went dead with nothing on screen to say why. No `lockedRef` needed here, unlike
   * ReaderScreen: there is no in-flight decrypt-then-send-to-a-WebView race on this screen for a
   * lock to win — `resolveAudioAssetUri` either already returned a URI (and the reclaimer just
   * released the player under it) or it is still awaiting `openBook()`'s own licence gate, which
   * a revoked book fails on its own terms.
   */
  const { lock } = useContentLock(bookId);

  // No reset-state-on-bookId-change logic here, deliberately: this effect's own deps array is
  // `[bookId]`, but per this component's own contract (see the `bookId` prop doc above) a real
  // bookId change never happens to an already-mounted instance — the caller remounts via
  // `key={bookId}` instead, which resets every useState/useRef here for free. Synchronously
  // calling setState at the top of an effect body (to simulate that reset) is exactly what this
  // repo's react-hooks lint config flags, and it would be solving a problem that key={bookId}
  // already solves upstream.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        // ORDERING, not setup: the global audio session must already be `.playback` before this
        // screen claims the lock screen further down. Gating the URI on it transitively gates
        // `status.isLoaded` — and so `setActiveForLockScreen` — without a second async effect.
        // Rejection is swallowed on purpose: useAudioPlayerSetup already logs it, and a failed
        // audio-mode call must not turn into "couldn't load this audiobook" when playback itself
        // would still work.
        await ensureAudioModeConfigured().catch(() => undefined);
        // NO ensureSeeded() ANY MORE. The audio dev seed was deleted on 2026-08-25; the resolver
        // acquires from the backend through openBook() instead, which serves the downloaded and the
        // streaming cases alike. That call is also the licence gate, so a revoked or unentitled
        // audiobook now fails HERE, into `loadError` below, rather than playing from a local seed.
        const resolvedUri = await audioAssetResolver.resolveAudioAssetUri(bookId);
        if (!cancelled) setUri(resolvedUri);
      } catch (error) {
        if (!cancelled) setLoadError(error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bookId]);

  // A MODULE-LEVEL SINGLETON, NOT `useAudioPlayer` — REAL-DEVICE FIX. `useAudioPlayer` (the hook)
  // auto-releases its player the moment the component that called it unmounts, which is exactly
  // backwards for background playback: navigating back to BookList while a book plays must NOT
  // tear down the native player. The first version of this file used `useAudioPlayer` and hit
  // this two ways — a crash (`ERR_NATIVE_SHARED_OBJECT_NOT_FOUND`, this file's own cleanup calling
  // a method on an already-released player) that was a symptom, and the real bug underneath it
  // (background playback silently stopping on every "back" navigation) that the crash was masking.
  // getAudioPlayerFor (audioPlayerInstance.ts) uses `createAudioPlayer` — expo-audio's own
  // "doesn't release automatically" variant — and hands back the SAME player across remounts for
  // the same bookId, so leaving and returning to a still-playing book reconnects to it instead of
  // restarting it.
  //
  // useState(() => ...), not useMemo: this must run EXACTLY ONCE per mount and its result must
  // never be silently recomputed — React does not guarantee useMemo never discards a cached value,
  // and recomputing this one would mean re-running getAudioPlayerFor's "is this the same book"
  // check against a fresh call, which is not what "compute once per mount" needs here.
  const [{ player, isNew }] = useState(() => getAudioPlayerFor(bookId));
  const status = useAudioPlayerStatus(player);

  // `isNew` gates this — NOT just `uri !== null` — REAL-DEVICE BUG. Every reopen of this screen is
  // a fresh AudioPlayerScreen instance (a new navigation push), so `uri` always starts at `null`
  // and resolves again, even when getAudioPlayerFor returned the SAME, already-playing player.
  // Calling `player.replace(uri)` unconditionally meant reopening a still-playing book replaced
  // its own source with itself — which reloads it from position 0, exactly like restarting it,
  // confirmed on a real device. A reused player already has the right source loaded; there is
  // nothing to replace.
  useEffect(() => {
    if (uri !== null && isNew) {
      player.replace(uri);
    }
  }, [uri, player, isNew]);

  // Resume ONCE, the first time the player finishes loading the resolved source — guarded by a
  // ref, not a status field, because `status.isLoaded` stays true on every later tick and this
  // must fire exactly once, not every render. `isNew` matters just as much as the ref: reopening a
  // book whose player was already running (isNew: false) must NOT seek to a stale
  // `initialPosition` on top of wherever it has actually gotten to while this screen was away.
  useEffect(() => {
    if (status.isLoaded && !hasResumedRef.current) {
      hasResumedRef.current = true;
      if (isNew && initialPosition && initialPosition > 0) {
        const target =
          status.duration > 0 && initialPosition >= status.duration - 2
            ? 0
            : clamp(initialPosition, 0, status.duration || initialPosition);
        if (target > 0) {
          void player.seekTo(target);
        }
      }
    }
  }, [status.isLoaded, status.duration, initialPosition, isNew, player]);

  // setActiveForLockScreen is PER-PLAYER (AudioModule.types.d.ts), not global — this is the one
  // place in the whole feature a real player for a real book exists, so this is where it belongs.
  // showSeekForward/showSeekBackward (not next/prev-track — this module has no such option for a
  // single AudioPlayer) is what keeps the lock screen's remote commands audiobook-appropriate.
  // Re-asserted every mount (including for a reused player) rather than only for `isNew`: harmless
  // if already active, and correctly reclaims lock-screen control if another player took it in
  // between. audioPlayerInstance.ts is the only thing in this app that constructs a player, so
  // "another player" today means only the one a previous book left behind — releasing that one
  // calls setActivePlayer(nil) natively (AudioPlayer.sharedObjectWillRelease), which clears the
  // card, so re-claiming here is what puts it back.
  useEffect(() => {
    if (status.isLoaded && !hasSetLockScreenRef.current) {
      hasSetLockScreenRef.current = true;
      player.setActiveForLockScreen(
        true,
        { title, artist: 'TF Reader' },
        { showSeekForward: true, showSeekBackward: true },
      );
    }
  }, [status.isLoaded, player, title]);

  // NO clearLockScreenControls()/remove() ON UNMOUNT, DELIBERATELY. The player is owned by
  // audioPlayerInstance.ts, not by this component — unmounting this screen (navigating back) must
  // leave a still-playing book's audio session and lock-screen Now Playing info exactly as they
  // were. Clearing them here would silence the Now Playing display and undo
  // setActiveForLockScreen the instant the user left the screen, which is precisely the behavior
  // this whole singleton exists to prevent. There is deliberately no "stop and release" path in
  // this phase's scope (single-file playback, no queue) — the player lives until a DIFFERENT book
  // is opened (audioPlayerInstance.ts releases the old one then) or the app process ends.

  useEffect(() => {
    if (status.isLoaded) {
      onPositionChange?.(status.currentTime);
    }
  }, [status.isLoaded, status.currentTime, onPositionChange]);

  // AUDIO PHASE 4. Held in a ref so the unmount effect below can stay `[player]`-scoped: reading
  // the prop directly would put `onPositionCommit` in that effect's deps, and a caller passing an
  // inline arrow would then re-run its CLEANUP on every render — committing a position (and, one
  // layer down, writing a file) on renders where nothing was unmounted at all.
  // Synced in an effect, not assigned during render: this repo's react-hooks/refs rule rejects
  // touching `.current` in a render body outright.
  const positionCommitRef = useRef(onPositionCommit);
  useEffect(() => {
    positionCommitRef.current = onPositionCommit;
  }, [onPositionCommit]);

  /** The pause/seek/unmount edges: a tick may never arrive to report this position. */
  const commitPosition = useCallback((positionSeconds: number) => {
    positionCommitRef.current?.(positionSeconds);
  }, []);

  // See `AudioPlayerScreenHandle`'s own doc comment for why this reads `player` directly rather
  // than `status`. `[player, commitPosition]` is a stable dep list — `player` is the module-level
  // singleton (`useState(() => ...)`, never reassigned) and `commitPosition` has its own empty dep
  // array — so this handle is built once per mount, not rebuilt on every tick.
  useImperativeHandle(
    ref,
    () => ({
      isPlaying: () => player.playing,
      currentPositionSeconds: () => player.currentTime,
      pause: () => {
        if (!player.playing) return;
        player.pause();
        commitPosition(player.currentTime);
      },
    }),
    [player, commitPosition],
  );

  // Same ref-indirection reasoning as positionCommitRef above, applied to onBeforePlay.
  const beforePlayRef = useRef(onBeforePlay);
  useEffect(() => {
    beforePlayRef.current = onBeforePlay;
  }, [onBeforePlay]);

  // Disables the Play button for the DURATION of the gate check, not just until it starts — a
  // caller with a slow check (a sync round trip) would otherwise let a second tap start a second,
  // overlapping check. `false` mid-check would be indistinguishable from "check hasn't run yet",
  // which is why this is its own state rather than derived from `status.playing`.
  const [playCheckPending, setPlayCheckPending] = useState(false);

  const beginPlayback = useCallback(async () => {
    if (playCheckPending) return;
    setPlayCheckPending(true);
    try {
      const allowed = (await beforePlayRef.current?.()) ?? true;
      if (allowed) {
        // AUDIO SESSION CONCURRENCY: Only one audio stream runs at a time.
        // Stop any active TTS speech before audiobook playback begins.
        stopActiveTts();

        // Re-assert audio session configuration in case TTS modified AVAudioSession mode/options.
        await ensureAudioModeConfigured(true);

        // At end of track the position is already duration, so play() is a no-op.
        // Reads from the PLAYER, not `status`: `status` can be up to one 250ms tick stale
        // (the same reasoning the unmount-commit effect already documents).
        if (
          player.duration > 0 &&
          player.currentTime >= player.duration - TRACK_END_EPSILON_SECONDS
        ) {
          await player.seekTo(0);
          commitPosition(0);
        }
        player.play();
      }
    } finally {
      setPlayCheckPending(false);
    }
  }, [commitPosition, playCheckPending, player]);

  // Commit on unmount — navigating back to BookList. Reads the PLAYER, not `status`: this runs
  // during teardown, where the last rendered status can be up to one tick (250ms) stale, and the
  // player is the singleton that outlives this component anyway.
  useEffect(() => {
    return () => {
      if (player.isLoaded) {
        positionCommitRef.current?.(player.currentTime);
      }
    };
  }, [player]);

  const skip = useCallback(
    (deltaSeconds: number) => {
      const target = clamp(status.currentTime + deltaSeconds, 0, status.duration);
      void player.seekTo(target);
      commitPosition(target);
    },
    [player, status.currentTime, status.duration, commitPosition],
  );

  // CHECKED BEFORE `loadError`, and with its OWN heading — not the generic one below. "Couldn't
  // load this audiobook" is the right words for a corrupt file or a network failure; it is the
  // wrong words for "your access to this book ended", the same distinction Contract ask 4 (to
  // Abhinav) names for the cold-open case. `formatDiagnosticErrorMessage(lock)` still renders the
  // CODE (`CONTENT_LOCKED: …`) — only the heading above it needs to say something different.
  if (lock !== null) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorTitle}>Access to this book ended</Text>
        <Text style={styles.errorDetail}>{formatDiagnosticErrorMessage(lock)}</Text>
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorTitle}>Couldn&apos;t load this audiobook</Text>
        <Text style={styles.errorDetail}>
          {formatDiagnosticErrorMessage(loadError)}
        </Text>
      </View>
    );
  }

  if (!status.isLoaded) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
        <Text style={styles.loadingLabel}>Loading {title}…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open queue, ${queueLength} track${queueLength === 1 ? '' : 's'}`}
          onPress={() => setQueueModalVisible(true)}
          style={styles.queueButton}
        >
          <Text style={styles.queueButtonLabel}>
            Queue {queueLength > 0 ? `(${queueLength})` : ''}
          </Text>
        </Pressable>
      </View>

      <Scrubber
        positionSeconds={status.currentTime}
        durationSeconds={status.duration}
        onSeek={(seconds) => {
          void player.seekTo(seconds);
          commitPosition(seconds);
        }}
      />

      <View style={styles.transportRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous track"
          disabled={!hasPrevious && status.currentTime <= 3.0}
          onPress={() => void skipToPreviousTrack(status.currentTime)}
          style={[
            styles.transportButton,
            styles.trackNavButton,
            !hasPrevious && status.currentTime <= 3.0 && styles.transportButtonDisabled,
          ]}
        >
          <Text
            style={[
              styles.transportButtonLabel,
              styles.trackNavIcon,
              !hasPrevious && status.currentTime <= 3.0 && styles.transportButtonLabelDisabled,
            ]}
          >
            |◀◀
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Skip back ${SKIP_SECONDS} seconds`}
          onPress={() => skip(-SKIP_SECONDS)}
          style={styles.transportButton}
        >
          <Text style={styles.transportButtonLabel}>-{SKIP_SECONDS}s</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            status.playing ? 'Pause' : playCheckPending ? 'Checking progress' : 'Play'
          }
          disabled={playCheckPending}
          onPress={() => {
            if (status.playing) {
              player.pause();
              // Pause is the edge most likely to be followed by nothing at all — no further ticks,
              // and possibly no further foreground time before the OS reclaims the process.
              commitPosition(status.currentTime);
            } else {
              void beginPlayback();
            }
          }}
          style={[styles.transportButton, styles.playButton]}
        >
          <Text style={styles.playButtonLabel}>
            {status.playing ? 'Pause' : playCheckPending ? 'Checking…' : 'Play'}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Skip forward ${SKIP_SECONDS} seconds`}
          onPress={() => skip(SKIP_SECONDS)}
          style={styles.transportButton}
        >
          <Text style={styles.transportButtonLabel}>+{SKIP_SECONDS}s</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next track"
          disabled={!hasNext}
          onPress={() => void skipToNextTrack()}
          style={[
            styles.transportButton,
            styles.trackNavButton,
            !hasNext && styles.transportButtonDisabled,
          ]}
        >
          <Text
            style={[
              styles.transportButtonLabel,
              styles.trackNavIcon,
              !hasNext && styles.transportButtonLabelDisabled,
            ]}
          >
            ▶▶|
          </Text>
        </Pressable>
      </View>

      <View style={styles.rateRow}>
        {PLAYBACK_RATES.map((rate) => (
          <Pressable
            key={rate}
            accessibilityRole="button"
            accessibilityLabel={`Playback speed ${rate}x`}
            onPress={() => player.setPlaybackRate(rate)}
            style={[styles.rateButton, status.playbackRate === rate && styles.rateButtonActive]}
          >
            <Text
              style={[styles.rateButtonLabel, status.playbackRate === rate && styles.rateButtonLabelActive]}
            >
              {rate}x
            </Text>
          </Pressable>
        ))}
      </View>

      <AudioQueueModal
        visible={queueModalVisible}
        onClose={() => setQueueModalVisible(false)}
        onSelectTrack={(idx) => void jumpToQueueIndex(idx)}
      />
    </View>
  );
}

// `forwardRef` only for `AudioPlayerScreenHandle` — see that type's own doc comment. Every existing
// caller keeps working unchanged: a `ref` prop is simply optional on a forwardRef component.
export const AudioPlayerScreen = forwardRef(AudioPlayerScreenComponent);
AudioPlayerScreen.displayName = 'AudioPlayerScreen';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff', padding: 20, gap: 24 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 20 },
  loadingLabel: { fontSize: 15, color: '#555555' },
  errorTitle: { fontSize: 17, fontWeight: '600', color: '#b00020', textAlign: 'center' },
  errorDetail: { fontSize: 14, color: '#555555', textAlign: 'center' },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
  },
  title: { fontSize: 20, fontWeight: '700', color: '#111111', flex: 1, marginRight: 12 },
  queueButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#f3f4f6',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  queueButtonLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
  },
  scrubberRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  timeLabel: { fontSize: 12, color: '#555555', width: 40, textAlign: 'center' },
  scrubberTrack: {
    flex: 1,
    height: 28,
    justifyContent: 'center',
  },
  scrubberBackground: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#e2e2e2',
  },
  scrubberFill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: '#111111',
  },
  transportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  transportButton: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 24,
    backgroundColor: '#f0f0f0',
  },
  transportButtonLabel: { fontSize: 15, fontWeight: '600', color: '#111111' },
  trackNavButton: {
    paddingHorizontal: 12,
  },
  trackNavIcon: {
    fontSize: 12,
    fontWeight: '700',
  },
  transportButtonDisabled: {
    opacity: 0.35,
  },
  transportButtonLabelDisabled: {
    color: '#9ca3af',
  },
  playButton: { backgroundColor: '#111111', minWidth: 96, alignItems: 'center' },
  playButtonLabel: { fontSize: 15, fontWeight: '700', color: '#ffffff' },
  rateRow: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  rateButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#cccccc',
  },
  rateButtonActive: { backgroundColor: '#111111', borderColor: '#111111' },
  rateButtonLabel: { fontSize: 13, fontWeight: '600', color: '#111111' },
  rateButtonLabelActive: { color: '#ffffff' },
});
