// Screen 05 (book) and Screen 04 (article) — one screen, two presentations,
// both built on the shared `ItemDetail` model. Reused by both CatalogueStack
// and SearchStack, which is why the route type below stays the minimal shape
// both stacks agree on rather than either stack's own NativeStackScreenProps.
//
// WORK TYPE IS HARDCODED, NOT DERIVED. Nothing in the feed says whether a title
// is a book or an article yet: wokay's published `@type` enum only confirms
// Book and Audiobook, so there is no article/journal value to read. The fetch
// below always builds a book (`BOOK_WORK_TYPE`) because that is the only work
// type any real fixture or endpoint can currently produce — passing 'article'
// from there would be inventing data, not reading it.
//
// THE ARTICLE PRESENTATION EXISTS AND IS UNREACHABLE FROM TODAY'S FETCH, AND
// THAT IS FINE. Same shape as `resolveAccess`'s "no acquisition link" branch:
// kept and tested directly rather than treated as a claim about code that does
// not exist. `renderArticleContent` below is exported so a test can hand it a
// hand-built `ItemDetail` with `workType: 'article'` — see
// ItemDetailScreen.test.tsx. The moment `@type` grows a real value, the only
// line that changes is the one call to `buildItemDetail` in `fetchItem`.
//
// ACCESS IS RESOLVED REACTIVELY, NOT ONCE AT FETCH TIME. The publication is stored
// separately and detail is recomputed whenever loans/holds change (after a borrow,
// return, hold, or accept). This is what makes the action bar update immediately
// after a tap without re-fetching from wokay — the catalogue data is stable, only
// the licence state changes.
//
// THREE STATES, KEPT VISIBLY DISTINCT, plus an offline overlay that is
// independent of them. Same shape as InstitutionDetailScreen: a skeleton while
// the fetch is in flight, ErrorState on rejection, the content once resolved. No
// ActivityIndicator — skeletons replace spinners.
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { ContentFormat } from '@/shared/types/primitives';
import { handToggledSession } from '@access/handToggledSession';
import { isNotEntitled, resolveAccess } from '@access/resolveAccess';
import { ActionBar } from '@components/ActionBar';
import { AccessTierBadge } from '@components/AccessTierBadge';
import { ErrorState } from '@components/ErrorState';
import { OfflineBanner } from '@components/OfflineBanner';
import { Skeleton } from '@components/Skeleton';
import { SectionHeader } from '@components/SectionHeader';
import { getCatalogueSource } from '@config/catalogue';
import { getLicenceSource } from '@config/licence';
import { borrowOrPlaceHold, queuePositionLabel } from '@/licence/queueRequest';
import { useNetworkStatus } from '@hooks/useNetworkStatus';
import { buildItemDetail, type ItemDetail } from '@model/detail';
import { type CatalogueError, isCatalogueFailure } from '@model/errors';
import { CATALOGUE_ERROR_COPY, catalogueErrorVariant } from '@model/errorCopy';
import type { ActionId, Publication, WorkType } from '@model/types';
import { useInstitutionStore } from '@store/institutionStore';
import { useLibraryStore } from '@store/libraryStore';
import { color, elevation, radius, space, type as typeScale } from '@theme/tokens';

interface ItemDetailRouteProps {
  route: { params: { itemId: string } };
  // Hand-typed rather than one stack's generated props, same reason as
  // `route` above — this screen is shared by both stacks, and `navigate` is
  // typed for exactly the one real call it makes: opening the access gate
  // when `resolveAccess` resolves to `requires_signin`.
  navigation: {
    navigate: (
      screen: 'AccessGate',
      params: { itemId: string; title: string; authors: string },
    ) => void;
  };
}

// Explicit and typed, so this line breaks to a compile error rather than a typo
// if 'book' is ever removed from the work-type vocabulary.
export const BOOK_WORK_TYPE: WorkType = 'book';

// Screen 04's work type. Not yet passed to `buildItemDetail` anywhere in this
// file — see the header comment. Declared and exported beside `BOOK_WORK_TYPE`
// so a test can build an article `ItemDetail` from the same constant this file
// would use, rather than a second hand-typed 'article' string that could drift.
export const ARTICLE_WORK_TYPE: WorkType = 'article';

const COVER_WIDTH = space.xl * 3;
const COVER_HEIGHT = space.xl * 4 + space.md;

const GENERIC_MESSAGE = "We couldn't load this title.";

