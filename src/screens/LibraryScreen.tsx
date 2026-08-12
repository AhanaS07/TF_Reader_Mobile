// The Library tab. The real Library feature has not been built yet.
//
// ⚠ TEMPORARY COMPONENT PREVIEW — DELETE WHEN THE GALLERY IS REACHABLE.
// Everything below the "Library" title is scaffolding, not the Library screen.
// SubjectChip and Tabs (Foundation Spec §6.4, components 3 and 5) are both built
// and tested, but neither can be seen running yet: subject filtering needs OPDS
// facets, and feed tabs are blocked on L-5 and on getShelf() having no fixture
// behind 'ebooks'/'audiobooks'. `GalleryScreen` is where these belong — but its
// route is registered in RootNavigator and nothing navigates to it, so it cannot
// be opened on a device today.
//
// So this is a LOOK-AT-IT harness, not a feature. The state below exists only to
// exercise the components' props; nothing here reads the catalogue, and none of
// it is a claim about how the Library screen or screen 01 will work. When the
// Gallery route becomes reachable, this whole block moves there verbatim and this
// file goes back to being the four-line stub it was.
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { SectionHeader } from '@components/SectionHeader';
import { SubjectChip } from '@components/SubjectChip';
import { Tabs } from '@components/Tabs';
import { color, space, type } from '@theme/tokens';

// The real subjects carried by the home-catalogue fixture's four publications.
const SUBJECTS = [
  'Law',
  'Technology',
  'Environment',
  'Public Policy',
  'Statistics',
  'Anthropology',
];

// The fixture's three navigation rows, and screen 04's detail sections.
const FEED_TABS = [
  { id: 'ebooks', label: 'eBooks' },
  { id: 'audiobooks', label: 'Audiobooks' },
  { id: 'open-access', label: 'Open access' },
];

const DETAIL_TABS = [
  { id: 'description', label: 'Description' },
  { id: 'details', label: 'Details' },
  { id: 'contents', label: 'Contents' },
];

export default function LibraryScreen() {
  const [subject, setSubject] = useState<string | null>(null);
  const [feedTab, setFeedTab] = useState(FEED_TABS[0].id);
  const [detailTab, setDetailTab] = useState(DETAIL_TABS[0].id);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Library</Text>
      <Text style={styles.caveat}>
        Component preview — not the Library screen. See the note at the top of this file.
      </Text>

      <View style={styles.group}>
        <SectionHeader title="SubjectChip" />
        {/* Horizontal, because a per-institution subject list has no known
            maximum length — the same reason the Tabs bar scrolls. */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.chipRow}>
            {SUBJECTS.map((label) => (
              <SubjectChip
                key={label}
                label={label}
                selected={label === subject}
                onPress={() => setSubject(label === subject ? null : label)}
              />
            ))}
          </View>
        </ScrollView>
        <Text style={styles.caption}>
          {subject === null ? 'Nothing selected — tap a chip' : `Selected: ${subject}`}
        </Text>

        <Text style={styles.caption}>Disabled state:</Text>
        <View style={styles.chipRow}>
          <SubjectChip label="Unavailable" disabled onPress={() => {}} />
          <SubjectChip label="Also disabled" selected disabled onPress={() => {}} />
        </View>
      </View>

      <View style={styles.group}>
        <SectionHeader title="Tabs — segmented" />
        <Tabs tabs={FEED_TABS} activeId={feedTab} onChange={setFeedTab} />
        <Text style={styles.caption}>Active: {feedTab}</Text>
      </View>

      <View style={styles.group}>
        <SectionHeader title="Tabs — underline" />
        <Tabs
          tabs={DETAIL_TABS}
          activeId={detailTab}
          variant="underline"
          onChange={setDetailTab}
        />
        <Text style={styles.caption}>Active: {detailTab}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.surface,
  },
  content: {
    padding: space.md,
    gap: space.lg,
  },
  title: {
    fontWeight: type.pageTitle.weight,
    fontSize: type.pageTitle.size,
    lineHeight: type.pageTitle.lineHeight,
    color: color.textPrimary,
  },
  caveat: {
    fontWeight: type.meta.weight,
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
    color: color.wait,
  },
  group: {
    gap: space.sm,
  },
  chipRow: {
    flexDirection: 'row',
    gap: space.sm,
  },
  caption: {
    fontWeight: type.meta.weight,
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
    color: color.textSecondary,
  },
});
