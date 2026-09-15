// src/search/voiceState.test.ts
// Recogniser state, tested as a pure function — no render, no microphone, no
// permission dialog, no timers. That is the payoff for keeping the transitions
// out of the hook: every rule screen 11 depends on is asserted here in a line,
// including the ones that are only ever visible as bugs on a real device (a
// trailing event from a cancelled session, a silence reported as a breakage, an
// unconfirmed partial submitted as a query).
import {
  initialVoiceState,
  voiceReducer,
  type VoiceAction,
  type VoiceState,
} from '@search/voiceState';

// Runs a sequence from the initial state, so each test reads as the interaction
// it describes rather than as a hand-assembled state object.
function run(...actions: VoiceAction[]): VoiceState {
  return actions.reduce(voiceReducer, initialVoiceState);
}

// The session the surface is currently in — what an outcome must echo to be
// applied. The first press of the mic always produces 1.
const SESSION = 1;

// The mic press plus a granted permission: the shortest route to an open
// microphone, which is where most of these tests actually start.
const LISTENING: VoiceAction[] = [
  { type: 'opened' },
  { type: 'permissionGranted', sessionId: SESSION },
];

// A complete, successful utterance.
function heard(words: string): VoiceAction[] {
  return [
    ...LISTENING,
    { type: 'transcriptUpdated', sessionId: SESSION, transcript: words },
    { type: 'speechEnded', sessionId: SESSION },
    { type: 'recognitionEnded', sessionId: SESSION },
  ];
}

describe('opening the overlay', () => {
  it('starts closed, with nothing heard', () => {
    expect(initialVoiceState.status).toBe('closed');
    expect(initialVoiceState.transcript).toBe('');
  });

  // The mic is not open yet — the OS dialog is. Conflating the two would leave
  // the machine unable to tell a refusal from a silence.
  it('checks permission before it claims to be listening', () => {
    const state = run({ type: 'opened' });

    expect(state.status).toBe('checkingPermission');
  });

  it('starts a session the recogniser can be held to', () => {
    const state = run({ type: 'opened' });

    expect(state.sessionId).toBe(SESSION);
  });

  // A second recogniser started against the first one's events is the classic
  // double-tap bug.
  it('ignores a second press while a session is already up', () => {
    const once = run({ type: 'opened' });
    const twice = voiceReducer(once, { type: 'opened' });

    expect(twice).toBe(once);
  });
});

describe('permission', () => {
  it('opens the microphone when it is granted', () => {
    const state = run(...LISTENING);

    expect(state.status).toBe('listening');
    expect(state.errorCode).toBeUndefined();
  });

  it('reports a refusal as its own state, not a generic failure', () => {
    const state = run({ type: 'opened' }, { type: 'permissionRefused', sessionId: SESSION });

    expect(state.status).toBe('permissionDenied');
    expect(state.errorCode).toBe('permission_denied');
  });

  // The state the whole refusal path exists to prevent.
  it('never reaches listening after a refusal', () => {
    const state = run({ type: 'opened' }, { type: 'permissionRefused', sessionId: SESSION });

    expect(state.status).not.toBe('listening');
  });

  // A refused session has no transcript to offer, and Search is unreachable
  // from anywhere but `done`.
  it('leaves nothing to submit after a refusal', () => {
    const refused = run({ type: 'opened' }, { type: 'permissionRefused', sessionId: SESSION });
    const state = voiceReducer(refused, { type: 'submitted' });

    expect(state.transcript).toBe('');
    expect(state.status).toBe('permissionDenied');
  });

  // The native `start` event can beat the permission promise's resolution.
  it('accepts the recogniser starting before the permission promise resolves', () => {
    const state = run({ type: 'opened' }, { type: 'recognitionStarted', sessionId: SESSION });

    expect(state.status).toBe('listening');
  });
});

