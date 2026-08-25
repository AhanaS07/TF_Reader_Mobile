// src/components/Slider/Slider.test.tsx
// `@react-native-community/slider` is mocked globally in jest.setup.js to a
// plain View carrying every prop straight through — see the comment there.
// `fireEvent(element, 'slidingComplete', value)` reaches `onSlidingComplete`
// through that View exactly as a real thumb release would.
//
// `await render(...)` is required — RTL 14's render is async. See App.test.tsx.
import { fireEvent, render, screen } from '@testing-library/react-native';

import Slider from './Slider';

describe('Slider', () => {
  it('renders with the value, range and step it is handed', async () => {
    await render(
      <Slider
        testID="line-height-slider"
        value={1.5}
        minimumValue={1.0}
        maximumValue={2.0}
        step={0.1}
        onSlidingComplete={() => {}}
      />,
    );

    const slider = screen.getByTestId('line-height-slider');
    expect(slider.props.value).toBe(1.5);
    expect(slider.props.minimumValue).toBe(1.0);
    expect(slider.props.maximumValue).toBe(2.0);
    expect(slider.props.step).toBe(0.1);
  });

  it('reports the released value to the caller', async () => {
    const onSlidingComplete = jest.fn();
    await render(
      <Slider
        testID="margins-slider"
        value={16}
        minimumValue={0}
        maximumValue={48}
        step={4}
        onSlidingComplete={onSlidingComplete}
      />,
    );

    await fireEvent(screen.getByTestId('margins-slider'), 'slidingComplete', 24);

    expect(onSlidingComplete).toHaveBeenCalledWith(24);
  });

  // This component does not expose onValueChange at all — per-tick handlers
  // cannot be wired even by accident. See the file header.
  it('exposes no per-tick value handler', async () => {
    await render(
      <Slider
        testID="spacing-slider"
        value={0}
        minimumValue={0}
        maximumValue={4}
        step={0.5}
        onSlidingComplete={() => {}}
      />,
    );

    expect(screen.getByTestId('spacing-slider').props.onValueChange).toBeUndefined();
  });
});
