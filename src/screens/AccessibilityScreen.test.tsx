// src/screens/AccessibilityScreen.test.tsx
// Accessibility settings — Hruthik's contract, FINAL 2026-09-02.
//
// DRIVEN THROUGH THE HOOK SEAM, NOT AROUND IT. Every test injects a fake
// `PrefsSource` via the screen's `prefsSource` prop and asserts on what reached
// it — same pattern as ReaderPreferencesScreen.test.tsx. The hook's own rules
// (the two-level spread, the optimistic rollback, the scoped restore) are
// covered in useReaderPrefs.test.ts.
//
// TWELVE CONTROLS, FOUR GROUPS, AND NO TTS. `accessibility.tts` is a real group
// on the record that this screen must never surface — "it is not rendered" is
// a property worth a failing test if someone adds it.
//
// `await render(...)` is required — RTL 14's render is async. See App.test.tsx.
// `await act(async () => ...)` where a callback fires outside a press; a bare
// synchronous `act()` corrupts every later render in the file — see the header
// of useReaderPrefs.test.ts.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import { DEFAULT_PREFS } from '@/shared/contracts';
import type { PrefsSource, PrefsValues } from '@/features/personalization/useReaderPrefs';

import AccessibilityScreen from './AccessibilityScreen';

// Offline is the screen's own axis, read from `useNetworkStatus` rather than
// the hook — prefs are local-first, so connectivity never gates a write.
const mockIsOnline = jest.fn(() => true);
jest.mock('@hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => mockIsOnline(),
}));

const STORED: PrefsValues = { ...DEFAULT_PREFS };
const A11Y = DEFAULT_PREFS.accessibility;

function fakeSource(overrides: Partial<PrefsSource> = {}): PrefsSource {
  return {
    getPrefs: jest.fn(() => Promise.resolve(STORED)),
    savePrefs: jest.fn(() => Promise.resolve()),
    resetPrefs: jest.fn(() => Promise.resolve()),
    subscribe: jest.fn(() => () => {}),
    ...overrides,
  };
}

/** Renders and waits for the first read to land. */
async function renderReady(source: PrefsSource) {
  await render(<AccessibilityScreen prefsSource={source} />);
  await waitFor(() => expect(screen.getByTestId('accessibility-section')).toBeTruthy());
}

const accessibilitySection = () => within(screen.getByTestId('accessibility-section'));
const textGroup = () => within(screen.getByTestId('accessibility-text-group'));
const displayGroup = () => within(screen.getByTestId('accessibility-display-group'));
const announceGroup = () => within(screen.getByTestId('accessibility-announce-group'));

afterEach(() => {
  mockIsOnline.mockReturnValue(true);
});

describe('AccessibilityScreen structure', () => {
  it('renders all four groups', async () => {
    await renderReady(fakeSource());

    expect(screen.getByTestId('accessibility-text-group')).toBeTruthy();
    expect(screen.getByTestId('accessibility-display-group')).toBeTruthy();
    expect(screen.getByTestId('accessibility-announce-group')).toBeTruthy();
    expect(screen.getByTestId('accessibility-hints-group')).toBeTruthy();
  });

  it('renders all twelve controls', async () => {
    await renderReady(fakeSource());

    const a11y = accessibilitySection();
    // Ten toggles…
    [
      'Dyslexia-friendly font',
      'Match device text size',
      'Readable spacing',
      'Bold text',
      'High contrast',
      'Large touch targets',
      'Large audio controls',
      'Page changes',
      'Chapter changes',
      'Extra screen reader hints',
    ].forEach((label) => expect(a11y.getByText(label)).toBeTruthy());

    // …one slider, one segmented picker.
    expect(a11y.getByTestId('accessibility-font-scale-slider')).toBeTruthy();
    expect(a11y.getByText('Reduce motion')).toBeTruthy();
  });

  it('renders no TTS section or controls', async () => {
    await renderReady(fakeSource());

    expect(screen.queryByText(/text.to.speech|\bTTS\b/i)).toBeNull();
    [/voice/i, /\brate\b/i, /\bpitch\b/i, /background playback/i, /highlight mode/i].forEach(
      (pattern) => expect(screen.queryByText(pattern)).toBeNull(),
    );
  });
});

describe('AccessibilityScreen contract defaults', () => {
  it('shows every toggle at its contract default', async () => {
    await renderReady(fakeSource());

    // `ListRow` puts role="switch" on the ROW, exposing state via
    // `accessibilityState.checked` — see ListRow.test.tsx.
    const checked = (group: ReturnType<typeof within>, label: string) =>
      group.getByRole('switch', { name: label }).props.accessibilityState.checked;

    expect(checked(textGroup(), 'Match device text size')).toBe(true);
    expect(checked(announceGroup(), 'Page changes')).toBe(true);
    expect(checked(announceGroup(), 'Chapter changes')).toBe(true);

    expect(checked(textGroup(), 'Dyslexia-friendly font')).toBe(false);
    expect(checked(displayGroup(), 'High contrast')).toBe(false);
  });

  it('shows the font scale multiplier at 1.0', async () => {
    await renderReady(fakeSource());

    expect(A11Y.text.fontScaleMultiplier).toBe(1.0);
    expect(accessibilitySection().getByTestId('accessibility-font-scale-slider').props.value).toBe(
      1.0,
    );
    expect(accessibilitySection().getByText('1.0×')).toBeTruthy();
  });

  it("defaults reduceMotion to 'system'", async () => {
    await renderReady(fakeSource());

    expect(A11Y.display.reduceMotion).toBe('system');
    expect(displayGroup().getByTestId('tabs-tab-system').props.accessibilityState.selected).toBe(
      true,
    );
  });
});

