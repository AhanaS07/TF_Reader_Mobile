// Shelf detail screen — Prayas wires CategoryCard.onPress to this route (C1).
// Stub: renders the shelfId received via route params so Prayas can verify
// navigation is wired before building the real listing.
import { View, Text, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { CatalogueStackParamList } from '../navigation/types';
import { color, space, type } from '@theme/tokens';

type Props = NativeStackScreenProps<CatalogueStackParamList, 'Shelf'>;

export default function ShelfScreen({ route }: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{route.params.title}</Text>
      <Text style={styles.sub}>{route.params.shelfId}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: color.surface },
  title: {
    fontWeight: type.sectionHeader.weight,
    fontSize: type.sectionHeader.size,
    lineHeight: type.sectionHeader.lineHeight,
    color: color.textPrimary,
    marginBottom: space.xs,
  },
  sub: {
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
    color: color.textSecondary,
  },
});
