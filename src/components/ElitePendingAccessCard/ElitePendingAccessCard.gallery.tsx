// Gallery entry — every state of ElitePendingAccessCard from hardcoded props.
// No providers, no navigation, no stores.
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import ElitePendingAccessCard from './ElitePendingAccessCard';
import { color, space, type } from '@theme/tokens';

export default function ElitePendingAccessCardGallery() {
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>ElitePendingAccessCard</Text>

      <Text style={styles.label}>idle, with an expiry</Text>
      <View style={styles.row}>
        <ElitePendingAccessCard
          title="The Politics of Coalition in Korea"
          expiryLabel="Expires in 23 minutes"
          onAccept={() => {}}
          onReject={() => {}}
        />
      </View>

      <Text style={styles.label}>no expiry supplied — omitted, not invented</Text>
      <View style={styles.row}>
        <ElitePendingAccessCard
          title="Playful Identities: The Ludification of Digital Media Cultures"
          onAccept={() => {}}
          onReject={() => {}}
        />
      </View>

      <Text style={styles.label}>accepting</Text>
      <View style={styles.row}>
        <ElitePendingAccessCard
          title="The Politics of Coalition in Korea"
          expiryLabel="Expiring now"
          pending="accept"
          onAccept={() => {}}
          onReject={() => {}}
        />
      </View>

      <Text style={styles.label}>rejecting</Text>
      <View style={styles.row}>
        <ElitePendingAccessCard
          title="The Politics of Coalition in Korea"
          expiryLabel="Expires in 1 minute"
          pending="reject"
          onAccept={() => {}}
          onReject={() => {}}
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
