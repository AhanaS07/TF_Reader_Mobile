// src/components/EliteActiveAccessCard/EliteActiveAccessCard.tsx
// An Elite title the reader currently holds — access already granted, not
// queued, readable right now. Product spec (Sept 2026), Library redesign,
// Premium §"STATE 2 — ACTIVE ELITE ACCESS": "Elite access is temporary. When
// access expires, the user loses access and must request access again."
//
// SHARED BY `All` AND `Premium`, same reason as `ElitePendingAccessCard` —
// one component, not two copies of the same Elite state (spec §11).
//
// `expiresLabel` IS ALREADY-FORMATTED, LIKE ITS SIBLING CARD'S `expiryLabel`.
// The caller derives it from the SAME loan this card is drawn for, via
// `LibraryScreen.holdings.ts`'s `dueLabel` — this file adds no arithmetic of
// its own and no clock. Absent renders no expiry line, never an invented
// duration (the spec's own "Do NOT invent an expiration duration").
//
// TAPS THROUGH TO THE ITEM'S DETAIL PAGE, LIKE EVERY OTHER ROW IN THIS APP.
// Catalogue/Search/Shelf never open a reader straight from a list row either
// — they push `ItemDetail` and reading happens from that page's own
// ActionBar. `onPress` is required rather than optional for the same reason
// ContentCard treats a missing `onPress` as "not a navigation target": a
// card with nothing to do on tap would draw no chevron and be misleading if
// it looked pressable anyway.
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { AccessTierBadge } from '@components/AccessTierBadge';
import { color, radius, space, type } from '@theme/tokens';

export interface EliteActiveAccessCardProps {
  title: string;
  imageUrl?: string;
  /** Already-derived ('PDF', 'EPUB', 'AUDIO') — never guessed here. */
  format?: string;
  /** Already-formatted ("Due in 3 days", "Due now"). Absent renders no line. */
  expiresLabel?: string;
  /** Tap → this item's detail page. */
  onPress: () => void;
}

const THUMB = space.xl * 2.5;
const ICON_SIZE = space.lg;

export default function EliteActiveAccessCard({
  title,
  imageUrl,
  format,
  expiresLabel,
  onPress,
}: EliteActiveAccessCardProps) {
  return (
    <Pressable
      testID="elite-active-access-card"
      style={styles.card}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <View style={styles.thumbWrap}>
        {imageUrl === undefined ? (
          <View testID="elite-active-access-placeholder" style={[styles.thumb, styles.placeholder]}>
            <Ionicons name="image-outline" size={ICON_SIZE} color={color.textSecondary} />
          </View>
        ) : (
          <Image testID="elite-active-access-image" source={{ uri: imageUrl }} style={styles.thumb} resizeMode="cover" />
        )}
      </View>

      <View style={styles.body}>
        {/* No colour banner here — the page-level heading above this card
            ("Your content" / "Your Elite access") already says what group
            it belongs to; the Elite pill below is the card's own fact about
            itself and does not need a second, redundant label restating it. */}
        <Text testID="elite-active-access-title" style={styles.title} numberOfLines={2}>
          {title}
        </Text>

        <View style={styles.metaRow}>
          <AccessTierBadge tier="ELITE" size="sm" />
          {format !== undefined && (
            <View style={styles.formatChip}>
              <Text style={styles.formatChipText}>{format}</Text>
            </View>
          )}
        </View>

        {expiresLabel !== undefined && (
          <Text testID="elite-active-access-expiry" style={styles.expiry}>
            Access expires: {expiresLabel}
          </Text>
        )}
      </View>

      <View style={styles.chevron} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: color.white,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.border,
    padding: space.xs,
  },
  thumbWrap: {
    alignSelf: 'flex-start',
  },
  thumb: {
    width: THUMB,
    aspectRatio: 2 / 3,
    borderRadius: radius.card,
    backgroundColor: color.border,
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    gap: space.xs / 2,
  },
  title: {
    fontFamily: type.cardTitle.fontFamily,
    fontSize: type.cardTitle.size,
    lineHeight: type.cardTitle.lineHeight,
    letterSpacing: -0.3,
    color: color.textPrimary,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  formatChip: {
    paddingHorizontal: space.xs,
    paddingVertical: space.xs / 2,
    backgroundColor: color.border,
    borderRadius: radius.card,
  },
  formatChipText: {
    fontFamily: type.cardLabel.fontFamily,
    fontSize: type.cardLabel.size,
    lineHeight: type.cardLabel.lineHeight,
    color: color.textSecondary,
  },
  expiry: {
    fontFamily: type.smallLabel.fontFamily,
    fontSize: type.smallLabel.size,
    lineHeight: type.smallLabel.lineHeight,
    color: color.textSecondary,
  },
  // Two borders on a rotated square: a chevron without an icon font, the
  // same device ContentCard's own row chevron uses.
  chevron: {
    width: space.sm,
    height: space.sm,
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderColor: color.textSecondary,
    transform: [{ rotate: '45deg' }],
    marginRight: space.xs,
  },
});
