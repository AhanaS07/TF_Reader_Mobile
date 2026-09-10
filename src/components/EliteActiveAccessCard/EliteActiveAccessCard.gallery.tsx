// Gallery entry — every state of EliteActiveAccessCard from hardcoded props.
// No providers, no navigation, no stores.
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import EliteActiveAccessCard from './EliteActiveAccessCard';
import { color, space, type } from '@theme/tokens';

export default function EliteActiveAccessCardGallery() {
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>EliteActiveAccessCard</Text>

      <Text style={styles.label}>with a cover, format and expiry</Text>
      <View style={styles.row}>
        <EliteActiveAccessCard
          title="Playful Identities: The Ludification of Digital Media Cultures"
          imageUrl="https://images.example.com/playful-identities.jpg"
          format="PDF"
          expiresLabel="Due in 3 days"
          onPress={() => {}}
        />
      </View>

      <Text style={styles.label}>no cover — placeholder well</Text>
      <View style={styles.row}>
        <EliteActiveAccessCard title="The Politics of Coalition in Korea" format="EPUB" onPress={() => {}} />
      </View>

      <Text style={styles.label}>no expiry supplied — line omitted, not invented</Text>
      <View style={styles.row}>
        <EliteActiveAccessCard title="Law and Ecology" format="EPUB" onPress={() => {}} />
      </View>

      <View style={styles.spacer} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.white },
  content: { paddingBottom: space.xl },
  heading: {
    fontFamily: type.pageTitle.fontFamily,
    fontSize: type.pageTitle.size,
    lineHeight: type.pageTitle.lineHeight,
    color: color.textPrimary,
    margin: space.md,
  },
  label: {
    fontFamily: type.meta.fontFamily,
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
    color: color.textSecondary,
    marginHorizontal: space.md,
    marginTop: space.md,
    marginBottom: space.xs,
  },
  row: { marginHorizontal: space.md },
  spacer: { height: space.xl },
});
