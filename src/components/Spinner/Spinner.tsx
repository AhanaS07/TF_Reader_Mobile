// A branded stand-in for RN's built-in ActivityIndicator, which renders as two
// visibly different native widgets (UIActivityIndicatorView vs. Android's
// ProgressBar) — this draws the same ring on both platforms via a rotating
// View, so "the loader looks the same on iOS and Android" is true by
// construction rather than by platform luck.
//
// Same size/color prop shape as ActivityIndicator on purpose, so every
// existing call site is a like-for-like swap.
import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';

import { color as tokenColor } from '@theme/tokens';

export type SpinnerSize = 'small' | 'large';

export interface SpinnerProps {
  size?: SpinnerSize;
  color?: string;
  testID?: string;
}

const DIAMETER: Record<SpinnerSize, number> = { small: 18, large: 40 };
const STROKE_WIDTH: Record<SpinnerSize, number> = { small: 2, large: 3 };
const SPIN_MS = 800;
// Appended to the tint hex to draw the ring's unlit three-quarters — every
// caller passes a 6-digit hex from theme/tokens, so a fixed-length alpha
// suffix is safe.
const TRACK_ALPHA = '33';

export default function Spinner({ size = 'small', color = tokenColor.primary, testID }: SpinnerProps) {
  const [spin] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: SPIN_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const diameter = DIAMETER[size];

  return (
    <Animated.View
      testID={testID}
      accessibilityRole="progressbar"
      style={[
        styles.ring,
        {
          width: diameter,
          height: diameter,
          borderRadius: diameter / 2,
          borderWidth: STROKE_WIDTH[size],
          borderColor: `${color}${TRACK_ALPHA}`,
          borderTopColor: color,
          transform: [{ rotate }],
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  ring: {
    backgroundColor: 'transparent',
  },
});
