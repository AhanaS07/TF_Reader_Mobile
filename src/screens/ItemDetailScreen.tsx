// Placeholder for item detail — reused by both CatalogueStack and SearchStack.
// Both stacks define ItemDetail: { itemId: string }, so a shared minimal type is safe.
// Feature screens (screens 04 & 05) land in Week 2.
import { View, Text, StyleSheet } from 'react-native';
import { color, type } from '@theme/tokens';

interface ItemDetailRouteProps {
  route: { params: { itemId: string } };
}

export default function ItemDetailScreen({ route }: ItemDetailRouteProps) {
  const { itemId } = route.params;

  return (
    <View style={styles.container}>
      <Text style={styles.stub}>Item: {itemId}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: color.surface },
  stub: {
    fontWeight: type.body.weight,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: color.textSecondary,
  },
});