// Screen 05's presentation. Exported for the same reason `renderArticleContent`
// below is — a test can render it directly from a hand-built `ItemDetail`
// without going through the fetch — not because anything outside this file is
// meant to import it.
//
// THE COVER IS CENTRED; NOTHING ELSE IS. The mockup centres the jacket in the
// column and ranges every line beneath it off the left margin — title, edition,
// author, copyright, the price pair, the badge and the metadata list all share
// one edge. The whole column used to be centred, which gave the metadata rows a
// ragged left edge and no relationship to the title above them. Same left-ranged
// rule the article layout follows and the Monday branding pass is applying to
// the empty and error screens.
//
// THE ACTION BAR IS PINNED, NOT SCROLLED — same as the article layout, and for
// the same reason: the mockup fixes Read and Download to the bottom of the
// viewport, and this screen is a full jacket plus a description, so a bar at the
// end of the scroll is a bar the reader has to work for.
export function renderBookContent(
  detail: ItemDetail,
  onAction: (action: ActionId) => void,
  // The action waiting on flambeau, if any. Optional so the existing two-argument
  // callers keep working; `undefined` is the same "nothing in flight" ActionBar
  // already defaults to.
  pending?: ActionId,
): ReactElement {
  return (
    <>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {detail.coverUrl !== undefined && (
          <Image
            source={{ uri: detail.coverUrl }}
            style={styles.cover}
            resizeMode="contain"
            accessibilityLabel={`${detail.title} cover`}
          />
        )}

        <Text style={styles.title}>{detail.title}</Text>

        {detail.subtitle !== undefined && <Text style={styles.subtitle}>{detail.subtitle}</Text>}

        {/* "By" carried in the primary text colour with the names themselves in
          the link colour, which is how the mockup sets this line. Nested rather
          than two siblings so the names wrap under the "By" as one sentence
          instead of forming a second column. Nothing navigates — there is no
          author route — so it takes the mockup's colour and not its behaviour,
          the same note as the article layout's author line. */}
        {detail.authors.length > 0 && (
          <Text style={styles.byLine}>
            By <Text style={styles.byLineNames}>{detail.authors.join(', ')}</Text>
          </Text>
        )}

        {/* The one confirmed format, shown once as a plain strip — the contract
          says every title has exactly one, so there is nothing to switch
          between (index.html: "it becomes a single-format display strip
          rather than a control"). Absent only when normalize.ts could not
          derive one (a `subscribe` rel carries no file), same "leave gaps
          blank" rule as everything else here. */}
        {detail.format !== undefined && <FormatStrip format={detail.format} />}

        {/* The mockup fuses a price pair into the same control as the format
          toggle, but price is a separate, unconfirmed fact — neither contract
          has a price field, and printing a number would misrepresent real
          commerce data rather than merely omit it. Shown, muted, not
          invented, same rule as citation and the type label on screen 04. */}
        <UnavailableTag label="Price unavailable" />

        {/* D8 — `not_entitled` renders nothing at all, badge included. `tier`
            is required on AccessResult, so that state carries an OPEN_ACCESS
            filler; drawing it would label a title the reader cannot open as
            free to read. ActionBar already renders null on the empty action
            set, so the buttons need no gate. */}
        {!isNotEntitled(detail.access) && <AccessTierBadge tier={detail.access.tier} />}

        {/* D12 — the `queued` half: "queued shows a position and nothing
            tappable". `resolveAccess` returns no actions in that state, so
            ActionBar draws nothing and this line is the entire UI for it —
            without it a waiting reader sees a detail screen with no answer. */}
        <QueuePositionLine access={detail.access} />

        {/* Publisher, published date, ISBN and page count are each shown only
          when the feed actually supplied them — "render whatever fields are
          present; leave gaps blank rather than blocking" applies here exactly
          as it does in `renderArticleContent` below. The mockup fences this
          list off with a rule above it and gives each row its own glyph, which
          is what turns four bare strings into a spec block.

          PUBLISHER AND DATE SHARE A LINE when both arrived — "Published <date>
          by <publisher>", the mockup's own phrasing. Either one alone still
          gets its own row, because half that sentence is not a sentence. */}
        <View style={styles.metaBlock}>
          <View style={styles.rule} />

          {detail.isbn !== undefined && (
            <MetaRow icon="book-open-variant" text={`ISBN ${detail.isbn}`} />
          )}

          {detail.numberOfPages !== undefined && (
            <MetaRow icon="file-document-outline" text={`${detail.numberOfPages} pages`} />
          )}

          {detail.published !== undefined && detail.publisher !== undefined && (
            <MetaRow
              icon="calendar-blank-outline"
              text={`Published ${detail.published} by ${detail.publisher}`}
            />
          )}
          {detail.published !== undefined && detail.publisher === undefined && (
            <MetaRow icon="calendar-blank-outline" text={`Published ${detail.published}`} />
          )}
          {detail.published === undefined && detail.publisher !== undefined && (
            <MetaRow icon="domain" text={`Publisher ${detail.publisher}`} />
          )}
        </View>

        {detail.description !== undefined && (
          <Text style={styles.description}>{detail.description}</Text>
        )}

        {/* "Table of Contents" — a real mockup row with no data behind it; no
          endpoint returns a chapter list. It takes the mockup's full-width row
          and its list glyph, but NOT its trailing chevron and NOT a Pressable:
          the chevron promises an expand interaction that does not exist, the
          same half-measure the article branch's tab row already avoids for its
          own four dead tabs. */}
        <UnavailableTag label="Table of Contents" variant="row" icon="format-list-bulleted" />
      </ScrollView>

      {/* Outside the ScrollView — see the header comment. ActionBar pads itself
          and draws its own top border, so it needs no wrapper of its own here. */}
      <ActionBar actions={detail.access.actions} onAction={onAction} pending={pending} />
    </>
  );
}

// One metadata row: a muted glyph and the line it belongs to. The icon is
// decorative — the text beside it already says everything, so it is never the
// only thing a screen reader is given, and the row keeps `Text`'s own default
// role rather than claiming to be an image.
function MetaRow({
  icon,
  text,
}: {
  icon: ComponentProps<typeof MaterialCommunityIcons>['name'];
  text: string;
}): ReactElement {
  return (
    <View style={styles.metaRowLine}>
      <MaterialCommunityIcons name={icon} size={typeScale.meta.size} color={color.textSecondary} />
      <Text style={[styles.metaRow, styles.metaRowText]}>{text}</Text>
    </View>
  );
}

