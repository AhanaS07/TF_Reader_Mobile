// Gallery entry — every state of EliteQueueCard from hardcoded props.
// No providers, no navigation, no stores.
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import EliteQueueCard from './EliteQueueCard';
import { color, space, type } from '@theme/tokens';

export default function EliteQueueCardGallery() {
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>EliteQueueCard</Text>

      <Text style={styles.label}>with a position, a length and a cover</Text>
      <View style={styles.row}>
        <EliteQueueCard
          title="Law and Ecology: New Environmental Foundations"
          imageUrl="https://images.example.com/law-and-ecology.jpg"
          format="EPUB"
          queueLabel="#3 of 7"
          progressFraction={5 / 7}
          onPress={() => {}}
        />
      </View>

      <Text style={styles.label}>a position with no known queue length — no bar to draw</Text>
      <View style={styles.row}>
        <EliteQueueCard
          title="The Politics of Coalition in Korea"
          format="EPUB"
          queueLabel="#3 in queue"
          onPress={() => {}}
        />
      </View>

      <Text style={styles.label}>no cover — placeholder well</Text>
      <View style={styles.row}>
        <EliteQueueCard
          title="Playful Identities"
          format="PDF"
          queueLabel="#1 of 2"
          progressFraction={1}
          onPress={() => {}}
        />
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