describe('AccessibilityScreen reduce motion', () => {
  it("selects 'on' and writes the raw string", async () => {
    const source = fakeSource();
    await renderReady(source);

    fireEvent.press(displayGroup().getByText('On'));

    expect(source.savePrefs).toHaveBeenCalledWith({
      accessibility: { ...A11Y, display: { ...A11Y.display, reduceMotion: 'on' } },
    });
  });

  it("selects 'off' and writes the raw string", async () => {
    const source = fakeSource();
    await renderReady(source);

    fireEvent.press(displayGroup().getByText('Off'));

    expect(source.savePrefs).toHaveBeenCalledWith({
      accessibility: { ...A11Y, display: { ...A11Y.display, reduceMotion: 'off' } },
    });
  });

  // THE ANTI-REGRESSION FOR THE ONE MISTAKE THIS FIELD INVITES. 'off' is falsy
  // in no useful sense and `false` is not a member of the union, but a
  // well-meaning `Boolean(...)` or `=== 'on'` somewhere on the path would still
  // typecheck at a cast. Assert the runtime type, not just the value.
  it('never coerces reduceMotion to a boolean', async () => {
    const source = fakeSource();
    await renderReady(source);

    fireEvent.press(displayGroup().getByText('Off'));

    const patch = (source.savePrefs as jest.Mock).mock.calls[0][0];
    expect(typeof patch.accessibility.display.reduceMotion).toBe('string');
    expect(patch.accessibility.display.reduceMotion).toBe('off');
  });
});

describe('AccessibilityScreen preserves nested values on save', () => {
  // THE LOAD-BEARING ONE FOR THE TWO-LEVEL MERGE. A naive patch would wipe the
  // four sibling fields in `display` AND the sibling `text` / `announce` / `tts`
  // groups. Both levels are asserted.
  it('preserves siblings at both levels when one nested field changes', async () => {
    const source = fakeSource();
    await renderReady(source);

    fireEvent.press(displayGroup().getByText('On'));

    const patch = (source.savePrefs as jest.Mock).mock.calls[0][0];
    expect(patch.accessibility.display).toEqual({ ...A11Y.display, reduceMotion: 'on' });
    expect(patch.accessibility.text).toEqual(A11Y.text);
    expect(patch.accessibility.announce).toEqual(A11Y.announce);
    expect(patch.accessibility.tts).toEqual(A11Y.tts);
    expect(patch.accessibility.screenReaderHints).toBe(A11Y.screenReaderHints);
  });

  it('preserves siblings when a top-level accessibility field changes', async () => {
    const source = fakeSource();
    await renderReady(source);

    fireEvent.press(
      within(screen.getByTestId('accessibility-hints-group')).getByRole('switch', {
        name: 'Extra screen reader hints',
      }),
    );

    expect(source.savePrefs).toHaveBeenCalledWith({
      accessibility: { ...A11Y, screenReaderHints: true },
    });
  });

  // CLAMPED IN THE HOOK, NOT BY THE SLIDER — the slider's own bounds only
  // constrain a drag, so the guard is asserted by driving the event past them
  // directly, which is exactly what another caller could do.
  it('clamps the font scale multiplier to the top of its range', async () => {
    const source = fakeSource();
    await renderReady(source);

    fireEvent(
      accessibilitySection().getByTestId('accessibility-font-scale-slider'),
      'slidingComplete',
      4.0,
    );

    const patch = (source.savePrefs as jest.Mock).mock.calls[0][0];
    expect(patch.accessibility.text.fontScaleMultiplier).toBe(1.5);
  });

  it('clamps the font scale multiplier to the bottom of its range', async () => {
    const source = fakeSource();
    await renderReady(source);

    fireEvent(
      accessibilitySection().getByTestId('accessibility-font-scale-slider'),
      'slidingComplete',
      0.1,
    );

    const patch = (source.savePrefs as jest.Mock).mock.calls[0][0];
    expect(patch.accessibility.text.fontScaleMultiplier).toBe(0.8);
  });

  it('says screen reader hints do not reach title content', async () => {
    await renderReady(fakeSource());

    const hints = within(screen.getByTestId('accessibility-hints-group'));
    expect(hints.getByText(/does not change title content/i)).toBeTruthy();
    expect(hints.getByText(/text inside a title .* is not affected/i)).toBeTruthy();
  });
});

