// Owner: Accessibility (Hruthik).
//
// TtsControls is "NOT MOUNTED ANYWHERE YET" (see its own header) — this is the only place its
// pitch row is exercised until Reader mounts it. Takes a hand-built TtsSession rather than
// useTtsSession itself, mirroring the component's own contract: it only knows how to drive the
// session it's handed.

import { fireEvent, render, screen, within } from '@testing-library/react-native';

import { DEFAULT_ACCESSIBILITY_PREFS } from '@/shared/contracts';
import type { A11yTtsPrefs } from '@/shared/contracts';

import { TtsControls } from './TtsControls';
import type { Voice } from './ttsEngine';
import type { TtsSession } from './useTtsSession';

function makeSession(overrides: Partial<TtsSession> = {}): TtsSession {
  const prefs: A11yTtsPrefs = { ...DEFAULT_ACCESSIBILITY_PREFS.tts, ...overrides.prefs };
  return {
    status: 'idle',
    errorMessage: null,
    currentSentence: null,
    prefs,
    voices: [],
    play: jest.fn(),
    pause: jest.fn(),
    stop: jest.fn(),
    reloadVoices: jest.fn(),
    setRate: jest.fn(),
    setPitch: jest.fn(),
    setVoice: jest.fn(),
    setAutoContinueChapter: jest.fn(),
    ...overrides,
  };
}

function makeVoice(overrides: Partial<Voice> = {}): Voice {
  return {
    id: 'v1',
    name: 'Voice One',
    language: 'en-US',
    quality: 1,
    latency: 0,
    networkConnectionRequired: false,
    notInstalled: false,
    ...overrides,
  };
}

describe('TtsControls', () => {
  it('renders a chip for every pitch stop, marking the current pitch selected', async () => {
    const session = makeSession({ prefs: { ...DEFAULT_ACCESSIBILITY_PREFS.tts, pitch: 1.5 } });
    await render(<TtsControls session={session} />);

    const pitchRow = within(screen.getByTestId('tts-pitch-row'));
    expect(screen.getByText('Pitch')).toBeTruthy();
    expect(pitchRow.getByText('1.5x')).toBeTruthy();
  });

  it('pressing a pitch chip calls session.setPitch with that value', async () => {
    const session = makeSession();
    await render(<TtsControls session={session} />);

    const pitchRow = within(screen.getByTestId('tts-pitch-row'));
    await fireEvent.press(pitchRow.getByText('1.25x'));

    expect(session.setPitch).toHaveBeenCalledWith(1.25);
  });
});

// `AccessibilityInfo.setAccessibilityFocus` itself isn't asserted here: it needs a real native
// tag, and `findNodeHandle` always resolves to `null` under react-test-renderer (no host
// environment to assign one) — see VoicePicker.test.tsx's header comment for the same note.
// What's covered instead is the wiring these tests can actually observe: RN's own Modal
// visibility filtering means the picker's content (and the backdrop specifically — see the
// sibling-hiding regression test in VoicePicker.test.tsx) is only queryable while open, so
// opening/closing correctly is verifiable without touching `findNodeHandle` at all.
describe('TtsControls — voice picker open/close wiring', () => {
  it('opening the voice picker reloads voices and surfaces its content', async () => {
    const session = makeSession({ voices: [makeVoice()] });
    await render(<TtsControls session={session} />);
    expect(screen.queryByLabelText('Close voice picker')).toBeNull();

    await fireEvent.press(screen.getByLabelText('Choose voice'));

    expect(session.reloadVoices).toHaveBeenCalled();
    expect(screen.getByLabelText('Close voice picker')).toBeTruthy();
  });

  it('closing via the backdrop hides the voice picker again', async () => {
    const session = makeSession();
    await render(<TtsControls session={session} />);
    await fireEvent.press(screen.getByLabelText('Choose voice'));

    await fireEvent.press(screen.getByLabelText('Close voice picker'));

    expect(screen.queryByLabelText('Close voice picker')).toBeNull();
  });

  it('selecting a voice sets it and closes the picker', async () => {
    const session = makeSession({ voices: [makeVoice()] });
    await render(<TtsControls session={session} />);
    await fireEvent.press(screen.getByLabelText('Choose voice'));

    await fireEvent.press(screen.getByLabelText('Voice One, en-US'));

    expect(session.setVoice).toHaveBeenCalledWith('v1');
    expect(screen.queryByLabelText('Close voice picker')).toBeNull();
  });
});
