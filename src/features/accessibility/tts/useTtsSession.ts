// Owner: Accessibility (Hruthik).
//
// The TTS session: walks a ReaderTextProvider one sentence at a time and drives the native TTS
// engine to speak it. Everything this file does is a direct consequence of the seam Reader
// (Ahana) published in `src/features/reader/tts/readerTextProvider.ts` and explained in
// `TTS_PROVIDER.md` — this header restates only what shapes the code below; read that doc for
// the "why" behind the seam itself.
//
//   - text and cfi are two projections of one DOM Range: don't re-segment `text`, don't parse
//     `cfi`. Pass `cfi` back verbatim.
//   - Paint the highlight (`setSpokenRange`) when the utterance actually starts speaking, not
//     when the sentence is fetched — a session prefetches the next sentence while the current
//     one is still playing, and painting at fetch time would run the highlight ahead of the
//     voice.
//   - PAUSE keeps the highlight. STOP and ERROR clear it. `navigated` means Reader already
//     cleared it — this session must not clear it again for that reason.
//   - `current`/`next` never reject; every non-`ok` status is handled explicitly, not caught.
//
// PAUSE/RESUME ON ANDROID IS STOP-AND-REMEMBER, NOT A NATIVE SUSPEND. Android's pause()/resume()
// in @iternio/react-native-tts are documented no-ops (they resolve `false` without touching the
// native engine) — see ttsEngine.ts — so there is nothing to suspend. Instead, pause() there
// snapshots `currentlySpeaking` into `pausedSentence` (a closure variable, never persisted to
// sharedPrefs/SQLite — it dies with this effect) and calls the real Tts.stop(), then drives status
// to 'paused' directly rather than waiting for a tts-pause EVENT that Android's engine will never
// emit. This is no longer a lie: the engine really did stop, and play() really can resume this
// exact sentence (from its start, not the exact word — the native engine gives us no finer
// resolution than one speak() call). iOS keeps the real native path: Tts.pause()/resume() suspend
// and continue AVSpeechSynthesizer at the exact word, so status there is still driven off the
// genuine tts-pause/tts-resume events.
//
// ALL SESSION STATE LIVES INSIDE ONE EFFECT, deliberately. `provider` is the only thing this
// hook depends on (its lifetime belongs to whoever owns the book, per TTS_PROVIDER.md, so it is
// expected to be referentially stable for the life of this hook — create it once per book at
// the call site, e.g. via useState(() => createFakeReaderTextProvider())). Every other piece of
// bookkeeping (the in-flight prefetch, whether an utterance is outstanding, a generation counter
// that invalidates stale async continuations after stop/interruption) is a plain closure
// variable inside that effect rather than a separate useRef — there is only ever one "session"
// live for a given provider, so there is nothing for a second ref to coordinate with. The
// returned action functions (play/pause/stop/...) are stable trampolines into whatever the
// effect most recently assigned, so callers never need to worry about identity.

import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import type { AppStateStatus } from 'react-native';

import { announce } from '@/features/reader/a11yAnnounce';
import type {
  ReaderTextProvider,
  TtsFetchResult,
  TtsSentence,
} from '@/features/reader/tts/readerTextProvider';
import { logSpan, now } from '@/features/reader/readerTiming';
import { readSharedPrefs, writeSharedPrefs } from '@/features/sync/sharedPrefs';
import { DEFAULT_ACCESSIBILITY_PREFS } from '@/shared/contracts';
import type { A11yTtsPrefs } from '@/shared/contracts';

import Tts from './ttsEngine';
import type { Voice } from './ttsEngine';
import { mapRate } from './ttsRate';
import { normalizeTtsProgressEvent } from './ttsProgress';
import { ttsStatusAnnouncement } from './ttsAnnouncements';

export type TtsSessionStatus = 'idle' | 'speaking' | 'paused' | 'error';

