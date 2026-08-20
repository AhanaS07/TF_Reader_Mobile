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
// ACCESS IS RESOLVED HERE, NOT COMPUTED. `resolveAccess` is the only place access
// logic may live (CONVENTIONS §3) — this screen calls it once, with `session:
// null` because no session store exists yet. That is not a placeholder hack:
// resolveAccess's own header says omitting session/loan/hold is exactly what
// lets a screen resolve Open Access, Subscription and Elite-with-nothing-held
// correctly before flambeau exists.
//
// THREE STATES, KEPT VISIBLY DISTINCT, plus an offline overlay that is
// independent of them. Same shape as InstitutionDetailScreen: a skeleton while
// the fetch is in flight, ErrorState on rejection, the content once resolved. No
// ActivityIndicator — skeletons replace spinners.
import { useCallback, useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { ContentFormat } from '@/shared/types/primitives';
import { resolveAccess } from '@access/resolveAccess';
import { ActionBar } from '@components/ActionBar';
import { AccessTierBadge } from '@components/AccessTierBadge';
import { ErrorState, type ErrorStateVariant } from '@components/ErrorState';
import { OfflineBanner } from '@components/OfflineBanner';
import { Skeleton } from '@components/Skeleton';
import { SectionHeader } from '@components/SectionHeader';
import { getCatalogueSource } from '@config/catalogue';
import { useNetworkStatus } from '@hooks/useNetworkStatus';
import { buildItemDetail, type ItemDetail } from '@model/detail';
import { CatalogueError, isCatalogueFailure } from '@model/errors';
import type { ActionId, WorkType } from '@model/types';
import { useInstitutionStore } from '@store/institutionStore';
import { color, radius, space, type as typeScale } from '@theme/tokens';

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

// Same fallback CatalogueScreen uses: the one institution the mock fixtures
// serve, until CAP-3 selection has actually run.
const FALLBACK_INSTITUTION_ID = 'inst_7f3';

const COVER_WIDTH = space.xl * 3;
const COVER_HEIGHT = space.xl * 4 + space.md;

const GENERIC_MESSAGE = "We couldn't load this title.";

// Same shape as InstitutionDetailScreen's describeFailure: variant and message
// travel together because the variant decides whether Retry renders at all.
// `not_found` gets none — repeating a well-formed request for a title that does
// not exist cannot make it appear.
function describeFailure(err: unknown): { variant: ErrorStateVariant; message: string } {
  if (isCatalogueFailure(err)) {
    switch (err.code) {
      case CatalogueError.NOT_FOUND:
        return { variant: 'not_found', message: "We couldn't find this title." };
      case CatalogueError.NETWORK_UNAVAILABLE:
        return {
          variant: 'network',
          message: 'You appear to be offline. Check your connection and try again.',
        };
      case CatalogueError.TIMEOUT:
        return { variant: 'network', message: 'That took longer than expected. Try again.' };
      case CatalogueError.MALFORMED_FEED:
        return { variant: 'not_ready', message: "We couldn't read this title's details." };
    }
  }

  return { variant: 'not_ready', message: GENERIC_MESSAGE };
}

// Screen 05's presentation. Exported for the same reason `renderArticleContent`
// below is — a test can render it directly from a hand-built `ItemDetail`
// without going through the fetch — not because anything outside this file is
// meant to import it.
export function renderBookContent(
  detail: ItemDetail,
  onAction: (action: ActionId) => void,
): ReactElement {
  return (
    <ScrollView contentContainerStyle={styles.content}>
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

      {detail.authors.length > 0 && (
        <Text style={styles.authors}>{detail.authors.join(', ')}</Text>
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

      <AccessTierBadge tier={detail.access.tier} />

      {/* Publisher, published date, ISBN and page count are each shown only
          when the feed actually supplied them — "render whatever fields are
          present; leave gaps blank rather than blocking" applies here exactly
          as it does in `renderArticleContent` below. */}
      <View style={styles.metaBlock}>
        {detail.publisher !== undefined && (
          <Text style={styles.metaRow}>Publisher · {detail.publisher}</Text>
        )}
        {detail.published !== undefined && (
          <Text style={styles.metaRow}>Published · {detail.published}</Text>
        )}
        {detail.isbn !== undefined && <Text style={styles.metaRow}>ISBN · {detail.isbn}</Text>}
        {detail.numberOfPages !== undefined && (
          <Text style={styles.metaRow}>{detail.numberOfPages} pages</Text>
        )}
      </View>

      {detail.description !== undefined && (
        <Text style={styles.description}>{detail.description}</Text>
      )}

      {/* "Table of Contents" — a real mockup row with no data behind it; no
          endpoint returns a chapter list. No chevron and no Pressable: the
          mockup's chevron promises an expand interaction that does not exist,
          the same half-measure the article branch's tab row already avoids
          for its own four dead tabs. */}
      <UnavailableTag label="Table of Contents" />

      <ActionBar actions={detail.access.actions} onAction={onAction} />
    </ScrollView>
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
const ARTICLE_TAB_LABELS = ['Full Article', 'Figures & data', 'Citations', 'Metrics', 'PDF'] as const;

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
function UnavailableTag({
  label,
  accessibilityLabel,
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
}): ReactElement {
  return (
    <View
      testID="unavailable-tag"
      style={styles.unavailableTag}
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel ?? label}
    >
      <Text style={styles.unavailableTagLabel} numberOfLines={1}>
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
function InertTabRow({ labels }: { labels: readonly string[] }): ReactElement {
  return (
    <View style={styles.tabRow}>
      <View style={styles.tabRowLabels}>
        {labels.map((label) => (
          <Text key={label} style={styles.tabRowLabel} numberOfLines={1}>
            {label}
          </Text>
        ))}
      </View>
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
export function renderArticleContent(
  detail: ItemDetail,
  onAction: (action: ActionId) => void,
): ReactElement {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.title}>{detail.title}</Text>

      {detail.authors.length > 0 && (
        <Text style={styles.authors}>{detail.authors.join(', ')}</Text>
      )}

      <AccessTierBadge tier={detail.access.tier} />

      {/* The CONTENT type, not to be confused with the access tier badge
          above — the two are unrelated axes. "Research article" is the real
          mockup string (index.html: "Screen 04 — four elements"), kept rather
          than paraphrased — the same "keep the real name, mark it disabled"
          rule screen 12's unsupported filter rows already follow. wokay's
          published `@type` enum only confirms Book and Audiobook (see the file
          header), so the visible text is muted rather than live teal, and a
          screen reader is told explicitly that the classification is not
          confirmed — a sighted reader gets that from the styling alone, an
          assistive-tech user needs it said. workType is NOT derived from
          `@type` anywhere here; this label is display-only. */}
      <UnavailableTag
        label="Research article"
        accessibilityLabel="Research article — not confirmed by the current contract"
      />

      {/* None of the five is made an exception, PDF included. A tab's whole
          point is switching to what it names, and there is nothing behind the
          other four to switch to — one live tab among four dead ones would
          still be the half-measure this file is avoiding, and PDF's own file
          is already Read/Download on the action bar below, not a second
          entry point worth building. */}
      <InertTabRow labels={ARTICLE_TAB_LABELS} />

      {detail.published !== undefined && (
        <Text style={styles.metaRow}>Published · {detail.published}</Text>
      )}

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

      {/* "Download citation" — a real mockup action with no citation data
          behind it (no endpoint, no format, nothing to build a file from).
          Shown inert rather than removed, same rule as the tabs above. */}
      <UnavailableTag label="Download citation" />

      <ActionBar actions={detail.access.actions} onAction={onAction} />
    </ScrollView>
  );
}

export default function ItemDetailScreen({ route, navigation }: ItemDetailRouteProps) {
  const { itemId } = route.params;

  const selectedInstitution = useInstitutionStore((s) => s.selectedInstitution);
  const institutionId = selectedInstitution?.id ?? FALLBACK_INSTITUTION_ID;

  const isOnline = useNetworkStatus();

  const [detail, setDetail] = useState<ItemDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<unknown>(null);

  // No synchronous setState in here — only inside the async continuations. Same
  // note as InstitutionDetailScreen: retry is the one path that resets
  // loading/failure, and it runs from a press handler, not an effect.
  const fetchItem = useCallback(() => {
    getCatalogueSource()
      .getPublication(institutionId, itemId)
      .then((publication) => {
        // `publication` already has the two fields resolveAccess reads
        // (`id`, `acquisition`), so it is passed straight in.
        const access = resolveAccess({ item: publication, institutionId, session: null });
        setDetail(buildItemDetail({ publication, workType: BOOK_WORK_TYPE, access }));
      })
      .catch((err: unknown) => setFailure(err))
      .finally(() => setLoading(false));
  }, [institutionId, itemId]);

  useEffect(() => {
    fetchItem();
  }, [fetchItem]);

  const retry = useCallback(() => {
    setLoading(true);
    setFailure(null);
    fetchItem();
  }, [fetchItem]);

  // `signIn` is the one action with somewhere real to go: it opens the access
  // gate (screen 03), same trigger `resolveAccess`'s "signed out on a
  // licensed tier" branch names it for. Every other action is still a
  // no-op — the four flambeau calls behind them (generate, check, revoke,
  // join queue) are Akriti's D9/D13, Week 3 — so this screen renders the
  // resolved buttons and stops there rather than pretending a tap does
  // something it does not yet do.
  const handleAction = useCallback(
    (action: ActionId) => {
      if (action === 'signIn' && detail !== null) {
        navigation.navigate('AccessGate', {
          itemId: detail.id,
          title: detail.title,
          authors: detail.authors.join(', '),
        });
      }
    },
    [navigation, detail],
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
  } else if (failure !== null) {
    const { variant, message } = describeFailure(failure);
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
        ? renderArticleContent(detail, handleAction)
        : renderBookContent(detail, handleAction);
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
  screen: {
    flex: 1,
    backgroundColor: color.surface,
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
  content: {
    alignItems: 'center',
    padding: space.lg,
    gap: space.sm,
  },
  cover: {
    width: COVER_WIDTH,
    height: COVER_HEIGHT,
    borderRadius: radius.card,
    backgroundColor: color.border,
    marginBottom: space.sm,
  },
  title: {
    fontWeight: typeScale.pageTitle.weight,
    fontSize: typeScale.pageTitle.size,
    lineHeight: typeScale.pageTitle.lineHeight,
    color: color.textPrimary,
    textAlign: 'center',
  },
  subtitle: {
    fontWeight: typeScale.body.weight,
    fontSize: typeScale.body.size,
    lineHeight: typeScale.body.lineHeight,
    color: color.textSecondary,
    textAlign: 'center',
  },
  authors: {
    fontWeight: typeScale.body.weight,
    fontSize: typeScale.body.size,
    lineHeight: typeScale.body.lineHeight,
    color: color.textPrimary,
    textAlign: 'center',
  },
  metaBlock: {
    alignSelf: 'stretch',
    gap: space.xs,
    marginTop: space.sm,
  },
  metaRow: {
    fontWeight: typeScale.meta.weight,
    fontSize: typeScale.meta.size,
    lineHeight: typeScale.meta.lineHeight,
    color: color.textSecondary,
  },
  description: {
    alignSelf: 'stretch',
    fontWeight: typeScale.body.weight,
    fontSize: typeScale.body.size,
    lineHeight: typeScale.body.lineHeight,
    color: color.textPrimary,
    marginTop: space.sm,
  },
  abstractBlock: {
    alignSelf: 'stretch',
    gap: space.xs,
    marginTop: space.sm,
  },
  // No marginTop of its own: abstractBlock's own gap already spaces it under
  // the SectionHeader, and description's margin would double it up.
  abstractText: {
    fontWeight: typeScale.body.weight,
    fontSize: typeScale.body.size,
    lineHeight: typeScale.body.lineHeight,
    color: color.textPrimary,
  },
  // Same box shape as `unavailableTag`, deliberately, so the two read as
  // siblings — but full opacity and primary-coloured text, because this one
  // is confirmed data rather than a gap.
  formatStrip: {
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  formatStripLabel: {
    fontWeight: typeScale.smallLabel.weight,
    fontSize: typeScale.smallLabel.size,
    lineHeight: typeScale.smallLabel.lineHeight,
    color: color.textPrimary,
  },
  // Muted and outlined rather than filled, mirroring FilterChip's own
  // `chipDisabled: { opacity: 0.4 }` — the same "greyed control" language, not
  // the component itself (a filter dimension and an unavailable mockup element
  // are different things wearing a similar look).
  unavailableTag: {
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface,
    opacity: 0.5,
  },
  unavailableTagLabel: {
    fontWeight: typeScale.smallLabel.weight,
    fontSize: typeScale.smallLabel.size,
    lineHeight: typeScale.smallLabel.lineHeight,
    color: color.textSecondary,
  },
  // Plain text and a divider, matching the mockup's own tab strip shape —
  // deliberately not chips. See the header comment on `InertTabRow`.
  tabRow: {
    alignSelf: 'stretch',
  },
  tabRowLabels: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.md,
  },
  // Secondary colour throughout, on every label — no active one, no teal, no
  // underline. See `InertTabRow`'s header comment for why marking one active
  // would overclaim.
  tabRowLabel: {
    fontWeight: typeScale.button.weight,
    fontSize: typeScale.button.size,
    lineHeight: typeScale.button.lineHeight,
    color: color.textSecondary,
  },
  tabRowDivider: {
    alignSelf: 'stretch',
    height: StyleSheet.hairlineWidth,
    backgroundColor: color.border,
    marginTop: space.sm,
  },
});
