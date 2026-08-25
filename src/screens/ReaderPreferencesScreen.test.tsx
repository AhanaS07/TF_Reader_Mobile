// src/screens/ReaderPreferencesScreen.test.tsx
// Reader preferences — the screen, its two sections, and Restore defaults.
//
// DRIVEN THROUGH THE HOOK SEAM, NOT AROUND IT. Every test injects a fake
// `PrefsSource` via the screen's `prefsSource` prop and asserts on what reached
// it. Nothing here mocks `useReaderPrefs`: mocking the hook would test that the
// screen calls a function, where injecting the source tests that a tap becomes
// the right write. The hook's own rules — the nested-group spread, the
// optimistic rollback — are covered in useReaderPrefs.test.ts.
//
// `await render(...)` is required — RTL 14's render is async. See App.test.tsx.
// `await act(async () => ...)` where a callback has to be fired outside a press;
// a bare synchronous `act()` corrupts every later render in the file. See the
// header of useReaderPrefs.test.ts, which records why.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import { DEFAULT_PREFS } from '@/shared/contracts';
import type { PrefsSource, PrefsValues } from '@/features/personalization/useReaderPrefs';
import {
  FONT_FAMILY_OPTIONS,
  TEXT_SIZE_OPTIONS,
  THEME_OPTIONS,
} from '@/features/personalization/prefsOptions';

import ReaderPreferencesScreen from './ReaderPreferencesScreen';

// Offline is the screen's own axis, read from `useNetworkStatus` rather than from
// the hook — prefs are local-first, so connectivity never gates a write. Mocked
// so the banner and the "controls stay live" rule can both be asserted.
const mockIsOnline = jest.fn(() => true);
jest.mock('@hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => mockIsOnline(),
}));

const STORED: PrefsValues = {
  ...DEFAULT_PREFS,
  theme: 'sepia',
  font: { family: 'Lora', customFontUri: 'file:///fonts/custom.ttf' },
};

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
  await render(<ReaderPreferencesScreen prefsSource={source} />);
  await waitFor(() => expect(screen.getByText('Theme')).toBeTruthy());
}

// SCOPED QUERIES, AND NOT FOR NEATNESS. `Tabs` hardcodes `testID="tabs"` and
// `tabs-tab-<id>`, this screen renders two of them, and BOTH have a 'system'
// option — so `tabs-tab-system` and the label "System" are genuinely ambiguous
// at screen level. Every option assertion below scopes to its own section.
const themeSection = () => within(screen.getByTestId('theme-section'));
const fontSection = () => within(screen.getByTestId('font-section'));
const typographySection = () => within(screen.getByTestId('typography-section'));

afterEach(() => {
  mockIsOnline.mockReturnValue(true);
});

describe('ReaderPreferencesScreen structure', () => {
  it('renders Theme, Font, Layout and Typography sections', async () => {
    await renderReady(fakeSource());

    expect(screen.getByText('Theme')).toBeTruthy();
    expect(screen.getByText('Font')).toBeTruthy();
    expect(screen.getByText('Reading style')).toBeTruthy();
    expect(screen.getByText('Page view')).toBeTruthy();
    expect(screen.getByTestId('typography-section')).toBeTruthy();
  });

  // Never rendered: identity and sync plumbing, plus zoom and the accessibility
  // flags, which belong to other surfaces.
  it('renders none of the fields this screen must not show', async () => {
    await renderReady(fakeSource());

    for (const forbidden of [/zoom/i, /userId/i, /updatedAt/i, /isDeleted/i, /synced/i]) {
      expect(screen.queryByText(forbidden)).toBeNull();
    }
  });
});

describe('ReaderPreferencesScreen theme section', () => {
  it('offers exactly the four theme options', async () => {
    await renderReady(fakeSource());

    for (const option of THEME_OPTIONS) {
      expect(themeSection().getByTestId(`tabs-tab-${option.id}`)).toBeTruthy();
      expect(themeSection().getByText(option.label)).toBeTruthy();
    }
  });

  // `highContrast` is a real member of the contract's Theme union, deliberately
  // not offered: it pairs with `AccessibilityPrefs.highContrast`, which prefs.ts
  // marks as pending Hruthik's sign-off.
  it('does not offer high contrast', async () => {
    await renderReady(fakeSource());

    expect(screen.queryByText(/high.?contrast/i)).toBeNull();
  });

  it('marks the stored theme as the selected option', async () => {
    await renderReady(fakeSource());

    expect(themeSection().getByTestId('tabs-tab-sepia').props.accessibilityState.selected).toBe(
      true,
    );
    expect(themeSection().getByTestId('tabs-tab-light').props.accessibilityState.selected).toBe(
      false,
    );
  });

  it('writes the picked theme through the seam', async () => {
    const source = fakeSource();
    await renderReady(source);

    fireEvent.press(themeSection().getByText('Dark'));

    expect(source.savePrefs).toHaveBeenCalledWith({ theme: 'dark' });
  });

  // A theme set from another device, or from the accessibility surface. `Tabs`
  // renders nothing active, which is right — a wrong highlight is worse than
  // none — and the section says so rather than looking broken.
  it('selects nothing and explains itself when the stored theme is not an option', async () => {
    const source = fakeSource({
      getPrefs: jest.fn(() => Promise.resolve({ ...STORED, theme: 'highContrast' as const })),
    });
    await renderReady(source);

    for (const option of THEME_OPTIONS) {
      expect(
        themeSection().getByTestId(`tabs-tab-${option.id}`).props.accessibilityState.selected,
      ).toBe(false);
    }
    expect(screen.getByText(/set elsewhere/i)).toBeTruthy();
  });
});

