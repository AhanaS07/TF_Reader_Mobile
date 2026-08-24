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
