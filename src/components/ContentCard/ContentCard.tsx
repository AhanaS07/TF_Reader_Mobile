// src/components/ContentCard/ContentCard.tsx
// One publication as a row: thumbnail, a meta row (publisher, format, access
// badge), title, author line. This is the card used in the listing beneath
// the subject chips.
//
// TWO VARIANTS: `row` (default) and `cover`. A `tile` shape for a publications
// carousel was built once, then removed because nothing rendered it
// (CONVENTIONS §10 forbids a variant without a caller). CatalogueScreen's
// first-shelf carousel is now that caller, so `cover` follows §7's normal
// path: added back alongside the screen that needs it, not in advance. `cover`
// drops the chevron and action slot to stay compact as a carousel tile —
// everything else (skeleton, placeholder well, meta row, author line) works
// the same as `row`.
//
// IT NEVER DECIDES WHAT ACCESS THE USER HAS. `badge` is a slot the screen fills
// with already-resolved UI (Akriti's AccessTierBadge). Design Spec §5.1 — "the UI
// must never calculate access rights" — and CONVENTIONS §3 both forbid this card
// reading `acquisition.actionId` or `accessTier` to choose a label itself. That is
// also why this file imports nothing from `@model`: it takes strings, not a
// Publication, so it cannot reach for a field it should not interpret. `authors`
// is a plain, pre-joined string for the same reason — the screen turns
// `publication.authors` into one line, this file never sees the array.
//
// It sets no outer width, margin or position (CONVENTIONS §8) — the list that
// lays the rows out owns that.
import { useState, type ReactNode } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { color, elevation, radius, space, type } from '@theme/tokens';

// `error` and `offline` are deliberately absent. A single row cannot be offline
// on its own — the feed either arrived or it did not, so those belong to the
// screen that owns the request (CONVENTIONS §6).
export type ContentCardState = 'idle' | 'loading';

// `row` is the listing shape below the subject chips. `cover` is a carousel
// tile: image-forward, no action slot, no chevron. See the file header.
export type ContentCardVariant = 'row' | 'cover';

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
  // Credit line, pre-joined by the screen ('Joshua C. Gellers' or 'A. One,
  // B. Two'). Optional: `Publication.authors` is a real array that is
  // sometimes empty, and an empty grey line where a name should be reads as a
  // bug the same way a blank `publisher` line would.
  authors?: string;
  // A short line of real metadata ("312 pp.") shown beside `action` at the
  // foot of a row — never a fabricated field like an edition number, which
  // is why this takes a plain, already-formatted string rather than a page
  // count this file would have to word itself. Row variant only.
  meta?: string;
  // Already-resolved access UI. Never derived here — see the file header.
  badge?: ReactNode;
  /**
   * The row's access ACTION, already resolved — D12's Elite queue button.
   *
   * A SLOT, FOR THE SAME REASON `badge` IS ONE. This card must not decide that
   * an Elite title with nothing held earns a "Grant access" button; that is
   * `resolveAccess`'s answer and the screen's to render (Design Spec §5.1,
   * CONVENTIONS §3). Handing it a node keeps this file unable to reach for
   * `acquisition.actionId` even by accident — the same reason it imports nothing
   * from `@model`.
   *
   * WHY IT DOES NOT BREAK THE CARD'S OWN TAP. It renders inside the card's
   * Pressable, and a nested Pressable claims the touch itself, so the button
   * fires without also navigating. Both stay reachable to assistive tech —
   * verified, because a default-accessible Pressable CAN collapse its children
   * into one element (see the note in SignInScreen) and that would have hidden
   * this button. It does not here. Row variant only — see the file header.
   */
  action?: ReactNode;
  state?: ContentCardState;
  variant?: ContentCardVariant;
  // Absent means the row is not a navigation target, so it is not announced as a
  // button and no chevron is drawn.
  onPress?: () => void;
}