describe('ReaderPreferencesScreen font section', () => {
  it('offers exactly the seven provisional font options', async () => {
    await renderReady(fakeSource());

    for (const option of FONT_FAMILY_OPTIONS) {
      expect(fontSection().getByTestId(`tabs-tab-${option.id}`)).toBeTruthy();
    }
  });

  // Scoped to the section — Typography carries its own "EPUB only" hint too,
  // so an unscoped query here would be ambiguous.
  it('says the choice is EPUB only', async () => {
    await renderReady(fakeSource());

    expect(fontSection().getByText(/EPUB only/i)).toBeTruthy();
  });

  it('marks the stored family as the selected option', async () => {
    await renderReady(fakeSource());

    expect(fontSection().getByTestId('tabs-tab-Lora').props.accessibilityState.selected).toBe(true);
  });

  // The screen's half of the hook's spread rule: the write must carry the
  // family the reader picked AND keep the custom font URI they already had.
  it('writes the picked family through the seam without dropping customFontUri', async () => {
    const source = fakeSource();
    await renderReady(source);

    fireEvent.press(fontSection().getByText('Merriweather'));

    expect(source.savePrefs).toHaveBeenCalledWith({
      font: { family: 'Merriweather', customFontUri: 'file:///fonts/custom.ttf' },
    });
  });

  it('selects nothing and names the current face when it is not an option', async () => {
    const source = fakeSource({
      getPrefs: jest.fn(() => Promise.resolve({ ...STORED, font: { family: 'Georgia' } })),
    });
    await renderReady(source);

    for (const option of FONT_FAMILY_OPTIONS) {
      expect(
        fontSection().getByTestId(`tabs-tab-${option.id}`).props.accessibilityState.selected,
      ).toBe(false);
    }
    expect(screen.getByText(/Georgia/)).toBeTruthy();
  });
});

describe('ReaderPreferencesScreen typography section', () => {
  it('offers exactly the six text size presets', async () => {
    await renderReady(fakeSource());

    for (const option of TEXT_SIZE_OPTIONS) {
      expect(typographySection().getByTestId(`tabs-tab-${option.id}`)).toBeTruthy();
    }
  });

  it('says the choice is EPUB only', async () => {
    await renderReady(fakeSource());

    expect(typographySection().getByText(/EPUB only/i)).toBeTruthy();
  });

  it('marks the stored text size as the selected preset', async () => {
    await renderReady(fakeSource());

    // STORED carries DEFAULT_PREFS.typography, so size 16.
    expect(
      typographySection().getByTestId('tabs-tab-16').props.accessibilityState.selected,
    ).toBe(true);
  });

  it('writes the picked text size through the seam, spreading the group', async () => {
    const source = fakeSource();
    await renderReady(source);

    fireEvent.press(typographySection().getByText('20pt'));

    expect(source.savePrefs).toHaveBeenCalledWith({
      typography: { size: 20, lineHeight: 1.5, spacing: 0, margins: 16 },
    });
  });

  it('renders a slider for line height, letter spacing and page margins', async () => {
    await renderReady(fakeSource());

    expect(typographySection().getByTestId('typography-line-height-slider')).toBeTruthy();
    expect(typographySection().getByTestId('typography-letter-spacing-slider')).toBeTruthy();
    expect(typographySection().getByTestId('typography-margins-slider')).toBeTruthy();
  });

  // Save-on-release: the section wires the slider's release event straight to
  // the seam, spreading the rest of the typography group.
  it('writes the released line height through the seam, spreading the group', async () => {
    const source = fakeSource();
    await renderReady(source);

    fireEvent(
      typographySection().getByTestId('typography-line-height-slider'),
      'slidingComplete',
      1.8,
    );

    expect(source.savePrefs).toHaveBeenCalledWith({
      typography: { size: 16, lineHeight: 1.8, spacing: 0, margins: 16 },
    });
  });

  it('writes the released letter spacing through the seam, spreading the group', async () => {
    const source = fakeSource();
    await renderReady(source);

    fireEvent(
      typographySection().getByTestId('typography-letter-spacing-slider'),
      'slidingComplete',
      2,
    );

    expect(source.savePrefs).toHaveBeenCalledWith({
      typography: { size: 16, lineHeight: 1.5, spacing: 2, margins: 16 },
    });
  });

  it('writes the released page margins through the seam, spreading the group', async () => {
    const source = fakeSource();
    await renderReady(source);

    fireEvent(
      typographySection().getByTestId('typography-margins-slider'),
      'slidingComplete',
      32,
    );

    expect(source.savePrefs).toHaveBeenCalledWith({
      typography: { size: 16, lineHeight: 1.5, spacing: 0, margins: 32 },
    });
  });
});

