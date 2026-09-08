// Owner: Accessibility (Hruthik).
//
// Hosts AccessibilitySummaryView.tsx (Day 2) behind a real screen. Fetches
// getPublicationAccessibility(bookId) and summarizes it itself — Day 2's view stays purely
// presentational, with no idea a bookId or an async fetch exists.
//
// Props are `{ bookId, onClose }`, not a navigation object — same "ignorant of where things come
// from" contract ReaderScreen/AudioPlayerScreen already follow via their own route-screen split.
// `BookInfoRouteScreen.tsx` is what knows about `navigation.goBack()`.
//
// getPublicationAccessibility does not reject for the cases its own pipeline documents (a parse
// failure lands in metadata.issues, never thrown) — the try/catch below is a defensive backstop,
// not the primary path. PDF/AUDIO books resolve to the empty model (no OPF to read), which renders
// as an intentional "nothing declared" state via AccessibilitySummaryView, not an error.
//
// No expand/collapse affordance yet — no known fixture produces token lists long enough to need
// one. MIN_TOUCH_TARGET applies here to the one control this screen adds: the close button.

import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { getPublicationAccessibility } from './getPublicationAccessibility';
import { summarizePublicationAccessibility } from './publicationA11ySummary';
import type { PublicationAccessibilitySummary } from './publicationA11ySummary';
import { AccessibilitySummaryView } from './AccessibilitySummaryView';
import { MIN_TOUCH_TARGET } from './a11yConstants';
import type { BookId } from '@/shared/contracts';

export interface AccessibilityInfoScreenProps {
  bookId: BookId;
  onClose: () => void;
}

export function AccessibilityInfoScreen({
  bookId,
  onClose,
}: AccessibilityInfoScreenProps): React.JSX.Element {
  const [summary, setSummary] = useState<PublicationAccessibilitySummary | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const metadata = await getPublicationAccessibility(bookId);
        if (!cancelled) {
          setSummary(summarizePublicationAccessibility(metadata));
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(error);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bookId]);

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={onClose}
        style={styles.closeButton}
      >
        <Text style={styles.closeIcon}>✕</Text>
      </Pressable>

      <Text accessibilityRole="header" style={styles.title}>
        Accessibility information
      </Text>

      {loadError ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>Couldn&apos;t load accessibility information.</Text>
        </View>
      ) : !summary ? (
        <View style={styles.centered} testID="accessibility-info-loading">
          <ActivityIndicator />
        </View>
      ) : (
        <ScrollView>
          <AccessibilitySummaryView summary={summary} />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff', paddingTop: 8 },
  closeButton: {
    minWidth: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-end',
    marginRight: 8,
  },
  closeIcon: { fontSize: 20, color: '#111111' },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111111',
    textAlign: 'center',
    marginBottom: 8,
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { color: '#333333', paddingHorizontal: 16, textAlign: 'center' },
});