// D12's `queued` state on the detail screen. A status line, not a control.
//
// LOCAL TO THIS SCREEN, because this is the ONLY surface the queue appears on.
// Confirmed team decision, 26 Aug: D12 is item detail only, so there is no card
// row wanting the same block and nothing to share it with. A shared component
// for one caller is the speculative one CONVENTIONS §10 rules out.
//
// ABSENT IN EVERY OTHER STATE, including `offered`: the position is a fact about
// waiting, and a reader who has been offered a copy is no longer waiting.
function QueuePositionLine({ access }: { access: ItemDetail['access'] }): ReactElement | null {
  const label = queuePositionLabel(access);
  if (label === undefined) return null;

  return (
    <Text testID="queue-position" style={styles.queuePosition} accessibilityRole="text">
      {label}
    </Text>
  );
}

// The one confirmed format, shown as a plain strip rather than a control —
// index.html: "the contract confirms one format per title, so there is
// nothing to select between... it becomes a single-format display strip
// rather than a control."
//
// NOT `Tabs` OR `FilterChip`. Both exist to switch or toggle between several
// values; there is exactly one value here, so a control built to manage many
// would be answering a question this screen does not have. No `Pressable`,
// no `onPress`, no active/inactive pair — `AccessTierBadge` is the same shape
// one line below every call site: a resolved value that is looked at.
//
// NOT MUTED LIKE `UnavailableTag`. This is real, confirmed data — the
// contract states it plainly — so it reads at full opacity in the primary
// text colour, visually distinct from the "we don't have this yet" tags
// beside it.
function FormatStrip({ format }: { format: ContentFormat }): ReactElement {
  return (
    <View testID="format-strip" style={styles.formatStrip} accessibilityRole="text">
      <Text style={styles.formatStripLabel}>{format}</Text>
    </View>
  );
}

// The five mockup tab labels, verbatim from index.html's "Screen 04 — four
// elements" gap list. Real mockup names, not invented ones — only the CONTENT
// behind four of them is missing. PDF is left inert alongside the rest; see the
// comment on the tab row below for why it is not made the exception.
const ARTICLE_TAB_LABELS = [
  'Full Article',
  'Figures & data',
  'Citations',
  'Metrics',
  'PDF',
] as const;

// A mockup element the current contract has no data for — shown, not hidden,
// and honestly labelled as unavailable. Same principle FilterChip's own
// `disabled` prop already documents for screen 12's rows: "Dropping it would
// make the screen look complete when it is not... a greyed control that
// announces itself as disabled is the honest version."
//
// KEPT LOCAL RATHER THAN PROMOTED TO `src/components/` (CONVENTIONS §7) —
// nothing outside this screen needs it yet. If a second screen does, it earns
// its own folder then.
//
// A PLAIN VIEW, NOT A PRESSABLE. Neither call site below has anything to do on
// a tap — there is no citation to fetch, no more specific type to reveal — so a
// disabled Pressable would promise an interaction that does not exist.
// `AccessTierBadge` sets the same precedent one line above every call site: a
// resolved value that is looked at, not pressed.
//
// THREE SHAPES, ONE MEANING. The two mockups draw their unavailable elements
// differently, so `variant` follows the mockup being built rather than forcing
// one screen into the other's furniture:
//
//   pill   — screen 05's price, a bordered chip among the badges
//   inline — screen 04's eyebrow and citation link: plain muted text
//   row     — screen 05's Table of Contents, a full-width ruled row
//
// All three stay muted, all three keep `accessibilityRole="text"`, and all three
// keep the same testID — the honesty is in the muting and the missing tap, not
// in the border.
function UnavailableTag({
  label,
  accessibilityLabel,
  variant = 'pill',
  icon,
}: {
  label: string;
  /**
   * Overrides what a screen reader announces, for the one call site where the
   * visible text alone would not say enough — the type tag is a real mockup
   * string ("Research article") that this contract cannot confirm, and a
   * sighted reader gets that from the muted styling but a screen reader needs
   * it said explicitly. Defaults to the visible label, unchanged from before
   * this prop existed.
   */
  accessibilityLabel?: string;
  variant?: 'pill' | 'inline' | 'row';
  /**
   * Leading glyph, for the one call site whose mockup draws one — the quote
   * mark against "Download citation". Decorative: the label beside it already
   * carries the meaning, so it is never the only thing announced.
   */
  icon?: ComponentProps<typeof MaterialCommunityIcons>['name'];
}): ReactElement {
  const boxStyle =
    variant === 'inline'
      ? styles.unavailableInline
      : variant === 'row'
        ? styles.unavailableRow
        : styles.unavailableTag;

  // The row variant carries the mockup's own weight for this line — it reads as
  // a section heading there, not as a caption — while the other two stay small.
  const labelStyle =
    variant === 'pill' ? styles.unavailableTagLabel : styles.unavailableInlineLabel;

  return (
    <View
      testID="unavailable-tag"
      style={boxStyle}
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel ?? label}
    >
      {icon !== undefined && (
        <MaterialCommunityIcons
          name={icon}
          size={variant === 'row' ? typeScale.sectionHeader.size : typeScale.smallLabel.size}
          color={color.textSecondary}
        />
      )}
      <Text style={variant === 'row' ? styles.unavailableRowLabel : labelStyle} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

// The five mockup tab labels, laid out as a plain, non-interactive row rather
// than as chips — screen 04's actual mockup draws this as text with a divider
// beneath it, not as pills, so this stays visually apart from `UnavailableTag`
// even though the two exist for the same reason.
//
// NO ACTIVE TAB. The mockup shows "Full Article" active with a teal underline,
// but that is true only when the other four genuinely lead somewhere. None of
// the five does here, so marking one active would claim a working tab strip
// with four broken siblings — the same half-measure the file already avoids by
// not making PDF an exception.
//
// NOT THE SHARED `Tabs` COMPONENT. `Tabs` always renders `accessibilityRole=
// "tablist"`/`"tab"` and a live `onChange`; both tell an assistive-tech user
// these five switch to something, which none of them do. This stays a local,
// inert row instead of the interactive component wearing a disabled coat of
// paint (CONVENTIONS §7 — `Tabs` is not modified to grow a state it does not
// otherwise need).
// ONE LINE THAT SCROLLS, NOT A WRAPPING BLOCK. The mockup draws all five
// labels on a single line under the metadata. At `type.button`'s 15pt they
// wrapped onto two lines on a phone, which read as a paragraph of links rather
// than a tab strip; at `type.smallLabel` they fit, and the horizontal scroll
// covers the narrowest devices and the largest accessibility text sizes without
// the row ever reflowing.
function InertTabRow({ labels }: { labels: readonly string[] }): ReactElement {
  return (
    <View style={styles.tabRow}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabRowLabels}
      >
        {labels.map((label) => (
          <Text key={label} style={styles.tabRowLabel} numberOfLines={1}>
            {label}
          </Text>
        ))}
      </ScrollView>
      <View style={styles.tabRowDivider} />
    </View>
  );
}