describe('the transcript grows while listening', () => {
  it('records a partial result', () => {
    const state = run(...LISTENING, {
      type: 'transcriptUpdated',
      sessionId: SESSION,
      transcript: 'machine learning',
    });

    expect(state.transcript).toBe('machine learning');
    expect(state.status).toBe('listening');
  });

  it('replaces the partial as it is refined, rather than appending', () => {
    const state = run(
      ...LISTENING,
      { type: 'transcriptUpdated', sessionId: SESSION, transcript: 'machine' },
      { type: 'transcriptUpdated', sessionId: SESSION, transcript: 'machine learning' },
    );

    expect(state.transcript).toBe('machine learning');
  });

  it('keeps taking results once speech has stopped and the final is resolving', () => {
    const state = run(
      ...LISTENING,
      { type: 'speechEnded', sessionId: SESSION },
      { type: 'transcriptUpdated', sessionId: SESSION, transcript: 'machine learning' },
    );

    expect(state.status).toBe('processing');
    expect(state.transcript).toBe('machine learning');
  });

  // Listening and transcribing render differently — the pulse ring says the mic
  // is open, and leaving it running through the final would be a lie.
  it('moves to processing when speech stops', () => {
    const state = run(...LISTENING, { type: 'speechEnded', sessionId: SESSION });

    expect(state.status).toBe('processing');
  });
});

describe('a session that heard something', () => {
  it('ends with a transcript ready to search', () => {
    const state = run(...heard('machine learning in healthcare'));

    expect(state.status).toBe('done');
    expect(state.transcript).toBe('machine learning in healthcare');
    expect(state.errorCode).toBeUndefined();
  });

  // What is submitted is what was displayed, and `searchParams` is not handed
  // whitespace to strip a second time.
  it('trims the transcript on the way out', () => {
    const state = run(...heard('  climate  '));

    expect(state.transcript).toBe('climate');
  });

  it('closes and clears when the transcript is submitted', () => {
    const done = run(...heard('climate'));
    const state = voiceReducer(done, { type: 'submitted' });

    expect(state.status).toBe('closed');
    expect(state.transcript).toBe('');
  });
});

describe('committing before the recogniser has finished', () => {
  // The design's own state: the mockup shows Search live and teal while the
  // title still reads "Listening…", over a transcript that is still growing.
  // A reader who has said enough does not have to wait to be told they have.
  it('submits a partial the reader is happy with', () => {
    const listening = run(...LISTENING, {
      type: 'transcriptUpdated',
      sessionId: SESSION,
      transcript: 'machine learning',
    });
    const state = voiceReducer(listening, { type: 'submitted' });

    expect(state.status).toBe('closed');
  });

  it('submits from processing, while the final is still resolving', () => {
    const processing = run(
      ...LISTENING,
      { type: 'transcriptUpdated', sessionId: SESSION, transcript: 'climate' },
      { type: 'speechEnded', sessionId: SESSION },
    );
    const state = voiceReducer(processing, { type: 'submitted' });

    expect(state.status).toBe('closed');
  });

  // The gate is the transcript, not the status — so a session that has heard
  // nothing yet stays unsubmittable even though it is perfectly healthy.
  it('refuses to submit before a single word has been heard', () => {
    const listening = run(...LISTENING);
    const state = voiceReducer(listening, { type: 'submitted' });

    expect(state).toBe(listening);
    expect(state.status).toBe('listening');
  });

  it('refuses to submit a transcript that is only whitespace', () => {
    const listening = run(...LISTENING, {
      type: 'transcriptUpdated',
      sessionId: SESSION,
      transcript: '   ',
    });
    const state = voiceReducer(listening, { type: 'submitted' });

    expect(state).toBe(listening);
  });

  // The old session must not be able to answer the surface it just left.
  it('advances the session on the way out', () => {
    const state = run(...heard('climate'), { type: 'submitted' });

    expect(state.sessionId).toBeGreaterThan(SESSION);
  });
});

describe('a session that heard nothing', () => {
  it('is noSpeech, not a failure', () => {
    const state = run(...LISTENING, { type: 'recognitionEnded', sessionId: SESSION });

    expect(state.status).toBe('noSpeech');
    expect(state.status).not.toBe('failed');
    expect(state.errorCode).toBe('no_speech');
  });

  // Whitespace is not speech.
  it('treats a blank transcript as nothing heard', () => {
    const state = run(
      ...LISTENING,
      { type: 'transcriptUpdated', sessionId: SESSION, transcript: '   ' },
      { type: 'recognitionEnded', sessionId: SESSION },
    );

    expect(state.status).toBe('noSpeech');
    expect(state.transcript).toBe('');
  });

  // The rule that keeps a silence from becoming a catalogue query.
  it('cannot be submitted', () => {
    const silent = run(...LISTENING, { type: 'recognitionEnded', sessionId: SESSION });
    const state = voiceReducer(silent, { type: 'submitted' });

    expect(state).toBe(silent);
  });

  // `nomatch` means the recogniser could not confirm what it was hearing.
  // Searching the catalogue for an unconfirmed guess finds the wrong books,
  // which is worse than reporting that nothing was heard.
  it('discards an unconfirmed partial rather than submitting it', () => {
    const state = run(
      ...LISTENING,
      { type: 'transcriptUpdated', sessionId: SESSION, transcript: 'mushroom lightning' },
      { type: 'noMatch', sessionId: SESSION },
      { type: 'recognitionEnded', sessionId: SESSION },
    );

    expect(state.status).toBe('noSpeech');
    expect(state.transcript).toBe('');
  });
});

