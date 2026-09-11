// src/components/Slider/Slider.tsx
// The shared library's one drag control, for a bounded numeric value — first
// used by the Typography section (line height, letter spacing, page margins),
// and available to anything else that needs one rather than a feature growing
// its own (CONVENTIONS §10).
//
// SAVES ON RELEASE ONLY, ON PURPOSE. `onSlidingComplete` fires once, when the
// thumb is let go. This component does not expose `onValueChange` (fired on
// every drag tick) at all — a caller cannot wire a per-tick save even by
// accident, which is the rule the Week 3 plan states for every slider on the
// Preferences screen: "Sliders save on release only, never per-tick."
//
// A THIN WRAPPER, NOT A NEW CONTROL. `@react-native-community/slider` already
// does the drag math and the accessibility work; this file only tokens its
// colours and narrows its props to the ones a caller here needs.
import RNSlider from '@react-native-community/slider';
import { StyleSheet } from 'react-native';

import { color } from '@theme/tokens';

export interface SliderProps {
  value: number;
  minimumValue: number;
  maximumValue: number;
  step: number;
  onSlidingComplete: (value: number) => void;
  testID?: string;
}

export default function Slider({
  value,
  minimumValue,
  maximumValue,
  step,
  onSlidingComplete,
  testID,
}: SliderProps) {
  return (
    <RNSlider
      testID={testID}
      style={styles.slider}
      value={value}
      minimumValue={minimumValue}
      maximumValue={maximumValue}
      step={step}
      minimumTrackTintColor={color.primary}
      maximumTrackTintColor={color.border}
      thumbTintColor={color.primary}
      onSlidingComplete={onSlidingComplete}
    />
  );
}

const styles = StyleSheet.create({
  slider: {
    width: '100%',
  },
});
