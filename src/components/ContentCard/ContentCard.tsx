// src/components/ContentCard/ContentCard.tsx
// One publication as a row: thumbnail, title, publisher, access badge, chevron.
// This is the card used in the listing beneath the subject chips.
//
// NO VARIANTS. A `tile` shape for a publications carousel was built and then
// removed: nothing renders it, and CONVENTIONS §10 forbids a variant without a
// caller. Adding one back later is the normal path (§7) — do it alongside the
// screen that needs it, not in advance.
//
// IT NEVER DECIDES WHAT ACCESS THE USER HAS. `badge` is a slot the screen fills
// with already-resolved UI (Akriti's AccessTierBadge). Design Spec §5.1 — "the UI
// must never calculate access rights" — and CONVENTIONS §3 both forbid this card
// reading `acquisition.actionId` or `accessTier` to choose a label itself. That is
// also why this file imports nothing from `@model`: it takes strings, not a
// Publication, so it cannot reach for a field it should not interpret.
//
// It sets no outer width, margin or position (CONVENTIONS §8) — the list that
// lays the rows out owns that.
import type { ReactNode } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { color, elevation, radius, space, type } from '@theme/tokens';

// `error` and `offline` are deliberately absent. A single row cannot be offline
// on its own — the feed either arrived or it did not, so those belong to the
// screen that owns the request (CONVENTIONS §6).
export type ContentCardState = 'idle' | 'loading';

export interface ContentCardProps {
  title: string;
  // The grey line under the title — the journal or press name. Optional because
  // a publication may ship without one, and an empty grey line reads as a bug.
  publisher?: string;
  // Cover art. Absent renders a placeholder rather than failing: no fixture
  // publication carries a `thumbnailUrl`, so this is the common path today.
  imageUrl?: string;
  // The book's own file type, already derived — 'PDF', 'EPUB' or 'AUDIO'. A
  // plain string, not a ContentFormat, for the same reason `badge` is a node:
  // this file imports nothing from @model, so it cannot reach past what it is
  // handed. Optional because a `subscribe` title has no file to name.
  format?: string;
  // Already-resolved access UI. Never derived here — see the file header.
  badge?: ReactNode;
  state?: ContentCardState;
  // Absent means the row is not a navigation target, so it is not announced as a
  // button and no chevron is drawn.
  onPress?: () => void;
}

export default function ContentCard({
  title,
  publisher,
  imageUrl,
  format,
  badge,
  state = 'idle',
  onPress,
}: ContentCardProps) {
  const loading = state === 'loading';
  // A skeleton must not navigate: it stands in for a publication whose identity
  // the card does not know yet.
  const pressable = onPress !== undefined && !loading;

  return (
    <Pressable
      testID="content-card"
      style={styles.card}
      onPress={pressable ? onPress : undefined}
      // `disabled`, not just a missing onPress. Clearing the handler alone leaves
      // Pressable's responder system live, so the row still reacts to touches
      // (and a test firing a press still reaches the handler). Disabling it stops
      // the responder outright, which is what a skeleton needs.
      disabled={!pressable}
      // Only a row that actually goes somewhere claims to be a button.
      accessibilityRole={pressable ? 'button' : undefined}
      accessibilityLabel={pressable ? title : undefined}
    >
      {loading ? (
        <View testID="content-card-skeleton" style={styles.row}>
          <View style={styles.thumb} />
          <View style={styles.text}>
            <View style={[styles.bar, styles.barTitle]} />
            <View style={[styles.bar, styles.barMeta]} />
          </View>
        </View>
      ) : (
        <>
          {imageUrl === undefined ? (
            // A grey well, sized exactly like the image it replaces, so a list of
            // mixed cover availability stays on one baseline.
            <View testID="content-card-placeholder" style={styles.thumb} />
          ) : (
            <Image
              testID="content-card-image"
              source={{ uri: imageUrl }}
              style={styles.thumb}
              // `contain` would letterbox a portrait cover inside a square thumb.
              resizeMode="cover"
            />
          )}

          <View style={styles.text}>
            <Text testID="content-card-title" style={styles.title} numberOfLines={2}>
              {title}
            </Text>
            {publisher !== undefined && (
              <Text testID="content-card-publisher" style={styles.publisher} numberOfLines={1}>
                {publisher}
              </Text>
            )}
            {format !== undefined && (
              <Text testID="content-card-format" style={styles.format} numberOfLines={1}>
                {format}
              </Text>
            )}
            {badge !== undefined && (
              <View testID="content-card-badge" style={styles.badge}>
                {badge}
              </View>
            )}
          </View>

          {pressable && <View testID="content-card-chevron" style={styles.chevron} />}
        </>
      )}
    </Pressable>
  );
}

// The thumbnail's edge and the chevron's box. Both are sizes rather than spacing,
// but they are composed from the spacing scale so no bare number reaches the
// stylesheet (CONVENTIONS §5).
const THUMB = space.xl * 2;
const CHEVRON = space.sm;

const styles = StyleSheet.create({
  // One horizontal band: thumb, text, chevron.
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.xs,
    backgroundColor: color.white,
    borderRadius: radius.card,
    // A hairline keeps adjacent rows separable on a white screen where the
    // shadow alone is too subtle to read.
    borderWidth: 1,
    borderColor: color.border,
    // Cropped so a cover cannot square off the card's rounded corners.
    overflow: 'hidden',
    ...(Platform.OS === 'ios' ? elevation.card.ios : elevation.card.android),
  },
  // The skeleton reuses the card's own layout so nothing shifts when data lands.
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  thumb: {
    width: THUMB,
    minHeight: THUMB,
    // Stretches to match whatever height the text column ends up at, so the
    // cover fills the row's full height instead of leaving a gap around a
    // fixed-size square when the text stack is taller than THUMB.
    alignSelf: 'stretch',
    borderRadius: radius.card,
    backgroundColor: color.border,
  },
  text: {
    // Takes the space left over beside the thumbnail, so a long title wraps
    // instead of pushing the chevron off the card.
    flex: 1,
    gap: space.xs,
  },
  title: {
    fontWeight: type.body.weight,
    fontFamily: type.body.fontFamily,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: color.textPrimary,
  },
  publisher: {
    fontWeight: type.meta.weight,
    fontFamily: type.meta.fontFamily,
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
    color: color.textSecondary,
  },
  // Its own line under the publisher rather than joined onto it, so neither has
  // to know whether the other is present.
  format: {
    fontWeight: type.meta.weight,
    fontFamily: type.meta.fontFamily,
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
    color: color.textSecondary,
  },
  badge: {
    // Shrinks to its content instead of stretching across the row.
    alignSelf: 'flex-start',
    marginBottom: space.xs,
  },
  // Two borders on a rotated square: a chevron without an icon font, since none
  // is installed.
  chevron: {
    width: CHEVRON,
    height: CHEVRON,
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderColor: color.textSecondary,
    transform: [{ rotate: '45deg' }],
    marginRight: space.sm,
  },
  bar: {
    backgroundColor: color.border,
    borderRadius: radius.card,
  },
  // Each bar stands at the height of the line of text it replaces.
  barTitle: { height: type.body.lineHeight, width: '100%' },
  barMeta: { height: type.meta.lineHeight, width: '60%' },
});