describe('a recogniser that broke', () => {
  it('reports an unavailable recogniser as failed', () => {
    const state = run(...LISTENING, {
      type: 'recognitionFailed',
      sessionId: SESSION,
      code: 'no_recogniser',
    });

    expect(state.status).toBe('failed');
    expect(state.errorCode).toBe('no_recogniser');
  });

  it('keeps a network failure distinct from a silence', () => {
    const state = run(...LISTENING, {
      type: 'recognitionFailed',
      sessionId: SESSION,
      code: 'network',
    });

    expect(state.status).toBe('failed');
    expect(state.errorCode).toBe('network');
  });

  // A refusal reported through the error channel must land where a refused
  // permission request lands. One rule, two routes in.
  it('routes a refusal reported as an error to permissionDenied', () => {
    const state = run(...LISTENING, {
      type: 'recognitionFailed',
      sessionId: SESSION,
      code: 'permission_denied',
    });

    expect(state.status).toBe('permissionDenied');
  });

  it('routes a no-speech reported as an error to noSpeech', () => {
    const state = run(...LISTENING, {
      type: 'recognitionFailed',
      sessionId: SESSION,
      code: 'no_speech',
    });

    expect(state.status).toBe('noSpeech');
  });

  // `start()` can reject before anything is open, on a device with no service.
  it('can fail before the microphone was ever opened', () => {
    const state = run({ type: 'opened' }, {
      type: 'recognitionFailed',
      sessionId: SESSION,
      code: 'no_recogniser',
    });

    expect(state.status).toBe('failed');
  });

  // `end` fires after a failure too. Without the guard the reader would watch a
  // real error be replaced by a cheerful "no speech was heard".
  it('is not overwritten by the end event that follows it', () => {
    const state = run(
      ...LISTENING,
      { type: 'recognitionFailed', sessionId: SESSION, code: 'network' },
      { type: 'recognitionEnded', sessionId: SESSION },
    );

    expect(state.status).toBe('failed');
    expect(state.errorCode).toBe('network');
  });

  it('cannot be submitted', () => {
    const broken = run(...LISTENING, {
      type: 'recognitionFailed',
      sessionId: SESSION,
      code: 'unknown',
    });
    const state = voiceReducer(broken, { type: 'submitted' });

    expect(state).toBe(broken);
  });
});

describe('cancelling', () => {
  it('closes from listening and discards what was heard', () => {
    const state = run(
      ...LISTENING,
      { type: 'transcriptUpdated', sessionId: SESSION, transcript: 'climate' },
      { type: 'cancelled' },
    );

    expect(state.status).toBe('closed');
    expect(state.transcript).toBe('');
  });

  it('closes from a finished transcript without submitting it', () => {
    const state = run(...heard('climate'), { type: 'cancelled' });

    expect(state.status).toBe('closed');
    expect(state.transcript).toBe('');
  });

  it('closes from a refusal', () => {
    const state = run(
      { type: 'opened' },
      { type: 'permissionRefused', sessionId: SESSION },
      { type: 'cancelled' },
    );

    expect(state.status).toBe('closed');
    expect(state.errorCode).toBeUndefined();
  });

  it('is a no-op when nothing is open', () => {
    const state = voiceReducer(initialVoiceState, { type: 'cancelled' });

    expect(state).toBe(initialVoiceState);
  });

  // The half that makes late events harmless — see the next block.
  it('advances the session so the old one can no longer be answered', () => {
    const state = run(...LISTENING, { type: 'cancelled' });

    expect(state.sessionId).toBeGreaterThan(SESSION);
  });
});

