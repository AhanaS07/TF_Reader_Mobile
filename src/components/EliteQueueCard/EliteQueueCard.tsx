// src/components/EliteQueueCard/EliteQueueCard.tsx
// An Elite title the reader is waiting for — a real place in a real queue,
// and nothing to do yet. Product spec (Sept 2026), Library redesign, Premium
// §"STATE 3 — WAITING QUEUE": "The user is WAITING, not currently allowed to
// read." Shared by `All` and `Premium`, same reason as its two sibling cards.
//
// REASSURANCE, NOT ACTION — no button, no chevron, not tappable. Mirrors the
// original Library shelf's own `WaitingRow`: cancelling a hold is a real
// action a reader may want, but it is not on this screen's spec, so this
// card does not invent one.
//
// `queueLabel` AND `progressFraction` ARE ALREADY-DERIVED. Both come from
// `LibraryScreen.holdings.ts` (`queueLabel`, `queueProgressFraction`), which
// already read `Hold.position`/`Hold.queueLength` and refuse to draw a bar
// with no denominator — this file adds no arithmetic and no fallback number.
import { Image, StyleSheet, Text, View } from 'react-native';
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
}

const THUMB = space.xl * 3;
const ICON_SIZE = space.xl;

export default function EliteQueueCard({
  title,
  imageUrl,
  format,
  queueLabel,
  progressFraction,
}: EliteQueueCardProps) {
  return (
    <View testID="elite-queue-card" style={styles.card}>
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
        <View style={styles.tag}>
          <Text style={styles.tagLabel}>Waiting for access</Text>
        </View>

        <Text testID="elite-queue-title" style={styles.title} numberOfLines={2}>
          {title}
        </Text>

        <View style={styles.metaRow}>
          <AccessTierBadge tier="ELITE" />
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
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: space.md,
    backgroundColor: color.white,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.border,
    padding: space.sm,
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
    gap: space.xs,
  },
  tag: {
    alignSelf: 'flex-start',
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    backgroundColor: color.wait,
  },
  tagLabel: {
    fontFamily: type.cardLabel.fontFamily,
    fontSize: type.cardLabel.size,
    lineHeight: type.cardLabel.lineHeight,
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
    paddingVertical: space.xs,
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
    marginTop: space.xs,
    borderRadius: radius.pill,
    backgroundColor: color.border,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: color.wait,
  },
});
