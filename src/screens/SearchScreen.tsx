import { View, Text, StyleSheet } from 'react-native';
import tokens from '../theme/tokens';

const { color } = tokens;
const typeScale = tokens.type;

export default function SearchScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Search</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: color.surface },
  title: {
    fontWeight: typeScale.sectionHeader.weight,
    fontSize: typeScale.sectionHeader.size,
    lineHeight: typeScale.sectionHeader.lineHeight,
    color: color.textSecondary,
  },
});
