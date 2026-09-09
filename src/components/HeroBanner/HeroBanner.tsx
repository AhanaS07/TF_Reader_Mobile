// src/components/HeroBanner/HeroBanner.tsx
// The editorial banner at the top of the Home/Catalogue screen: a stat pill,
// a headline, a line of supporting copy, an action button and an "updated"
// note, on a brand gradient — matched against a reference design.
// CatalogueScreen is its only caller.
//
// THE ACTION IS BOTH-OR-NEITHER, LIKE SECTIONHEADER'S. `actionLabel` with no
// `onPressAction` would render a button that looks tappable and does
// nothing — the same dishonesty SectionHeader's own action slot avoids.
//
// `statLabel` AND `updatedLabel` ARE STRINGS, NOT DATA THIS COMPONENT
// INTERPRETS. Whether either is a real derived number or static editorial
// copy is the screen's decision — this file only renders the finished text,
// the same reason `badge` and `action` arrive as nodes elsewhere in this
// codebase rather than raw values this component would have to interpret.
//
// FULL-OPACITY TEXT, NOT A FADED SUBTITLE. tokens.ts already documents a real
// contrast failure from putting reduced-opacity white text on a saturated fill
// (the `subscription` colour note: 4.94:1 drops to ~4.20:1 at 0.85 opacity,
// under AA). This banner keeps every line at full opacity and leans on the
// type scale alone (`editorialTitle` for the headline, `body`/`smallLabel`
// for everything else) for hierarchy instead. The action button fills with
// `color.subscription` (Cornflower): the same tokens.ts note measures white
// text on it at 4.94:1, which clears AA at the button label's normal
// (non-reduced) size.
//
// `statLabel` IS THE ONE LINE ON ALEO (`keyStat`), NOT THE HEADLINE. The
// brand guide's own typography page names "Aleo light key stat" as an
// example, and reserves Open Sans Regular for titles — `title` below is
// this screen's own title, so it stays Open Sans (`editorialTitle`) even
// though an earlier pass had routed it through Aleo.
//
// THE BLOB IS CATEGORYCARD'S, REUSED. One translucent circle bleeding off the
// corner, filling space a bottom-aligned text block leaves empty — the same
// device, for the same reason: it gives a saturated fill some depth without a
// second image asset.
//
// RAISED, NOT `card`. This is the one surface on the screen meant to look
// lifted off the page rather than merely separated from it — see
// `elevation.raised`'s own header in tokens.ts.
//
// It sets no outer margin (CONVENTIONS §8) — CatalogueScreen's own `content`
// gap spacing places it, the same way every other section on that screen is
// spaced.
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';

import { color, elevation, radius, space, type } from '@theme/tokens';

export type HeroBannerState = 'idle' | 'loading';

export interface HeroBannerProps {
  // A small pill above the headline ("Over 140,000 peer-reviewed titles").
  // Absent renders no pill at all.
  statLabel?: string;
  // Rendered verbatim — static brand copy chosen by the screen, not a value
  // this component derives.
  title: string;
  // Optional supporting line. Absent renders no second line at all, the same
  // rule ContentCard applies to `publisher`.
  subtitle?: string;
  // The button label ("Explore All Titles"). See the file header — both this
  // and `onPressAction` arrive together or not at all.
  actionLabel?: string;
  onPressAction?: () => void;
  // A pre-worded note ("Updated daily"), not a timestamp. See the file header.
  updatedLabel?: string;
  state?: HeroBannerState;
}

