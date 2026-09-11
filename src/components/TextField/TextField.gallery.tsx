// Gallery entry — every state of TextField from hardcoded props.
// No providers, no navigation, no stores. Pure rendering only.
//
// The fields here are uncontrolled on purpose: `value` never changes, so typing
// into one shows nothing. That is correct for a review surface — it is the states
// that are under review, not the typing.
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import TextField from './TextField';
import { color, space, type } from '@theme/tokens';

export default function TextFieldGallery() {
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>TextField</Text>

      <View style={styles.stack}>
        <Text style={styles.label}>empty, with a placeholder</Text>
        <TextField
          testID="gallery-empty"
          label="Email"
          value=""
          placeholder="you@example.com"
          onChangeText={() => {}}
        />

        <Text style={styles.label}>filled</Text>
        <TextField
          testID="gallery-filled"
          label="Email"
          value="reader@tandfonline.com"
          onChangeText={() => {}}
        />

        <Text style={styles.label}>invalid — the message is also the a11y hint</Text>
        <TextField
          testID="gallery-invalid"
          label="Email"
          value="reader.tandfonline.com"
          error="Enter a valid email address."
          onChangeText={() => {}}
        />

        <Text style={styles.label}>secure — masked, with the reveal toggle</Text>
        <TextField
          testID="gallery-secure"
          label="Password"
          value="correct horse battery"
          secureTextEntry
          onChangeText={() => {}}
        />

        <Text style={styles.label}>secure and invalid</Text>
        <TextField
          testID="gallery-secure-invalid"
          label="Password"
          value="short"
          secureTextEntry
          error="Use at least 8 characters."
          onChangeText={() => {}}
        />

        <Text style={styles.label}>not editable — a call is in flight</Text>
        <TextField
          testID="gallery-disabled"
          label="Email"
          value="reader@tandfonline.com"
          editable={false}
          onChangeText={() => {}}
        />

        {/* A long message has to wrap under the field rather than clip, or a
            reader on a small handset never learns what is wrong. */}
        <Text style={styles.label}>invalid — a message long enough to wrap</Text>
        <TextField
          testID="gallery-long-error"
          label="Password"
          value="hunter2"
          secureTextEntry
          error="Use at least 8 characters, and avoid a password you have used on another site."
          onChangeText={() => {}}
        />
      </View>

      <View style={styles.spacer} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.white },
  content: { paddingBottom: space.xl },
  // TextField sets no outer margin of its own (CONVENTIONS §8), so the gallery
  // supplies the inset and the rhythm between fields.
  stack: { paddingHorizontal: space.md, gap: space.sm },
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
    marginTop: space.md,
  },
  spacer: { height: space.xl },
});
