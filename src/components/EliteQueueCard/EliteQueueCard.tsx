// src/components/EliteQueueCard/EliteQueueCard.tsx
// An Elite title the reader is waiting for — a real place in a real queue,
// and nothing to DO about it yet. Product spec (Sept 2026), Library
// redesign, Premium §"STATE 3 — WAITING QUEUE": "The user is WAITING, not
// currently allowed to read." Shared by `All` and `Premium`, same reason as
// its two sibling cards.
//
// TAPPING GOES TO THE ITEM'S DETAIL PAGE — that is browsing, not the ACTION
// this card deliberately still refuses to invent (cancelling a hold is a
// real thing a reader may want, but it is not on this screen's spec, so no
// button appears here for it). Mirrors every other row in the app: viewing
// detail is always available; acting on a hold is not this card's job.
//
// `queueLabel` AND `progressFraction` ARE ALREADY-DERIVED. Both come from
// `LibraryScreen.holdings.ts` (`queueLabel`, `queueProgressFraction`), which
// already read `Hold.position`/`Hold.queueLength` and refuse to draw a bar
// with no denominator — this file adds no arithmetic and no fallback number.
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { AccessTierBadge } from '@components/AccessTierBadge';
import { color, radius, space, type } from '@theme/tokens';

export interface EliteQueueCardProps {
  title: string;
  imageUrl?: string;
  /** Already-derived ('PDF', 'EPUB', 'AUDIO') — never guessed here. */
  format?: string;
  /** "3rd of 7" / "3rd in the queue" — see `queueLabel`. Absent renders no line. */
  queueLabel?: string;
  /** 0–1 fill toward the front — see `queueProgressFraction`. Absent draws no bar. */
  progressFraction?: number;
  /** Tap → this item's detail page. */
  onPress: () => void;
}

const THUMB = space.xl * 2.5;
const ICON_SIZE = space.lg;

export default function EliteQueueCard({
  title,
  imageUrl,
  format,
  queueLabel,
  progressFraction,
  onPress,
}: EliteQueueCardProps) {
  return (
    <Pressable
      testID="elite-queue-card"
      style={styles.card}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <View style={styles.thumbWrap}>
        {imageUrl === undefined ? (
          <View testID="elite-queue-placeholder" style={[styles.thumb, styles.placeholder]}>
            <Ionicons name="image-outline" size={ICON_SIZE} color={color.textSecondary} />
          </View>
        ) : (
          <Image testID="elite-queue-image" source={{ uri: imageUrl }} style={styles.thumb} resizeMode="cover" />
        )}
      </View>

      <View style={styles.body}>
        <Text testID="elite-queue-title" style={styles.title} numberOfLines={2}>
          {title}
        </Text>

        {/* "Elite" + "In queue" side by side — the page-level heading above
            this card already says "Waiting for access"; repeating that as a
            second banner on the card itself was the redundancy this pass
            removed. */}
        <View style={styles.metaRow}>
          <AccessTierBadge tier="ELITE" size="sm" />
          <View style={styles.queueChip}>
            <Text style={styles.queueChipText}>In queue</Text>
          </View>
          {format !== undefined && (
            <View style={styles.formatChip}>
              <Text style={styles.formatChipText}>{format}</Text>
            </View>
          )}
        </View>

        {/* Prominent by size and weight, not colour — this is the one fact
            the reader is here to see, so it reads bigger than the metadata
            around it rather than sharing a small-label line with them. */}
        {queueLabel !== undefined && (
          <Text testID="elite-queue-position" style={styles.queuePosition}>
            {queueLabel}
          </Text>
        )}

        {progressFraction !== undefined && (
          <View style={styles.progressTrack} testID="elite-queue-progress">
            <View style={[styles.progressFill, { width: `${Math.round(progressFraction * 100)}%` }]} />
          </View>
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
  // The second pill beside "Elite" — a light, calm tint rather than the
  // saturated amber `wait` token: this card states a fact ("you are in
  // queue"), it does not warn.
  queueChip: {
    paddingHorizontal: space.sm,
    paddingVertical: space.xs / 2,
    borderRadius: radius.pill,
    backgroundColor: color.subscriptionTint,
  },
  queueChipText: {
    fontFamily: type.smallLabel.fontFamily,
    fontSize: type.smallLabel.size,
    lineHeight: type.smallLabel.lineHeight,
    color: color.navy,
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
  // One size up from the surrounding metadata — the queue position is the
  // whole point of this card, per the file header.
  queuePosition: {
    fontFamily: type.sectionHeader.fontFamily,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: color.textPrimary,
  },
  progressTrack: {
    height: space.xs,
    marginTop: space.xs / 2,
    borderRadius: radius.pill,
    backgroundColor: color.border,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: color.wait,
  },
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
