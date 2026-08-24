// Gallery entry — both variants of SectionHeader from hardcoded props.
// No providers, no navigation, no stores, no pipeline. Pure rendering only.
//
// Each row is boxed to a realistic content width so the wrapping cases below
// actually wrap: a header that sets no width of its own only reveals its
// layout behaviour once something constrains it, which on a real screen is
// the scroll view's padding.
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import SectionHeader from './SectionHeader';
import { color, space, type } from '@theme/tokens';

// One labelled row.
function Row({
  label,
  title,
  actionLabel,
  withAction,
}: {
  label: string;
  title: string;
  actionLabel?: string;
  withAction?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.frame}>
        <SectionHeader
          title={title}
          actionLabel={actionLabel}
          onAction={withAction ? () => {} : undefined}
        />
      </View>
    </View>
  );
}

export default function SectionHeaderGallery() {
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>SectionHeader</Text>

      <Row label="default — screen 01, the category strip" title="Featured" />

      <Row label="default — screen 01, the subject row" title="Browse by Subject" />

      <Row label="default — screen 01, shelf title off the feed" title="Recently Published" />

      <Row
        label="with_action — screen 06"
        title="All Institutions"
        actionLabel="See all"
        withAction
      />

      <Row
        label="with_action — screen 06, the shorter heading"
        title="Recently used"
        actionLabel="See all"
        withAction
      />

      <Row
        label="with_action — a longer action label still holds its width"
        title="New this term"
        actionLabel="View everything"
        withAction
      />

      <Row
        label="overflow — a long title wraps; the action does not move (done-when)"
        title="Environmental Policy, Air Pollution and Sustainable Development in Contemporary China"
        actionLabel="See all"
        withAction
      />

      <Row
        label="overflow — default variant, the same title with the row to itself"
        title="Environmental Policy, Air Pollution and Sustainable Development in Contemporary China"
      />

      <Row
        label="half-given action — label with no handler draws nothing, on purpose"
        title="Free to read"
        actionLabel="See all"
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
  row: {
    marginHorizontal: space.md,
    marginBottom: space.md,
  },
  label: {
    fontWeight: type.meta.weight,
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
    color: color.textSecondary,
    marginBottom: space.xs,
  },
  // Marks out the width the header is working inside, so a wrap is visibly a
  // wrap rather than a mystery line break.
  frame: {
    borderWidth: 1,
    borderColor: color.border,
    padding: space.sm,
  },
  spacer: { height: space.xl },
});
