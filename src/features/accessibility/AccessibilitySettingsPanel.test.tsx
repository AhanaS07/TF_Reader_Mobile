// Owner: Accessibility (Hruthik).
//
// Pins: initial render reflects the seeded prefs, each control saves a patch that spreads both
// `accessibility` and the touched sub-block only (the "patches merge at the top level only" rule
// every prefs writer in this app must follow), Reduce Motion saves the raw tri-state string rather
// than a collapsed boolean, and the Dyslexia Font control hides for non-EPUB formats.

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { prefsStore } from '@/features/personalization/prefsStore';
import { DEFAULT_ACCESSIBILITY_PREFS } from '@/shared/contracts';

import { AccessibilitySettingsPanel } from './AccessibilitySettingsPanel';

jest.mock('@/features/personalization/prefsStore', () => ({
  prefsStore: { getPrefs: jest.fn(), savePrefs: jest.fn(), subscribe: jest.fn() },
}));

const getPrefsMock = prefsStore.getPrefs as jest.Mock;
const savePrefsMock = prefsStore.savePrefs as jest.Mock;
const subscribeMock = prefsStore.subscribe as jest.Mock;

describe('AccessibilitySettingsPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    subscribeMock.mockReturnValue(() => undefined);
    getPrefsMock.mockResolvedValue({ accessibility: structuredClone(DEFAULT_ACCESSIBILITY_PREFS) });
    savePrefsMock.mockResolvedValue(undefined);
  });

  it('renders all three controls at their stored defaults', async () => {
    await render(<AccessibilitySettingsPanel />);
    await waitFor(() => expect(getPrefsMock).toHaveBeenCalled());

    expect(screen.getByLabelText('Dyslexia font: Off')).toBeTruthy();
    expect(screen.getByLabelText('High contrast: Off')).toBeTruthy();
    expect(screen.getByLabelText('Reduce motion: System')).toBeTruthy();
  });

  it('pressing Dyslexia Font saves a patch that only touches text.dyslexiaFont', async () => {
    await render(<AccessibilitySettingsPanel />);
    await waitFor(() => expect(getPrefsMock).toHaveBeenCalled());

    await fireEvent.press(screen.getByLabelText('Dyslexia font: Off'));

    expect(savePrefsMock).toHaveBeenCalledWith({
      accessibility: {
        ...DEFAULT_ACCESSIBILITY_PREFS,
        text: { ...DEFAULT_ACCESSIBILITY_PREFS.text, dyslexiaFont: true },
      },
    });
  });

  it('pressing High Contrast saves a patch that only touches display.highContrast', async () => {
    await render(<AccessibilitySettingsPanel />);
    await waitFor(() => expect(getPrefsMock).toHaveBeenCalled());

    await fireEvent.press(screen.getByLabelText('High contrast: Off'));

    expect(savePrefsMock).toHaveBeenCalledWith({
      accessibility: {
        ...DEFAULT_ACCESSIBILITY_PREFS,
        display: { ...DEFAULT_ACCESSIBILITY_PREFS.display, highContrast: true },
      },
    });
  });

  it('pressing a Reduce Motion option saves the raw tri-state value, not a boolean', async () => {
    await render(<AccessibilitySettingsPanel />);
    await waitFor(() => expect(getPrefsMock).toHaveBeenCalled());

    await fireEvent.press(screen.getByLabelText('Reduce motion: On'));

    expect(savePrefsMock).toHaveBeenCalledWith({
      accessibility: {
        ...DEFAULT_ACCESSIBILITY_PREFS,
        display: { ...DEFAULT_ACCESSIBILITY_PREFS.display, reduceMotion: 'on' },
      },
    });
  });

  it('hides the Dyslexia Font control for a PDF — pdf.js rasterises pages, no text CSS layer to override', async () => {
    await render(<AccessibilitySettingsPanel format="PDF" />);
    await waitFor(() => expect(getPrefsMock).toHaveBeenCalled());

    expect(screen.queryByLabelText(/Dyslexia font/)).toBeNull();
    expect(screen.getByLabelText('High contrast: Off')).toBeTruthy();
  });

  it('shows the Dyslexia Font control for an EPUB', async () => {
    await render(<AccessibilitySettingsPanel format="EPUB" />);
    await waitFor(() => expect(getPrefsMock).toHaveBeenCalled());

    expect(screen.getByLabelText('Dyslexia font: Off')).toBeTruthy();
  });
});