describe('AccessibilityScreen restore defaults', () => {
  it('offers the action', async () => {
    await renderReady(fakeSource());

    expect(screen.getByRole('button', { name: 'Restore defaults' })).toBeTruthy();
  });

  // SCOPED TO ACCESSIBILITY, NOT A WHOLE-RECORD `resetPrefs()`. This screen
  // shows none of theme/font/layout/typography, so resetting them alongside
  // accessibility would silently change controls the reader cannot see here.
  it('writes only the accessibility group back to its defaults, via savePrefs not resetPrefs', async () => {
    const source = fakeSource({
      getPrefs: jest.fn(() =>
        Promise.resolve({
          ...STORED,
          accessibility: { ...A11Y, display: { ...A11Y.display, boldText: true } },
        }),
      ),
    });
    await renderReady(source);

    fireEvent.press(screen.getByText('Restore defaults'));

    expect(source.savePrefs).toHaveBeenCalledWith({ accessibility: A11Y });
    expect(source.resetPrefs).not.toHaveBeenCalled();
  });

  it('returns every control to its contract default', async () => {
    const source = fakeSource({
      getPrefs: jest.fn(() =>
        Promise.resolve({
          ...STORED,
          accessibility: { ...A11Y, display: { ...A11Y.display, boldText: true } },
        }),
      ),
    });
    await renderReady(source);

    fireEvent.press(screen.getByText('Restore defaults'));

    await waitFor(() =>
      expect(
        displayGroup().getByRole('switch', { name: 'Bold text' }).props.accessibilityState.checked,
      ).toBe(false),
    );
  });
});

describe('AccessibilityScreen states', () => {
  it('renders skeletons, and no controls, while the first read is in flight', async () => {
    const source = fakeSource({ getPrefs: jest.fn(() => new Promise<PrefsValues>(() => {})) });
    await render(<AccessibilityScreen prefsSource={source} />);

    expect(screen.getByTestId('accessibility-skeleton')).toBeTruthy();
    expect(screen.queryByTestId('accessibility-section')).toBeNull();
  });

  it('renders an error with a retry when the read fails', async () => {
    const source = fakeSource({ getPrefs: jest.fn(() => Promise.reject(new Error('nope'))) });
    await render(<AccessibilityScreen prefsSource={source} />);

    await waitFor(() =>
      expect(screen.getByText("We couldn't load your accessibility settings.")).toBeTruthy(),
    );
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
  });

  it('recovers when retry succeeds', async () => {
    const getPrefs = jest
      .fn()
      .mockRejectedValueOnce(new Error('nope'))
      .mockResolvedValueOnce(STORED);
    await render(<AccessibilityScreen prefsSource={fakeSource({ getPrefs })} />);

    await waitFor(() => expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy());
    fireEvent.press(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => expect(screen.getByTestId('accessibility-section')).toBeTruthy());
  });

  // OFFLINE IS NOT A BLOCKING STATE. Prefs are written locally and reconciled by
  // LWW on `updatedAt`, so the banner is informational and every control stays
  // live behind it.
  it('shows the offline banner and keeps every control usable behind it', async () => {
    mockIsOnline.mockReturnValue(false);
    const source = fakeSource();
    await renderReady(source);

    expect(screen.getByText(/offline/i)).toBeTruthy();

    fireEvent.press(displayGroup().getByRole('switch', { name: 'Bold text' }));
    expect(source.savePrefs).toHaveBeenCalledWith({
      accessibility: { ...A11Y, display: { ...A11Y.display, boldText: true } },
    });
  });

  it('reports a failed write inline, leaving the screen on its content', async () => {
    const source = fakeSource({ savePrefs: jest.fn(() => Promise.reject(new Error('nope'))) });
    await renderReady(source);

    fireEvent.press(displayGroup().getByRole('switch', { name: 'Bold text' }));

    await waitFor(() => expect(screen.getByText(/didn't save/i)).toBeTruthy());
    // Still the content, not an error page — the value rolled back.
    expect(
      displayGroup().getByRole('switch', { name: 'Bold text' }).props.accessibilityState.checked,
    ).toBe(false);
  });
});

describe('AccessibilityScreen accessibility', () => {
  it('announces each group heading as a header', async () => {
    await renderReady(fakeSource());

    const headers = screen.getAllByRole('header');
    const labels = headers.map((header) => header.props.children);

    expect(labels).toContain('Text');
    expect(labels).toContain('Display');
  });

  it('announces the selected reduce-motion option, so it is not colour-only', async () => {
    await renderReady(fakeSource());

    expect(displayGroup().getByTestId('tabs-tab-system').props.accessibilityState.selected).toBe(
      true,
    );
  });

  it('announces Restore defaults as a button under its visible name', async () => {
    await renderReady(fakeSource());

    expect(screen.getByRole('button', { name: 'Restore defaults' })).toBeTruthy();
  });

  it('announces a failed write as an alert', async () => {
    const source = fakeSource({ savePrefs: jest.fn(() => Promise.reject(new Error('nope'))) });
    await renderReady(source);

    fireEvent.press(displayGroup().getByRole('switch', { name: 'Bold text' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  });
});
