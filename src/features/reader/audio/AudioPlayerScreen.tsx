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
// OWN SEEDING STEP, MIRRORING readerAssets.ts's prepareBook/getBookBase64 — NOT inherited from
// ReaderScreen. Since BookListScreen now routes AUDIO here instead of into the WebView reader (see
// that file's onPress), ReaderScreen's own ensureSeeded() call never runs for an audio book
// anymore. audioAssetResolver.resolveAudioAssetUri() requires the book to already be stored
// (openSession throws DECRYPTION_FAILED otherwise) — so this screen calls ensureSeeded() itself,
// the same TEMPORARY stand-in readerAssets.ts already depends on, before ever calling the
// resolver. It goes away on the same day devContentSeed.ts does (CLAUDE.md's scaffolding table),
// not before.
//
// RESOLVER, NOT A BUNDLED ASSET — this is the one thing that makes this the REAL player rather
// than a rerun of Phase 2's smoke test. No require(), no contentStore import, no aesGcm: this file
// depends on the audioAssetResolver.AudioAssetResolver INTERFACE only (see that file's own header
// on why), so swapping the stopgap for the Contracts-Gate accessor later is a wiring change in
// audioAssetResolver.ts alone.
//
// FORMAT-AGNOSTIC ON PURPOSE: nothing here assumes WAV. The resolved `file://` URI's container is
// whatever audioAssetResolver.ts decided (today: always .wav, a KNOWN, already-documented stopgap
// limitation — see that file's STOPGAP_AUDIO_EXTENSION comment). expo-audio's native decoders
// handle mp3/AAC/wav identically from this file's point of view.

import { useCallback, useEffect, useRef, useState } from 'react';

import { useAudioPlayerStatus } from 'expo-audio';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { ensureSeeded } from '@/features/reader/devContentSeed';
import type { BookId } from '@/shared/contracts';

import { audioAssetResolver } from './audioAssetResolver';
import { getAudioPlayerFor } from './audioPlayerInstance';

const SKIP_SECONDS = 15;
const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2] as const;

export interface AudioPlayerScreenProps {
  /** CALLERS MUST KEY ON bookId — same contract ReaderScreen.tsx states outright. This component
   * assumes it gets a fresh mount per bookId (AudioPlayerRouteScreen.tsx renders it with
   * `key={bookId}`) and does not reset its own state if `bookId` changes under an existing
   * instance; it relies on the remount instead. */
  bookId: BookId;
  title: string;
  /** Seconds into the track to resume at, or undefined for "start from the top." Read once on
   * mount — see AudioPlayerRouteScreen.tsx for where this comes from (session-only, this app run
   * only; see audioSessionProgress.ts). */
  initialPosition?: number;
  /** Called on every status tick once loaded, so the caller can keep a session-position cache
   * warm. Deliberately NOT this component's own concern where that goes — same boundary
   * ReaderScreen.tsx's onRelocated draws. */
  onPositionChange?: (positionSeconds: number) => void;
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

export function AudioPlayerScreen({
  bookId,
  title,
  initialPosition,
  onPositionChange,
}: AudioPlayerScreenProps): React.JSX.Element {
  const [uri, setUri] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const hasResumedRef = useRef(false);
  const hasSetLockScreenRef = useRef(false);

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
        // TEMPORARY stand-in for Download's real pass — see this file's own header note.
        await ensureSeeded(bookId);
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
        void player.seekTo(clamp(initialPosition, 0, status.duration || initialPosition));
      }
    }
  }, [status.isLoaded, status.duration, initialPosition, isNew, player]);

  // setActiveForLockScreen is PER-PLAYER (AudioModule.types.d.ts), not global — this is the one
  // place in the whole feature a real player for a real book exists, so this is where it belongs.
  // showSeekForward/showSeekBackward (not next/prev-track — this module has no such option for a
  // single AudioPlayer) is what keeps the lock screen's remote commands audiobook-appropriate.
  // Re-asserted every mount (including for a reused player) rather than only for `isNew`: harmless
  // if already active, and correctly reclaims lock-screen control if the smoke test or some other
  // player briefly took it in between.
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

  const skip = useCallback(
    (deltaSeconds: number) => {
      void player.seekTo(clamp(status.currentTime + deltaSeconds, 0, status.duration));
    },
    [player, status.currentTime, status.duration],
  );

  if (loadError) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorTitle}>Couldn&apos;t load this audiobook</Text>
        <Text style={styles.errorDetail}>
          {loadError instanceof Error ? loadError.message : String(loadError)}
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
      <Text style={styles.title} numberOfLines={2}>
        {title}
      </Text>

      <Scrubber
        positionSeconds={status.currentTime}
        durationSeconds={status.duration}
        onSeek={(seconds) => void player.seekTo(seconds)}
      />

      <View style={styles.transportRow}>
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
          accessibilityLabel={status.playing ? 'Pause' : 'Play'}
          onPress={() => (status.playing ? player.pause() : player.play())}
          style={[styles.transportButton, styles.playButton]}
        >
          <Text style={styles.playButtonLabel}>{status.playing ? 'Pause' : 'Play'}</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Skip forward ${SKIP_SECONDS} seconds`}
          onPress={() => skip(SKIP_SECONDS)}
          style={styles.transportButton}
        >
          <Text style={styles.transportButtonLabel}>+{SKIP_SECONDS}s</Text>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff', padding: 20, gap: 24 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 20 },
  loadingLabel: { fontSize: 15, color: '#555555' },
  errorTitle: { fontSize: 17, fontWeight: '600', color: '#b00020', textAlign: 'center' },
  errorDetail: { fontSize: 14, color: '#555555', textAlign: 'center' },
  title: { fontSize: 20, fontWeight: '700', color: '#111111', marginTop: 12 },
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