// The meta row: publisher, format chip, access badge, whichever are present.
// A function rather than a component folder of its own — it has no
// independent identity outside this file, the same reasoning CONVENTIONS §1
// gives for a part used by only one caller.
//
// `spread` is the cover tile's own shape: publisher on the left, badge
// pinned to the right (`justifyContent: 'space-between'`), with the format
// chip omitted here entirely — a narrow carousel tile has room for two of
// these three (see `coverFormatBadge`, which draws it over the cover image
// instead). The row variant has a full text column to work with, so it
// keeps all three side by side, left-aligned, no spread.
function MetaRow({
  publisher,
  format,
  badge,
  spread = false,
}: {
  publisher?: string;
  format?: string;
  badge?: ReactNode;
  spread?: boolean;
}) {
  return (
    <View style={[styles.metaRow, spread && styles.metaRowSpread]}>
      {publisher !== undefined && (
        <Text
          testID="content-card-publisher"
          style={styles.publisher}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {publisher}
        </Text>
      )}
      {format !== undefined && (
        <View style={styles.formatChip}>
          {/* The testID sits on the Text, not this wrapper — every other
              field on this card (title, publisher, authors) puts its testID
              on the text node so `.props.children` is the plain string a test
              can compare directly, not a React element whose own accidental
              inequality prints a diff big enough to exhaust the heap. */}
          <Text testID="content-card-format" style={styles.formatChipText}>
            {format}
          </Text>
        </View>
      )}
      {badge !== undefined && <View testID="content-card-badge">{badge}</View>}
    </View>
  );
}

