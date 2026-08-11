import { StyleSheet, View, type DimensionValue } from 'react-native';

import { color, radius } from '@theme/tokens';

export type SkeletonVariant = 'block' | 'text' | 'circle';

export interface SkeletonProps {
  variant: SkeletonVariant;
  width?: number | string;
  height?: number;
  /** Accepted for spec parity; this Skeleton is static, so it has no effect. */
  animated?: boolean;
}

export default function Skeleton({ variant, width, height }: SkeletonProps) {
  return (
    <View style={[styles.base, styles[variant], { width: width as DimensionValue, height }]} />
  );
}

const styles = StyleSheet.create({
  base: { backgroundColor: color.border },
  block: { borderRadius: radius.card },
  text: { borderRadius: radius.pill },
  // React Native clamps borderRadius to half the size, so pill renders a circle when square.
  circle: { borderRadius: radius.pill },
});
