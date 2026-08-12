// src/screens/SearchScreen.FilterSheet.tsx
// Screen 12 — the Filter & Sort sheet for catalogue search.
//
// A SCREEN PART, NOT A LIBRARY COMPONENT. CONVENTIONS §1 puts a part used by one
// component beside it under `Owner.Part.tsx`, and §7 forbids a feature adding to
// the shared library on its own. The library pieces this screen is *supposed* to
// be composed from are `BottomSheet` (Keshav, #11) and `ActionButton` (Akriti,
// #15), neither of which exists yet. So the container and the two buttons below
// are deliberately local and deliberately plain: when those land, this file
// should shrink to the four sections and lose its own chrome entirely. Building
// a second shared BottomSheet here would be exactly the duplication the rule
// protects against.
//
// THE DRAFT IS LOCAL UNTIL APPLIED. The sheet edits a copy and hands it back on
// Apply, so backing out with the × leaves the results exactly as they were —
// which is what a sheet with an explicit Apply button promises.
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { FilterChip } from '@components/FilterChip';
import {
  ACCESS_FILTERS,
  CONTENT_TYPES,
  DATE_RANGES,
  SORT_OPTIONS,
  isAccessFilterSupported,
  isContentTypeSupported,
  isSortSupported,
  type AccessFilter,
  type ContentTypeFilter,
  type DateRangeFilter,
  type SortOption,
} from '@/search';
import { color, radius, space, type } from '@theme/tokens';

const RADIO_ICON_SIZE = 22;
const CLOSE_ICON_SIZE = 24;

// Reader-facing copy, kept apart from the machine values so a wording change
// never risks changing what the pipeline matches on.
// Exported so the screen's quick-access chip row uses the same words the sheet
// does. Two label maps would drift the first time one of them is reworded.
export const CONTENT_TYPE_LABELS: Record<ContentTypeFilter, string> = {
  ALL: 'All',
  JOURNALS: 'Journals',
  BOOKS: 'Books',
  AUDIO: 'Audio',
};

const ACCESS_LABELS: Record<AccessFilter, string> = {
  ALL: 'All Types',
  OPEN_ACCESS: 'Open Access',
  SUBSCRIPTION: 'Subscription',
  ELITE: 'Elite',
};

const DATE_RANGE_LABELS: Record<DateRangeFilter, string> = {
  ANY: 'Any time',
  LAST_YEAR: 'Last year',
  LAST_5_YEARS: 'Last 5 years',
};

const SORT_LABELS: Record<SortOption, string> = {
  RELEVANCE: 'Relevance',
  MOST_RECENT: 'Most Recent',
  MOST_CITED: 'Most Cited',
  ALPHABETICAL: 'Alphabetical',
};

export interface FilterCriteria {
  contentType: ContentTypeFilter;
  access: AccessFilter;
  dateRange: DateRangeFilter;
  sort: SortOption;
}

export const DEFAULT_CRITERIA: FilterCriteria = {
  contentType: 'ALL',
  access: 'ALL',
  dateRange: 'ANY',
  sort: 'RELEVANCE',
};

interface FilterSheetProps {
  criteria: FilterCriteria;
  onApply: (criteria: FilterCriteria) => void;
  onDismiss: () => void;
}

// One labelled block. Keeps the four sections visually identical without four
// copies of the same heading markup.
function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {note && <Text style={styles.sectionNote}>{note}</Text>}
      <View style={styles.chips}>{children}</View>
    </View>
  );
}