export default function HeroBanner({
  statLabel,
  title,
  subtitle,
  actionLabel,
  onPressAction,
  updatedLabel,
  state = 'idle',
}: HeroBannerProps) {
  const loading = state === 'loading';
  // Both, or neither — see the file header.
  const showAction = actionLabel !== undefined && onPressAction !== undefined;
  const showFooter = showAction || updatedLabel !== undefined;

  return (
    // The shadow lives here, not on the gradient below. The gradient sets
    // `overflow: 'hidden'` to clip the decorative blob to its rounded corner,
    // and on iOS that would clip a shadow on the same view too — see
    // ContentCard's identical `coverShadow` wrapper for the same reason.
    <View testID="hero-banner" style={styles.shadow}>
      <LinearGradient
        colors={[color.navy, color.primary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.banner}
      >
        {/* CategoryCard's own device: one translucent circle bleeding off the
            corner, giving the fill some depth with no image asset. */}
        <View style={styles.blob} pointerEvents="none" />

        {loading ? (
          <View testID="hero-banner-skeleton" style={styles.skeleton}>
            <View style={[styles.bar, styles.barStat]} />
            <View style={[styles.bar, styles.barTitle]} />
            <View style={[styles.bar, styles.barSubtitle]} />
          </View>
        ) : (
          <>
            {statLabel !== undefined && (
              <View testID="hero-banner-stat" style={styles.stat}>
                <Ionicons name="book" size={type.smallLabel.size} color={color.navy} />
                <Text style={styles.statLabel}>{statLabel}</Text>
              </View>
            )}
            <Text
              testID="hero-banner-title"
              style={styles.title}
              // Announced as a heading, same reason SectionHeader does — a screen
              // reader can jump past it rather than reading the gradient copy
              // linearly with the feed beneath it.
              accessibilityRole="header"
            >
              {title}
            </Text>
            {subtitle !== undefined && (
              <Text testID="hero-banner-subtitle" style={styles.subtitle}>
                {subtitle}
              </Text>
            )}
            {showFooter && (
              <View style={styles.footer}>
                {showAction && (
                  <Pressable
                    testID="hero-banner-action"
                    style={styles.action}
                    onPress={onPressAction}
                    accessibilityRole="button"
                  >
                    <Text style={styles.actionLabel}>{actionLabel}</Text>
                    <Ionicons name="arrow-forward" size={type.button.size} color={color.white} />
                  </Pressable>
                )}
                {updatedLabel !== undefined && (
                  <View style={styles.updatedRow}>
                    <View style={styles.updatedDot} />
                    <Text testID="hero-banner-updated" style={styles.updated}>
                      {updatedLabel}
                    </Text>
                  </View>
                )}
              </View>
            )}
          </>
        )}
      </LinearGradient>
    </View>
  );
}

// The decorative blob's size, following CategoryCard's own formula (top:
// -BLOB/3, right: -BLOB/4) at a larger scale for this bigger surface.
const BLOB = space.xl * 3;

const styles = StyleSheet.create({
  // Matches `banner`'s own radius so the shadow's outline follows the same
  // rounded shape. `backgroundColor` gives Android's elevation shadow a
  // non-transparent surface to draw against, even though the gradient below
  // fully covers it.
  shadow: {
    borderRadius: radius.sheet,
    backgroundColor: color.navy,
    ...(Platform.OS === 'ios' ? elevation.raised.ios : elevation.raised.android),
  },
  banner: {
    borderRadius: radius.sheet,
    padding: space.lg,
    gap: space.sm,
    overflow: 'hidden',
  },
  blob: {
    position: 'absolute',
    width: BLOB,
    height: BLOB,
    borderRadius: radius.pill,
    backgroundColor: color.white,
    opacity: 0.12,
    top: -BLOB / 3,
    right: -BLOB / 4,
  },
  // Bars stand at the height of the line they replace, so nothing shifts when
  // real copy lands — same convention as CategoryCard's skeleton.
  skeleton: {
    gap: space.xs,
  },
  bar: {
    backgroundColor: color.white,
    borderRadius: radius.card,
    // Lightened rather than grey: a grey bar on a saturated gradient reads as a
    // rendering fault instead of a placeholder (CategoryCard's own reasoning).
    opacity: 0.25,
  },
  barStat: { height: type.keyStat.lineHeight, width: '55%' },
  barTitle: { height: type.editorialTitle.lineHeight, width: '70%' },
  barSubtitle: { height: type.body.lineHeight, width: '50%' },
  // The reference design's pill above the headline — light tint, dark text,
  // the same pairing `AccessTierBadge`'s Subscription badge now uses.
  stat: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    backgroundColor: color.subscriptionTint,
    marginBottom: space.xs,
  },
  // Aleo Light (`keyStat`) — the brand guide's own named example ("Aleo
  // light key stat") is exactly this pill, not a reference design's choice.
  statLabel: {
    fontFamily: type.keyStat.fontFamily,
    fontSize: type.keyStat.size,
    lineHeight: type.keyStat.lineHeight,
    color: color.navy,
  },
  title: {
    fontFamily: type.editorialTitle.fontFamily,
    fontSize: type.editorialTitle.size,
    lineHeight: type.editorialTitle.lineHeight,
    color: color.white,
  },
  subtitle: {
    fontFamily: type.body.fontFamily,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: color.white,
  },
  // The button and the "updated" note share one row, pinned to opposite ends —
  // mirrors SectionHeader's title/action layout, one level up in scale.
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    marginTop: space.xs,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.card,
    backgroundColor: color.subscription,
  },
  actionLabel: {
    fontFamily: type.button.fontFamily,
    fontSize: type.button.size,
    lineHeight: type.button.lineHeight,
    color: color.white,
  },
  updatedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    gap: space.xs,
  },
  // A small filled circle, the reference design's "live" dot ahead of
  // "Updated daily" — decorative, so it carries no accessibility role of its
  // own; `updated`'s own text is what a screen reader announces.
  updatedDot: {
    width: space.xs,
    height: space.xs,
    borderRadius: radius.pill,
    backgroundColor: color.subscriptionTint,
  },
  updated: {
    flexShrink: 1,
    fontFamily: type.smallLabel.fontFamily,
    fontSize: type.smallLabel.size,
    lineHeight: type.smallLabel.lineHeight,
    color: color.white,
  },
});
