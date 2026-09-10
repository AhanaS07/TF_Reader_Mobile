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
// USES ActionButton FOR READ, the same component ContentCard's own action
// slot and ItemDetailScreen's ActionBar already draw it with — CONVENTIONS
// §7 again: one label/icon for `read` everywhere it appears.
import { Image, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { AccessTierBadge } from '@components/AccessTierBadge';
import { ActionButton } from '@components/ActionButton';
import { color, radius, space, type } from '@theme/tokens';

export interface EliteActiveAccessCardProps {
  title: string;
  imageUrl?: string;
  /** Already-derived ('PDF', 'EPUB', 'AUDIO') — never guessed here. */
  format?: string;
  /** Already-formatted ("Due in 3 days", "Due now"). Absent renders no line. */
  expiresLabel?: string;
  onRead: () => void;
}

const THUMB = space.xl * 3;
const ICON_SIZE = space.xl;

export default function EliteActiveAccessCard({
  title,
  imageUrl,
  format,
  expiresLabel,
  onRead,
}: EliteActiveAccessCardProps) {
  return (
    <View testID="elite-active-access-card" style={styles.card}>
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
        <View style={styles.tag}>
          <Text style={styles.tagLabel}>Elite access</Text>
        </View>

        <Text testID="elite-active-access-title" style={styles.title} numberOfLines={2}>
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

        {expiresLabel !== undefined && (
          <Text testID="elite-active-access-expiry" style={styles.expiry}>
            Access expires: {expiresLabel}
          </Text>
        )}

        <View style={styles.actionSlot}>
          <ActionButton action="read" onPress={onRead} />
        </View>
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
    backgroundColor: color.elite,
  },
  tagLabel: {
    fontFamily: type.cardLabel.fontFamily,
    fontSize: type.cardLabel.size,
    lineHeight: type.cardLabel.lineHeight,
    color: color.white,
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
  expiry: {
    fontFamily: type.smallLabel.fontFamily,
    fontSize: type.smallLabel.size,
    lineHeight: type.smallLabel.lineHeight,
    color: color.textSecondary,
  },
  actionSlot: {
    marginTop: space.xs,
    alignSelf: 'flex-start',
  },
});
