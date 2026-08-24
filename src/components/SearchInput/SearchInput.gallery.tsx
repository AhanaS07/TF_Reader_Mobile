// Gallery entry — every state of SearchInput from hardcoded props.
// No providers, no navigation, no stores, no pipeline. Pure rendering only.
//
// The field is controlled, so a gallery that passed a literal string would be
// untypeable and half the states unreachable by hand. Each row therefore holds
// its own useState — that is the CALLER owning the query, which is exactly the
// contract this component is asserting, so the gallery demonstrates it rather
// than working around it.
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import SearchInput, { type SearchInputState } from './SearchInput';
import { color, space, type } from '@theme/tokens';

// One labelled row. `initial` seeds the field so the filled states render
// without anyone having to type into them.
function Row({
  label,
  initial = '',
  state,
  disabled,
  withVoice,
  placeholder,
}: {
  label: string;
  initial?: string;
  state?: SearchInputState;
  disabled?: boolean;
  withVoice?: boolean;
  placeholder?: string;
}) {
  const [value, setValue] = useState(initial);

  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <SearchInput
        value={value}
        onChangeText={setValue}
        placeholder={placeholder}
        state={state}
        disabled={disabled}
        onSubmit={() => {}}
        onClear={() => {}}
        onVoicePress={withVoice ? () => {} : undefined}
      />
    </View>
  );
}

export default function SearchInputGallery() {
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>SearchInput</Text>

      <Row label="default — empty, no voice (institution search)" placeholder="Search institutions" />

      <Row label="default — empty, with mic (catalogue search)" withVoice />

      <Row label="filled — clear affordance appears" initial="climate" />

      <Row label="filled + mic — both trailing controls" initial="climate" withVoice />

      <Row label="focused — tap the field; border goes teal" placeholder="Tap me" withVoice />

      <Row label="disabled — empty" disabled />

      <Row
        label="disabled — filled; trailing controls withdrawn"
        initial="climate"
        disabled
        withVoice
      />

      <Row label="offline — glyph changes, field stays typeable" state="offline" withVoice />

      <Row label="offline + filled" initial="climate" state="offline" withVoice />

      <Row
        label="overflow — a query longer than the field scrolls, never wraps"
        initial="anthropogenic climate change adaptation in coastal megacities"
        withVoice
      />

      <Row
        label="overflow — a long placeholder truncates"
        placeholder="Search books, journals, articles and audiobooks across every collection"
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
  spacer: { height: space.xl },
});
