// src/search/useVoiceSearch.ts
// The bridge between the pure recogniser reducer and `expo-speech-recognition`.
// Deliberately the only file in this feature that is both React and native, and
// deliberately thin: every rule about what a transition MEANS lives in
// `voiceState.ts`, and everything below is "when the machine wants the
// microphone open, open it".
//
// The same split, and the same reasoning, as `useCatalogueSearch.ts`.
//
// THERE IS NO SEARCH IN HERE. Not a pipeline, not a query, not a `SearchStatus`
// — the Foundation Spec's line is that voice is "simply a second way to produce
// a query string", so this hook's entire output is a string plus a lifecycle,
// and running that string as a search is the screen's job through the same
// `onChangeQuery` / `onSubmit` pair that typing and recent searches already use.
// Wiring the pipeline in here would give the catalogue a second, voice-shaped
// search path to keep in step with the first.
//
// THE SCREEN GETS NO NATIVE MODULE. It gets a status, a transcript, an error
// code and four `on<Event>` callbacks — so the surface stays reviewable, and
// swapping the recogniser is a change to this file alone.
import { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
  type ExpoSpeechRecognitionErrorCode,
} from 'expo-speech-recognition';

import {
  initialVoiceState,
  voiceReducer,
  type VoiceErrorCode,
  type VoiceStatus,
} from './voiceState';

// ─── Recognition options ─────────────────────────────────────────────────────

/**
 * The locale the recogniser is asked for.
 *
 * A NAMED CONSTANT RATHER THAN A PICKER. The app has no i18n layer and no
 * language setting anywhere — every string in `src/` is hard-coded English, and
 * the catalogue fixtures are `"language": "en"`. A locale selector on screen 11
 * would be the only language control in the product, and would imply a choice
 * nothing else honours.
 *
 * When a language setting does land, this is the one line that reads from it.
 */
const VOICE_LOCALE = 'en-US';

const RECOGNITION_OPTIONS = {
  lang: VOICE_LOCALE,
  // The transcript has to appear as it is spoken — the mockup shows a growing
  // line under the mic, and it is the only feedback that the microphone is
  // actually working.
  interimResults: true,
  // One utterance, then stop. A search query is a phrase, not a dictation
  // session, and `continuous` would leave the mic open until something else
  // closed it.
  continuous: false,
  // Nothing renders alternatives, so asking for them is bandwidth and battery
  // spent on a list nobody reads (CONVENTIONS §10).
  maxAlternatives: 1,
  // Network recognition is markedly more accurate, and the offline case is
  // reported honestly through `network` rather than silently degraded.
  requiresOnDeviceRecognition: false,
  // A QUERY IS NOT PROSE — the same reason `SearchInput` sets `autoCorrect`
  // false. Punctuating "machine learning in healthcare?" into the query would
  // send a character the catalogue never indexed.
  addsPunctuation: false,
} as const;

// ─── Error translation ───────────────────────────────────────────────────────

/**
 * Thirteen native codes onto the five a reader can act on.
 *
 * The translation happens HERE rather than in the reducer for the reason
 * `useCatalogueSearch` translates an unknown throw into a `CatalogueError`: the
 * machine should not have to know what vocabulary this quarter's recogniser
 * speaks.
 *
 * `aborted` is absent on purpose. We are the only caller of `abort()`, and the
 * event it produces is dropped before it reaches here — see `stopRecognition`.
 */
