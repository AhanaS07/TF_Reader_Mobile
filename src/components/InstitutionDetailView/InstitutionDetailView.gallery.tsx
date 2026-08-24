// Gallery entry — every state of InstitutionDetailView from hardcoded props.
// Names and countries are the real fixture values from institutions.json, so the
// awkward cases here are the ones the app will actually meet.
// Callbacks are wired to harmless no-ops: never navigation, never a store.
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { color, space, type } from '@theme/tokens';

import InstitutionDetailView from './InstitutionDetailView';

export default function InstitutionDetailViewGallery() {
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>InstitutionDetailView</Text>

      <Text style={styles.label}>logo present</Text>
      <InstitutionDetailView
        name="Imperial College London"
        country="United Kingdom"
        logoUrl="https://cdn.tf/crests/inst_7f3.png"
        onSelect={() => {}}
        onBack={() => {}}
      />

      <Text style={styles.label}>logo absent — initials fallback (W-17)</Text>
      <InstitutionDetailView
        name="Kwame Nkrumah University of Science and Technology"
        country="Ghana"
        onSelect={() => {}}
        onBack={() => {}}
      />

      <Text style={styles.label}>long name — wraps rather than truncating</Text>
      <InstitutionDetailView
        name="The Royal Netherlands Institute for Southeast Asian and Caribbean Studies"
        country="Netherlands"
        onSelect={() => {}}
        onBack={() => {}}
      />

      <Text style={styles.label}>long country</Text>
      <InstitutionDetailView
        name="Trinity College Dublin"
        country="United Kingdom of Great Britain and Northern Ireland"
        logoUrl="https://cdn.tf/crests/inst_c11.png"
        onSelect={() => {}}
        onBack={() => {}}
      />

      <Text style={styles.label}>single-word name — one initial</Text>
      <InstitutionDetailView
        name="Sorbonne"
        country="France"
        onSelect={() => {}}
        onBack={() => {}}
      />

      <Text style={styles.label}>non-ASCII name with a logo</Text>
      <InstitutionDetailView
        name="Universidade de São Paulo"
        country="Brazil"
        logoUrl="https://cdn.tf/crests/inst_9a2.png"
        onSelect={() => {}}
        onBack={() => {}}
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
