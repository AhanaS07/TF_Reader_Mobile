// Owner: Accessibility (Hruthik).
//
// A full-width row now (mounted inside ReaderScreen's merged Accessibility dropdown, alongside
// AccessibilitySettingsPanel's toggles), not the icon-only square this used to be as its own
// toolbar button — so only `minHeight` floors at the touch target; there is no `minWidth` to pin
// against a square. Same 44-floor assertion style as TtsControls.test.tsx's touch-target test.

import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { AccessibilityInfoButton } from './AccessibilityInfoButton';

describe('AccessibilityInfoButton', () => {
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
});
