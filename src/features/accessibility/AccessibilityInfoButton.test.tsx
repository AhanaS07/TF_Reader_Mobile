// Owner: Accessibility (Hruthik).
//
// A full-width row now (mounted inside ReaderScreen's merged Accessibility dropdown, alongside
// AccessibilitySettingsPanel's toggles), not the icon-only square this used to be as its own
// toolbar button — so only `minHeight` floors at the touch target; there is no `minWidth` to pin
// against a square. Same 44-floor assertion style as TtsControls.test.tsx's touch-target test.
//
// `prefsStore` is mocked the same way `AccessibilitySettingsPanel.test.tsx` mocks it — this
// component now reads `screenReaderHints` itself via `useAccessibilityPrefs`.

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { prefsStore } from '@/features/personalization/prefsStore';
import { DEFAULT_ACCESSIBILITY_PREFS } from '@/shared/contracts';

import { AccessibilityInfoButton } from './AccessibilityInfoButton';

jest.mock('@/features/personalization/prefsStore', () => ({
  prefsStore: { getPrefs: jest.fn(), savePrefs: jest.fn(), subscribe: jest.fn() },
}));

const getPrefsMock = prefsStore.getPrefs as jest.Mock;
const subscribeMock = prefsStore.subscribe as jest.Mock;

describe('AccessibilityInfoButton', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    subscribeMock.mockReturnValue(() => undefined);
    getPrefsMock.mockResolvedValue({ accessibility: structuredClone(DEFAULT_ACCESSIBILITY_PREFS) });
  });

  it('renders a labelled row that hits the 44px touch-target floor and calls onPress', async () => {
    const onPress = jest.fn();
    await render(<AccessibilityInfoButton onPress={onPress} />);

    expect(screen.getByText('Accessibility information')).toBeTruthy();

    const button = screen.getByLabelText('Accessibility information');
    const style = StyleSheet.flatten(button.props.style);
    expect(style.minHeight).toBeGreaterThanOrEqual(44);

    fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('carries no accessibilityHint when screenReaderHints is off (the default)', async () => {
    await render(<AccessibilityInfoButton onPress={jest.fn()} />);
    await waitFor(() => expect(getPrefsMock).toHaveBeenCalled());

    expect(screen.getByLabelText('Accessibility information').props.accessibilityHint).toBeUndefined();
  });

  it('adds an accessibilityHint once screenReaderHints is on', async () => {
    getPrefsMock.mockResolvedValue({
      accessibility: { ...structuredClone(DEFAULT_ACCESSIBILITY_PREFS), screenReaderHints: true },
    });

    await render(<AccessibilityInfoButton onPress={jest.fn()} />);
    await waitFor(() =>
      expect(screen.getByLabelText('Accessibility information').props.accessibilityHint).toBe(
        'Opens accessibility settings and supported-features information',
      ),
    );
  });
});