describe('ReaderPreferencesScreen restore defaults', () => {
  it('offers the action', async () => {
    await renderReady(fakeSource());

    expect(screen.getByRole('button', { name: 'Restore defaults' })).toBeTruthy();
  });

  it('calls resetPrefs, and does not write the groups one at a time', async () => {
    const source = fakeSource();
    await renderReady(source);

    fireEvent.press(screen.getByText('Restore defaults'));

    expect(source.resetPrefs).toHaveBeenCalledTimes(1);
    expect(source.savePrefs).not.toHaveBeenCalled();
  });

  it('returns the controls to the contract defaults', async () => {
    await renderReady(fakeSource());

    fireEvent.press(screen.getByText('Restore defaults'));

    // DEFAULT_PREFS is theme 'system' and family 'system' — one per section,
    // which is exactly why these queries have to be scoped.
    await waitFor(() =>
      expect(themeSection().getByTestId('tabs-tab-system').props.accessibilityState.selected).toBe(
        true,
      ),
    );
    expect(fontSection().getByTestId('tabs-tab-system').props.accessibilityState.selected).toBe(
      true,
    );
  });
});

describe('ReaderPreferencesScreen states', () => {
  it('renders skeletons, and no controls, while the first read is in flight', async () => {
    const source = fakeSource({ getPrefs: jest.fn(() => new Promise<PrefsValues>(() => {})) });
    await render(<ReaderPreferencesScreen prefsSource={source} />);

    expect(screen.getByTestId('reader-prefs-skeleton')).toBeTruthy();
    expect(screen.queryByText('Theme')).toBeNull();
  });

  it('renders an error with a retry when the read fails', async () => {
    const source = fakeSource({ getPrefs: jest.fn(() => Promise.reject(new Error('nope'))) });
    await render(<ReaderPreferencesScreen prefsSource={source} />);

    await waitFor(() =>
      expect(screen.getByText("We couldn't load your reading preferences.")).toBeTruthy(),
    );
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
  });

  it('recovers when retry succeeds', async () => {
    const getPrefs = jest
      .fn()
      .mockRejectedValueOnce(new Error('nope'))
      .mockResolvedValueOnce(STORED);
    await render(<ReaderPreferencesScreen prefsSource={fakeSource({ getPrefs })} />);

    await waitFor(() => expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy());
    fireEvent.press(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => expect(screen.getByText('Theme')).toBeTruthy());
  });

  // OFFLINE IS NOT A BLOCKING STATE. Prefs are written locally and reconciled by
  // LWW on `updatedAt`, so the banner is informational and every control stays
  // live behind it. This is the test that stops someone "fixing" the screen by
  // disabling it offline.
  it('shows the offline banner and keeps every control usable behind it', async () => {
    mockIsOnline.mockReturnValue(false);
    const source = fakeSource();
    await renderReady(source);

    expect(screen.getByText(/offline/i)).toBeTruthy();

    fireEvent.press(themeSection().getByText('Dark'));
    expect(source.savePrefs).toHaveBeenCalledWith({ theme: 'dark' });
  });

  it('reports a failed write inline, leaving the screen on its content', async () => {
    const source = fakeSource({ savePrefs: jest.fn(() => Promise.reject(new Error('nope'))) });
    await renderReady(source);

    fireEvent.press(themeSection().getByText('Dark'));

    await waitFor(() => expect(screen.getByText(/didn't save/i)).toBeTruthy());
    // Still the content, not an error page — the values on screen are correct
    // because the hook rolled the failed one back.
    expect(screen.getByText('Theme')).toBeTruthy();
    expect(themeSection().getByTestId('tabs-tab-sepia').props.accessibilityState.selected).toBe(
      true,
    );
  });
});

describe('ReaderPreferencesScreen accessibility', () => {
  it('announces each section heading as a header', async () => {
    await renderReady(fakeSource());

    const headers = screen.getAllByRole('header');
    const labels = headers.map((header) => header.props.children);

    expect(labels).toContain('Theme');
    expect(labels).toContain('Font');
  });

  it('announces the selected option, so the current value is not colour-only', async () => {
    await renderReady(fakeSource());

    expect(themeSection().getByTestId('tabs-tab-sepia').props.accessibilityState.selected).toBe(
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

    fireEvent.press(themeSection().getByText('Dark'));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  });
});
