// Gallery entry — every variant of ErrorState from hardcoded props.
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { color, space, type } from '@theme/tokens';

import ErrorState from './ErrorState';

export default function ErrorStateGallery() {
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>ErrorState</Text>

      <Text style={styles.label}>network — Retry</Text>
      <ErrorState
        variant="network"
        message="You appear to be offline."
        onRetry={() => {}}
      />

      <Text style={styles.label}>not_ready — Retry is meaningful here</Text>
      <ErrorState
        variant="not_ready"
        message="This title is still being prepared."
        code="CONTENT_NOT_READY"
        onRetry={() => {}}
      />

      <Text style={styles.label}>access_restricted — Learn more, no Retry</Text>
      <ErrorState
        variant="access_restricted"
        message="Your library's subscription has expired."
        code="ENTITLEMENT_EXPIRED"
        onLearnMore={() => {}}
      />

      <Text style={styles.label}>access_restricted — online only</Text>
      <ErrorState
        variant="access_restricted"
        message="This title is available online only."
        code="DOWNLOAD_NOT_PERMITTED"
        onLearnMore={() => {}}
      />

      <Text style={styles.label}>not_found — no action</Text>
      <ErrorState
        variant="not_found"
        message="We could not find this title."
        code="NOT_FOUND"
      />

      <Text style={styles.label}>network — long message wraps</Text>
      <ErrorState
        variant="network"
        message="We could not reach the catalogue. Check your connection and try again in a moment."
        onRetry={() => {}}
      />

      <Text style={styles.label}>network — Retry rendered without a handler</Text>
      <ErrorState variant="network" message="You appear to be offline." />

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
