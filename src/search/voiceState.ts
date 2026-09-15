// src/search/voiceState.ts
// Recogniser state for the voice-search surface (screen 11). A PURE REDUCER —
// no React, no native module, no clock, no fetch. Same shape and the same
// reasoning as `searchState.ts`, and for the same reason: what a transition
// MEANS is testable here without a microphone, a permission dialog or a device.
//
// THIS FILE KNOWS NOTHING ABOUT `expo-speech-recognition`. Every native error
// code is translated into the small `VoiceErrorCode` union below before it
// reaches a dispatch — the same way `useCatalogueSearch` translates an unknown
// throw into a `CatalogueError` rather than letting a transport detail into the
// reducer. Swapping the recogniser is then a change in `useVoiceSearch.ts` and
// nothing else.
//
// AND IT KNOWS NOTHING ABOUT SEARCH. Voice is "simply a second way to produce a
// query string" — so this machine's whole job is to end up holding a transcript
// somebody else can submit. There is no query, no pipeline and no `SearchStatus`
// anywhere below this line; `searchState.ts` owns all of that and the two
// machines never touch. What joins them is one string, handed over by the
// screen.
//
// FOUR WAYS A SESSION ENDS, NEVER CONFLATED. The whole design pressure on this
// file is keeping these apart, because they are four different things to say to
// a reader:
//   1. done             — speech was heard and there is a transcript to search
//   2. noSpeech         — the recogniser ran fine and heard nothing
//   3. permissionDenied — the microphone was never opened
//   4. failed           — the recogniser itself broke
// (2) is not (4), for exactly the reason `searchState.ts` keeps `empty` apart
// from `error`: one of them is an answer and the other is a breakage.

// ─── Lifecycle ───────────────────────────────────────────────────────────────

// A union rather than a set of booleans (CONVENTIONS §4) — booleans would permit
// `listening && permissionDenied`, which is not a state this surface has.
//
// `closed` is a real member rather than the absence of state, so "the overlay is
// not up" is one representable value instead of a `null` every caller has to
// remember to check.
//
// `checkingPermission` is separate from `listening` because the microphone is
// genuinely not open yet — the OS dialog is. It renders AS "Listening…" (the
// dialog covers the screen anyway), but conflating the two in the model would
// mean the machine could not tell a refusal from a silence.
export type VoiceStatus =
  | 'closed'
  | 'checkingPermission'
  | 'listening'
  | 'processing'
  | 'done'
  | 'noSpeech'
  | 'permissionDenied'
  | 'failed';

/**
 * Why a session ended badly, in this app's vocabulary rather than the
 * recogniser's.
 *
 * DELIBERATELY SMALLER THAN THE NATIVE ONE. `expo-speech-recognition` reports
 * thirteen codes; a reader can act on four outcomes. `useVoiceSearch` collapses
 * them, and the copy for each lives in `./voiceErrorCopy` — keyed on the code,
 * never spelled here, so the reducer stays free of reader-facing strings the
 * same way `searchState.ts` is.
 *
 * NOT IN `@model/errors` ALONGSIDE `CatalogueError`, which is the tempting
 * home. That file is the adapter layer's rejection carrier — every code in it
 * describes a request to wokay that did not come back. A microphone that was
 * refused is not a catalogue failure, has no `CatalogueFailure` to travel in,
 * and would be the first member of that enum no adapter can ever throw.
 */
export type VoiceErrorCode =
  | 'permission_denied'
  | 'no_speech'
  /** No usable recogniser on the device, or it does not support the locale. */
  | 'no_recogniser'
  | 'network'
  | 'unknown';

export interface VoiceState {
  status: VoiceStatus;
  /**
   * What has been heard so far. Grows while listening, and is the ONLY thing
   * this machine hands to the search pipeline.
   *
   * Always a string, never `undefined` — "nothing heard yet" is `''`, which is
   * the one representation, so no caller has to test for both.
   */
  transcript: string;
  errorCode?: VoiceErrorCode;
  /**
   * Increments once per listening session started, and is echoed back by every
   * outcome that answers it.
   *
   * THIS IS WHAT MAKES A LATE RECOGNISER EVENT HARMLESS, and it is the same
   * discipline `searchState.requestId` uses against a superseded response. The
   * native recogniser is a process-wide singleton that keeps emitting after
   * `abort()` — a trailing `end` or `error` from a session the reader already
   * cancelled would otherwise reopen a closed overlay, or overwrite the state
   * of the session after it.
   */
  sessionId: number;
}

