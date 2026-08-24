// Gallery entry — every variant of ListRow from hardcoded props.
// No providers, no navigation, no stores. Pure rendering only.
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import ListRow from './ListRow';
import { color, space, type } from '@theme/tokens';

export default function ListRowGallery() {
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>ListRow</Text>

      <Text style={styles.label}>chevron — simple navigation row</Text>
      <ListRow title="Language" variant="chevron" onPress={() => {}} />

      <Text style={styles.label}>chevron — with subtitle</Text>
      <ListRow
        title="Account"
        subtitle="Manage your account details"
        variant="chevron"
        onPress={() => {}}
      />

      <Text style={styles.label}>chevron — with leading icon</Text>
      <ListRow
        title="Notifications"
        variant="chevron"
        icon={<Ionicons name="notifications-outline" size={20} color={color.textSecondary} />}
        onPress={() => {}}
      />

      <Text style={styles.label}>toggle — off</Text>
      <ListRow
        title="Download over Wi-Fi only"
        variant="toggle"
        toggleValue={false}
        onToggleChange={() => {}}
      />

      <Text style={styles.label}>toggle — on</Text>
      <ListRow
        title="Download over Wi-Fi only"
        variant="toggle"
        toggleValue={true}
        onToggleChange={() => {}}
      />

      <Text style={styles.label}>toggle — with subtitle and icon</Text>
      <ListRow
        title="Push Notifications"
        subtitle="Receive alerts for new content"
        variant="toggle"
        toggleValue={true}
        icon={<Ionicons name="notifications-outline" size={20} color={color.textSecondary} />}
        onToggleChange={() => {}}
      />

      <Text style={styles.label}>value — trailing text</Text>
      <ListRow title="Language" variant="value" valueText="English" onPress={() => {}} />

      <Text style={styles.label}>value — with subtitle</Text>
      <ListRow
        title="Region"
        subtitle="Affects content availability"
        variant="value"
        valueText="United Kingdom"
        onPress={() => {}}
      />

      <Text style={styles.label}>destructive — sign out</Text>
      <ListRow title="Sign Out" variant="destructive" onPress={() => {}} />

      <Text style={styles.label}>destructive — with subtitle</Text>
      <ListRow
        title="Delete Account"
        subtitle="This action cannot be undone"
        variant="destructive"
        onPress={() => {}}
      />

      {/* `disabled` crosses every variant rather than being one of its own, so
          each one gets an entry — a greyed toggle and a greyed chevron are
          different pictures, and only the toggle can be wrong in two ways
          (the row inert but the Switch still flipping). */}
      <Text style={styles.label}>chevron — disabled, nothing behind it yet</Text>
      <ListRow
        title="Privacy & Security"
        variant="chevron"
        disabled
        icon={<Ionicons name="shield-checkmark-outline" size={20} color={color.primary} />}
      />

      <Text style={styles.label}>chevron — disabled, with subtitle</Text>
      <ListRow
        title="Reading Preferences"
        subtitle="Font size, theme"
        variant="chevron"
        disabled
        icon={<Ionicons name="book-outline" size={20} color={color.primary} />}
      />

      <Text style={styles.label}>toggle — disabled (the Switch is inert too)</Text>
      <ListRow
        title="Notifications"
        variant="toggle"
        toggleValue={false}
        disabled
        icon={<Ionicons name="notifications-outline" size={20} color={color.primary} />}
      />

      <Text style={styles.label}>value — disabled</Text>
      <ListRow title="Language" variant="value" valueText="English" disabled />

      <Text style={styles.label}>destructive — disabled</Text>
      <ListRow title="Sign Out" variant="destructive" disabled />

      <View style={styles.spacer} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.white },
  content: { paddingBottom: space.xl },
  heading: {
    fontWeight: type.pageTitle.weight,
    fontSize: type.pageTitle.size,
    lineHeight: type.pageTitle.lineHeight,
    color: color.textPrimary,
    margin: space.md,
  },
  label: {
    fontWeight: type.meta.weight,
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
    color: color.textSecondary,
    marginHorizontal: space.md,
    marginTop: space.md,
    marginBottom: space.xs,
  },
  spacer: { height: space.xl },
});