// Screen 04's presentation. The board's field list for this screen is
// deliberately smaller than the book's — title, authors, published date, the
// badge, the abstract and the actions — so publisher, ISBN, page count, cover
// and subtitle are not read here even though `ItemDetail` carries them: they
// are book fields the article mockup never asked for.
//
// NO PAGE RANGE. The board lists it as a screen 04 field, but `Publication` has
// no field for it and neither backend contract mentions one, so there is
// nothing to read. Left absent rather than invented — this is one of the four
// screen 04 gaps index.html already tracks under "mockup elements with no data
// behind them"; this file does not re-decide it, just leaves the space out.
//
// DOI IS NOT ONE OF THOSE GAPS. It is a settled removal, not an open question —
// design still need telling, but the field is gone for good, so nothing here
// renders even a blank line for it. Download citation, the five tabs and the
// content-type label ARE the other three gaps, and they render below as
// `UnavailableTag`/`InertTabRow` — visible, muted, not invented — rather than
// left absent.
// LEFT-ALIGNED, NOT CENTRED, AND IN THE MOCKUP'S OWN ORDER. Screen 04 is a
// reading surface: an eyebrow, a title that runs to three lines, an author line,
// a metadata line, then the tab strip and the abstract, all ranged left off a
// single margin. Centring a 24pt title over a left-ranged abstract gives the
// block two competing edges, and it is what the Monday branding pass is
// stripping out of the empty and error screens for the same reason. Screen 05
// keeps its centred column — a cover-led layout has a real axis to centre on;
// this one does not.
//
// THE ACTION BAR IS PINNED, NOT SCROLLED. The mockup fixes Read and Download to
// the bottom of the viewport, and an abstract is long enough that a bar at the
// end of the scroll is a bar the reader never reaches. It sits outside the
// ScrollView, which is why this returns a fragment rather than a single
// ScrollView the way `renderBookContent` still does.
export function renderArticleContent(
  detail: ItemDetail,
  onAction: (action: ActionId) => void,
  /** See renderBookContent. */
  pending?: ActionId,
): ReactElement {
  return (
    <>
      <ScrollView style={styles.articleScroll} contentContainerStyle={styles.articleContent}>
        {/* Title block — the four lines the mockup groups tightly together, on
            xs gaps, so they read as one unit against the md gaps separating the
            sections below. */}
        <View style={styles.articleHeader}>
          {/* The CONTENT type, not to be confused with the access tier badge
              below — the two are unrelated axes. "Research article" is the real
              mockup string (index.html: "Screen 04 — four elements"), kept
              rather than paraphrased — the same "keep the real name, mark it
              disabled" rule screen 12's unsupported filter rows already follow.
              wokay's published `@type` enum only confirms Book and Audiobook
              (see the file header), so it takes the mockup's eyebrow POSITION
              but not its live link colour: muted, and a screen reader is told
              explicitly that the classification is not confirmed. A sighted
              reader gets that from the styling alone; an assistive-tech user
              needs it said. workType is NOT derived from `@type` anywhere here;
              this label is display-only. */}
          <UnavailableTag
            label="Research article"
            accessibilityLabel="Research article — not confirmed by the current contract"
            variant="inline"
          />

          <Text style={styles.articleTitle}>{detail.title}</Text>

          {detail.authors.length > 0 && (
            <Text style={styles.articleAuthors}>{detail.authors.join(', ')}</Text>
          )}

          {/* The mockup pairs a page range with the date on this line. There is
              no page range to pair — see the header comment — so the date holds
              the line alone rather than being padded out with an invented
              second half. */}
          {detail.published !== undefined && (
            <Text style={styles.metaRow}>Published · {detail.published}</Text>
          )}
        </View>

        {/* "Download citation" — a real mockup action with no citation data
            behind it (no endpoint, no format, nothing to build a file from).
            Shown inert rather than removed, same rule as the tabs below, and in
            the mockup's own position: the row under the metadata, quote glyph
            included. The mockup's other half of this row was the DOI link,
            which is a settled removal and leaves no gap behind it. */}
        <UnavailableTag label="Download citation" variant="inline" icon="format-quote-close" />

        {/* None of the five is made an exception, PDF included. A tab's whole
            point is switching to what it names, and there is nothing behind the
            other four to switch to — one live tab among four dead ones would
            still be the half-measure this file is avoiding, and PDF's own file
            is already Read/Download on the action bar below, not a second
            entry point worth building. */}
        <InertTabRow labels={ARTICLE_TAB_LABELS} />

        {/* D8 — `not_entitled` renders nothing at all, badge included. `tier`
            is required on AccessResult, so that state carries an OPEN_ACCESS
            filler; drawing it would label a title the reader cannot open as
            free to read. ActionBar already renders null on the empty action
            set, so the buttons need no gate. */}
        {!isNotEntitled(detail.access) && <AccessTierBadge tier={detail.access.tier} />}

        {/* D12 — the `queued` half: "queued shows a position and nothing
            tappable". `resolveAccess` returns no actions in that state, so
            ActionBar draws nothing and this line is the entire UI for it —
            without it a waiting reader sees a detail screen with no answer. */}
        <QueuePositionLine access={detail.access} />

        {/* The abstract is `ItemDetail.description` under the label this screen
            uses for it. Absent entirely — no heading, no empty block — when the
            feed did not supply one, same "leave gaps blank" rule as everywhere
            else on this screen. */}
        {detail.description !== undefined && (
          <View style={styles.abstractBlock}>
            <SectionHeader title="Abstract" />
            <Text style={styles.abstractText}>{detail.description}</Text>
          </View>
        )}
      </ScrollView>

      {/* Outside the ScrollView — see the header comment. ActionBar pads itself
          and draws its own top border, so no wrapper is needed here; the
          `actionBarWrapper` stretch fix exists only for the book layout, whose
          centring column would otherwise shrink it. */}
      <ActionBar actions={detail.access.actions} onAction={onAction} pending={pending} />
    </>
  );
}