export default function FilterSheet({ criteria, onApply, onDismiss }: FilterSheetProps) {
  // Seeded once from the applied criteria. The parent mounts this only while
  // open, so every open starts from what is currently applied.
  const [draft, setDraft] = useState<FilterCriteria>(criteria);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onDismiss}>
      {/* Tapping outside dismisses without applying — the same promise the ×
          makes. Marked as a button so it is reachable rather than being a
          sighted-only gesture. */}
      <Pressable
        testID="filter-sheet-backdrop"
        style={styles.backdrop}
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel="Close filters"
      />

      <View testID="filter-sheet" style={styles.sheet}>
        <View style={styles.handle} />

        <View style={styles.header}>
          <Text style={styles.heading}>Filter &amp; Sort</Text>
          <Pressable
            testID="filter-sheet-close"
            onPress={onDismiss}
            hitSlop={space.sm}
            accessibilityRole="button"
            accessibilityLabel="Close filters"
          >
            <Ionicons name="close" size={CLOSE_ICON_SIZE} color={color.textPrimary} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <Section
            title="Content Type"
            // Journals is greyed rather than dropped: `Publication` carries no
            // work type, and OPDS `@type` for journal is still a guess (Q-1b).
            note={
              isContentTypeSupported('JOURNALS')
                ? undefined
                : 'Journals needs a work-type field the catalogue does not send yet.'
            }
          >
            {CONTENT_TYPES.map((value) => (
              <FilterChip
                key={value}
                label={CONTENT_TYPE_LABELS[value]}
                selected={draft.contentType === value}
                disabled={!isContentTypeSupported(value)}
                onPress={() => setDraft({ ...draft, contentType: value })}
              />
            ))}
          </Section>

          <Section
            title="Access Type"
            // Q-D closed: the tier is DERIVED from licenceModel, and that
            // derivation belongs to the adapter / resolveAccess, never here
            // (Design Spec §5.1). Until one of them lands, the tiers cannot be
            // resolved, so they cannot be filtered on.
            note="Access tiers are resolved by the access layer, which is not built yet."
          >
            {ACCESS_FILTERS.map((value) => (
              <FilterChip
                key={value}
                label={ACCESS_LABELS[value]}
                selected={draft.access === value}
                disabled={!isAccessFilterSupported(value)}
                onPress={() => setDraft({ ...draft, access: value })}
              />
            ))}
          </Section>

          <Section title="Date Range">
            {DATE_RANGES.map((value) => (
              <FilterChip
                key={value}
                label={DATE_RANGE_LABELS[value]}
                selected={draft.dateRange === value}
                onPress={() => setDraft({ ...draft, dateRange: value })}
              />
            ))}
          </Section>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Sort by</Text>
            {SORT_OPTIONS.map((value) => {
              const supported = isSortSupported(value);
              const selected = draft.sort === value;

              return (
                <Pressable
                  key={value}
                  testID={`sort-option-${value}`}
                  onPress={() => setDraft({ ...draft, sort: value })}
                  disabled={!supported}
                  style={[styles.sortRow, !supported && styles.sortRowDisabled]}
                  accessibilityRole="radio"
                  accessibilityLabel={SORT_LABELS[value]}
                  accessibilityState={{ selected, disabled: !supported }}
                >
                  <Ionicons
                    name={selected ? 'radio-button-on' : 'radio-button-off'}
                    size={RADIO_ICON_SIZE}
                    color={selected ? color.primary : color.textSecondary}
                  />
                  <Text style={styles.sortLabel}>{SORT_LABELS[value]}</Text>
                </Pressable>
              );
            })}
            {/* Stated once, next to the control it explains. */}
            <Text style={styles.sectionNote}>
              Most Cited needs a citation count the catalogue does not send yet.
            </Text>
          </View>
        </ScrollView>

        <View style={styles.actions}>
          <Pressable
            testID="filter-sheet-apply"
            onPress={() => onApply(draft)}
            style={styles.applyButton}
            accessibilityRole="button"
            accessibilityLabel="Apply filters"
          >
            <Text style={styles.applyLabel}>Apply Filters</Text>
          </Pressable>

          <Pressable
            testID="filter-sheet-clear"
            // Clears the DRAFT, not the applied criteria — nothing changes on
            // the results until Apply, which is what the button beside it means.
            onPress={() => setDraft(DEFAULT_CRITERIA)}
            style={styles.clearButton}
            accessibilityRole="button"
            accessibilityLabel="Clear all filters"
          >
            <Text style={styles.clearLabel}>Clear All</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: color.textPrimary,
    opacity: 0.4,
  },
  sheet: {
    // Design Spec §2.3: 16px top radius, drag handle, 60–70% of the screen.
    maxHeight: '75%',
    backgroundColor: color.surface,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingBottom: space.lg,
  },
  handle: {
    width: space.xl,
    height: space.xs,
    borderRadius: radius.pill,
    backgroundColor: color.border,
    alignSelf: 'center',
    marginTop: space.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingTop: space.md,
  },
  heading: {
    fontWeight: type.pageTitle.weight,
    fontSize: type.pageTitle.size,
    lineHeight: type.pageTitle.lineHeight,
    color: color.textPrimary,
  },
  body: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.lg,
  },
  section: {
    marginBottom: space.lg,
  },
  sectionTitle: {
    fontWeight: type.sectionHeader.weight,
    fontSize: type.sectionHeader.size,
    lineHeight: type.sectionHeader.lineHeight,
    color: color.textPrimary,
    marginBottom: space.sm,
  },
  sectionNote: {
    fontWeight: type.meta.weight,
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
    color: color.textSecondary,
    marginBottom: space.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
  },
  sortRowDisabled: {
    opacity: 0.4,
  },
  sortLabel: {
    fontWeight: type.body.weight,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: color.textPrimary,
  },
  actions: {
    paddingHorizontal: space.lg,
    gap: space.sm,
  },
  applyButton: {
    height: space.xl + space.md,
    borderRadius: radius.card,
    backgroundColor: color.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  applyLabel: {
    fontWeight: type.button.weight,
    fontSize: type.button.size,
    lineHeight: type.button.lineHeight,
    color: color.surface,
  },
  clearButton: {
    height: space.xl + space.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearLabel: {
    fontWeight: type.button.weight,
    fontSize: type.button.size,
    lineHeight: type.button.lineHeight,
    color: color.primary,
  },
});
