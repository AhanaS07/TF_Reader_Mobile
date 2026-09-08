// Owner: Accessibility (Hruthik).
//
// Purely presentational: renders a PublicationAccessibilitySummary as-is. Day 3 owns fetching a
// book's metadata (getPublicationAccessibility) and calling summarizePublicationAccessibility —
// this component has no idea a book, a bookId, or an async fetch exists.
//
// Renders `hazards.label` verbatim rather than branching on `hazards.declaration` — the
// not-provided vs none-declared distinction is publicationA11ySummary.ts's decision to make, not
// this component's to re-derive. `conformsTo` is framed as a publisher self-report
// ("Publisher-asserted conformance"), never as verification, matching the pipeline's own D10.
//
// No pressables or focus rings in v1 — every field here is static text. MIN_TOUCH_TARGET will
// apply once Day 3 adds real interactive chrome (a dismiss/close control, or an expand/collapse
// affordance) — tracked in 4th Week Plan.md's Day 3 entry.

import { StyleSheet, Text, View } from 'react-native';

import { useAppearanceEnv } from '@/features/reader/useAppearanceEnv';

import type { PublicationAccessibilitySummary } from './publicationA11ySummary';

export interface AccessibilitySummaryViewProps {
  summary: PublicationAccessibilitySummary;
}

export function AccessibilitySummaryView({
  summary,
}: AccessibilitySummaryViewProps): React.JSX.Element {
  const { osFontScale } = useAppearanceEnv();

  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" style={[styles.headline, { fontSize: 18 * osFontScale }]}>
        {summary.headline}
      </Text>

      {!summary.isEmpty && (
        <>
          <TokenSection title="Access modes" tokens={summary.accessModes} osFontScale={osFontScale} />
          <TokenSection
            title="Accessibility features"
            tokens={summary.accessibilityFeatures}
            osFontScale={osFontScale}
          />

          <Section title="Hazards" osFontScale={osFontScale}>
            <Text style={[styles.sectionBody, { fontSize: 14 * osFontScale }]}>
              {summary.hazards.label}
            </Text>
          </Section>

          <TokenSection
            title="Publisher-asserted conformance"
            tokens={summary.conformsTo}
            osFontScale={osFontScale}
          />

          {summary.publisherStatement !== undefined && (
            <Section title="Publisher's accessibility statement" osFontScale={osFontScale}>
              <Text style={[styles.sectionBody, { fontSize: 14 * osFontScale }]}>
                {summary.publisherStatement}
              </Text>
            </Section>
          )}
        </>
      )}
    </View>
  );
}

interface SectionProps {
  title: string;
  osFontScale: number;
  children: React.ReactNode;
}

// Unexported — pairs a header with its body so the sections above don't each repeat the same
// accessibilityRole="header" boilerplate.
function Section({ title, osFontScale, children }: SectionProps): React.JSX.Element {
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={[styles.sectionHeader, { fontSize: 15 * osFontScale }]}>
        {title}
      </Text>
      {children}
    </View>
  );
}

interface TokenSectionProps {
  title: string;
  tokens: string[];
  osFontScale: number;
}

// Renders nothing when `tokens` is empty — a section header with nothing under it is worse than
// omitting the section outright.
function TokenSection({ title, tokens, osFontScale }: TokenSectionProps): React.JSX.Element | null {
  if (tokens.length === 0) return null;

  return (
    <Section title={title} osFontScale={osFontScale}>
      {tokens.map((token) => (
        // Each token is its own Text node, not one comma-joined string — VoiceOver/TalkBack reads
        // list items individually rather than as a single run-on sentence.
        <Text key={token} style={[styles.listItem, { fontSize: 14 * osFontScale }]}>
          {token}
        </Text>
      ))}
    </Section>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headline: { fontWeight: '700', color: '#111111', marginBottom: 12 },
  section: { marginBottom: 16 },
  sectionHeader: { fontWeight: '600', color: '#111111', marginBottom: 6 },
  sectionBody: { color: '#333333' },
  listItem: { color: '#333333', marginBottom: 2 },
});
