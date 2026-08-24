// Gallery entry — every variant of InstitutionRow from hardcoded props.
// No providers, no navigation, no stores. Pure rendering only.
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import InstitutionRow from './InstitutionRow';
import type { Institution } from '@model/institution';
import { color, space, type } from '@theme/tokens';

const WITH_CREST: Institution = {
  id: 'inst_7f3',
  name: 'Imperial College London',
  country: 'United Kingdom',
  code: 'ICL',
  city: 'London',
  catalogueUrl: 'https://api.tf/opds/v1/institutions/inst_7f3/catalogue',
  branding: { logoUrl: 'https://cdn.tf/crests/inst_7f3.png' },
};

// inst_c88 has no branding in the fixture — exercises the initials fallback.
const NO_CREST: Institution = {
  id: 'inst_c88',
  name: 'Kwame Nkrumah University of Science and Technology',
  country: 'Ghana',
  code: 'KNUST',
  city: 'Kumasi',
  catalogueUrl: 'https://api.tf/opds/v1/institutions/inst_c88/catalogue',
};

// inst_09c has the longest name in the fixture — exercises 2-line truncation.
const LONG_NAME: Institution = {
  id: 'inst_09c',
  name: 'The Royal Netherlands Institute for Southeast Asian and Caribbean Studies',
  country: 'Netherlands',
  code: 'KITLV',
  city: 'Leiden',
  catalogueUrl: 'https://api.tf/opds/v1/institutions/inst_09c/catalogue',
};

export default function InstitutionRowGallery() {
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>InstitutionRow</Text>

      <Text style={styles.label}>default — with crest logo</Text>
      <InstitutionRow institution={WITH_CREST} onPress={() => {}} />

      <Text style={styles.label}>default — initials fallback (no crest)</Text>
      <InstitutionRow institution={NO_CREST} onPress={() => {}} />

      <Text style={styles.label}>selected — with crest logo</Text>
      <InstitutionRow institution={WITH_CREST} isSelected onPress={() => {}} />

      <Text style={styles.label}>selected — initials fallback</Text>
      <InstitutionRow institution={NO_CREST} isSelected onPress={() => {}} />

      <Text style={styles.label}>pinned (recently used) — with crest</Text>
      <InstitutionRow institution={WITH_CREST} isPinned onPress={() => {}} />

      <Text style={styles.label}>pinned (recently used) — initials fallback</Text>
      <InstitutionRow institution={NO_CREST} isPinned onPress={() => {}} />

      <Text style={styles.label}>pinned + selected</Text>
      <InstitutionRow institution={WITH_CREST} isPinned isSelected onPress={() => {}} />

      <Text style={styles.label}>long name — must wrap to two lines</Text>
      <InstitutionRow institution={LONG_NAME} onPress={() => {}} />

      <Text style={styles.label}>long name — selected</Text>
      <InstitutionRow institution={LONG_NAME} isSelected onPress={() => {}} />

      <View style={styles.spacer} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.white },
  content: { paddingBottom: space.xl },
  heading: {
    fontWeight: type.pageTitle.weight,
    fontFamily: type.pageTitle.fontFamily,
    fontSize: type.pageTitle.size,
    lineHeight: type.pageTitle.lineHeight,
    color: color.textPrimary,
    margin: space.md,
  },
  label: {
    fontWeight: type.meta.weight,
    fontFamily: type.meta.fontFamily,
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
    color: color.textSecondary,
    marginHorizontal: space.md,
    marginTop: space.md,
    marginBottom: space.xs,
  },
  spacer: { height: space.xl },
});