describe('late events from a cancelled session', () => {
  // The native recogniser is a process-wide singleton and keeps emitting after
  // abort(). Every one of these would be a visible bug: an overlay the reader
  // just dismissed putting itself back on screen.
  const CANCELLED = [...LISTENING, { type: 'cancelled' } as const];

  it('ignores a trailing result', () => {
    const cancelled = run(...CANCELLED);
    const state = voiceReducer(cancelled, {
      type: 'transcriptUpdated',
      sessionId: SESSION,
      transcript: 'climate',
    });

    expect(state).toBe(cancelled);
    expect(state.transcript).toBe('');
  });

  it('ignores a trailing end, and does not reopen as noSpeech', () => {
    const cancelled = run(...CANCELLED);
    const state = voiceReducer(cancelled, { type: 'recognitionEnded', sessionId: SESSION });

    expect(state).toBe(cancelled);
    expect(state.status).toBe('closed');
  });

  it('ignores a trailing error, and does not reopen as failed', () => {
    const cancelled = run(...CANCELLED);
    const state = voiceReducer(cancelled, {
      type: 'recognitionFailed',
      sessionId: SESSION,
      code: 'unknown',
    });

    expect(state).toBe(cancelled);
    expect(state.status).toBe('closed');
  });

  it('ignores a permission answer that arrives after the reader gave up', () => {
    const cancelled = run({ type: 'opened' }, { type: 'cancelled' });
    const state = voiceReducer(cancelled, { type: 'permissionGranted', sessionId: SESSION });

    expect(state).toBe(cancelled);
    expect(state.status).toBe('closed');
  });

  // Not just cancellation: the session after this one must not inherit the
  // previous one's answers either.
  it('ignores an old session answering while a NEW one is listening', () => {
    const restarted = run(...LISTENING, { type: 'cancelled' }, { type: 'opened' });
    const state = voiceReducer(restarted, {
      type: 'transcriptUpdated',
      sessionId: SESSION,
      transcript: 'stale words',
    });

    expect(state.transcript).toBe('');
  });
});

describe('clearing and retrying', () => {
  it('restarts listening with an empty transcript from a finished transcript', () => {
    const state = run(...heard('climate'), { type: 'cleared' });

    expect(state.status).toBe('checkingPermission');
    expect(state.transcript).toBe('');
  });

  it('restarts from a silence', () => {
    const state = run(
      ...LISTENING,
      { type: 'recognitionEnded', sessionId: SESSION },
      { type: 'cleared' },
    );

    expect(state.status).toBe('checkingPermission');
    expect(state.errorCode).toBeUndefined();
  });

  it('restarts from a failure, dropping the error', () => {
    const state = run(
      ...LISTENING,
      { type: 'recognitionFailed', sessionId: SESSION, code: 'network' },
      { type: 'cleared' },
    );

    expect(state.status).toBe('checkingPermission');
    expect(state.errorCode).toBeUndefined();
  });

  // Permission is revocable from Settings while the overlay is open, so a
  // retry after a refusal has to ask again rather than assume the old answer.
  it('re-checks permission when retrying after a refusal', () => {
    const state = run(
      { type: 'opened' },
      { type: 'permissionRefused', sessionId: SESSION },
      { type: 'cleared' },
    );

    expect(state.status).toBe('checkingPermission');
  });

  it('advances the session so the cleared attempt cannot answer the new one', () => {
    const state = run(...heard('climate'), { type: 'cleared' });

    expect(state.sessionId).toBeGreaterThan(SESSION);
  });

  it('is a no-op when nothing is open', () => {
    const state = voiceReducer(initialVoiceState, { type: 'cleared' });

    expect(state).toBe(initialVoiceState);
  });
});

describe('the error key is removed rather than blanked', () => {
  // Same reason `searchState.withoutResults` deletes its optional keys: one
  // representation of "this session has not failed", so a deep-equality
  // assertion stays honest.
  it('carries no errorCode key at all on a healthy session', () => {
    const state = run(...heard('climate'));

    expect('errorCode' in state).toBe(false);
  });

  it('drops the key when a new session begins', () => {
    const state = run(
      { type: 'opened' },
      { type: 'permissionRefused', sessionId: SESSION },
      { type: 'cleared' },
    );

    expect('errorCode' in state).toBe(false);
  });
});
