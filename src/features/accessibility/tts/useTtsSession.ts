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
// STATUS IS EVENT-DRIVEN, NOT ACTION-DRIVEN. Android's pause()/resume() in
// @iternio/react-native-tts are documented no-ops (they resolve `false` without touching the
// native engine) — see ttsEngine.ts. Flipping status to 'paused' the moment pause() is CALLED
// would lie on Android: speech keeps playing while the UI claims otherwise. Driving status off
// the tts-pause/tts-resume EVENTS instead means Android simply never shows 'paused', because the
// event never arrives — which is the honest outcome given the platform limitation.
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

import type {
  ReaderTextProvider,
  TtsFetchResult,
  TtsSentence,
} from '@/features/reader/tts/readerTextProvider';
import { readSharedPrefs, writeSharedPrefs } from '@/features/sync/sharedPrefs';
import { DEFAULT_ACCESSIBILITY_PREFS } from '@/shared/contracts';
import type { A11yTtsPrefs } from '@/shared/contracts';

import Tts from './ttsEngine';
import type { Voice } from './ttsEngine';
import { mapRate } from './ttsRate';

export type TtsSessionStatus = 'idle' | 'speaking' | 'paused' | 'error';

export interface TtsSession {
  status: TtsSessionStatus;
  /** Diagnostic, not user-facing copy — mirrors TtsFetchResult's own `message` contract. */
  errorMessage: string | null;
  /** The sentence currently speaking (or about to). Null when idle. */
  currentSentence: TtsSentence | null;
  prefs: A11yTtsPrefs;
  voices: Voice[];
  /** Starts from the reader's live position, or resumes if paused (iOS only — see status note). */
  play(): void;
  /** No-op on Android; see the platform note on TtsSessionStatus above. */
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

const noop = (): void => undefined;

export function useTtsSession(provider: ReaderTextProvider): TtsSession {
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
    let torn = false;

    // The only pieces of session state this effect needs synchronously — read from a closure
    // variable rather than React state, which only updates on the next render — live here.
    // setPrefs/setStatus (below) keep these and the UI-facing state in sync on every change.
    let livePrefs: A11yTtsPrefs = DEFAULT_ACCESSIBILITY_PREFS.tts;
    let liveStatus: TtsSessionStatus = 'idle';

    let currentlySpeaking: TtsSentence | null = null;
    let awaitingUtterance = false;
    let pendingNext: Promise<TtsFetchResult> | null = null;
    // Bumped on every stop/interruption/teardown. Async continuations (a prefetch resolving, a
    // fetch issued from beginFrom) capture this on entry and check it after every await, so a
    // continuation from a superseded play() can't resurrect state a later action already moved
    // past.
    let generation = 0;

    function updateStatus(next: TtsSessionStatus): void {
      liveStatus = next;
      setStatus(next);
    }

    function clearHighlight(): void {
      provider.setSpokenRange(null);
    }

    function stopInternal(opts?: { clearHighlight?: boolean; status?: TtsSessionStatus }): void {
      generation += 1;
      awaitingUtterance = false;
      pendingNext = null;
      currentlySpeaking = null;
      setCurrentSentence(null);
      updateStatus(opts?.status ?? 'idle');
      if (opts?.clearHighlight !== false) clearHighlight();
      void Tts.stop().catch(noop);
    }

    function speakSentence(sentence: TtsSentence, myGeneration: number): void {
      currentlySpeaking = sentence;
      setCurrentSentence(sentence);
      // Prefetch now, while this sentence is still speaking — see the file header.
      pendingNext = provider.next(sentence.cfi);
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
      const result = await provider.current(from);
      if (generation !== myGeneration) return;
      applyFetchResult(result, myGeneration);
    }

    function handleTtsStart(): void {
      if (!awaitingUtterance) return;
      setErrorMessage(null);
      updateStatus('speaking');
      if (currentlySpeaking) provider.setSpokenRange(currentlySpeaking.cfi);
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

    function applyPrefsPatch(patch: Partial<A11yTtsPrefs>): void {
      livePrefs = { ...livePrefs, ...patch };
      setPrefs(livePrefs);
      void persistTtsPatch(patch).catch(noop);
    }

    playRef.current = () => {
      // `enabled` is the settings-screen master switch, not a second gate here: whoever decides
      // to mount TtsControls at all has already decided TTS is enabled. A silent no-op with no
      // status change and no error would leave a caller unable to tell a real press from one
      // this session declined to honour.
      if (liveStatus === 'speaking') return;
      if (liveStatus === 'paused' && PAUSE_RESUME_SUPPORTED) {
        void Tts.resume().catch(noop);
        return;
      }
      void beginFrom(null, generation);
    };

    pauseRef.current = () => {
      if (!PAUSE_RESUME_SUPPORTED) return;
      void Tts.pause().catch(noop);
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

    const unsubscribeInterrupted = provider.onInterrupted((reason) => {
      if (reason === 'navigated') {
        // Not a teardown, and Reader already cleared the highlight itself. Just drop any
        // prefetch tied to the position we've now moved away from.
        generation += 1;
        pendingNext = null;
        return;
      }
      // closed / revoked are terminal.
      stopInternal();
    });

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
      subscriptions.forEach((subscription) => subscription.remove());
      appStateSubscription.remove();
      unsubscribeInterrupted();
      generation += 1;
      clearHighlight();
      void Tts.stop().catch(noop);
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
