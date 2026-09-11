// src/components/PrimaryButton/PrimaryButton.test.tsx
//
// Covered behaviours:
//   1. Renders its label and reports presses.
//   2. `loading` keeps the label, adds a spinner, and refuses the press.
//   3. `disabled` refuses the press.
//   4. Both inert states are announced to assistive technology.
//   5. `size="compact"` overrides the default height; the default is unchanged.
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

import PrimaryButton from './PrimaryButton';

function minHeightOf(testID: string): number | undefined {
  const flat = StyleSheet.flatten(screen.getByTestId(testID).props.style);
  return flat.minHeight;
}

describe('PrimaryButton', () => {
  it('renders the label and reports a press', async () => {
    const onPress = jest.fn();
    await render(<PrimaryButton testID="submit" label="Sign in" onPress={onPress} />);

    await fireEvent.press(screen.getByTestId('submit'));

    expect(screen.getByText('Sign in')).toBeTruthy();
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  // The label staying put is the point: a button whose text vanishes changes
  // width, and the form jumps under the reader's thumb.
  it('keeps the label and adds a spinner while loading', async () => {
    await render(<PrimaryButton testID="submit" label="Sign in" loading onPress={jest.fn()} />);

    expect(screen.getByText('Sign in')).toBeTruthy();
    expect(screen.getByTestId('submit-spinner')).toBeTruthy();
  });

  it('refuses a press while loading', async () => {
    const onPress = jest.fn();
    await render(<PrimaryButton testID="submit" label="Sign in" loading onPress={onPress} />);

    await fireEvent.press(screen.getByTestId('submit'));

    expect(onPress).not.toHaveBeenCalled();
  });

  it('refuses a press while disabled', async () => {
    const onPress = jest.fn();
    await render(<PrimaryButton testID="submit" label="Sign in" disabled onPress={onPress} />);

    await fireEvent.press(screen.getByTestId('submit'));

    expect(onPress).not.toHaveBeenCalled();
  });

  it('announces itself as busy while loading, so it is not read as actionable', async () => {
    await render(<PrimaryButton testID="submit" label="Sign in" loading onPress={jest.fn()} />);

    expect(screen.getByTestId('submit').props.accessibilityState).toMatchObject({
      disabled: true,
      busy: true,
    });
  });

  it('announces itself as disabled but not busy when merely disabled', async () => {
    await render(<PrimaryButton testID="submit" label="Sign in" disabled onPress={jest.fn()} />);

    expect(screen.getByTestId('submit').props.accessibilityState).toMatchObject({
      disabled: true,
      busy: false,
    });
  });

  it('renders no spinner when idle', async () => {
    await render(<PrimaryButton testID="submit" label="Sign in" onPress={jest.fn()} />);

    expect(screen.queryByTestId('submit-spinner')).toBeNull();
  });

  it('defaults to the standard height', async () => {
    await render(<PrimaryButton testID="submit" label="Sign in" onPress={jest.fn()} />);

    expect(minHeightOf('submit')).toBe(48);
  });

  // 36 is not arbitrary — it is FilterChip's own CHIP_HEIGHT, reused here rather
  // than a second invented number for "smaller than the default."
  it('shrinks to FilterChip-height when size is compact', async () => {
    await render(
      <PrimaryButton testID="submit" label="Sign in" size="compact" onPress={jest.fn()} />,
    );

    expect(minHeightOf('submit')).toBe(36);
  });
});