export type VoiceAction =
  // Intents — the surface asking for something. No session: they START one (or
  // end it), so there is nothing yet to be stale against.
  | { type: 'opened' }
  | { type: 'cancelled' }
  | { type: 'cleared' }
  | { type: 'submitted' }
  // Outcomes — the permission API and the recogniser answering. Every one
  // carries the session it belongs to.
  | { type: 'permissionGranted'; sessionId: number }
  | { type: 'permissionRefused'; sessionId: number }
  | { type: 'recognitionStarted'; sessionId: number }
  | { type: 'transcriptUpdated'; sessionId: number; transcript: string }
  | { type: 'speechEnded'; sessionId: number }
  /** A final result carrying no significant recognition — the `nomatch` event. */
  | { type: 'noMatch'; sessionId: number }
  | { type: 'recognitionEnded'; sessionId: number }
  | { type: 'recognitionFailed'; sessionId: number; code: VoiceErrorCode };

export const initialVoiceState: VoiceState = {
  status: 'closed',
  transcript: '',
  sessionId: 0,
};

// The statuses in which the recogniser is legitimately still talking to us.
// Anything arriving outside these is either late or impossible, and both are
// dropped rather than applied.
const OPEN_STATUSES: readonly VoiceStatus[] = ['listening', 'processing'];

function isOpen(status: VoiceStatus): boolean {
  return OPEN_STATUSES.includes(status);
}

// Drops a previous session's failure. The key is REMOVED rather than set to
// `undefined`, so "this session has not failed" has exactly one representation
// and a deep-equality assertion stays honest — `searchState.withoutResults`
// exists for the same reason.
function withoutError(state: VoiceState): Omit<VoiceState, 'errorCode'> {
  const { errorCode: _errorCode, ...rest } = state;

  return rest;
}

/**
 * Starts a fresh listening session.
 *
 * ALWAYS THROUGH `checkingPermission`, never straight to `listening`, and that
 * is deliberate even when this session's predecessor was already granted.
 * Permission is revocable from the Settings app while the overlay is open, so a
 * machine that remembered "granted" would open a mic it no longer has. The
 * check is a cheap resolved promise in the granted case, and the overlay renders
 * this status as "Listening…" — so what the reader sees is exactly the
 * return-to-listening the design asks for.
 */
function beginSession(state: VoiceState): VoiceState {
  return {
    ...withoutError(state),
    status: 'checkingPermission',
    transcript: '',
    sessionId: state.sessionId + 1,
  };
}

