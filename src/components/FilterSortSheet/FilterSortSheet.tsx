// src/components/FilterSortSheet/FilterSortSheet.tsx
// Screen 12 — the filter & sort sheet for a browsed shelf. Wraps `BottomSheet`
// (Design Spec §2.3's 60–70% height) with the dimensions `browseParams`
// (src/search/browseLink.ts) already knows how to turn into query parameters:
// content type, access type and sort.
//
// EVERY ROW A CALLER CAN'T WIRE YET IS DISABLED, NOT REMOVED. Video (a content
// type), Date range and Subject (filter dimensions with no facet support —
// P0-8) and Relevance / Most cited (sort criteria outside `SORT_ORDERS`) all
// have no field behind them. Dropping them would make the sheet look complete
// when it is not; a greyed row that announces itself as disabled is the honest
// version, same reasoning as `FilterChip`'s own `disabled` prop.
//
// DRAFT, THEN APPLY. Every chip press here only updates what the caller is
// about to ask for — `onApply` is the one moment a new request goes out. This
// mirrors search's own filters-are-part-of-the-request rule (searchLink.ts)
// while keeping a shelf listing from re-fetching on every tap before the
// reader has finished choosing.
//
// SORT SHOWN EVEN WHEN IT WILL DO NOTHING. `sortDisabled` greys the sort
// section rather than hiding it: sort is honored only on the 'all' shelf
// (browseLink.ts), and a curated shelf that hid the row instead would look
// like a bug report waiting to happen rather than a documented limit.
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import BottomSheet from '@components/BottomSheet';
import { FilterChip } from '@components/FilterChip';
import { SectionHeader } from '@components/SectionHeader';
import type { AccessTier, SortOrder } from '@model/types';
import { color, radius, space, type } from '@theme/tokens';
import type { ContentFormat } from '@/shared/types/primitives';

// Filter panels are content-heavy — BottomSheet's own gallery calls out 70% as
// the height for exactly this case.
const SHEET_HEIGHT_RATIO = 0.7;

const CONTENT_TYPE_LABELS: Record<ContentFormat, string> = {
  EPUB: 'eBooks',
  PDF: 'PDF',
  AUDIO: 'Audiobooks',
};
const CONTENT_TYPES = Object.keys(CONTENT_TYPE_LABELS) as ContentFormat[];

const ACCESS_TIER_LABELS: Record<AccessTier, string> = {
  OPEN_ACCESS: 'Open access',
  SUBSCRIPTION: 'Subscription',
  ELITE: 'Elite',
};
const ACCESS_TIERS: AccessTier[] = ['OPEN_ACCESS', 'SUBSCRIPTION', 'ELITE'];

// The one sort vocabulary (types.ts SORT_ORDERS), paired with the four labels
// the doc names exactly: newest, oldest, A–Z, Z–A.
const SORT_OPTIONS: readonly { value: SortOrder; label: string }[] = [
  { value: 'publishedAt.desc', label: 'Newest' },
  { value: 'publishedAt.asc', label: 'Oldest' },
  { value: 'title.asc', label: 'A–Z' },
  { value: 'title.desc', label: 'Z–A' },
];

// No-op for a disabled chip's required onPress — it never fires (Pressable
// disables the press entirely), but FilterChip's prop is not optional.
function noop() {
  /* disabled — never called */
}

export interface FilterSortSheetProps {
  visible: boolean;
  onDismiss: () => void;

  contentType?: ContentFormat;
  onSelectContentType: (contentType: ContentFormat | undefined) => void;

  accessTier?: AccessTier;
  onSelectAccessTier: (accessTier: AccessTier | undefined) => void;

  sort?: SortOrder;
  onSelectSort: (sort: SortOrder | undefined) => void;
  /** Greys the whole sort row without removing it — see file header. */
  sortDisabled?: boolean;

  /** Commits the current selection and is the one moment a new request goes out. */
  onApply: () => void;
  /** Resets every dimension and commits immediately — there is nothing left to apply. */
  onClearAll: () => void;
}

