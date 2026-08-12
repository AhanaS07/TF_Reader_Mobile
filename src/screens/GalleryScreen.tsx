// Dev-only route — never user-reachable in production.
// Khushi (K5) fills this with the full component gallery.
import { View, Text, StyleSheet } from 'react-native';
import { color, space, type } from '@theme/tokens';

export default function GalleryScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>State Gallery</Text>
      <Text style={styles.sub}>Component library renders here — Khushi K5</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: color.surface },
  title: {
    fontWeight: type.pageTitle.weight,
    fontSize: type.pageTitle.size,
    lineHeight: type.pageTitle.lineHeight,
    color: color.textPrimary,
  },
  sub: {
    fontWeight: type.meta.weight,
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
    color: color.textSecondary,
    marginTop: space.sm,
    textAlign: 'center',
  },
});