export function voiceReducer(state: VoiceState, action: VoiceAction): VoiceState {
  switch (action.type) {
    // The mic was pressed. Ignored while a session is already up, so a
    // double-tap cannot start a second recogniser against the first's events.
    case 'opened':
      if (state.status !== 'closed') return state;
      return beginSession(state);

    // The × or the hardware back button. Returns to `closed` from ANY state and
    // discards the transcript — a cancelled query is not a query, and leaving it
    // behind would offer it again the next time the overlay opened.
    //
    // The id still advances, which is the half that matters: it is what makes
    // the `end` and `error` events the recogniser fires after `abort()` land as
    // answers to a session nobody is listening to.
    case 'cancelled':
      if (state.status === 'closed') return state;
      return {
        ...withoutError(state),
        status: 'closed',
        transcript: '',
        sessionId: state.sessionId + 1,
      };

    // Clear — discard what was heard and listen again. Same restart as `opened`,
    // so a refusal, a silence and a finished transcript all recover the same
    // way and there is one path to keep correct.
    case 'cleared':
      if (state.status === 'closed') return state;
      return beginSession(state);

    // Search was pressed.
    //
    // GATED ON THE TRANSCRIPT, NOT ON `done`, because the design says so: the
    // mockup shows the Search button live and teal while the title still reads
    // "Listening…", over a transcript that is still growing. A reader who has
    // said enough may commit it without waiting for the recogniser to decide
    // the utterance is over, and `VoiceOverlay` enables the button on exactly
    // that condition (`hasTranscript`).
    //
    // It still carries the whole of "nothing heard must not start a search",
    // and more robustly than a status check would: every state that has not
    // heard anything holds an EMPTY transcript — `noSpeech`, `permissionDenied`
    // and `failed` all clear it — so one condition covers all of them, and a
    // future state cannot accidentally become submittable without also
    // acquiring words to submit.
    //
    // The transcript is NOT carried in this action. The caller already holds it
    // — it has been on screen — and a second copy travelling separately could
    // disagree with the one the reader read.
    case 'submitted':
      if (state.status === 'closed') return state;
      if (state.transcript.trim().length === 0) return state;
      return {
        ...withoutError(state),
        status: 'closed',
        transcript: '',
        sessionId: state.sessionId + 1,
      };

    case 'permissionGranted':
      if (action.sessionId !== state.sessionId) return state;
      if (state.status !== 'checkingPermission') return state;
      return { ...withoutError(state), status: 'listening' };

    case 'permissionRefused':
      if (action.sessionId !== state.sessionId) return state;
      if (state.status !== 'checkingPermission') return state;
      return {
        ...state,
        status: 'permissionDenied',
        transcript: '',
        errorCode: 'permission_denied',
      };

    // The recogniser's own `start` event — the mic is genuinely open now.
    // Tolerated from `checkingPermission` as well as `listening` because the
    // native event can beat the permission promise's resolution.
    case 'recognitionStarted':
      if (action.sessionId !== state.sessionId) return state;
      if (state.status !== 'checkingPermission' && state.status !== 'listening') return state;
      return { ...withoutError(state), status: 'listening' };

    // A partial or final result. Guarded on an OPEN status so a straggler cannot
    // put words back on a cancelled overlay, or onto one showing a refusal.
    case 'transcriptUpdated':
      if (action.sessionId !== state.sessionId) return state;
      if (!isOpen(state.status)) return state;
      return { ...state, transcript: action.transcript };

    // Speech stopped being detected; the recogniser is resolving a final result.
    case 'speechEnded':
      if (action.sessionId !== state.sessionId) return state;
      if (state.status !== 'listening') return state;
      return { ...state, status: 'processing' };

    // A final result that recognised nothing. The accumulated partials are
    // dropped rather than kept: the recogniser has just said it could not
    // confirm them, and searching the catalogue for an unconfirmed guess is
    // worse than reporting that nothing was heard.
    case 'noMatch':
      if (action.sessionId !== state.sessionId) return state;
      if (!isOpen(state.status)) return state;
      return { ...state, transcript: '' };

    // THE SESSION IS OVER, and this is where the two good outcomes are told
    // apart. `end` fires after a failure too — hence the open-status guard,
    // without which a recogniser error would be immediately overwritten by a
    // cheerful "no speech was heard".
    case 'recognitionEnded': {
      if (action.sessionId !== state.sessionId) return state;
      if (!isOpen(state.status)) return state;

      const heard = state.transcript.trim();
      if (heard.length === 0) {
        return { ...state, status: 'noSpeech', transcript: '', errorCode: 'no_speech' };
      }

      // Trimmed on the way out, so what gets submitted is what gets displayed
      // and `searchLink.searchParams` is not handed leading whitespace to strip
      // a second time.
      return { ...withoutError(state), status: 'done', transcript: heard };
    }

    case 'recognitionFailed': {
      if (action.sessionId !== state.sessionId) return state;
      // A failure may legitimately arrive during `checkingPermission` — `start()`
      // rejects with `service-not-allowed` on a device with no recogniser before
      // anything is ever open — so this is the one outcome not gated on an open
      // status. It is still gated on the session being current, and on the
      // overlay not already being closed.
      if (state.status === 'closed') return state;

      // The code decides the state, so a refusal reported through the error
      // channel lands on the same status a refused permission request does.
      // One rule, two routes in.
      const status: VoiceStatus =
        action.code === 'permission_denied'
          ? 'permissionDenied'
          : action.code === 'no_speech'
            ? 'noSpeech'
            : 'failed';

      return { ...state, status, transcript: '', errorCode: action.code };
    }
  }
}
