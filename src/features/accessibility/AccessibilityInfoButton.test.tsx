// Owner: Accessibility (Hruthik).
//
// Same 44x44 assertion style as TtsControls.test.tsx's touch-target test.

import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { AccessibilityInfoButton } from './AccessibilityInfoButton';

describe('AccessibilityInfoButton', () => {
  it('hits the 44x44 touch-target floor and calls onPress', async () => {
    const onPress = jest.fn();
    await render(<AccessibilityInfoButton onPress={onPress} />);

    const button = screen.getByLabelText('Accessibility information');
    const style = StyleSheet.flatten(button.props.style);
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
    expect(style.minWidth).toBeGreaterThanOrEqual(44);

    fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