export default function ContentCard({
  title,
  publisher,
  imageUrl,
  format,
  authors,
  meta,
  badge,
  action,
  state = 'idle',
  variant = 'row',
  onPress,
}: ContentCardProps) {
  const loading = state === 'loading';
  // A skeleton must not navigate: it stands in for a publication whose identity
  // the card does not know yet.
  const pressable = onPress !== undefined && !loading;
  const cover = variant === 'cover';

  // A load failure and "no cover on file" used to render identically — the
  // same grey well, no way to tell a broken fetch from a title that genuinely
  // has no artwork. One flag, held per mounted instance — every caller keys
  // a row by `publication.id`, so a different publication is a different
  // instance and starts with a clean flag rather than inheriting this one.
  const [imageFailed, setImageFailed] = useState(false);
  const showPlaceholder = imageUrl === undefined || imageFailed;

  let content: ReactNode;

  if (loading) {
    content = cover ? (
      // Mirrors the same three fixed-height slots the loaded state below
      // reserves, so nothing changes size when the real card lands.
      <View testID="content-card-skeleton" style={styles.coverSkeleton}>
        <View style={styles.coverThumb} />
        <View style={styles.metaRowSlot}>
          <View style={[styles.bar, styles.barBadge]} />
        </View>
        <View style={styles.titleSlot}>
          <View style={[styles.bar, styles.barTitle]} />
        </View>
        <View style={styles.authorSlot}>
          <View style={[styles.bar, styles.barMeta]} />
        </View>
      </View>
    ) : (
      <View testID="content-card-skeleton" style={styles.row}>
        <View style={styles.thumb} />
        <View style={styles.text}>
          <View style={[styles.bar, styles.barMeta]} />
          <View style={[styles.bar, styles.barTitle]} />
        </View>
      </View>
    );
  } else if (cover) {
    // No action slot, no chevron — a carousel tile stays compact, and Elite's
    // queue button belongs on the detail screen only (same reason the row
    // variant never draws it on this shelf either).
    //
    // EVERY SLOT BELOW IS FIXED-HEIGHT, ALWAYS RENDERED, WHETHER OR NOT IT HAS
    // CONTENT. Side-by-side carousel tiles make an intrinsic height look like a
    // bug rather than a list's normal variation: a title that wraps to one
    // line instead of two, or a publisher/badge/author a sibling tile happens
    // to lack, would otherwise make that one tile visibly shorter than its
    // neighbours. Reserving the space regardless is what row-variant, stacked
    // vertically one at a time, never needed.
    content = (
      <>
        <View style={styles.coverImageWrap}>
          {showPlaceholder ? (
            <View
              testID="content-card-placeholder"
              style={[styles.coverThumb, styles.placeholderCenter]}
            >
              <Ionicons name="image-outline" size={ICON_SIZE} color={color.textSecondary} />
            </View>
          ) : (
            <Image
              testID="content-card-image"
              source={{ uri: imageUrl }}
              style={styles.coverThumb}
              resizeMode="cover"
              onError={() => setImageFailed(true)}
            />
          )}
          {/* Drawn over the cover art rather than in the meta row below —
              the row only has room for publisher and badge (see MetaRow's
              `spread`); the format chip moves here instead of competing with
              them for the same narrow width. */}
          {format !== undefined && (
            <View style={styles.coverFormatBadge}>
              <Text testID="content-card-format" style={styles.coverFormatBadgeText}>
                {format}
              </Text>
            </View>
          )}
        </View>
        <View testID="content-card-meta-slot" style={styles.metaRowSlot}>
          <MetaRow publisher={publisher} badge={badge} spread />
        </View>
        <View testID="content-card-title-slot" style={styles.titleSlot}>
          <Text testID="content-card-title" style={styles.title} numberOfLines={2}>
            {title}
          </Text>
        </View>
        <View testID="content-card-author-slot" style={styles.authorSlot}>
          {authors !== undefined && (
            <Text testID="content-card-authors" style={styles.authorLine} numberOfLines={1}>
              {authors}
            </Text>
          )}
        </View>
      </>
    );
  } else {
    content = (
      <>
        <View style={styles.thumbWrap}>
          {showPlaceholder ? (
            // A grey well, sized exactly like the image it replaces, so a list of
            // mixed cover availability stays on one baseline. The icon marks this
            // as a deliberate stand-in rather than a stalled load — see the
            // `imageFailed` note above for why "missing" and "failed" share it.
            <View
              testID="content-card-placeholder"
              style={[styles.thumb, styles.placeholderCenter]}
            >
              <Ionicons name="image-outline" size={ICON_SIZE} color={color.textSecondary} />
            </View>
          ) : (
            <Image
              testID="content-card-image"
              source={{ uri: imageUrl }}
              style={styles.thumb}
              // `contain` would letterbox a portrait cover inside a square thumb.
              resizeMode="cover"
              onError={() => setImageFailed(true)}
            />
          )}
          {/* `format` is real, already-derived data (never guessed from the
              tier or the id — see the file header), so this is not the card
              deciding anything: AUDIO already means "no cover art to look
              at", overlay or not, and the overlay only restates what the
              format chip beside it already says in words. */}
          {format === 'AUDIO' && (
            <View testID="content-card-play-overlay" style={styles.playOverlay}>
              <Ionicons name="play" size={type.button.size} color={color.white} />
            </View>
          )}
        </View>

        <View style={styles.text}>
          <MetaRow publisher={publisher} format={format} badge={badge} />
          {/* NOT a fixed-height slot, deliberately — that was tried and
              reverted. Reserving two lines' worth of height for a one-line
              title left dead space inside the box, which pushed the author
              line down by a visibly DIFFERENT amount than a two-line title
              did — an inconsistent GAP, and a more noticeable one than the
              inconsistent absolute position it replaced. The cover variant's
              own fixed slots are right for THAT shape because its tiles sit
              side by side in a horizontal carousel, where mismatched heights
              read as broken alignment between neighbours; these rows are
              stacked vertically, one at a time, the same as any feed or
              list whose items vary with their own content — `text`'s own
              `gap` below already keeps that spacing uniform. */}
          <Text testID="content-card-title" style={styles.title} numberOfLines={2}>
            {title}
          </Text>
          {authors !== undefined && (
            <Text testID="content-card-authors" style={styles.authorLine} numberOfLines={1}>
              {authors}
            </Text>
          )}
          {/* Beneath everything else rather than beside the chevron: the row
              already reads top-to-bottom (meta, title, author), and a 48pt
              button in the horizontal band would squeeze that column on a
              phone. `meta` and `action` share the one line — pinned to
              opposite ends — rather than each getting a row of their own;
              either can appear without the other. */}
          {(meta !== undefined || action !== undefined) && (
            <View style={styles.bottomRow}>
              {meta !== undefined && (
                <Text testID="content-card-meta" style={styles.metaLine} numberOfLines={1}>
                  {meta}
                </Text>
              )}
              {action !== undefined && (
                <View testID="content-card-action" style={styles.action}>
                  {action}
                </View>
              )}
            </View>
          )}
        </View>

        {pressable && <View testID="content-card-chevron" style={styles.chevron} />}
      </>
    );
  }

  const pressableNode = (
    <Pressable
      testID="content-card"
      style={[styles.card, cover && styles.cardCover]}
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
      {content}
    </Pressable>
  );

  // NO SHADOW, ON PURPOSE — a lifted-object shadow was reading as noise
  // between adjacent carousel tiles rather than depth, especially with the
  // gap between tiles as tight as it was. Separation now comes from that gap
  // (CatalogueScreen's own `carousel` style) and the hairline `card` border
  // alone — the same flat, whitespace-defined treatment the row variant
  // already uses, just at the tile's own radius.
  return pressableNode;
}