export interface TtsSession {
  status: TtsSessionStatus;
  /** Diagnostic, not user-facing copy — mirrors TtsFetchResult's own `message` contract. */
  errorMessage: string | null;
  /** The sentence currently speaking (or about to). Null when idle. */
  currentSentence: TtsSentence | null;
  prefs: A11yTtsPrefs;
  voices: Voice[];
  /**
   * Starts from the reader's live position, or resumes if paused. On iOS, resuming continues the
   * native engine at the exact word; on Android it re-speaks the paused sentence from its start
   * (see the platform note on TtsSessionStatus above).
   */
  play(): void;
  /** Pauses. On Android this stops the engine but remembers the sentence so play() resumes it. */
  pause(): void;
  stop(): void;
  reloadVoices(): void;
  setRate(multiplier: number): void;
  setPitch(pitch: number): void;
  setVoice(voiceId: string | null): void;
  setAutoContinueChapter(value: boolean): void;
}

/** Android's pause()/resume() are documented no-ops in @iternio/react-native-tts. */
const PAUSE_RESUME_SUPPORTED = Platform.OS === 'ios';

// Coalesces rapid-fire rate/pitch/voice changes (a user dragging through chips) into one
// SQLite round trip instead of one per press. See applyPrefsPatch/schedulePersist below for why
// this also fixes a lost-update race, not just I/O volume.
const PERSIST_DEBOUNCE_MS = 300;

const noop = (): void => undefined;

