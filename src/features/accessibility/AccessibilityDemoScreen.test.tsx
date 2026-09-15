// Owner: Accessibility (Hruthik). TEMPORARY — pins the demo screen renders and reacts to toggles,
// since there's no simulator available in this environment to eyeball it directly. Delete alongside
// AccessibilityDemoScreen.tsx once Handoff B lands and this screen is no longer needed.

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { prefsStore } from '@/features/personalization/prefsStore';
import { DEFAULT_ACCESSIBILITY_PREFS } from '@/shared/contracts';

import { AccessibilityDemoScreen } from './AccessibilityDemoScreen';

jest.mock('@/features/personalization/prefsStore', () => ({
  prefsStore: { getPrefs: jest.fn(), savePrefs: jest.fn(), subscribe: jest.fn() },
}));

jest.mock('./dyslexiaFontLoader', () => ({
  loadDyslexiaFontFaceSrc: jest.fn().mockResolvedValue('data:font/ttf;base64,AAAA'),
}));

const getPrefsMock = prefsStore.getPrefs as jest.Mock;
const savePrefsMock = prefsStore.savePrefs as jest.Mock;
const subscribeMock = prefsStore.subscribe as jest.Mock;

describe('AccessibilityDemoScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    subscribeMock.mockReturnValue(() => undefined);
    getPrefsMock.mockResolvedValue({ accessibility: structuredClone(DEFAULT_ACCESSIBILITY_PREFS) });
    savePrefsMock.mockImplementation((patch) =>
      Promise.resolve({ accessibility: patch.accessibility }),
    );
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: jest.fn() } as never);
  });

  it('renders all three preview sections plus the live settings panel', async () => {
    await render(<AccessibilityDemoScreen />);
    await waitFor(() => expect(getPrefsMock).toHaveBeenCalled());

    expect(screen.getByLabelText('Dyslexia font: Off')).toBeTruthy();
    expect(screen.getByText('1. Dyslexia font preview')).toBeTruthy();
    expect(screen.getByText('2. High contrast preview')).toBeTruthy();
    expect(screen.getByText('light')).toBeTruthy();
    expect(screen.getByText('dark')).toBeTruthy();
    expect(screen.getByText('3. Reduced motion preview')).toBeTruthy();
    expect(screen.getByText('Stored preference: system')).toBeTruthy();
    expect(screen.getByText('OS Reduce Motion: Off')).toBeTruthy();
    expect(screen.getByText('Effective (resolveReduceMotion): false')).toBeTruthy();
  });

  it('reflects a live prefsStore update (e.g. from the panel above) in the reduced-motion preview', async () => {
    await render(<AccessibilityDemoScreen />);
    await waitFor(() => expect(getPrefsMock).toHaveBeenCalled());

    const listener = subscribeMock.mock.calls.at(-1)?.[0];
    await act(async () => {
      listener({
        accessibility: {
          ...DEFAULT_ACCESSIBILITY_PREFS,
          display: { ...DEFAULT_ACCESSIBILITY_PREFS.display, reduceMotion: 'on' },
        },
      });
    });

    expect(screen.getByText('Stored preference: on')).toBeTruthy();
    expect(screen.getByText('Effective (resolveReduceMotion): true')).toBeTruthy();
  });

  it('pressing the High Contrast chip in the embedded panel saves through prefsStore', async () => {
    await render(<AccessibilityDemoScreen />);
    await waitFor(() => expect(getPrefsMock).toHaveBeenCalled());

    await fireEvent.press(screen.getByLabelText('High contrast: Off'));

    expect(savePrefsMock).toHaveBeenCalledWith({
      accessibility: {
        ...DEFAULT_ACCESSIBILITY_PREFS,
        display: { ...DEFAULT_ACCESSIBILITY_PREFS.display, highContrast: true },
      },
    });
  });
});