// The row thumbnail's width — the reference design's own `w-24` (96px) — and
// the chevron's box. Both are sizes rather than spacing, but they are
// composed from the spacing scale so no bare number reaches the stylesheet
// (CONVENTIONS §5).
const THUMB = space.xl * 3;
const CHEVRON = space.sm;

// The placeholder well's fallback glyph — sized against `space` for the same
// CONVENTIONS §5 reason as the two constants above, big enough to read as a
// deliberate icon rather than a stray mark in a much larger well.
const ICON_SIZE = space.xl;

// AccessTierBadge's own rendered height at size="sm": its label line
// (`type.smallLabel.lineHeight`) plus its vertical padding (`space.xs`, top
// and bottom). Shared by the meta-row slot and its skeleton bar so both track
// the same source instead of two guessed constants.
const BADGE_HEIGHT = type.smallLabel.lineHeight + space.xs * 2;

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
  // Overrides `card`'s row axis for a carousel tile. Width is not set here —
  // the horizontal ScrollView that lays tiles out owns that (CONVENTIONS §8),
  // same as CategoryCard's strip owns its cards' width. `radius.tile` (12px)
  // matches the reference design's own tile corner exactly. No `gap` here —
  // the reference design's tile uses two different gaps (a bigger one under
  // the image, a tighter one between the meta row/title/author), so each is
  // its own margin below (`coverImageWrap`, `metaRowSlot`, `titleSlot`)
  // instead of one uniform value.
  cardCover: {
    flexDirection: 'column',
    alignItems: 'stretch',
    // Tighter than `card`'s own implicit `space.sm` reasoning would suggest —
    // this tile packs a cover, a meta row, a title and an author line into a
    // fixed width, and every side of padding is height the shelf spends on
    // whitespace rather than on being able to show a shorter, wider card.
    padding: space.xs,
    borderRadius: radius.tile,
    // Cancels `card`'s own `elevation.card` shadow rather than leaving it to
    // apply by default — see the component's return statement for why a
    // carousel tile stays flat. Zero, not omitted: RN shadow/elevation props
    // merge onto whatever `card` already set, they don't reset by absence.
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
  // The skeleton reuses the card's own layout so nothing shifts when data lands.
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  // A book's own 2:3 ratio, not a square — matched against the reference
  // design's row card rather than stretched to fill whatever height the
  // text column happens to need. Top-aligned (`alignSelf: 'flex-start'`,
  // not `'stretch'`): a fixed-aspect cover that stretched taller than its
  // own ratio would distort.
  thumb: {
    width: THUMB,
    aspectRatio: 2 / 3,
    alignSelf: 'flex-start',
    borderRadius: radius.card,
    backgroundColor: color.border,
  },
  // Centres the fallback icon inside whichever well it is combined with
  // (`thumb` or `coverThumb`) — a layout addition only, so it composes with
  // either one's own size/ratio/radius rather than duplicating them.
  placeholderCenter: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Gives the play-icon overlay something to measure "centred over the
  // thumbnail" against — same device as `coverImageWrap` a few styles down.
  thumbWrap: {
    position: 'relative',
    alignSelf: 'flex-start',
  },
  // Centred over the thumb rather than the whole row: it marks the ARTWORK
  // as playable, the same thing the format chip already says in words, so it
  // does not need its own tap target or accessibility role.
  playOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 34, 68, 0.4)', // Indigo (color.navy) at 40% — see coverFormatBadge's own note on why this is a raw rgba.
    borderRadius: radius.card,
  },
  // Groups the cover image with the format badge drawn over it — a plain
  // View, not `overflow: 'hidden'`, so the format badge's own corner isn't
  // clipped by the image's rounded one; `coverThumb`'s own radius already
  // keeps the IMAGE inside its rounded corner, this wrapper just gives the
  // absolutely-positioned badge something to measure "bottom-right" against.
  // No `marginBottom` — the meta row directly below is this tile's caption,
  // not a separate block, and any gap here was whitespace the "too tall"
  // complaint was actually about, not a highlight.
  coverImageWrap: {
    position: 'relative',
  },
  // The cover tile's own image well: full tile width, the row thumb's own
  // true book ratio (`2/3`) — a shorter `4/5` crop was tried here for a
  // denser card, but once real cover art was actually loading (rather than
  // the grey placeholder that had masked this) it visibly clipped real
  // covers' own top/bottom content (a publisher logo, an edition line).
  // `resizeMode="cover"` fills the box either way; this is the ratio that
  // does it with nothing cropped off a real jacket. `aspectRatio` is a
  // layout primitive, not a token value (CONVENTIONS §5's stated exceptions).
  coverThumb: {
    width: '100%',
    aspectRatio: 2 / 3,
    borderRadius: radius.card,
    backgroundColor: color.border,
  },
  // Mirrors the reference design's format tag on the book cover itself
  // rather than in the text meta row below it — see MetaRow's `spread` note.
  // A dark translucent fill over the image needs an actual alpha channel,
  // which no flat token carries, so this is a deliberate raw rgba rather than
  // a missing token (CONVENTIONS §5 governs `src/components/`'s tokens for
  // colour VALUES; there is no `color.*` entry this could be instead).
  coverFormatBadge: {
    position: 'absolute',
    right: space.xs,
    // Straddles the image's bottom edge (a negative offset, not `space.xs`
    // inset) — matches the reference design's tag sitting half on the cover,
    // half below it, rather than fully inside the image bounds.
    bottom: -space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderRadius: radius.card,
    backgroundColor: 'rgba(0, 34, 68, 0.72)', // Indigo (color.navy) at 72% — see above.
  },
  coverFormatBadgeText: {
    fontFamily: type.cardLabel.fontFamily,
    fontSize: type.cardLabel.size,
    lineHeight: type.cardLabel.lineHeight,
    color: color.white,
  },
  // The cover skeleton's own wrapper, since `cardCover` is applied to the
  // Pressable and this needs its own testID to assert against.
  coverSkeleton: {
    flex: 1,
    gap: space.xs,
  },
  text: {
    // Takes the space left over beside the thumbnail, so a long title wraps
    // instead of pushing the chevron off the card.
    flex: 1,
    gap: space.xs,
  },
  // Publisher, format chip and access badge on one line — the row variant's
  // shape, where the text column is wide enough for all three left-aligned.
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  // The cover tile's shape: publisher and badge pinned to opposite ends of a
  // narrower row (no format chip here — see MetaRow's own header note).
  // `metaRowSlot`'s fixed height plus `publisher`'s own `flexShrink` is what
  // keeps a long publisher name from pushing the badge instead of truncating
  // against it.
  metaRowSpread: {
    justifyContent: 'space-between',
  },
  // A little more air above the action than the `xs` the text stack uses, so the
  // button reads as a separate affordance rather than a fourth line of metadata.
  // No margin of its own — it now sits inside `bottomRow`, which already
  // supplies the gap above this whole line.
  action: {},
  // `meta` and `action` share this row, pinned to opposite ends — see the
  // header comment where it's used.
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    marginTop: space.xs,
  },
  metaLine: {
    flexShrink: 1,
    fontFamily: type.cardMeta.fontFamily,
    fontSize: type.cardMeta.size,
    lineHeight: type.cardMeta.lineHeight,
    color: color.textSecondary,
  },
  // Aleo (serif) in both variants — a book's own title, not a UI label, so it
  // reads as printed rather than borrowed from the app's chrome font.
  // `letterSpacing` is a typographic value with no token group of its own,
  // same exception `formatChipText` used to take — negative, not the default
  // 0: Aleo Bold's own tracking reads as loose at this size, and a title this
  // visually important is where that shows most.
  title: {
    fontFamily: type.cardTitle.fontFamily,
    fontSize: type.cardTitle.size,
    lineHeight: type.cardTitle.lineHeight,
    letterSpacing: -0.3,
    color: color.textPrimary,
  },
  // Open Sans Light (`cardMeta`, the same size the author line uses),
  // sentence case — whatever case the feed sent it in. The brand guide's
  // typography page lists all-caps as something to explicitly avoid
  // ("especially for paragraphs or text"), so this is deliberately NOT the
  // bold, letter-spaced, forced-uppercase chip treatment an earlier pass
  // gave it. `flexShrink` only matters in `metaRowSpread` (`justifyContent`
  // there has nothing to compress against otherwise) — harmless in the
  // plain `metaRow` case, which never runs short of width.
  publisher: {
    flexShrink: 1,
    fontFamily: type.cardMeta.fontFamily,
    fontSize: type.cardMeta.size,
    lineHeight: type.cardMeta.lineHeight,
    color: color.textSecondary,
  },
  // The credit line under the title — same visual weight as `publisher`, its
  // own style only so the two can diverge later without one caller guessing
  // which name a shared style was really for.
  authorLine: {
    fontFamily: type.cardMeta.fontFamily,
    fontSize: type.cardMeta.size,
    lineHeight: type.cardMeta.lineHeight,
    color: color.textSecondary,
  },
  // A small, muted rect rather than a coloured pill — the format is a file
  // type, not a status, and `AccessTierBadge` already owns the pill shape for
  // things that ARE a status (open access, subscription, elite). Does not
  // shrink in the meta row, so a long badge label pushes it rather than
  // squeezing the format text into ellipsis.
  formatChip: {
    flexShrink: 0,
    paddingHorizontal: space.xs,
    paddingVertical: space.xs,
    backgroundColor: color.border,
    borderRadius: radius.card,
  },
  // Open Sans — see `cardLabel`'s own note in tokens.ts for why a format
  // tag is chrome, not editorial content, and stays off Aleo.
  formatChipText: {
    fontFamily: type.cardLabel.fontFamily,
    fontSize: type.cardLabel.size,
    lineHeight: type.cardLabel.lineHeight,
    color: color.textSecondary,
  },
  // Fixed-height slots for the cover tile — see the header comment where
  // they're used. `titleSlot` reserves two full lines regardless of how many
  // the actual title needs; the other two reserve one line's (or the meta
  // row's tallest child's) worth of space whether or not their content is
  // present. `metaRowSlot` additionally clips: it is the one slot whose
  // content is a ROW that could in principle run wider than the tile
  // (`metaRow`'s own header comment), and a clipped edge reads as intentional
  // where an overlapping second line over the title does not.
  metaRowSlot: {
    height: BADGE_HEIGHT,
    overflow: 'hidden',
    // No gap before the title — the badge/format row and the title read as
    // one caption block; the real air on this tile belongs to the image
    // above, not between these two lines.
  },
  titleSlot: {
    height: type.cardTitle.lineHeight * 2,
  },
  authorSlot: {
    height: type.cardMeta.lineHeight,
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
  barTitle: { height: type.cardTitle.lineHeight, width: '100%' },
  barMeta: { height: type.cardMeta.lineHeight, width: '60%' },
  // The cover skeleton's stand-in for the meta row — same height
  // `metaRowSlot` reserves for the real one, narrower than a text bar since
  // it stands for a badge pill rather than a line of copy.
  barBadge: { height: BADGE_HEIGHT, width: space.xl * 2 },
});
