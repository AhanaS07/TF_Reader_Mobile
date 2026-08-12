// Dev-only route — never user-reachable in production.
// Khushi (K5) fills this with the full component gallery.
import { View, Text, StyleSheet } from 'react-native';
import { color, space, type as typeScale } from '../theme/tokens';

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
    fontWeight: typeScale.pageTitle.weight,
    fontSize: typeScale.pageTitle.size,
    lineHeight: typeScale.pageTitle.lineHeight,
    color: color.textPrimary,
  },
  sub: {
    fontWeight: typeScale.meta.weight,
    fontSize: typeScale.meta.size,
    lineHeight: typeScale.meta.lineHeight,
    color: color.textSecondary,
    marginTop: space.sm,
    textAlign: 'center',
  },
});
