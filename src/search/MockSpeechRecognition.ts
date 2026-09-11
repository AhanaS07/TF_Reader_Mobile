// src/search/MockSpeechRecognition.ts
// A stand-in for `expo-speech-recognition` under Jest, registered globally in
// `jest.setup.js` alongside the AsyncStorage and safe-area mocks.
//
// WHY IT HAS TO BE GLOBAL. `expo-speech-recognition` is a native module. Under
// Jest it resolves to nothing and throws at IMPORT time, so the whole suite
// fails to load rather than just the test that touches it — the same failure
// `jest.setup.js` already documents for AsyncStorage. Anything that reaches
// `SearchScreen` hits this, which includes `App.test.tsx`.
//
// WHAT IT DOES AND DOES NOT FAKE. It fakes the NATIVE BOUNDARY: the module's
// method surface and its event stream. It does not fake recognition and it does
// not fake a permission decision — a test states which permission answer the OS
// gives and which events the recogniser emits, and those are the two things a
// device would decide. Nothing here guesses at either, so a passing test says
// "given this answer from the OS, the app does the right thing", which is the
// only claim a test without a microphone can honestly make.
//
// Accuracy, audio capture and the real permission dialog are not reachable from
// Jest and are not simulated here. They are dev-build checks.
import { useEffect, useRef } from 'react';

// ─── The event stream ────────────────────────────────────────────────────────

// Mirrors the subset of `ExpoSpeechRecognitionNativeEventMap` the app listens
// to. Spelled locally rather than imported, because importing the real package
// for its types inside its own mock is a cycle waiting to happen.
export interface MockSpeechEvents {
  start: null;
  result: { isFinal: boolean; results: { transcript: string; confidence: number }[] };
  speechend: null;
  nomatch: null;
  end: null;
  error: { error: string; message: string };
}

type Listener = (payload: unknown) => void;

const listeners = new Map<string, Set<Listener>>();

// ─── What the "OS" and the recogniser were told to do ────────────────────────

let permissionGranted = true;
let running = false;
const startOptions: unknown[] = [];
let abortCount = 0;

// ─── The module surface the hook calls ───────────────────────────────────────

export const ExpoSpeechRecognitionModule = {
  start(options: unknown) {
    running = true;
    startOptions.push(options);
  },

  stop() {
    running = false;
  },

  abort() {
    running = false;
    abortCount += 1;
  },

  // Shaped as expo-modules-core's PermissionResponse, because the hook reads
  // `.granted` off it and a narrower fake would let a bug through.
  requestPermissionsAsync() {
    return Promise.resolve({
      granted: permissionGranted,
      status: permissionGranted ? 'granted' : 'denied',
      canAskAgain: !permissionGranted,
      expires: 'never' as const,
    });
  },
};

// ─── The listener hook ───────────────────────────────────────────────────────

/**
 * Registers once per mount and always calls the latest listener, which is what
 * the real `useEventListener` does. Re-registering on every render instead
 * would leak a subscription per render and fire a stale closure.
 */
export function useSpeechRecognitionEvent(eventName: string, listener: Listener) {
  const latest = useRef(listener);
  useEffect(() => {
    latest.current = listener;
  });

  useEffect(() => {
    const entry: Listener = (payload) => latest.current(payload);
    const forEvent = listeners.get(eventName) ?? new Set<Listener>();
    forEvent.add(entry);
    listeners.set(eventName, forEvent);

    return () => {
      forEvent.delete(entry);
    };
  }, [eventName]);
}

// ─── Test controls ───────────────────────────────────────────────────────────

/**
 * The seam a test drives. Emissions cause React state updates, so wrap
 * `emit` in `act(...)` — this module deliberately does not, because it cannot
 * know whether the caller also wants to assert between two events.
 */
export const mockSpeechRecognition = {
  /** Back to a granted device with no history. Call from `beforeEach`. */
  reset() {
    permissionGranted = true;
    running = false;
    abortCount = 0;
    startOptions.length = 0;
  },

  /** What the OS answers the next permission request with. */
  setPermissionGranted(granted: boolean) {
    permissionGranted = granted;
  },

  /** Fires a native event at everything currently listening for it. */
  emit<K extends keyof MockSpeechEvents>(eventName: K, payload: MockSpeechEvents[K]) {
    for (const listener of listeners.get(eventName) ?? []) listener(payload);
  },

  /** One partial or final result, in the shape the native module sends. */
  emitTranscript(transcript: string, isFinal = false) {
    this.emit('result', { isFinal, results: [{ transcript, confidence: 1 }] });
  },

  /** Whether `start()` has been called without a later `stop()`/`abort()`. */
  isRunning() {
    return running;
  },

  /** The options each `start()` was called with — one entry per call. */
  startCalls() {
    return [...startOptions];
  },

  abortCount() {
    return abortCount;
  },
};
