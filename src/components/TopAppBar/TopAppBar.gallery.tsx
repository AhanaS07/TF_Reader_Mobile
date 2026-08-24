// Gallery entry — every variant of TopAppBar from hardcoded props.
// No providers, no navigation, no stores. Pure rendering only.
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import TopAppBar from './TopAppBar';
import { color, space, type } from '@theme/tokens';

export default function TopAppBarGallery() {
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>TopAppBar</Text>

      <Text style={styles.label}>title (brand home)</Text>
      <TopAppBar title="Taylor &amp; Francis" />

      <Text style={styles.label}>title_with_search</Text>
      <TopAppBar title="Taylor &amp; Francis" onSearch={() => {}} />

      <Text style={styles.label}>title_with_back</Text>
      <TopAppBar title="Institution Detail" onBack={() => {}} />

      <Text style={styles.label}>title_with_back_and_action</Text>
      <TopAppBar
        title="Item Detail"
        onBack={() => {}}
        action={
          <Ionicons name="ellipsis-vertical" size={22} color={color.white} />
        }
      />

      <Text style={styles.label}>long title — must truncate, not wrap</Text>
      <TopAppBar
        title="This Is an Extremely Long Title That Must Truncate Cleanly at the Right Edge"
        onBack={() => {}}
        onSearch={() => {}}
      />

      <Text style={styles.label}>long title — home (no back)</Text>
      <TopAppBar
        title="Taylor &amp; Francis — Academic Research &amp; Professional Content"
        onSearch={() => {}}
      />

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
