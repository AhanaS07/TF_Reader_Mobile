// Owner: Accessibility (Hruthik), added by Reader (Ahana) alongside the `focusOn` consolidation.
//
// WHY THIS EXISTS. `VoicePicker` and `TtsControls` each used to resolve the native node and guard
// the null cases inline; both now call Reader's shared `focusOn` (`src/features/reader/a11yFocus.ts`)
// so that logic lives in one place. Neither file's existing tests assert focus movement at all —
// they say so themselves, because `findNodeHandle` always resolves to null under
// react-test-renderer — which means that refactor could have silently deleted the behaviour and
// every suite would still have been green.
//
// Mocking `focusOn` is what makes it testable: the assertion becomes "focus was REQUESTED, for the
// right ref, at the right moment", which is the part this code owns. Whether the platform then
// moves the ring is the device pass's job.
//
// The timing is the other half worth pinning. Both call sites wrap `focusOn` in a `setTimeout`
// because RN's `Modal` attaches content on a native layer asynchronously — focusing the instant
// `visible` flips reliably no-ops. Fake timers let these tests prove the call lands AFTER the delay
// and not before, which is the property that delay exists for.

import { fireEvent, render, screen } from '@testing-library/react-native';
import { focusOn } from '@/features/reader/a11yFocus';
import { VoicePicker } from './VoicePicker';
import { TtsControls } from './TtsControls';
import type { TtsSession } from './useTtsSession';
import { DEFAULT_ACCESSIBILITY_PREFS } from '@/shared/contracts';

jest.mock('@/features/reader/a11yFocus', () => ({ focusOn: jest.fn() }));
jest.mock('./ttsEngine', () => ({ __esModule: true, default: {} }));

const focusOnMock = jest.mocked(focusOn);

function session(): TtsSession {
  return {
    status: 'idle',
    errorMessage: null,
    currentSentence: null,
    prefs: DEFAULT_ACCESSIBILITY_PREFS.tts,
    voices: [],
    play: jest.fn(),
    pause: jest.fn(),
    stop: jest.fn(),
    reloadVoices: jest.fn(),
    setRate: jest.fn(),
    setPitch: jest.fn(),
    setVoice: jest.fn(),
    setAutoContinueChapter: jest.fn(),
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  focusOnMock.mockClear();
});
afterEach(() => {
  jest.useRealTimers();
});

it('VoicePicker moves focus into the sheet after the mount delay', async () => {
  await render(
    <VoicePicker
      visible
      voices={[]}
      selectedVoiceId={null}
      onSelect={jest.fn()}
      onClose={jest.fn()}
    />,
  );
  expect(focusOnMock).not.toHaveBeenCalled(); // not before the delay
  jest.advanceTimersByTime(300);
  expect(focusOnMock).toHaveBeenCalledTimes(1);
  expect(focusOnMock.mock.calls[0][0]).toHaveProperty('current');
});

it('VoicePicker does NOT focus when it is not visible', async () => {
  await render(
    <VoicePicker
      visible={false}
      voices={[]}
      selectedVoiceId={null}
      onSelect={jest.fn()}
      onClose={jest.fn()}
    />,
  );
  jest.advanceTimersByTime(1000);
  expect(focusOnMock).not.toHaveBeenCalled();
});

it('TtsControls restores focus to the Voice button after closing the picker', async () => {
  await render(<TtsControls session={session()} />);
  await fireEvent.press(screen.getByLabelText('Choose voice'));
  focusOnMock.mockClear();
  await fireEvent.press(screen.getByLabelText('Close voice picker'));
  jest.advanceTimersByTime(300);
  expect(focusOnMock).toHaveBeenCalledTimes(1);
});
