// src/components/CategoryCard/CategoryCard.tsx
// One card in the home screen's top category strip: a category the reader can
// open. The current fixtures give three — eBooks, Audiobooks, Open access —
// straight from `catalogue.navigation`.
//
// A STRIP, NOT A CAROUSEL. The featured carousel and its page dots were dropped
// from the plan; these cards took that slot. So there is no paging, no momentum
// snap and no dot to keep in sync — CatalogueScreen lays them out in a plain
// horizontal ScrollView.
//
// THE ACCENT FILLS THE WHOLE CARD. An earlier version put a block of colour
// above a white body, which read as a large empty panel with nothing in it: a
// publication card earns that space with a cover, a category has no image to put
// there. Tinting the whole card turns the colour into the content instead of
// padding around it.
//
// THE ACCENT IS A RAMP OF BLUES, NOT A SET OF HUES. `success`, `subscription`
// and `elite` used to be cycled here too. All three are SEMANTIC in Design Spec
// §2.1: Mint Dark means Open Access, Cornflower means Subscription, and Elite
// has no brand purple at all (PENDING — the old #7C3AED is outside the brand
// palette). AccessTierBadge renders those exact colours on the ContentCards
// directly below this strip, so a shelf tinted Mint Dark read as "Open Access"
// while meaning nothing of the sort.
//
// The four here are one tonal family instead — Indigo, Ultramarine and two
// intermediate blues (tokens.ts `blueDeep`/`blueBright`). A ramp reads as
// deliberate where a spread of unrelated hues reads as random, it satisfies
// "blue must always be present" and "do not mix secondary tonal ranges", and
// every step clears AA for white text including the count's 0.85 opacity.
//
// IT HAS NO PER-CATEGORY VARIANT, ON PURPOSE. A union like
// `variant: 'ebooks' | 'audiobooks' | 'openAccess'` would bake one institution's
// shelf names into a type. There is no such vocabulary to bake: an administrator
// names the shelves (AGENTS.md L-5, settled 16 Aug 2026), so two institutions see
// different rows. The card is handed a title, an optional count and an accent; a
// shelf added tomorrow renders with no code change at all.
//
// It sets no width — the strip that lays it out owns that (CONVENTIONS §8).
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { color, elevation, radius, space, type, weight } from '@theme/tokens';

// Which tokens may tint a category. All four are blues carrying no semantic
// meaning elsewhere in the app — see the header for why the status colours went.
export type CategoryAccent = 'primary' | 'navy' | 'blueDeep' | 'blueBright';

// `error` and `offline` belong to the screen that owns the feed request, not to
// one card in the strip (CONVENTIONS §6).
export type CategoryCardState = 'idle' | 'loading';

export interface CategoryCardProps {
  // The feed's own label ("eBooks"), rendered verbatim. Never mapped through a
  // lookup table keyed by category — see the header.
  title: string;
  // Titles on the shelf. Optional because home-catalogue navigation entries
  // carry no `totalItems`; zero is a real count and still renders.
  count?: number;
  // Chosen by the caller rather than derived from `title`, so no category is
  // named in a branch here.
  accent?: CategoryAccent;
  state?: CategoryCardState;
  // Absent means the card is not a navigation target, so it is not announced as
  // a button and no chevron is drawn.
  onPress?: () => void;
}

