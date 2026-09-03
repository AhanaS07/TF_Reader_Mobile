// Owner: Accessibility (Hruthik).
//
// TtsControls IS mounted — ReaderScreen renders it whenever TTS is enabled for an EPUB, in place
// of the page-navigation row. (This note used to say "NOT MOUNTED ANYWHERE YET", back when the
// only way to see it was the since-deleted TTS Demo route.) Still the only place its pitch row is
// exercised directly. Takes a hand-built TtsSession rather than useTtsSession itself, mirroring
// the component's own contract: it only knows how to drive the session it's handed.

import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { useAppearanceEnv } from '@/features/reader/useAppearanceEnv';
import { DEFAULT_ACCESSIBILITY_PREFS } from '@/shared/contracts';
import type { A11yTtsPrefs } from '@/shared/contracts';

import { FOCUS_RING_COLOR } from '../a11yConstants';
import { TtsControls } from './TtsControls';
import type { Voice } from './ttsEngine';
import type { TtsSession } from './useTtsSession';

// Mocked for the same reason ReaderScreen.test.tsx mocks it: `osFontScale` has no dedicated change
// event, so tests control it directly rather than depending on a real PixelRatio read.
jest.mock('@/features/reader/useAppearanceEnv', () => ({
  useAppearanceEnv: jest.fn(),
}));

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

beforeEach(() => {
  jest.mocked(useAppearanceEnv).mockReturnValue({
    osColorScheme: 'light',
    osFontScale: 1,
    osReduceMotionEnabled: false,
  });
});

describe('TtsControls — touch targets and focus ring', () => {
  it('gives every transport button and chip at least a 44x44 touch target', async () => {
    const session = makeSession();
    await render(<TtsControls session={session} />);

    for (const label of ['Play', 'Stop', 'Choose voice']) {
      const style = StyleSheet.flatten(screen.getByLabelText(label).props.style);
      expect(style.minHeight).toBeGreaterThanOrEqual(44);
      expect(style.minWidth).toBeGreaterThanOrEqual(44);
    }

    const chipStyle = StyleSheet.flatten(screen.getByLabelText('1x speed').props.style);
    expect(chipStyle.minHeight).toBeGreaterThanOrEqual(44);
    expect(chipStyle.minWidth).toBeGreaterThanOrEqual(44);
  });

  it('shows the focus ring while a button is focused and hides it on blur', async () => {
    const session = makeSession();
    await render(<TtsControls session={session} />);
    const voiceButton = screen.getByLabelText('Choose voice');

    expect(StyleSheet.flatten(voiceButton.props.style).borderColor).toBe('transparent');

    await fireEvent(voiceButton, 'focus');
    expect(StyleSheet.flatten(voiceButton.props.style).borderColor).toBe(FOCUS_RING_COLOR);

    await fireEvent(voiceButton, 'blur');
    expect(StyleSheet.flatten(voiceButton.props.style).borderColor).toBe('transparent');
  });

  it('scales button and chip text with the OS font scale', async () => {
    jest.mocked(useAppearanceEnv).mockReturnValue({
      osColorScheme: 'light',
      osFontScale: 2,
      osReduceMotionEnabled: false,
    });
    const session = makeSession();
    await render(<TtsControls session={session} />);

    expect(StyleSheet.flatten(screen.getByText('Play').props.style).fontSize).toBe(28);
    const speedRow = within(screen.getByTestId('tts-speed-row'));
    expect(StyleSheet.flatten(speedRow.getByText('1x').props.style).fontSize).toBe(26);
  });
});

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
