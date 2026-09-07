// The personal library — CAP-4 Module E (Library & Sync), flambeau.
//
// The screen the app opens on for a signed-in reader: what they are holding,
// what is on this device, where they left off, and what they are standing in
// line for. Loans and holds come from `GET /api/v1/library`, which this repo
// reaches through `LicenceSource.getLibrary()` rather than through HTTP (see
// `src/licence/`). Downloads and bookmarks are DEVICE-LOCAL and come from
// `downloadStore` and `bookmarkStore` — that endpoint carries neither.
//
// FIVE SECTIONS, IN THIS ORDER, AND THE ORDER IS A DECISION RATHER THAN A
// LAYOUT PREFERENCE:
//
//   1 · Offered to you — loudest, and first. It is the only list that dies. A
//       reader who misses the countdown loses a book they queued for and the
//       queue moves on without them, so anything below the fold here is a lost
//       book. An ELITE title whose grant came through arrives here.
//   2 · Borrowed Books — what the reader came to the app to do: open a book.
//       The reader's live loans, shown as the mockup's "Reading Now" card — the
//       cover, format, access tier and due date, but NOT a reading-progress
//       percent, which lives behind CAP-7's reader and cannot be faked here.
//   3 · Downloads      — the same books, on this phone. Works in a tunnel.
//   4 · Bookmarks      — where the reader stopped. One row per bookmark.
//   5 · Waiting        — reassurance, not action. Nothing here expires. Carries
//       a positional queue-progress bar (see `queueProgressFraction`).
//
// EVERY HEADING RENDERS, EVEN WITH NOTHING UNDER IT. A new reader used to get a
// single "Nothing to show here yet" on a blank page, which answers "is this
// broken?" and nothing else. The five headings with an empty line each are the
// shelf's own table of contents: they tell a reader who has never borrowed
// anything that this is where a loan will appear, that downloads are a thing
// this app does, and that their place in a queue will be shown to them. The
// cost is a screen that is never empty-looking; the benefit is that the screen
// teaches itself.
//
// ─── A TAB BAR OVER AN OVERVIEW, NOT FIVE SECTIONS DOWN ONE SCROLL ──────────
//
// All · Borrowed Books · Downloads · Bookmarks · Premium books, pinned above the
// scroll, with `All` the default. `All` shows every heading but caps each at
// `PREVIEW_ROWS`, and a capped section grows a "See all (12)" that SWITCHES TAB
// rather than pushing a screen.
//
// BOOKMARKS IS WHAT FORCED THIS. It is one row per bookmark, not per book, so a
// reader working through a single monograph has thirty rows in the middle of
// the shelf and pushes Downloads and Waiting out of reach. Five sections down
// one scroll was defensible at three server-sourced sections; it is not with an
// unbounded one in the middle. Capping the overview bounds the page at fifteen
// rows however much the reader holds.
//
// WHY TABS ARE SAFE HERE, GIVEN THE ORDER ABOVE IS ABOUT URGENCY. The reason an
// offer had to be first was that it must be UNMISSABLE, and it still is on
// every tab — `QueueNotificationHost` (D16) mounts the actionable Accept /
// Decline banner at the app root, on every screen. So a reader on the Downloads
// tab has the offer in front of them regardless. The Offered section is a
// listing, not the alarm; the alarm is mounted elsewhere and always on.
//
// "See all" SWITCHES TAB INSTEAD OF NAVIGATING, which is the whole reason this
// costs no route: the full list already exists one tab over. A pushed screen
// would be a second place that renders a loan row, and CONVENTIONS §7 is about
// exactly that.
//
// THE TAB SET IS NAMED HERE AND THAT DOES NOT BREAK `Tabs`. Its "TABS ARE DATA,
// NOT CODE" rule (AGENTS.md L-5) is a rule about the COMPONENT: it must not
// name a tab or assume a count, because screen 01's bar is configured per
// institution. These five are partitions of one screen's own state, not
// institutional data, so naming them at this call site is what that rule
// intends. The bar holds no selection state either — `activeTab` lives here.
//
// THE SAME BOOK APPEARS IN TWO SECTIONS AND THAT IS NOT A BUG. A SUBSCRIPTION
// title a student downloads is a loan AND a download: the loan is what expires,
// the download is what opens offline. An OPEN_ACCESS title downloads with no
// loan at all, so it appears only under Downloads — which is exactly why
// Downloads cannot be a badge on the loan rows instead. See `sortedDownloads`.
//
// NO COMPONENT ON THIS SCREEN READS A CLOCK. Every countdown is a difference
// against the `serverTime` that arrived with the holdings. `Date.now()` is
// called only inside `@hooks/useServerClock`, and only ever to measure an
// ELAPSED interval between two readings of the same clock — which is safe even
// when that clock is absolutely wrong. A device five minutes fast must not show
// an offer dying five minutes early, because the reader then abandons a copy
// that is still theirs.
//
// THE OFFER BANNER IS NOT THIS SCREEN'S. `QueueNotificationHost` (D16) mounts
// `QueueNotification` globally at the app root, so the Offered section below
// lists offers and the floating banner carries Accept and Decline. See
// `OfferRow` for why, and for what it costs.
//
// UNDER-SHOW, NEVER OVER-SHOW. Where this screen is unsure whether an offer is
// still live it renders it as expiring and lets a refresh correct it. Costing a
// reader one refresh is better than someone tapping Accept on a copy that is
// already gone and getting the refusal after the celebration.
//
// TITLES ARE HYDRATED, NOT STORED. `getLibrary` carries item ids; titles and
// covers come from ONE `getItemsBatch` call. A title that fails to arrive
// leaves the row rendered against its id with a retry, because the reader still
// has the book — a title is decoration, possession is not.
//
// ─── WHAT IS DELIBERATELY NOT HERE YET ──────────────────────────────────────
//
// ACTION BUTTONS ON LOAN ROWS (Read · Revoke licence · Download). Design Spec
// §5.1 and CONVENTIONS §3 are absolute: the UI must never calculate access
// rights, and `resolveAccess` is the only place that logic may live. It needs a
// `ResolvableItem` carrying an `acquisition`, and `getItemsBatch` returns
// `BookSummary`, which has none — so a resolve from batch data alone returns
// the no-acquisition branch: `not_entitled`, `actions: []`. Getting a real
// resolve per row would mean one `getItem` call per loan, which is the "one
// call, not twenty" rule broken to satisfy the access rule.
//
// So the loan rows render possession and the due date, and no buttons. That is
// an open question for the access spine's owner rather than a decision to make
// here, and inventing a Read button from `loan.state` would be exactly the
// thing both rules forbid. `DOWNLOAD` is blocked twice over: `canPersist` does
// not survive `normalizeLicence.ts` at all.
//
// STALE AND REFUSED STATES. `libraryStore.refresh()` swallows every failure and
// exposes no `error`, by design — "a stale but present loan is better than
// blanking the UI". The consequence is that this screen cannot tell a failed
// refresh from a successful empty one, so the quiet "not up to date" marker and
// the rendered refusal are both unbuildable without the store reporting failure.
// Loading and empty are built; those two are not.
//
// NO ROW ON THE DOWNLOADS OR BOOKMARKS SECTION IS TAPPABLE YET, for the same
// reason the loan rows carry no buttons: opening a downloaded book means a
// reading session, and bookmarks navigate INTO the reader — both live behind
// CAP-7's `ContentProvider`/reader, which is not in this repo. The rows state
// the fact and wait for that seam rather than rendering a button that cannot
// fire. `src/features/download` is still an empty directory, so today both
// sections render their empty line for every reader; the wiring above them is
// what this screen owns and it is done.
import { Children, type ReactNode, useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { Bookmark } from '@/shared/contracts';
import { AccessTierBadge } from '@components/AccessTierBadge';
import { ContentCard } from '@components/ContentCard';
import { OfflineBanner } from '@components/OfflineBanner';
import { SectionHeader } from '@components/SectionHeader';
import { Skeleton } from '@components/Skeleton';
import { type TabItem, Tabs } from '@components/Tabs';
import { getCatalogueSource } from '@config/catalogue';
import { useNetworkStatus } from '@hooks/useNetworkStatus';
import { type ServerClock, useServerClock } from '@hooks/useServerClock';
import type { BookSummary, Hold, Loan } from '@model/types';
import { useBookmarkStore } from '@store/bookmarkStore';
import { type DownloadRecord, useDownloadStore } from '@store/downloadStore';
import { useLibraryStore } from '@store/libraryStore';
import { color, radius, space, type } from '@theme/tokens';

import {
  activeLoans,
  bookmarkLocationLabel,
  collectItemIds,
  downloadedLabel,
  downloadsSummaryLabel,
  dueLabel,
  offerExpiryLabel,
  offerMinutesRemaining,
  partitionHolds,
  queueLabel,
  queueProgressFraction,
  sortedBookmarks,
  sortedDownloads,
} from './LibraryScreen.holdings';

// How often the offer countdowns re-render. A minute is the resolution
// `QueueNotification` displays, so ticking faster would re-render the tree for
// a label that cannot change. Ticking slower would let "Expiring now" arrive up
// to a minute late, and the last minute is the one that matters.
const TICK_MS = 30_000;

// Per SECTION, not per screen — and two rather than three because three
// server-sourced sections load at once, so this is six rows plus their
// headings, which is already more than a phone shows. The skeleton stands in
// for a shelf whose length is not yet known, so this is a plausible shape
// rather than a count of anything.
const SKELETON_ROWS = 2;

// A single shared empty map, so "no titles yet" is the same object on every
// render. A fresh `new Map()` would be a new identity each time and re-run
// anything downstream that compares it.
const EMPTY_TITLES: Map<string, BookSummary> = new Map();

/**
 * The tab set, and the ids a section's "See all" switches to.
 *
 * `holds` CARRIES BOTH HOLD SECTIONS — Offered to you and Waiting — because a
 * reader thinks of them as one thing they asked for, and the app splits them
 * only because one of the two dies. One tab, still two headings inside it.
 *
 * NAMED HERE RATHER THAN IN `Tabs`, and the file header says why.
 */
const LIBRARY_TABS: TabItem[] = [
  { id: 'all', label: 'All' },
  // Shown as "Borrowed Books"; the id stays `loans` because that is the
  // partition it selects (the reader's active loans).
  { id: 'loans', label: 'Borrowed Books' },
  { id: 'downloads', label: 'Downloads' },
  { id: 'bookmarks', label: 'Bookmarks' },
  // Shown to the reader as "Premium books"; the id stays `holds` because that is
  // the partition it selects (Offered + Waiting). See the file header.
  { id: 'holds', label: 'Premium books' },
];

type LibraryTabId = 'all' | 'loans' | 'downloads' | 'bookmarks' | 'holds';

// How many rows a section shows on the overview before it defers to its own
// tab. Three is enough to prove the section is not empty and to show the row
// that matters most — every list on this screen is sorted with the most urgent
// or most recent first — while keeping the whole overview to about a screen and
// a half whatever the reader holds.
const PREVIEW_ROWS = 3;

export default function LibraryScreen() {
  const loans = useLibraryStore((s) => s.loans);
  const holds = useLibraryStore((s) => s.holds);
  const loading = useLibraryStore((s) => s.loading);
  const refresh = useLibraryStore((s) => s.refresh);
  // Device-local, so they are not part of `loading` and are not refetched by a
  // pull: there is nothing to fetch. A book on this phone is on this phone
  // whether or not the network answered.
  const downloadRecords = useDownloadStore((s) => s.downloads);
  const bookmarkRecords = useBookmarkStore((s) => s.bookmarks);
  const isOnline = useNetworkStatus();

  // Titles for the ids the holdings carry. Empty until a batch call lands; a
  // row with no entry renders against its id, which is the documented fallback
  // rather than a missing state.
  const [titles, setTitles] = useState<Map<string, BookSummary>>(EMPTY_TITLES);
  const [hydrationFailed, setHydrationFailed] = useState(false);
  // LOCAL, NOT ROUTE STATE. Which partition a reader is looking at is not worth
  // a back-stack entry — a Back that stepped through four tabs before leaving
  // the screen is the classic cost of routing a filter. It also means the tab
  // resets to the overview when the reader comes back to the shelf, which is
  // the right default: `All` is the only view that shows an offer.
  const [activeTab, setActiveTab] = useState<LibraryTabId>('all');

  const { offered, waiting } = partitionHolds(holds);
  const live = activeLoans(loans);
  const downloads = sortedDownloads(downloadRecords);
  const bookmarks = sortedBookmarks(bookmarkRecords);
  const { ids, truncated } = collectItemIds({
    offered,
    loans: live,
    downloads,
    bookmarks,
    waiting,
  });

  // The shelf is the launch screen, so it fetches on mount rather than waiting
  // for a pull. `refresh` never rejects — see the store — so there is nothing
  // to catch here, and equally nothing to report.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The identity of "this response". Keyed on the joined ids rather than on the
  // arrays themselves: the store replaces both objects on every refresh, so an
  // identity check would count a refresh that changed nothing as a new response
  // and re-anchor the clock on every poll.
  const idKey = ids.join(',');

  // ONE BATCH CALL PER DISTINCT SET OF IDS. Not per render, and not per row.
  //
  // Nothing is set synchronously in the effect body — a setState there cascades
  // a second render inside the same commit. The no-ids case simply does not
  // fetch, and `titles` stays at the shared empty map rather than being reset to
  // a fresh one, which would also be a new object every time.
  useEffect(() => {
    if (ids.length === 0) return;
    let cancelled = false;
    getCatalogueSource()
      .getItemsBatch(ids)
      .then((result) => {
        if (cancelled) return;
        setTitles(new Map(result.items.map((item) => [item.id, item])));
        setHydrationFailed(false);
      })
      .catch(() => {
        if (cancelled) return;
        // The reader still has their books. Fall back to rendering rows against
        // their ids with a retry rather than blanking a shelf over a title.
        setHydrationFailed(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `ids` is rebuilt every render; `idKey` is its stable identity.
  }, [idKey]);

  const onRefresh = useCallback(() => {
    void refresh();
  }, [refresh]);

  // Any row will do — `serverTime` is stamped once for the whole response, so
  // every loan and hold in one response carries the same value.
  const clock = useServerClock(
    offered[0]?.serverTime ?? waiting[0]?.serverTime,
    idKey,
    TICK_MS,
  );

  const titleFor = (itemId: string): string => titles.get(itemId)?.title ?? itemId;
  const publisherFor = (itemId: string): string | undefined =>
    titles.get(itemId)?.authors?.join(', ');
  // The hydrated record for a row, when it has arrived — carries the cover, the
  // file format and the access tier the rows below decorate with. Undefined
  // until the batch call lands (or for an id it could not resolve), and every
  // row treats that as "no decoration" rather than a missing state.
  const summaryFor = (itemId: string): BookSummary | undefined => titles.get(itemId);

  // FIRST LOAD OF THE SERVER-SOURCED SECTIONS ONLY. Downloads and bookmarks are
  // already in hand — they came off this device — so a whole-screen skeleton
  // would hide rows that are ready in order to wait for rows that are not.
  // Skeletons rather than a spinner, because this is the screen the app opens
  // on and a spinner says "wait" where a skeleton says "your shelf is arriving".
  const holdingsLoading = loading && live.length === 0 && holds.length === 0;

  // CAPPED ON THE OVERVIEW, WHOLE ON A SECTION'S OWN TAB. `Infinity` rather
  // than a big number so `slice` is a no-op there instead of a second cap
  // nobody remembers.
  const isOverview = activeTab === 'all';
  const limit = isOverview ? PREVIEW_ROWS : Infinity;

  /**
   * The "See all (12)" for a capped section, or nothing when it all fits.
   *
   * ONLY EVER ON THE OVERVIEW. On a section's own tab there is nowhere further
   * to go, and a "See all" that led back to the list you are reading is the
   * dishonest-affordance case `SectionHeader` refuses to render an action
   * without a handler for.
   */
  const seeAll = (total: number, tab: LibraryTabId) =>
    isOverview && total > PREVIEW_ROWS
      ? { label: `See all (${total})`, onPress: () => setActiveTab(tab) }
      : undefined;

  return (
    <View style={styles.screen} testID="library-screen">
      <OfflineBanner visible={!isOnline} />

      {/* PINNED ABOVE THE SCROLL rather than inside it: a filter that scrolls
          away leaves a reader deep in Bookmarks with no way back to the
          overview but a flick to the top. */}
      <View style={styles.tabBar}>
        <Tabs
          tabs={LIBRARY_TABS}
          activeId={activeTab}
          variant="segmented"
          // The five partitions are fixed, so the bar is a control with a known
          // width rather than a strip that continues off-screen. Without this
          // the segmented pill stops wherever "Holds" ends and leaves all its
          // slack on the right, which reads as a mis-centred component.
          fill
          onChange={(id) => setActiveTab(id as LibraryTabId)}
        />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} />}
        testID="library-scroll"
      >
        {hydrationFailed && (
          <Text style={styles.notice}>
            Titles couldn’t be loaded. Pull to try again — your books are still here.
          </Text>
        )}

        {truncated > 0 && (
          <Text style={styles.notice}>
            Showing your {ids.length} most recent items. {truncated} more are in your loan history.
          </Text>
        )}

        {/* Offers first: the only list that dies. An ELITE grant lands here. */}
        {(isOverview || activeTab === 'holds') && (
          <Section
            title="Offered to you"
            loading={holdingsLoading}
            action={seeAll(offered.length, 'holds')}
            // Nothing is wrong when this is empty — most readers are never
            // mid-offer — so the copy explains what the section is FOR rather
            // than apologising for being empty.
            empty="A copy reserved for you will appear here, with a countdown."
          >
            {offered.slice(0, limit).map((hold) => (
              <OfferRow
                key={hold.holdId ?? hold.itemId}
                hold={hold}
                title={titleFor(hold.itemId)}
                summary={summaryFor(hold.itemId)}
                clock={clock}
              />
            ))}
          </Section>
        )}

        {(isOverview || activeTab === 'loans') && (
          <Section
            title="Borrowed Books"
            loading={holdingsLoading}
            // The mockup's "ACTIVE LOAN" reassurance, but counted rather than
            // asserted: it is the number of live loans, which is real, not a
            // reading-progress claim the app cannot make (see the file header).
            caption={live.length === 0 ? undefined : live.length === 1 ? '1 active loan' : `${live.length} active loans`}
            action={seeAll(live.length, 'loans')}
            empty="Books you borrow will appear here until they’re due."
          >
            {live.slice(0, limit).map((loan) => (
              <BorrowedBookRow
                key={loan.loanId ?? loan.itemId}
                loan={loan}
                title={titleFor(loan.itemId)}
                publisher={publisherFor(loan.itemId)}
                summary={summaryFor(loan.itemId)}
                clock={clock}
              />
            ))}
          </Section>
        )}

        {/* Device-local: never `loading`, and unaffected by a failed refresh. */}
        {(isOverview || activeTab === 'downloads') && (
          <Section
            title="Downloads"
            // "2 items · 22.8 MB" from the mockup, over real records — see
            // `downloadsSummaryLabel` for why the size is a floor, not a claim.
            caption={downloadsSummaryLabel(downloads)}
            action={seeAll(downloads.length, 'downloads')}
            // Says which titles CAN be downloaded, because that is the question
            // an empty Downloads section raises and the answer is not obvious:
            // ELITE titles are read online only and never appear here however
            // long the reader holds them.
            empty="Open access and subscription books you download will be readable here offline."
          >
            {downloads.slice(0, limit).map((record) => (
              <DownloadRow
                key={record.itemId}
                record={record}
                title={titleFor(record.itemId)}
                publisher={publisherFor(record.itemId)}
                summary={summaryFor(record.itemId)}
              />
            ))}
          </Section>
        )}

        {(isOverview || activeTab === 'bookmarks') && (
          <Section
            title="Bookmarks"
            action={seeAll(bookmarks.length, 'bookmarks')}
            empty="Pages you bookmark while reading will appear here."
          >
            {bookmarks.slice(0, limit).map((bookmark) => (
              <BookmarkRow
                key={bookmark.id}
                bookmark={bookmark}
                title={titleFor(bookmark.bookId)}
              />
            ))}
          </Section>
        )}

        {(isOverview || activeTab === 'holds') && (
          <Section
            title="Waiting"
            loading={holdingsLoading}
            // "1 in queue" from the mockup's Hold & Reservation header.
            caption={waiting.length === 0 ? undefined : waiting.length === 1 ? '1 in queue' : `${waiting.length} in queue`}
            action={seeAll(waiting.length, 'holds')}
            empty="When every copy is out, join the queue and your place will show here."
          >
            {waiting.slice(0, limit).map((hold) => (
              <WaitingRow
                key={hold.holdId ?? hold.itemId}
                hold={hold}
                title={titleFor(hold.itemId)}
                summary={summaryFor(hold.itemId)}
              />
            ))}
          </Section>
        )}
      </ScrollView>
    </View>
  );
}

// ─── sections ────────────────────────────────────────────────────────────────

/**
 * One heading and whatever belongs under it — rows, skeletons, or a line of
 * copy saying what would go there.
 *
 * THE HEADING IS UNCONDITIONAL, WHICH IS THE WHOLE POINT OF THE COMPONENT. It
 * existing as a component is what makes "every section always renders" a fact
 * about one file instead of five call sites that have to remember. React counts
 * `children` as non-empty for an empty array, so the emptiness test is on the
 * array's length at the call site — hence `React.Children.count`, which sees
 * through the fragment `.map()` produces.
 *
 * `loading` IS OPTIONAL BECAUSE TWO SECTIONS CANNOT LOAD. Downloads and
 * bookmarks are read off this device; there is no request behind them to be
 * pending, and defaulting the prop to `false` says that rather than making
 * every caller pass it.
 */
function Section({
  title,
  empty,
  caption,
  loading = false,
  action,
  children,
}: {
  title: string;
  empty: string;
  /**
   * A small count/summary line under the heading — "2 items · 22.8 MB",
   * "1 in queue". Absent by default, and absent is common: sections with
   * nothing to summarise pass nothing, so the line only appears when it says
   * something true about what is below it.
   */
  caption?: string;
  loading?: boolean;
  /** "See all (12)", when the overview has more rows than it is showing. */
  action?: { label: string; onPress: () => void };
  children: ReactNode;
}) {
  const isEmpty = Children.count(children) === 0;
  return (
    <View style={styles.section}>
      {/* `SectionHeader` draws an action only when it has BOTH a label and a
          handler, so spreading an absent action is enough to withhold it. */}
      <SectionHeader
        title={title}
        {...(action === undefined ? {} : { actionLabel: action.label, onAction: action.onPress })}
      />
      {caption !== undefined && (
        <Text style={styles.sectionCaption} testID="section-caption">
          {caption}
        </Text>
      )}
      {loading ? (
        <SectionSkeleton />
      ) : isEmpty ? (
        <Text style={styles.sectionEmpty}>{empty}</Text>
      ) : (
        children
      )}
    </View>
  );
}

function SectionSkeleton() {
  return (
    <View testID="library-loading">
      {Array.from({ length: SKELETON_ROWS }, (_, i) => (
        <View key={i} style={styles.skeletonRow}>
          <Skeleton variant="block" width={48} height={64} />
          <View style={styles.skeletonText}>
            <Skeleton variant="text" width="70%" height={16} />
            <Skeleton variant="text" width="40%" height={12} />
          </View>
        </View>
      ))}
    </View>
  );
}

// ─── rows ────────────────────────────────────────────────────────────────────

// An offered row is a LISTING, not a second banner — and this is the one place
// this screen defers to something outside it.
//
// `QueueNotificationHost` (D16) mounts `QueueNotification` absolutely at the app
// root, for whatever offer is in `offerStore`, on every screen including this
// one. So rendering the same banner in this section put it on screen twice: once
// floating at the top, once inline. Two implementations of one thing is
// CONVENTIONS §7, and the visible bug is worse than the rule.
//
// SO THE ACTIONS LIVE IN THE FLOATING BANNER AND THE FACT LIVES HERE. The reader
// can still Accept or Decline — the host's banner is already on screen — and
// this section answers the question the shelf is for: what am I holding, and
// what is about to be mine. Module E's screen spec asks for Accept and Decline
// on the row itself, and that is still the better design; it needs the host to
// stand down while the Library tab is focused, which is a change to a file this
// module does not own. Raised rather than forced.
//
// TWO THINGS THIS ROW STILL OWNS. It is first, and it carries the countdown —
// an offer is the only row on the shelf that dies, and a reader scrolling past
// it has lost a book.
function OfferRow({
  hold,
  title,
  summary,
  clock,
}: {
  hold: Hold;
  title: string;
  summary?: BookSummary;
  clock: ServerClock;
}) {
  // NO COUNTDOWN UNTIL THE CLOCK HAS A SAMPLE, so the row under-shows for one
  // frame rather than counting against an offset that is not yet known.
  const minutes = clock.ready
    ? offerMinutesRemaining(hold, clock.offsetMs, clock.nowMs)
    : undefined;
  const expiry = offerExpiryLabel(minutes);
  return (
    <View style={styles.row}>
      <ContentCard
        title={title}
        {...(summary?.coverUrl === undefined ? {} : { imageUrl: summary.coverUrl })}
        {...(summary?.format === undefined ? {} : { format: summary.format })}
        badge={expiry === undefined ? undefined : <Text style={styles.expiry}>{expiry}</Text>}
      />
    </View>
  );
}

// The mockup's "Reading Now" card, rendered under the "Borrowed Books" heading,
// minus the one thing this app cannot know: the reading PROGRESS (percent, page
// x/y, "28 min left") lives behind CAP-7's reader, which is not in this repo, so
// inventing "64%" would be exactly the over-show the rest of this screen
// refuses. What the card CAN carry is real — the cover, the file format, the
// access tier, and the due date — so it carries those and stops there.
function BorrowedBookRow({
  loan,
  title,
  publisher,
  summary,
  clock,
}: {
  loan: Loan;
  title: string;
  publisher?: string;
  summary?: BookSummary;
  clock: ServerClock;
}) {
  // Held back until the clock has a sample, for the same reason as the offer
  // countdown. A due date is far less urgent than an offer, but a row that
  // said "Due in 19710 days" for one frame is worse than one that says nothing.
  const due = clock.ready ? dueLabel(loan, clock.offsetMs, clock.nowMs) : undefined;
  // The due date and the tier pill share one badge slot, stacked. Both are
  // optional: no tier until the batch call lands, no due line until the clock
  // has a sample, and an empty stack collapses to no badge at all.
  const badge =
    due === undefined && summary === undefined ? undefined : (
      <View style={styles.badgeStack}>
        {due !== undefined && <Text style={styles.badgeLabel}>{due}</Text>}
        {summary !== undefined && <AccessTierBadge tier={summary.accessTier} />}
      </View>
    );
  return (
    <View style={styles.row}>
      <ContentCard
        title={title}
        {...(publisher === undefined ? {} : { publisher })}
        {...(summary?.coverUrl === undefined ? {} : { imageUrl: summary.coverUrl })}
        {...(summary?.format === undefined ? {} : { format: summary.format })}
        {...(badge === undefined ? {} : { badge })}
      />
    </View>
  );
}

// A book whose bytes are on this phone.
//
// NO "Read offline" BUTTON, AND NO DELETE. Opening it needs a decrypt through
// CAP-7's `ContentProvider`, and deleting it needs `ContentStore.destroy` to
// take the wrapped key with it — a row that removed our record and left the
// ciphertext on disk would report free space that was never freed. Both are
// behind a seam this repo does not implement yet, so the row states the fact.
//
// IT DOES NOT SAY WHETHER THE BOOK STILL OPENS. See `downloadedLabel`: this
// screen knows a download happened, not that the licence behind it is still
// alive, and `isAvailableOffline` is the only thing that can tell them apart.
function DownloadRow({
  record,
  title,
  publisher,
  summary,
}: {
  record: DownloadRecord;
  title: string;
  publisher?: string;
  summary?: BookSummary;
}) {
  return (
    <View style={styles.row}>
      <ContentCard
        title={title}
        {...(publisher === undefined ? {} : { publisher })}
        {...(summary?.coverUrl === undefined ? {} : { imageUrl: summary.coverUrl })}
        // The "PDF · 14.2 MB" split from the mockup: the format is the book's
        // real type from the batch call, and the size stays on the "Downloaded"
        // badge where `downloadedLabel` owns the honest wording.
        {...(summary?.format === undefined ? {} : { format: summary.format })}
        badge={<Text style={styles.badgeLabel}>{downloadedLabel(record)}</Text>}
      />
    </View>
  );
}

// One saved place. The BOOK's title on the row, the POSITION in the badge, and
// the reader's own name for the bookmark on the second line where a loan row
// puts the authors — a name they typed is worth more to them than an author
// they already know, and only one of the two fits.
//
// NOT TAPPABLE YET for the same reason a download is not: the destination is
// inside the reader, which is CAP-7's. A bookmark that navigated nowhere would
// be worse than one that plainly sits there.
function BookmarkRow({ bookmark, title }: { bookmark: Bookmark; title: string }) {
  const where = bookmarkLocationLabel(bookmark);
  return (
    <View style={styles.row}>
      <ContentCard
        title={title}
        {...(bookmark.name === undefined ? {} : { publisher: bookmark.name })}
        badge={where === undefined ? undefined : <Text style={styles.badgeLabel}>{where}</Text>}
      />
    </View>
  );
}

// Reassurance, not action: no buttons, and nothing here expires. Cancelling a
// hold is a real action the reader may want, but it belongs beside a decision
// about where it lives — it is not on this screen's spec.
function WaitingRow({ hold, title, summary }: { hold: Hold; title: string; summary?: BookSummary }) {
  const place = queueLabel(hold);
  const fraction = queueProgressFraction(hold);
  return (
    <View style={styles.row}>
      <ContentCard
        title={title}
        {...(summary?.coverUrl === undefined ? {} : { imageUrl: summary.coverUrl })}
        {...(summary?.format === undefined ? {} : { format: summary.format })}
        badge={place === undefined ? undefined : <Text style={styles.badgeLabel}>{place}</Text>}
      />
      {/* The mockup's "Queue progress" bar. Drawn only when the response carried
          both a position AND a length — see `queueProgressFraction` — and it is a
          POSITIONAL fill, not the estimated wait the boundary drops. */}
      {fraction !== undefined && <QueueProgress fraction={fraction} />}
    </View>
  );
}

// A thin bar that fills toward the front of the queue. No text of its own — the
// "3rd of 7" badge above it says the number; this just makes the standing
// glanceable. Purely presentational, so it reads nothing and decides nothing.
function QueueProgress({ fraction }: { fraction: number }) {
  return (
    <View style={styles.progressTrack} testID="queue-progress">
      <View style={[styles.progressFill, { width: `${Math.round(fraction * 100)}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.white },
  // The bar owns its own inset because `Tabs` sets no outer margin, by its own
  // rule — the screen places the control.
  tabBar: { paddingHorizontal: space.md, paddingTop: space.md },
  scroll: { flex: 1 },
  content: { padding: space.md },
  section: { marginBottom: space.lg },
  row: { marginBottom: space.sm },
  skeletonRow: {
    flexDirection: 'row',
    padding: space.md,
    gap: space.md,
  },
  skeletonText: { flex: 1, gap: space.sm, justifyContent: 'center' },
  notice: {
    backgroundColor: color.surface,
    borderRadius: radius.card,
    padding: space.sm,
    marginBottom: space.md,
    color: color.textSecondary,
    fontWeight: type.smallLabel.weight,
    fontFamily: type.smallLabel.fontFamily,
    fontSize: type.smallLabel.size,
    lineHeight: type.smallLabel.lineHeight,
  },
  // Loud on purpose: `color.error` is the palette's destructive/restricted
  // colour, and an offer running out is the one thing on this shelf that takes
  // something away from the reader if they do nothing.
  expiry: {
    color: color.error,
    fontWeight: type.smallLabel.weight,
    fontFamily: type.smallLabel.fontFamily,
    fontSize: type.smallLabel.size,
    lineHeight: type.smallLabel.lineHeight,
  },
  // A line of explanation, not an error: the same secondary grey as a due date
  // rather than the `notice` card above, which is reserved for something having
  // gone wrong. Indented to the row inset so the copy hangs under its heading.
  sectionEmpty: {
    paddingHorizontal: space.xs,
    paddingTop: space.xs,
    color: color.textSecondary,
    fontWeight: type.meta.weight,
    fontFamily: type.meta.fontFamily,
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
  },
  // The count/summary line under a heading — same secondary grey and inset as
  // the empty copy, sitting just above the rows it describes.
  sectionCaption: {
    paddingHorizontal: space.xs,
    paddingTop: space.xs,
    paddingBottom: space.sm,
    color: color.textSecondary,
    fontWeight: type.meta.weight,
    fontFamily: type.meta.fontFamily,
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
  },
  // The due date and the tier pill on a Reading Now row, side by side and
  // wrapping to a second line on a narrow phone rather than pushing either off.
  badgeStack: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.xs,
  },
  // The queue-progress bar under a waiting row. `border` for the empty track,
  // `primary` for the fill — the same pairing the segmented tab bar uses.
  progressTrack: {
    height: space.xs,
    marginTop: space.sm,
    borderRadius: radius.pill,
    backgroundColor: color.border,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: color.primary,
  },
  // ONE STYLE FOR EVERY ROW BADGE — a due date, a downloaded-on date, a queue
  // position and a bookmark location are four different sentences in the same
  // slot, and they looked identical because they ARE the same thing: the row's
  // secondary line. Three byte-identical copies invited one of them drifting.
  badgeLabel: {
    color: color.textSecondary,
    fontWeight: type.smallLabel.weight,
    fontFamily: type.smallLabel.fontFamily,
    fontSize: type.smallLabel.size,
    lineHeight: type.smallLabel.lineHeight,
  },
});