export default function CategoryCard({
  title,
  count,
  accent = 'primary',
  state = 'idle',
  onPress,
}: CategoryCardProps) {
  const loading = state === 'loading';
  // A skeleton stands in for a category the card cannot identify yet, so it must
  // not open anything.
  const pressable = onPress !== undefined && !loading;

  return (
    <Pressable
      testID="category-card"
      style={[styles.card, { backgroundColor: color[accent] }]}
      onPress={pressable ? onPress : undefined}
      // Clearing onPress alone leaves Pressable's responder system live; only
      // `disabled` actually stops the card reacting to touches.
      disabled={!pressable}
      accessibilityRole={pressable ? 'button' : undefined}
      accessibilityLabel={pressable ? title : undefined}
    >
      {/* One translucent circle bleeding off the top corner, filling the space
          the bottom-aligned content leaves empty. It gives the tint some depth
          so a saturated card does not read as a flat swatch, and costs nothing —
          no image asset. There were two of these; the second sat on the opposite
          edge and only made the card busier. */}
      <View style={styles.blob} pointerEvents="none" />

      {loading ? (
        <View testID="category-card-skeleton" style={styles.body}>
          <View style={[styles.bar, styles.barTitle]} />
          <View style={[styles.bar, styles.barCount]} />
        </View>
      ) : (
        <View style={styles.body}>
          <Text testID="category-card-title" style={styles.title} numberOfLines={1}>
            {title}
          </Text>

          <View style={styles.footer}>
            {count !== undefined && (
              <Text testID="category-card-count" style={styles.count}>
                {/* Formatting a number it was handed, which §3 permits. */}
                {count} {count === 1 ? 'title' : 'titles'}
              </Text>
            )}
            {/* The affordance, drawn only when the card really opens something. */}
            {pressable && <View testID="category-card-chevron" style={styles.chevron} />}
          </View>
        </View>
      )}
    </Pressable>
  );
}

// Card height, the decorative circle, and the chevron box. All composed from the
// spacing scale so no bare number reaches the stylesheet (CONVENTIONS §5).
//
// The height budgets one line of the (now smaller) title (22) above the count
// line (18) with a gap between — 48 inside padding, plus a little extra room
// (space.lg over space.md) so the card doesn't read as cramped around that
// compact text. The title used to be sectionHeader-sized across up to two
// lines (48 on its own), which read as the text crowding the card; a single
// compact line with slightly more breathing room around it is the balance.
const CARD_HEIGHT = space.xl * 3;
const BLOB = space.xl * 2 + space.md;
const CHEVRON = space.sm;

const styles = StyleSheet.create({
  card: {
    height: CARD_HEIGHT,
    borderRadius: radius.card,
    // Content sits at the bottom; the circle fills the space above it.
    justifyContent: 'flex-end',
    // Keeps the circle from spilling past the rounded corners.
    overflow: 'hidden',
    ...(Platform.OS === 'ios' ? elevation.card.ios : elevation.card.android),
  },

  // Positioned off the corner so only an arc shows, which reads as a highlight
  // rather than a shape someone forgot to finish.
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

  body: {
    padding: space.md,
    // A touch more than before (space.xs) — now that the title is one compact
    // line, a slightly bigger gap keeps it visually separate from the count
    // instead of the two reading as a single dense block.
    gap: space.sm,
  },
  title: {
    // Bold stays — it is still the card's heading — but at the body size rather
    // than sectionHeader's. sectionHeader (18px, up to 2 lines) is what read as
    // "too much text" on a 160-wide card; body size keeps the same bold family
    // (weight is baked into the font file, not this fontWeight value) while
    // taking meaningfully less room.
    fontWeight: weight.bold,
    fontFamily: type.sectionHeader.fontFamily,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    // The light token, since the card behind it is saturated.
    color: color.white,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    // Pushes the chevron to the far edge with the count on the left, and keeps
    // the chevron in place when there is no count to sit beside it.
    justifyContent: 'space-between',
  },
  count: {
    fontWeight: type.meta.weight,
    fontFamily: type.meta.fontFamily,
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
    color: color.white,
    // Held back from the title so the two do not compete.
    opacity: 0.85,
  },
  chevron: {
    width: CHEVRON,
    height: CHEVRON,
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderColor: color.white,
    transform: [{ rotate: '45deg' }],
    // Nudged in from the edge so the rotated box does not touch the padding.
    marginRight: space.xs,
  },

  bar: {
    backgroundColor: color.white,
    borderRadius: radius.card,
    // Lightened rather than grey: a grey bar on a saturated card looks like a
    // rendering fault instead of a placeholder.
    opacity: 0.25,
  },
  // Each bar stands at the height of the line it replaces, so nothing shifts
  // when the real data arrives.
  barTitle: { height: type.body.lineHeight, width: '70%' },
  barCount: { height: type.meta.lineHeight, width: '40%' },
});