export function useTtsSession(provider: ReaderTextProvider | null): TtsSession {
  const [status, setStatus] = useState<TtsSessionStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentSentence, setCurrentSentence] = useState<TtsSentence | null>(null);
  const [prefs, setPrefs] = useState<A11yTtsPrefs>(DEFAULT_ACCESSIBILITY_PREFS.tts);
  const [voices, setVoices] = useState<Voice[]>([]);

  // Stable trampolines. The effect below overwrites `.current` on every (re-)run; the returned
  // TtsSession methods just forward through these, so their identity never changes.
  const playRef = useRef<() => void>(noop);
  const pauseRef = useRef<() => void>(noop);
  const stopRef = useRef<() => void>(noop);
  const reloadVoicesRef = useRef<() => void>(noop);
  const setRateRef = useRef<(multiplier: number) => void>(noop);
  const setPitchRef = useRef<(pitch: number) => void>(noop);
  const setVoiceRef = useRef<(voiceId: string | null) => void>(noop);
  const setAutoContinueChapterRef = useRef<(value: boolean) => void>(noop);

  useEffect(() => {
    // NO PROVIDER, NO SESSION. `useTtsSession` cannot be called conditionally (Rules of Hooks), so
    // a caller that does not have a book open yet — TTS switched off, a PDF, the bridge not ready —
    // passes null and this does nothing: no engine listeners, no AppState subscription, no prefs
    // read, no audio-session call.
    //
    // It used to receive an inert stand-in provider instead, which meant the whole body below ran
    // once against a provider that could never serve a sentence, and then ran AGAIN when the real
    // one arrived. Harmless at runtime (the first session's cleanup tears itself down correctly),
    // but it left two live generations of engine listeners in the mock during tests, where the
    // FIRST `tts-start` handler belongs to the dead session and silently does nothing.
    //
    // The trampolines and the React state are already reset by the previous run's cleanup, so
    // there is nothing to undo here — see the cleanup at the bottom of this effect.
    if (provider === null) return;
    // Bound to a const so the narrowing above survives into the nested closures below —
    // TypeScript will not carry a parameter's narrowing across a function boundary.
    const source = provider;

    let torn = false;

    // The only pieces of session state this effect needs synchronously — read from a closure
    // variable rather than React state, which only updates on the next render — live here.
    // setPrefs/setStatus (below) keep these and the UI-facing state in sync on every change.
    let livePrefs: A11yTtsPrefs = DEFAULT_ACCESSIBILITY_PREFS.tts;
    let liveStatus: TtsSessionStatus = 'idle';

    let currentlySpeaking: TtsSentence | null = null;
    // Android-only: the sentence pause() snapshotted, so play() can re-speak it instead of
    // re-resolving the reader's live position. In-memory only — never persisted. Cleared on
    // resume, on a real stop, and when the reader navigates away while paused.
    let pausedSentence: TtsSentence | null = null;
    let awaitingUtterance = false;
    let pendingNext: Promise<TtsFetchResult> | null = null;
    // Opt-in diagnostic only (readerTiming.ts's EXPO_PUBLIC_READER_TIMING flag) — set when a fresh
    // play() starts the WebView round-trip (`beginFrom`), closed on the native `tts-start` event.
    // Brackets exactly the one latency source `beginFrom` can't avoid: fetching the first sentence
    // has no cache to serve from, unlike every sentence after it (see `speakSentence`'s prefetch).
    let playPressedAt: number | null = null;
    // Bumped on every stop/interruption/teardown. Async continuations (a prefetch resolving, a
    // fetch issued from beginFrom) capture this on entry and check it after every await, so a
    // continuation from a superseded play() can't resurrect state a later action already moved
    // past.
    let generation = 0;

    // Debounced prefs persistence — see applyPrefsPatch/schedulePersist/flushPendingTtsPatch.
    let pendingTtsPatch: Partial<A11yTtsPrefs> | null = null;
    let persistTimer: ReturnType<typeof setTimeout> | null = null;
    // Every actual write chains onto this, so a debounce-timer flush and the teardown flush can
    // never interleave their read-modify-write against SQLite — whichever was scheduled first
    // fully completes before the next one reads.
    let persistChain: Promise<void> = Promise.resolve();

    function updateStatus(next: TtsSessionStatus): void {
      // READER_ANNOUNCEMENTS.md §5 item 8. Captured before the mutation so the pure decision
      // function sees the real transition, not `next` compared against itself.
      const previous = liveStatus;
      liveStatus = next;
      setStatus(next);
      const said = ttsStatusAnnouncement(previous, next);
      if (said !== null) announce(said);
    }

    function clearHighlight(): void {
      source.setSpokenRange(null);
      // Gated the same as handleTtsProgress below: the WebView has no setSpokenWordRange handler
      // outside 'word' mode's own rollout, so calling it unconditionally would hit the bridge's
      // NOT_READY path on every stop/clear and surface as ReaderScreen's interrupting error banner
      // for every TTS user, not just 'word' mode's.
      if (livePrefs.highlightMode === 'word') source.setSpokenWordRange(null, 0, 0);
    }

    function stopInternal(opts?: { clearHighlight?: boolean; status?: TtsSessionStatus }): void {
      generation += 1;
      awaitingUtterance = false;
      pendingNext = null;
      currentlySpeaking = null;
      pausedSentence = null;
      playPressedAt = null;
      setCurrentSentence(null);
      updateStatus(opts?.status ?? 'idle');
      if (opts?.clearHighlight !== false) clearHighlight();
      // Wrapped in try-catch because the native stop() takes a bool* parameter that can
      // throw synchronously under the new-arch interop layer when called with undefined.
      try {
        void Tts.stop().catch(noop);
      } catch {
        // Best-effort — the engine may already be stopped.
      }
    }

    function speakSentence(sentence: TtsSentence, myGeneration: number): void {
      currentlySpeaking = sentence;
      setCurrentSentence(sentence);
      // Prefetch now, while this sentence is still speaking — see the file header.
      pendingNext = source.next(sentence.cfi);
      awaitingUtterance = true;
      void Tts.speak(sentence.text).catch(() => {
        if (generation !== myGeneration) return;
        awaitingUtterance = false;
        setErrorMessage('The TTS engine rejected this sentence.');
        stopInternal({ status: 'error' });
      });
    }

    function applyFetchResult(result: TtsFetchResult, myGeneration: number): void {
      switch (result.status) {
        case 'ok':
          speakSentence(result.sentence, myGeneration);
          return;
        case 'endOfBook':
          stopInternal();
          return;
        case 'invalidAnchor':
          // Recovery is the provider's, not the caller's — re-resolve from the reader's live
          // position rather than trying to repair the stale cfi.
          void beginFrom(null, myGeneration);
          return;
        case 'unavailable':
          // The provider is gone, or this request was superseded. Nothing to surface.
          stopInternal();
          return;
        case 'error':
          setErrorMessage(result.message);
          stopInternal({ status: 'error' });
          return;
      }
    }

    async function beginFrom(from: string | null, myGeneration: number): Promise<void> {
      const result = await source.current(from);
      if (generation !== myGeneration) return;
      applyFetchResult(result, myGeneration);
    }

    function handleTtsStart(): void {
      if (!awaitingUtterance) return;
      if (playPressedAt !== null) {
        logSpan('tts play-to-start', playPressedAt);
        playPressedAt = null;
      }
      setErrorMessage(null);
      updateStatus('speaking');
      if (currentlySpeaking) {
        source.setSpokenRange(currentlySpeaking.cfi);
        // Clears any word-level sub-highlight left over from the previous sentence, so there is
        // nothing stale on screen in the gap before this sentence's first tts-progress event.
        // Same highlightMode gate as clearHighlight — see its note.
        if (livePrefs.highlightMode === 'word') source.setSpokenWordRange(null, 0, 0);
      }
    }

    async function handleTtsFinish(): Promise<void> {
      if (!awaitingUtterance) return;
      awaitingUtterance = false;
      const myGeneration = generation;
      const finished = currentlySpeaking;

      if (finished?.lastInSection === true && !livePrefs.autoContinueChapter) {
        stopInternal();
        return;
      }

      const pending = pendingNext;
      pendingNext = null;
      if (!pending) {
        stopInternal();
        return;
      }

      const result = await pending;
      if (generation !== myGeneration) return;
      applyFetchResult(result, myGeneration);
    }

    function handleTtsCancel(): void {
      // stop() already reconciled local state synchronously; this just closes the flag so a
      // straggling native cancel can't later be mistaken for this utterance's finish or error.
      awaitingUtterance = false;
    }

    function handleTtsPause(): void {
      if (!awaitingUtterance) return;
      updateStatus('paused');
    }

    function handleTtsResume(): void {
      if (!awaitingUtterance) return;
      updateStatus('speaking');
    }

    function handleTtsError(event: { message?: string }): void {
      if (!awaitingUtterance) return;
      setErrorMessage(event.message ?? 'The TTS engine reported an error.');
      stopInternal({ status: 'error' });
    }

    // Gated on highlightMode inside the handler rather than by conditionally subscribing, so a
    // runtime pref change never needs to resubscribe — same trade-off as the awaitingUtterance
    // guards above. Both platforms emit tts-progress, so this listener is always registered.
    function handleTtsProgress(event: {
      location?: number;
      length?: number;
      start?: number;
      end?: number;
    }): void {
      if (!awaitingUtterance) return;
      if (livePrefs.highlightMode !== 'word') return;
      if (!currentlySpeaking) return;
      const range = normalizeTtsProgressEvent(event);
      source.setSpokenWordRange(currentlySpeaking.cfi, range.start, range.end);
    }

    // Neither native TTS module observes app backgrounding itself (confirmed by reading
    // TextToSpeech.m and TextToSpeechModule.java), and this app declares no UIBackgroundModes, so
    // iOS/Android can suspend or kill speech with no callback into JS at all. AppState is the
    // only signal available. Fires on 'background' only, not 'inactive' — 'inactive' also covers
    // transient interruptions (a notification banner, Control Center) where the app is still
    // frontmost and the native module's own audio-session interruption handling already applies;
    // stopping speech on every one of those would be a regression, not a fix. Routing through
    // stopInternal() means the reset happens the instant backgrounding starts, so there is nothing
    // left to reconcile on returning to the foreground — no auto-resume path exists because
    // nothing preserved a resumable state across the transition.
    function handleAppStateChange(next: AppStateStatus): void {
      if (next !== 'background') return;
      stopInternal();
    }

    /**
     * Splits a tts.* patch back across the two prefs tables via the existing sync write path.
     *
     * Named fields rather than a destructure-and-omit, so this doesn't have to fight
     * no-unused-vars over the id/userId/updatedAt/isDeleted/synced fields writeSharedPrefs
     * doesn't accept.
     */
    async function persistTtsPatch(patch: Partial<A11yTtsPrefs>): Promise<void> {
      const shared = await readSharedPrefs();
      await writeSharedPrefs({
        theme: shared.theme,
        font: shared.font,
        typography: shared.typography,
        layout: shared.layout,
        zoom: shared.zoom,
        accessibility: {
          ...shared.accessibility,
          tts: { ...shared.accessibility.tts, ...patch },
        },
      });
    }

    // Persists whatever has accumulated in `pendingTtsPatch` right now, synchronously clearing
    // the debounce timer and the pending patch first so a flush can't be double-scheduled.
    // Chained onto persistChain rather than fired directly: without that, two flushes close
    // together (a debounce tick immediately followed by teardown, say) could each call
    // readSharedPrefs() before either's writeSharedPrefs() lands, and the second write's spread
    // of the pre-first-write record would silently undo the first patch.
    function flushPendingTtsPatch(): void {
      if (persistTimer !== null) {
        clearTimeout(persistTimer);
        persistTimer = null;
      }
      const patch = pendingTtsPatch;
      pendingTtsPatch = null;
      if (patch === null) return;
      persistChain = persistChain.then(() => persistTtsPatch(patch)).catch(noop);
    }

    // Coalesces patches that land inside the same debounce window into one persisted write —
    // e.g. a rate press immediately followed by a pitch press ends up as a single
    // read-modify-write carrying both, not two writes where the second overwrites the first.
    function schedulePersist(patch: Partial<A11yTtsPrefs>): void {
      pendingTtsPatch = { ...pendingTtsPatch, ...patch };
      if (persistTimer !== null) clearTimeout(persistTimer);
      persistTimer = setTimeout(flushPendingTtsPatch, PERSIST_DEBOUNCE_MS);
    }

    function applyPrefsPatch(patch: Partial<A11yTtsPrefs>): void {
      livePrefs = { ...livePrefs, ...patch };
      setPrefs(livePrefs);
      schedulePersist(patch);
    }

    playRef.current = () => {
      // `enabled` is the settings-screen master switch, not a second gate here: whoever decides
      // to mount TtsControls at all has already decided TTS is enabled. A silent no-op with no
      // status change and no error would leave a caller unable to tell a real press from one
      // this session declined to honour.
      if (liveStatus === 'speaking') return;
      if (liveStatus === 'paused') {
        if (PAUSE_RESUME_SUPPORTED) {
          void Tts.resume().catch(noop);
          return;
        }
        if (pausedSentence) {
          const sentence = pausedSentence;
          pausedSentence = null;
          playPressedAt = now();
          speakSentence(sentence, generation);
          return;
        }
        // Defensive fallback only — pausedSentence should always be set alongside 'paused' on
        // Android. Falls through to the same re-resolve every fresh play() uses.
      }
      playPressedAt = now();
      void beginFrom(null, generation);
    };

    pauseRef.current = () => {
      if (!awaitingUtterance) return;
      if (PAUSE_RESUME_SUPPORTED) {
        try {
          void Tts.pause().catch(noop);
        } catch {
          // Best-effort — the engine may already be paused.
        }
        return;
      }
      // Android has no native pause — stop the engine but remember the sentence so play() can
      // re-speak it. See the file header note on PAUSE/RESUME ON ANDROID.
      awaitingUtterance = false;
      pausedSentence = currentlySpeaking;
      updateStatus('paused');
      try {
        void Tts.stop().catch(noop);
      } catch {
        // Best-effort — the engine may already be stopped.
      }
    };

    stopRef.current = () => stopInternal();

    reloadVoicesRef.current = () => {
      void Tts.voices()
        .then((all) => setVoices(all.filter((voice) => !voice.notInstalled)))
        .catch(noop);
    };

    setRateRef.current = (multiplier) => {
      applyPrefsPatch({ rate: multiplier });
      void Tts.setDefaultRate(mapRate(multiplier).value).catch(noop);
    };

    setPitchRef.current = (pitch) => {
      applyPrefsPatch({ pitch });
      void Tts.setDefaultPitch(pitch).catch(noop);
    };

    setVoiceRef.current = (voiceId) => {
      applyPrefsPatch({ voiceId });
      if (voiceId) void Tts.setDefaultVoice(voiceId).catch(noop);
    };

    setAutoContinueChapterRef.current = (value) => {
      applyPrefsPatch({ autoContinueChapter: value });
    };

    const subscriptions = [
      Tts.addListener('tts-start', handleTtsStart),
      Tts.addListener('tts-finish', () => void handleTtsFinish()),
      Tts.addListener('tts-cancel', handleTtsCancel),
      Tts.addListener('tts-pause', handleTtsPause),
      Tts.addListener('tts-resume', handleTtsResume),
      Tts.addListener('tts-progress', handleTtsProgress),
      // 'tts-error' is absent from @iternio/react-native-tts's iOS `supportedEvents`
      // (TextToSpeech.m declares only start/finish/pause/resume/progress/cancel, and never calls
      // sendEventWithName:@"tts-error" — AVSpeechSynthesizerDelegate has no error callback for the
      // library to wire it from; Android's tts-error comes from UtteranceProgressListener.onError,
      // which has no iOS equivalent). RCTEventEmitter's addListener throws synchronously for an
      // event name outside supportedEvents, so this has to be skipped BEFORE calling addListener,
      // not caught after. CONSEQUENCE, not silently patched over: on iOS, handleTtsError never
      // fires — an engine failure leaves the session in 'speaking' with no error surfaced, rather
      // than transitioning to 'error'. No iOS signal exists to restore parity here.
      ...(Platform.OS === 'ios' ? [] : [Tts.addListener('tts-error', handleTtsError)]),
    ];

    const appStateSubscription = AppState.addEventListener('change', handleAppStateChange);

    const unsubscribeInterrupted = source.onInterrupted((reason) => {
      if (reason === 'navigated') {
        // Not a teardown, and Reader already cleared the highlight itself. Just drop any
        // prefetch tied to the position we've now moved away from, and any Android paused-sentence
        // snapshot — resuming a sentence tied to a cfi the reader has since left would be wrong.
        generation += 1;
        pendingNext = null;
        pausedSentence = null;
        return;
      }
      // closed / revoked are terminal.
      stopInternal();
    });

    // iOS defaults to SoloAmbient audio session, which obeys the hardware mute switch and
    // routes speech to the receiver. "ignore" switches to Playback so TTS always produces
    // audible output regardless of the mute switch position.
    if (Platform.OS === 'ios') {
      void Tts.setIgnoreSilentSwitch('ignore').catch(noop);
    }

    void readSharedPrefs().then((shared) => {
      if (torn) return;
      livePrefs = shared.accessibility.tts;
      setPrefs(livePrefs);
      const mapping = mapRate(livePrefs.rate);
      void Tts.setDefaultRate(mapping.value).catch(noop);
      void Tts.setDefaultPitch(livePrefs.pitch).catch(noop);
      if (livePrefs.voiceId) void Tts.setDefaultVoice(livePrefs.voiceId).catch(noop);
    });

    return () => {
      torn = true;
      // Before anything else: a pending debounced patch must not be lost just because the
      // session is going away (provider changed, TTS toggled off, the reader closed) before its
      // timer fired.
      flushPendingTtsPatch();
      subscriptions.forEach((subscription) => subscription.remove());
      appStateSubscription.remove();
      unsubscribeInterrupted();
      generation += 1;
      clearHighlight();
      try {
        void Tts.stop().catch(noop);
      } catch {
        // Best-effort — the engine may already be stopped.
      }

      // BACK TO IDLE, because the session this state described no longer exists. Stopping the
      // engine is not enough on its own: `status` is React state and would otherwise keep saying
      // 'speaking' after the speech was cut off, which is what any caller rendering a "reading
      // aloud" indicator off this hook would still be showing over a silent book.
      setStatus('idle');
      setCurrentSentence(null);
      setErrorMessage(null);

      // The trampolines close over THIS run's functions. Left in place they would let a late
      // play() drive a session that has already been torn down.
      playRef.current = noop;
      pauseRef.current = noop;
      stopRef.current = noop;
      reloadVoicesRef.current = noop;
      setRateRef.current = noop;
      setPitchRef.current = noop;
      setVoiceRef.current = noop;
      setAutoContinueChapterRef.current = noop;
    };
  }, [provider]);

  return {
    status,
    errorMessage,
    currentSentence,
    prefs,
    voices,
    play: () => playRef.current(),
    pause: () => pauseRef.current(),
    stop: () => stopRef.current(),
    reloadVoices: () => reloadVoicesRef.current(),
    setRate: (multiplier) => setRateRef.current(multiplier),
    setPitch: (pitch) => setPitchRef.current(pitch),
    setVoice: (voiceId) => setVoiceRef.current(voiceId),
    setAutoContinueChapter: (value) => setAutoContinueChapterRef.current(value),
  };
}
