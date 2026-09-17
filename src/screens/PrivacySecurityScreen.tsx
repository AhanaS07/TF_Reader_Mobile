// src/screens/PrivacySecurityScreen.tsx
// Pushed from the "Privacy & Security" row on screen 10 — see that row's own
// comment on ProfileScreen.tsx for why it stayed `variant="static"` until
// this screen existed.
//
// STATIC CONTENT, SHAPED AROUND T&F'S OWN PRIVACY & SECURITY PAGE, NOT COPIED
// FROM IT. T&F's own published policy describes T&F's website and its data
// flows, not Nexus's — carrying its legal text over verbatim would misstate
// what this app actually does. This screen borrows only the section shape
// (what's collected, how it's used, how it's protected, your choices, who
// else sees it, how to reach us) and fills it with Nexus-specific copy.
//
// THIS COPY IS A DRAFT, AND SAYS SO ON SCREEN. It has not been reviewed by
// legal — the same "flag rather than invent" rule the rest of this codebase
// already follows for facts it cannot source (see AuthMeResponse's missing
// name/email on ProfileScreen.tsx). Do not ship this without that review.
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { SectionHeader } from '@components/SectionHeader';
import { color, radius, space, type } from '@theme/tokens';

interface Section {
  title: string;
  body: string;
}

const SECTIONS: Section[] = [
  {
    title: 'Data we collect',
    body:
      'Your account details (email, or your institution where access comes through one), the ' +
      'titles you open, your reading progress and preferences, and basic device diagnostics used ' +
      'to keep the app working reliably.',
  },
  {
    title: 'How we use it',
    body:
      'To sync your library and reading position across your devices, apply your accessibility ' +
      'and reading preferences, and confirm the access your institution or account entitles you ' +
      'to.',
  },
  {
    title: 'How it’s protected',
    body:
      'Titles you download are encrypted on your device, and sign-in tokens are kept in your ' +
      'device’s secure keychain rather than in plain storage. Data sent to our servers travels ' +
      'over an encrypted connection.',
  },
  {
    title: 'Your choices',
    body:
      'Signing out removes your credentials from this device, and removing a title from Library ' +
      'deletes its downloaded copy. For account-level requests, contact your institution’s ' +
      'library.',
  },
  {
    title: 'Third parties',
    body:
      'Data is shared only with the publisher and institutional systems needed to verify your ' +
      'access and deliver the content itself — never for advertising.',
  },
  {
    title: 'Contact',
    body: 'Questions about this policy can be directed to your institution’s library, or to Taylor & Francis support.',
  },
];

export default function PrivacySecurityScreen() {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.pageHeader}>
        <Text style={styles.pageTitle}>Privacy & Security</Text>
        <Text style={styles.pageSubtitle}>How Nexus handles your data, and keeps it safe.</Text>
      </View>

      {SECTIONS.map((section) => (
        <View key={section.title} style={styles.group}>
          <SectionHeader title={section.title} />
          <Text style={styles.body}>{section.body}</Text>
        </View>
      ))}

      <Text style={styles.note}>
        This page is a draft of Nexus’s data handling and has not yet been reviewed by legal
        — treat it as a starting point, not a final policy.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.white,
  },
  content: {
    padding: space.md,
    paddingBottom: space.xl,
    gap: space.lg,
  },
  pageHeader: {
    gap: space.xs,
    paddingBottom: space.sm,
  },
  pageTitle: {
    fontFamily: type.editorialTitle.fontFamily,
    fontSize: type.editorialTitle.size,
    lineHeight: type.editorialTitle.lineHeight,
    color: color.textPrimary,
  },
  pageSubtitle: {
    fontFamily: type.editorialMeta.fontFamily,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: color.textSecondary,
  },
  group: {
    gap: space.sm,
    padding: space.md,
    backgroundColor: color.white,
    borderRadius: radius.sheet,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.border,
  },
  body: {
    fontWeight: type.body.weight,
    fontFamily: type.body.fontFamily,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: color.textPrimary,
  },
  note: {
    fontWeight: type.smallLabel.weight,
    fontFamily: type.smallLabel.fontFamily,
    fontSize: type.smallLabel.size,
    lineHeight: type.smallLabel.lineHeight,
    color: color.textSecondary,
  },
});
