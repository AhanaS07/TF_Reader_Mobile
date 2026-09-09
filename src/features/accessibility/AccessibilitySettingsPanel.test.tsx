// Owner: Accessibility (Hruthik).
//
// Pins: initial render reflects the seeded prefs, each control saves a patch that spreads both
// `accessibility` and the touched sub-block only (the "patches merge at the top level only" rule
// every prefs writer in this app must follow), Reduce Motion saves the raw tri-state string rather
// than a collapsed boolean, and the Dyslexia Font control hides for non-EPUB formats.
//
// The TTS on/off and announce-gate cases below were PORTED from DevPreferencesMenu.test.tsx when
// that UI moved into this panel — same assertions, same exact-match patch style already used above
// for Dyslexia Font/High Contrast/Reduce Motion (rather than DevPreferencesMenu's own
// `expect.objectContaining`), so all five controls in this file are pinned the same way.

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

  it('renders all five controls at their stored defaults', async () => {
    await render(<AccessibilitySettingsPanel />);
    await waitFor(() => expect(getPrefsMock).toHaveBeenCalled());

    expect(screen.getByLabelText('Dyslexia font: Off')).toBeTruthy();
    expect(screen.getByLabelText('High contrast: Off')).toBeTruthy();
    expect(screen.getByLabelText('Reduce motion: System')).toBeTruthy();
    expect(screen.getByLabelText('TTS: Off')).toBeTruthy();
    // Both announce gates default ON — see `toggleAnnounce`'s own comment for why these are plain
    // flips rather than this file's usual revert-to-default toggles.
    expect(screen.getByLabelText('Pages announcements: On')).toBeTruthy();
    expect(screen.getByLabelText('Chapters announcements: On')).toBeTruthy();
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

  it('pressing TTS saves a patch that only touches tts.enabled', async () => {
    await render(<AccessibilitySettingsPanel />);
    await waitFor(() => expect(getPrefsMock).toHaveBeenCalled());

    await fireEvent.press(screen.getByLabelText('TTS: Off'));

    expect(savePrefsMock).toHaveBeenCalledWith({
      accessibility: {
        ...DEFAULT_ACCESSIBILITY_PREFS,
        tts: { ...DEFAULT_ACCESSIBILITY_PREFS.tts, enabled: true },
      },
    });
  });

  it('turns page announcements off without touching chapters', async () => {
    // Separate preferences on purpose: a page turn announces constantly, a chapter change a handful
    // of times a book. Silencing one must not silence the other.
    await render(<AccessibilitySettingsPanel />);
    await waitFor(() => expect(getPrefsMock).toHaveBeenCalled());

    await fireEvent.press(screen.getByLabelText('Pages announcements: On'));

    expect(savePrefsMock).toHaveBeenCalledWith({
      accessibility: {
        ...DEFAULT_ACCESSIBILITY_PREFS,
        announce: { ...DEFAULT_ACCESSIBILITY_PREFS.announce, pageChanges: false },
      },
    });
  });

  it('turns chapter announcements off without touching pages', async () => {
    await render(<AccessibilitySettingsPanel />);
    await waitFor(() => expect(getPrefsMock).toHaveBeenCalled());

    await fireEvent.press(screen.getByLabelText('Chapters announcements: On'));

    expect(savePrefsMock).toHaveBeenCalledWith({
      accessibility: {
        ...DEFAULT_ACCESSIBILITY_PREFS,
        announce: { ...DEFAULT_ACCESSIBILITY_PREFS.announce, chapterChanges: false },
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