export default function ItemDetailScreen({ route, navigation }: ItemDetailRouteProps) {
  const { itemId } = route.params;

  const selectedInstitution = useInstitutionStore((s) => s.selectedInstitution);
  // NULL IS A REAL STATE HERE, not a missing value: this screen is reachable
  // from the public catalogue, where the reader has chosen no institution. It
  // picks the public endpoint in that case, and resolveAccess already takes
  // `institutionId: string | null`, so the null travels all the way through
  // rather than being papered over with a default id.
  const institutionId = selectedInstitution?.id ?? null;

  const isOnline = useNetworkStatus();

  // Holdings from the session cache. The cache starts empty and is populated by
  // refresh() — resolveAccess treats undefined loan/hold as "nothing held", so the
  // action bar is correct on first render and updates once the cache arrives.
  const loans = useLibraryStore((s) => s.loans);
  const holds = useLibraryStore((s) => s.holds);
  const refresh = useLibraryStore((s) => s.refresh);
  const loan = loans.find((l) => l.itemId === itemId);
  const hold = holds.find((h) => h.itemId === itemId);

  // Publication stored separately so that access can be re-resolved whenever
  // loan/hold change — without re-fetching from wokay.
  const [publication, setPublication] = useState<Publication | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // The licence call currently waiting on flambeau — handed to ActionBar so the
  // tapped button goes busy. `undefined` is "nothing in flight".
  const [pendingAction, setPendingAction] = useState<ActionId | undefined>(undefined);
  const [errorCode, setErrorCode] = useState<CatalogueError | undefined>(undefined);

  // Recomputed whenever the publication or the reader's holdings change. Pure and
  // fast — no call is made, resolveAccess is synchronous.
  const detail: ItemDetail | null = useMemo(() => {
    if (publication === null) return null;
    const access = resolveAccess({
      item: publication,
      institutionId,
      session: handToggledSession(institutionId),
      loan,
      hold,
    });
    return buildItemDetail({ publication, workType: BOOK_WORK_TYPE, access });
  }, [publication, institutionId, loan, hold]);

  // No synchronous setState in here — only inside the async continuations. Same
  // note as InstitutionDetailScreen: retry is the one path that resets
  // loading/failure, and it runs from a press handler, not an effect.
  const fetchItem = useCallback(() => {
    const source = getCatalogueSource();
    // No institution means the reader arrived from the public catalogue, so the
    // public route is the only one that can honestly answer for them.
    const request =
      institutionId === null
        ? source.getPublicPublication(itemId)
        : source.getPublication(institutionId, itemId);

    request
      .then((pub) => setPublication(pub))
      .catch((err: unknown) => {
        setErrorCode(isCatalogueFailure(err) ? err.code : undefined);
        setFailed(true);
      })
      .finally(() => setLoading(false));
  }, [institutionId, itemId]);

  useEffect(() => {
    fetchItem();
    // Fetch the reader's holdings once per mount so the action bar reflects live
    // state rather than the empty-cache default. Runs in parallel with fetchItem —
    // neither blocks on the other.
    void refresh();
  }, [fetchItem, refresh]);

  const retry = useCallback(() => {
    setLoading(true);
    setFailed(false);
    fetchItem();
  }, [fetchItem]);

  // ONE LICENCE CALL IN FLIGHT, AND THE BAR SAYS SO. Every branch below used to
  // be fire-and-forget: the button stayed idle, so Read or Grant access could be
  // tapped four times while the first borrow was still open and each tap made
  // another call. `pendingAction` is what ActionBar's own `pending` prop was
  // built for — it renders that one button `loading`, and ActionButton makes a
  // loading button `disabled`, so the tapped control stops accepting presses on
  // its own. The state check below closes the same door for the OTHER buttons in
  // the bar, which stay visually idle.
  //
  // NO REF GUARD, DELIBERATELY. A synchronous `inFlight` ref would be captured by
  // `handleAction`, which is handed to `renderBookContent` — a function called
  // during render — and `react-hooks/refs` rejects that for a real reason: a ref
  // read during render does not re-render when it changes. The disabled Pressable
  // is the guard the component library already provides, and it is the one the
  // rest of this app relies on (see ActionButton's `inert`).
  const runLicenceCall = useCallback(
    (action: ActionId, call: () => Promise<unknown>) => {
      setPendingAction(action);

      call()
        // Caught before the refresh so a failed call still invalidates the cache
        // — a borrow that threw may still have created the loan. D13 owns turning
        // the refusal into a message; this only stops the button spinning forever.
        .catch(() => {})
        .then(() => refresh())
        .catch(() => {})
        .finally(() => setPendingAction(undefined));
    },
    [refresh],
  );

  const handleAction = useCallback(
    (action: ActionId) => {
      // Nothing while a licence call is open. `signIn` is exempt below only
      // because it is navigation, not a call — and it cannot coexist with one
      // anyway, since resolveAccess never returns signIn beside the four.
      if (pendingAction !== undefined) return;

      if (action === 'signIn') {
        if (detail !== null) {
          navigation.navigate('AccessGate', {
            itemId: detail.id,
            title: detail.title,
            authors: detail.authors.join(', '),
          });
        }
        return;
      }

      // The four licence calls. Each mutates server state, so the holdings cache is
      // invalidated immediately after — refresh() re-fetches GET /api/v1/library and
      // the action bar updates to reflect the new loan or hold. All four now run
      // through `runLicenceCall`, which owns the pending state and the guard.
      const source = getLicenceSource();
      if (action === 'read' || action === 'download') {
        runLicenceCall(action, () => source.borrow(itemId));
      } else if (action === 'revokeLicence' && loan?.loanId !== undefined) {
        const loanId = loan.loanId;
        runLicenceCall(action, () => source.returnLoan(loanId));
      } else if (action === 'grantAccess') {
        // Elite path: borrow first, queue only on NO_COPIES_AVAILABLE. The rule
        // lives in `borrowOrPlaceHold` — see src/licence/queueRequest.ts. It is
        // there rather than inline because the refusal rule is easy to get
        // subtly wrong and dangerous when wrong, so it earns its own tests.
        runLicenceCall(action, () => borrowOrPlaceHold(source, itemId));
      } else if (action === 'acceptOffer' && hold?.holdId !== undefined) {
        const holdId = hold.holdId;
        runLicenceCall(action, () => source.acceptOffer(holdId));
      } else if (action === 'rejectOffer' && hold?.holdId !== undefined) {
        const holdId = hold.holdId;
        runLicenceCall(action, () => source.cancelHold(holdId));
      }
    },
    [navigation, detail, itemId, loan, hold, pendingAction, runLicenceCall],
  );

  let body: ReactNode;

  if (loading) {
    body = (
      <View style={styles.loading} testID="item-detail-skeleton">
        <Skeleton variant="block" width={COVER_WIDTH} height={COVER_HEIGHT} />
        <Skeleton variant="text" width={COVER_WIDTH * 2} height={typeScale.pageTitle.lineHeight} />
        <Skeleton variant="text" width={COVER_WIDTH} height={typeScale.body.lineHeight} />
      </View>
    );
  } else if (failed) {
    // errorCode is undefined when the rejection was not a CatalogueFailure at
    // all — a bug rather than a condition D14 has copy for, so this falls back
    // to the same honest generic line the unreachable branch below uses.
    const variant = errorCode === undefined ? 'not_ready' : catalogueErrorVariant(errorCode);
    const message = errorCode === undefined ? GENERIC_MESSAGE : CATALOGUE_ERROR_COPY[errorCode];
    body = (
      <View style={styles.centre}>
        <ErrorState variant={variant} message={message} onRetry={retry} />
      </View>
    );
  } else if (detail === null) {
    // Unreachable: `finally` clears `loading` only after one of the two branches
    // above has been given a value. Present so the compiler can narrow, and so a
    // future change that breaks that invariant shows a retry rather than a blank
    // screen — same guard as InstitutionDetailScreen.
    body = (
      <View style={styles.centre}>
        <ErrorState variant="not_ready" message={GENERIC_MESSAGE} onRetry={retry} />
      </View>
    );
  } else {
    // The only place workType is read for presentation. Today this is always
    // 'book' — see the header comment — but the branch is real and the article
    // side is exercised directly in tests rather than left unwritten.
    body =
      detail.workType === 'article'
        ? renderArticleContent(detail, handleAction, pendingAction)
        : renderBookContent(detail, handleAction, pendingAction);
  }

  return (
    <View style={styles.screen}>
      {/* Overlays whatever is above, in every state — the library stays usable
          behind it (§State: "offline means degraded but usable"). */}
      <OfflineBanner visible={!isOnline} />
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  // WHITE, NOT `surface`. `surface` was doing this job when it was #F8F9FA and
  // read as near-white; the brand palette makes it #EBF0FF Cornflower Neutral,
  // which is a card tint and not a page. Both mockups draw a white page with
  // tinted furniture on top, so the page takes `white` and `surface` goes back
  // to what tokens.ts says it is for — cards and section backgrounds, including
  // ActionBar's own footer band, which now separates from the page instead of
  // disappearing into it.
  screen: {
    flex: 1,
    backgroundColor: color.white,
  },
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loading: {
    alignItems: 'center',
    padding: space.lg,
    gap: space.md,
  },
  // Screen 05. LEFT-RANGED, not centred: the cover centres itself (see `cover`)
  // and everything under it shares the left margin. The extra bottom padding
  // clears the pinned ActionBar so the last row can be scrolled out from behind
  // it. No `alignItems` — the default `stretch` is what lets the rules and the
  // Table of Contents row run the full column width.
  content: {
    padding: space.lg,
    paddingBottom: space.xl,
    gap: space.sm,
  },
  // Both scroll regions. `flex: 1` is what leaves the pinned ActionBar below the
  // scroll the rest of the height instead of pushing it off-screen.
  scroll: {
    flex: 1,
  },
  articleScroll: {
    flex: 1,
  },
  // NO `alignItems` OVERRIDE, deliberately. The default `stretch` is what lets
  // the tab divider and the abstract run the full column width; text is
  // left-ranged by default, so left alignment needs no property at all. The two
  // children that must not stretch — the badge and the inline tags — set their
  // own `alignSelf`, which is the rule AccessTierBadge already follows.
  //
  // The extra bottom padding clears the pinned ActionBar, so the last line of a
  // long abstract can still be scrolled clear of it.
  articleContent: {
    padding: space.lg,
    paddingBottom: space.xl,
    gap: space.md,
  },
  // Eyebrow, title, authors and date as one tight unit — xs against the md
  // gaps between the sections below it.
  articleHeader: {
    gap: space.xs,
  },
  // `alignSelf` rather than the parent centring everything: the jacket is the
  // one element on this screen with an axis worth centring on. Elevation from
  // the token set, so the cover sits ON the white page the way the mockup draws
  // it rather than being a flat rectangle cut out of it.
  cover: {
    alignSelf: 'center',
    width: COVER_WIDTH,
    height: COVER_HEIGHT,
    borderRadius: radius.card,
    backgroundColor: color.border,
    marginBottom: space.md,
    ...elevation.card.ios,
    ...elevation.card.android,
  },
  title: {
    fontWeight: typeScale.pageTitle.weight,
    fontFamily: typeScale.pageTitle.fontFamily,
    fontSize: typeScale.pageTitle.size,
    lineHeight: typeScale.pageTitle.lineHeight,
    color: color.textPrimary,
  },
  subtitle: {
    fontWeight: typeScale.body.weight,
    fontFamily: typeScale.body.fontFamily,
    fontSize: typeScale.body.size,
    lineHeight: typeScale.body.lineHeight,
    color: color.textSecondary,
  },
  // "By" in the body colour; the names nested inside it take the link colour.
  byLine: {
    fontWeight: typeScale.body.weight,
    fontFamily: typeScale.body.fontFamily,
    fontSize: typeScale.body.size,
    lineHeight: typeScale.body.lineHeight,
    color: color.textSecondary,
  },
  byLineNames: {
    color: color.primary,
  },
  // Screen 04's title and author line. Same tokens as `title`/`authors` above,
  // minus the centring.
  articleTitle: {
    fontWeight: typeScale.pageTitle.weight,
    fontSize: typeScale.pageTitle.size,
    lineHeight: typeScale.pageTitle.lineHeight,
    color: color.textPrimary,
  },
  // PRIMARY, NOT `textPrimary`. The mockup sets the author line in its link
  // colour, and an author IS a destination on the web original. Nothing here
  // navigates yet — there is no author endpoint — so this is the one place the
  // screen takes a mockup colour without the mockup's behaviour. It reads as
  // emphasis rather than as a promise because it carries no chevron, no
  // underline and no `accessibilityRole="link"`; the moment an author route
  // exists this becomes a Pressable and nothing about the colour changes.
  articleAuthors: {
    fontWeight: typeScale.body.weight,
    fontSize: typeScale.body.size,
    lineHeight: typeScale.body.lineHeight,
    color: color.primary,
  },
  metaBlock: {
    gap: space.xs,
    marginTop: space.sm,
  },
  // The hairline that fences the metadata list off from the badge above it, as
  // the mockup draws it. `border` rather than a tint, and hairline rather than
  // 1px, so it stays a division and not a line to read.
  rule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: color.border,
    marginBottom: space.sm,
  },
  // Glyph and text on one row.
  metaRowLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  // D12's queue position: a status line, styled as metadata rather than as an
  // action, because that is what it is.
  queuePosition: {
    fontWeight: typeScale.meta.weight,
    fontFamily: typeScale.meta.fontFamily,
    fontSize: typeScale.meta.size,
    lineHeight: typeScale.meta.lineHeight,
    color: color.textSecondary,
  },
  metaRow: {
    fontWeight: typeScale.meta.weight,
    fontFamily: typeScale.meta.fontFamily,
    fontSize: typeScale.meta.size,
    lineHeight: typeScale.meta.lineHeight,
    color: color.textSecondary,
  },
  // Only inside `metaRowLine`, never on the article layout's standalone date —
  // `flex: 1` here wraps a long "Published … by …" under itself instead of
  // pushing past the right margin, but in a column parent it would stretch the
  // line vertically instead.
  metaRowText: {
    flex: 1,
  },
  description: {
    alignSelf: 'stretch',
    fontWeight: typeScale.body.weight,
    fontFamily: typeScale.body.fontFamily,
    fontSize: typeScale.body.size,
    lineHeight: typeScale.body.lineHeight,
    color: color.textPrimary,
    marginTop: space.sm,
  },
  // Article-only. No `marginTop` any more: `articleContent`'s own `gap` spaces
  // it off the badge above, and the old margin stacked on top of that.
  abstractBlock: {
    gap: space.xs,
  },
  // No marginTop of its own: abstractBlock's own gap already spaces it under
  // the SectionHeader, and description's margin would double it up.
  abstractText: {
    fontWeight: typeScale.body.weight,
    fontFamily: typeScale.body.fontFamily,
    fontSize: typeScale.body.size,
    lineHeight: typeScale.body.lineHeight,
    color: color.textPrimary,
  },
  // Same box shape as `unavailableTag`, deliberately, so the two read as
  // siblings — but full opacity and primary-coloured text, because this one
  // is confirmed data rather than a gap.
  // `alignSelf` now that `content` no longer centres its children — same one
  // line AccessTierBadge sets on itself, and for the same reason: a chip that
  // stretches to the column width stops looking like a chip.
  formatStrip: {
    alignSelf: 'flex-start',
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.white,
  },
  formatStripLabel: {
    fontWeight: typeScale.smallLabel.weight,
    fontFamily: typeScale.smallLabel.fontFamily,
    fontSize: typeScale.smallLabel.size,
    lineHeight: typeScale.smallLabel.lineHeight,
    color: color.textPrimary,
  },
  // Muted and outlined rather than filled, mirroring FilterChip's own
  // `chipDisabled: { opacity: 0.4 }` — the same "greyed control" language, not
  // the component itself (a filter dimension and an unavailable mockup element
  // are different things wearing a similar look).
  unavailableTag: {
    alignSelf: 'flex-start',
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.white,
    opacity: 0.5,
  },
  unavailableTagLabel: {
    fontWeight: typeScale.smallLabel.weight,
    fontFamily: typeScale.smallLabel.fontFamily,
    fontSize: typeScale.smallLabel.size,
    lineHeight: typeScale.smallLabel.lineHeight,
    color: color.textSecondary,
  },
  // Screen 04's shape: no border, no fill, no box — a row of muted text with an
  // optional glyph, which is how its mockup draws both call sites. `alignSelf`
  // keeps it to its content width against `articleContent`'s stretch default,
  // the same line AccessTierBadge sets on itself for the same reason.
  //
  // Muted by colour alone, with NO `opacity`. The pill above can afford opacity
  // because its border fades with it and the whole chip recedes together; here
  // there is nothing but text, and dimming 12pt text a second time after it is
  // already on the secondary colour puts it under AA on white.
  unavailableInline: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space.xs,
  },
  unavailableInlineLabel: {
    fontWeight: typeScale.smallLabel.weight,
    fontSize: typeScale.smallLabel.size,
    lineHeight: typeScale.smallLabel.lineHeight,
    color: color.textSecondary,
  },
  // Screen 05's Table of Contents shape: the mockup's full-width ruled row with
  // a leading glyph. Stretches rather than hugging its label, and takes a rule
  // above it the same way the metadata block does, so it reads as the section
  // heading the mockup makes it — minus the chevron, which is the whole point.
  //
  // Vertical padding rather than a fixed height, so a large accessibility text
  // size grows the row instead of clipping the label inside it.
  unavailableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.md,
    marginTop: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.border,
  },
  // `sectionHeader`, matching the weight the mockup gives this line and the
  // weight SectionHeader gives "Abstract" on screen 04 — but on the secondary
  // colour, because there is still nothing behind it.
  unavailableRowLabel: {
    fontWeight: typeScale.sectionHeader.weight,
    fontSize: typeScale.sectionHeader.size,
    lineHeight: typeScale.sectionHeader.lineHeight,
    color: color.textSecondary,
  },
  // Plain text and a divider, matching the mockup's own tab strip shape —
  // deliberately not chips. See the header comment on `InertTabRow`.
  tabRow: {
    alignSelf: 'stretch',
  },
  // No `flexWrap`: this is the horizontal ScrollView's content container now, so
  // the row runs off the edge and scrolls rather than folding onto a second line.
  tabRowLabels: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  // Secondary colour throughout, on every label — no active one, no accent, no
  // underline. See `InertTabRow`'s header comment for why marking one active
  // would overclaim.
  //
  // `smallLabel`, down from `button`. Regular weight at 12pt is what fits all
  // five on the mockup's single line; it is also the honest weight here, since
  // the mockup's bold is reserved for the active tab and this row has none.
  tabRowLabel: {
    fontWeight: typeScale.smallLabel.weight,
    fontFamily: typeScale.smallLabel.fontFamily,
    fontSize: typeScale.smallLabel.size,
    lineHeight: typeScale.smallLabel.lineHeight,
    color: color.textSecondary,
  },
  tabRowDivider: {
    alignSelf: 'stretch',
    height: StyleSheet.hairlineWidth,
    backgroundColor: color.border,
    marginTop: space.sm,
  },
});