function toVoiceErrorCode(code: ExpoSpeechRecognitionErrorCode): VoiceErrorCode {
  switch (code) {
    case 'not-allowed':
      return 'permission_denied';

    // Android reports a silence as a timeout; iOS reports it as no-speech. Both
    // mean the same thing to a reader.
    case 'no-speech':
    case 'speech-timeout':
      return 'no_speech';

    // No speech service installed, or one that cannot handle our locale.
    // Retrying will not help either.
    case 'service-not-allowed':
    case 'language-not-supported':
      return 'no_recogniser';

    case 'network':
      return 'network';

    default:
      return 'unknown';
  }
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export interface UseVoiceSearch {
  /** Lifecycle. `closed` means the overlay is not up. */
  status: VoiceStatus;
  /** What has been heard so far. `''` until the first partial arrives. */
  transcript: string;
  /** Why the session ended badly. The screen resolves it to copy. */
  errorCode?: VoiceErrorCode;
  /** The mic in the search field was pressed. */
  onMicPress: () => void;
  /** Dismissed — the × or the hardware back button. Never submits. */
  onCancel: () => void;
  /** Discard what was heard and listen again. */
  onClear: () => void;
  /**
   * The transcript is being run as a query. Closes the overlay.
   *
   * IT DOES NOT SEARCH. The caller already holds `transcript` and submits it
   * through the ordinary search path; this only retires the session.
   */
  onSubmit: () => void;
}

export function useVoiceSearch(): UseVoiceSearch {
  const [state, dispatch] = useReducer(voiceReducer, initialVoiceState);

  // The newest session this hook has acted on, and the whole of its bookkeeping
  // — `useCatalogueSearch.issued`, doing the same job for the same reason.
  //
  // THE REDUCER'S `sessionId` IS THE ONLY COUNTER. This ref never increments; it
  // is only ever ASSIGNED from `state.sessionId`, so it cannot drift from it.
  // An earlier version kept a parallel counter that the intent handlers bumped
  // themselves, guarded by a lagging copy of the state — two intents landing in
  // one React batch could then advance the counter twice while the reducer
  // accepted one session, and the two never resynchronised: every subsequent
  // permission answer was rejected as stale and the overlay sat on "Listening…"
  // with a live microphone it was ignoring. Deriving from the reducer instead
  // makes that unrepresentable rather than merely unlikely.
  //
  // It carries two jobs, which is what lets one ref replace the two it removed:
  //   1. IDEMPOTENCY — the effect below re-runs on every transition, so `begin`
  //      must fire once per session, not once per render.
  //   2. SUPERSESSION — an async `begin` compares against it to discover that a
  //      newer session has started while it was waiting on the permission
  //      dialog. Claiming the id whatever the status (rather than only for
  //      `checkingPermission`) is what makes a cancel visible here too.
  const issued = useRef(0);

  // The session the RECOGNISER is currently running for, or `null` when nothing
  // is running.
  //
  // THIS IS THE HALF THE REDUCER CANNOT DO. The native module is a process-wide
  // singleton that keeps emitting after `abort()` — a trailing `end` would
  // otherwise be dispatched against whatever session happens to be current by
  // then, which after a Clear is a brand new one that is legitimately listening.
  // Nulling this the instant we stop caring means those events are dropped at
  // the boundary; the reducer's own `sessionId` guard is the second line.
  const activeRef = useRef<number | null>(null);

  // Whether this hook is still mounted — a reader leaving the Search tab
  // mid-permission-prompt, whose answer then arrives to a screen that no longer
  // exists. Same guard, and the same reasoning, as `useCatalogueSearch.live`.
  const live = useRef(true);

  /** Stops the recogniser and disowns everything it says from here on. */
  const stopRecognition = useCallback(() => {
    if (activeRef.current === null) return;
    activeRef.current = null;
    // `abort()` rather than `stop()`: stop asks for a final result, and a
    // cancelled session must not produce one.
    ExpoSpeechRecognitionModule.abort();
  }, []);

  useEffect(() => {
    live.current = true;

    return () => {
      live.current = false;
      // Leaving the screen must close the microphone. Not routed through
      // `stopRecognition` because a cleanup may not depend on a callback
      // identity that could have changed.
      if (activeRef.current !== null) {
        activeRef.current = null;
        ExpoSpeechRecognitionModule.abort();
      }
    };
  }, []);

  /**
   * Asks for permission, then opens the microphone.
   *
   * PERMISSION EVERY TIME, not once per mount. It is revocable from the
   * Settings app while the overlay is open, and on a granted device the call
   * resolves immediately without a dialog — so the cost of being correct here
   * is nil.
   */
  const begin = useCallback(async (sessionId: number) => {
    try {
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();

      // Superseded or unmounted while the dialog was up. The reducer would
      // discard these anyway; returning early also avoids starting a recogniser
      // for a session nobody is waiting on.
      if (!live.current || issued.current !== sessionId) return;

      if (!permission.granted) {
        dispatch({ type: 'permissionRefused', sessionId });
        return;
      }

      dispatch({ type: 'permissionGranted', sessionId });

      // Set BEFORE `start()`, because the native `start` event can be emitted
      // synchronously and would otherwise be dropped as belonging to nothing.
      activeRef.current = sessionId;
      ExpoSpeechRecognitionModule.start(RECOGNITION_OPTIONS);
    } catch {
      // A rejected permission call or a `start()` that threw rather than
      // emitting an error event. The reader still needs a state, and "voice
      // could not be completed" is the least wrong thing to say about an
      // unclassified throw — the same call `useCatalogueSearch` makes.
      if (!live.current || issued.current !== sessionId) return;
      activeRef.current = null;
      dispatch({ type: 'recognitionFailed', sessionId, code: 'unknown' });
    }
  }, []);

  /**
   * WHEN THE MACHINE WANTS THE MICROPHONE, OPEN IT.
   *
   * The same shape as `useCatalogueSearch`'s request effect, and thin for the
   * same reason: the decision to listen was already made by the reducer, so all
   * that is left is carrying it out exactly once. Depending on the whole of
   * `state` means this re-runs on every transition — including the many that
   * change nothing it cares about — and `issued` is what makes that idempotent:
   * work is keyed on the session, not on having been called.
   *
   * No cleanup flag, deliberately, for the reason `useCatalogueSearch.live`
   * documents: this effect re-runs on every transition, so a flag flipped in
   * its cleanup would abandon a permission request that is still perfectly
   * wanted. Supersession is detected by comparing ids instead.
   */
  useEffect(() => {
    const { status, sessionId } = state;

    // Already acted on this session. Also the initial-mount case: the reducer
    // starts at 0 and so does this, so nothing is launched until a real intent
    // advances it.
    if (issued.current === sessionId) return;
    issued.current = sessionId;

    // A RECOGNISER MAY NOT OUTLIVE THE SESSION THAT STARTED IT. The intents
    // below already abort synchronously, so this is a net rather than the
    // mechanism — it catches the one ordering they cannot: a `begin` that was
    // waiting on the permission dialog, resumed just before its session was
    // superseded, and opened the microphone on the way out.
    if (activeRef.current !== null && activeRef.current !== sessionId) {
      activeRef.current = null;
      ExpoSpeechRecognitionModule.abort();
    }

    if (status !== 'checkingPermission') return;
    void begin(sessionId);
  }, [state, begin]);

  // ─── Intents ───────────────────────────────────────────────────────────────

  // Pure dispatches, as in `useCatalogueSearch`. THE GUARDS THAT USED TO BE HERE
  // ARE GONE, and their absence is the fix: they existed only to keep a parallel
  // session counter in step, they read a lagging copy of the state to do it, and
  // the reducer enforces every one of them anyway (`opened` is ignored unless
  // closed, `cancelled` and `cleared` unless open). A press the reducer ignores
  // now costs nothing, because nothing outside the reducer is counting.
  //
  // `stopRecognition` stays synchronous and stays here: closing the microphone
  // is not something to defer to an effect, and it is a no-op when nothing is
  // running, so it needs no guard of its own.

  const onMicPress = useCallback(() => {
    dispatch({ type: 'opened' });
  }, []);

  const onCancel = useCallback(() => {
    stopRecognition();
    dispatch({ type: 'cancelled' });
  }, [stopRecognition]);

  const onClear = useCallback(() => {
    stopRecognition();
    // Listening again is NOT started here — `cleared` puts the machine back into
    // `checkingPermission` with a fresh session, and the effect above picks it
    // up. One path into the microphone, whether it is the first attempt or the
    // fourth.
    dispatch({ type: 'cleared' });
  }, [stopRecognition]);

  // The one intent that still reads state, and not for a session id: submitting
  // nothing is a no-op in the reducer, so stopping the recogniser first would
  // close the microphone while leaving the surface saying "Listening…". Read
  // from `state` itself rather than a mirror of it — there is no second counter
  // to fall out of step, so a stale read costs at worst a redundant abort.
  const onSubmit = useCallback(() => {
    if (state.status === 'closed' || state.transcript.trim().length === 0) return;

    // Committing mid-utterance is allowed (see the reducer), so this may well
    // be closing a microphone that is still open. `abort()` rather than
    // `stop()`: we already have the words we are searching for, and a final
    // result arriving afterwards has nowhere to go.
    stopRecognition();
    dispatch({ type: 'submitted' });
  }, [state.status, state.transcript, stopRecognition]);

  // ─── Recogniser events ─────────────────────────────────────────────────────

  // Every handler answers `activeRef`, never the current state: an event that
  // belongs to no running session is not late, it is orphaned, and there is no
  // session id it could honestly claim to be about.

  useSpeechRecognitionEvent('start', () => {
    const sessionId = activeRef.current;
    if (sessionId === null) return;
    dispatch({ type: 'recognitionStarted', sessionId });
  });

  useSpeechRecognitionEvent('result', (event) => {
    const sessionId = activeRef.current;
    if (sessionId === null) return;

    // `maxAlternatives: 1`, so there is one result or none. A `result` event
    // with an empty array is possible and means "nothing this time" rather than
    // "clear what you had".
    const transcript = event.results[0]?.transcript;
    if (transcript === undefined) return;

    dispatch({ type: 'transcriptUpdated', sessionId, transcript });
  });

  useSpeechRecognitionEvent('speechend', () => {
    const sessionId = activeRef.current;
    if (sessionId === null) return;
    dispatch({ type: 'speechEnded', sessionId });
  });

  // A final result the recogniser could not make anything of. Handled rather
  // than left to `end`, because the partials already on screen are exactly what
  // it is declining to confirm — see the reducer.
  useSpeechRecognitionEvent('nomatch', () => {
    const sessionId = activeRef.current;
    if (sessionId === null) return;
    dispatch({ type: 'noMatch', sessionId });
  });

  useSpeechRecognitionEvent('error', (event) => {
    const sessionId = activeRef.current;
    if (sessionId === null) return;

    // The session is over either way, so it is disowned before the dispatch —
    // the `end` event that follows every error must not be read as a second,
    // contradictory outcome.
    activeRef.current = null;
    dispatch({ type: 'recognitionFailed', sessionId, code: toVoiceErrorCode(event.error) });
  });

  useSpeechRecognitionEvent('end', () => {
    const sessionId = activeRef.current;
    if (sessionId === null) return;

    activeRef.current = null;
    dispatch({ type: 'recognitionEnded', sessionId });
  });

  return {
    status: state.status,
    transcript: state.transcript,
    ...(state.errorCode !== undefined ? { errorCode: state.errorCode } : {}),
    onMicPress,
    onCancel,
    onClear,
    onSubmit,
  };
}