export default function FilterSortSheet({
  visible,
  onDismiss,
  contentType,
  onSelectContentType,
  accessTier,
  onSelectAccessTier,
  sort,
  onSelectSort,
  sortDisabled = false,
  onApply,
  onClearAll,
}: FilterSortSheetProps) {
  return (
    <BottomSheet visible={visible} onDismiss={onDismiss} heightRatio={SHEET_HEIGHT_RATIO}>
      <View style={styles.container}>
        <Text style={styles.title}>Filter & sort</Text>

        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.section}>
            <SectionHeader title="Content type" />
            <View style={styles.chips}>
              <FilterChip
                label="All"
                selected={contentType === undefined}
                onPress={() => onSelectContentType(undefined)}
              />
              {CONTENT_TYPES.map((value) => (
                <FilterChip
                  key={value}
                  label={CONTENT_TYPE_LABELS[value]}
                  selected={contentType === value}
                  onPress={() => onSelectContentType(value)}
                />
              ))}
              <FilterChip label="Video" disabled onPress={noop} />
            </View>
          </View>

          <View style={styles.section}>
            <SectionHeader title="Access type" />
            <View style={styles.chips}>
              <FilterChip
                label="All"
                selected={accessTier === undefined}
                onPress={() => onSelectAccessTier(undefined)}
              />
              {ACCESS_TIERS.map((value) => (
                <FilterChip
                  key={value}
                  label={ACCESS_TIER_LABELS[value]}
                  selected={accessTier === value}
                  onPress={() => onSelectAccessTier(value)}
                />
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <SectionHeader title="More filters" />
            <View style={styles.chips}>
              <FilterChip label="Date range" disabled onPress={noop} />
              <FilterChip label="Subject" disabled onPress={noop} />
            </View>
          </View>

          <View style={styles.section}>
            <SectionHeader title="Sort" />
            {sortDisabled && (
              <Text testID="filter-sort-sheet-sort-note" style={styles.note}>
                Sort only applies when browsing all titles — this shelf keeps its own order.
              </Text>
            )}
            <View style={styles.chips}>
              {SORT_OPTIONS.map(({ value, label }) => (
                <FilterChip
                  key={value}
                  label={label}
                  selected={!sortDisabled && sort === value}
                  disabled={sortDisabled}
                  onPress={() => onSelectSort(value)}
                />
              ))}
              <FilterChip label="Relevance" disabled onPress={noop} />
              <FilterChip label="Most cited" disabled onPress={noop} />
            </View>
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            testID="filter-sort-sheet-clear"
            onPress={onClearAll}
            style={styles.clearButton}
            accessibilityRole="button"
            accessibilityLabel="Clear all filters"
          >
            <Text style={styles.clearLabel}>Clear All</Text>
          </Pressable>

          <Pressable
            testID="filter-sort-sheet-apply"
            onPress={onApply}
            style={styles.applyButton}
            accessibilityRole="button"
            accessibilityLabel="Apply filters"
          >
            <Text style={styles.applyLabel}>Apply Filters</Text>
          </Pressable>
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: space.md,
  },
  title: {
    fontWeight: type.pageTitle.weight,
    fontSize: type.pageTitle.size,
    lineHeight: type.pageTitle.lineHeight,
    color: color.textPrimary,
    marginBottom: space.sm,
  },
  scrollContent: {
    gap: space.lg,
    paddingBottom: space.lg,
  },
  section: {
    gap: space.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  note: {
    fontWeight: type.meta.weight,
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
    color: color.textSecondary,
  },
  footer: {
    flexDirection: 'row',
    gap: space.sm,
    paddingVertical: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.border,
  },
  clearButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.border,
  },
  clearLabel: {
    fontWeight: type.button.weight,
    fontSize: type.button.size,
    lineHeight: type.button.lineHeight,
    color: color.textPrimary,
  },
  applyButton: {
    flex: 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    backgroundColor: color.primary,
  },
  applyLabel: {
    fontWeight: type.button.weight,
    fontSize: type.button.size,
    lineHeight: type.button.lineHeight,
    color: color.white,
  },
});
