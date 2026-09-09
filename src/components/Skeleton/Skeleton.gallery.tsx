import { StyleSheet, Text, View } from 'react-native';

import { color, space, type } from '@theme/tokens';

import Skeleton from './Skeleton';

export default function SkeletonGallery() {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>block — 200 x 80</Text>
      <Skeleton variant="block" width={200} height={80} />

      <Text style={styles.label}>text — 80% x 12</Text>
      <Skeleton variant="text" width="80%" height={12} />

      <Text style={styles.label}>text — 50% x 10</Text>
      <Skeleton variant="text" width="50%" height={10} />

      <Text style={styles.label}>circle — 48 x 48</Text>
      <Skeleton variant="circle" width={48} height={48} />

      {/* Both render identically — the component is static. */}
      <Text style={styles.label}>animated omitted (defaults true) — no animation</Text>
      <Skeleton variant="block" width={200} height={80} />

      <Text style={styles.label}>animated false — identical</Text>
      <Skeleton variant="block" width={200} height={80} animated={false} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: space.md, gap: space.sm },
  label: {
    fontWeight: type.meta.weight,
    fontFamily: type.meta.fontFamily,
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
    color: color.textSecondary,
  },
});
