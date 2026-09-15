// The personal library — CAP-4 Module E (Library & Sync), flambeau.
//
// The screen the app opens on for a signed-in reader: what they can access,
// what they are holding, what is on this device, where they left off, and
// what Elite title needs their answer. Loans and holds come from
// `GET /api/v1/library`, reached through `LicenceSource.getLibrary()` rather
// than through HTTP (see `src/licence/`). Downloads and bookmarks are
// DEVICE-LOCAL and come from `downloadStore` and `bookmarkStore` — that
// endpoint carries neither.
//
// REBUILT AROUND A PRODUCT MODEL, NOT FIVE BACKEND SECTIONS (product spec,
// Sept 2026, refined against a reference mockup the same month). The tab
// rail is real navigation — each tab renders a DIFFERENT view of the same
// underlying data. Five tabs:
//
//   All       — a genuine overview: a pending Elite offer first if one
//               exists (never a reserved empty slot for it), then "Your
//               content" (loans/downloads/bookmarks merged, one heading not
//               five) and, separately, "Premium waiting" if the reader is
//               queued for anything.
//   Borrowed  — SUBSCRIPTION LOANS ONLY. Elite is a different tier with a
//               different lifecycle (temporary, re-requested on expiry) and
//               does not belong here — see `partitionLoansByTier`.
//   Downloads — unchanged: content actually on this device, sourced from
//               `downloadStore`, never re-derived from a tier.
//   Bookmarks — GROUPED BY TITLE, not one row per bookmark. Tapping a title
//               expands that title's own bookmarks in place.
//   Premium   — the three Elite states, in priority order: a pending offer
//               needing Accept/Decline, active Elite access already granted,
//               and a place in a waiting queue. Nothing else belongs here.
//
// EVERY TAB RESTATES ITS OWN NAME AS A HEADING, WITH A REAL COUNT BESIDE IT
// WHEN NON-ZERO ("Downloads   2 items"). Tapping a pill already tells the
// reader where they are; the heading is not decoration — the SAME row also
// carries the count, on explicit instruction against a badge on the pill
// itself ("a number beside every filter read as noise"). `All` gets no
// single count of its own (one number cannot honestly describe five kinds
// of row), but its two sub-headings ("Your content", "Premium waiting")
// follow the identical pattern.
//
// A QUIET HINT, NOT A GIANT EMPTY STATE, closes every single-purpose tab —
// `TabHint`. It always renders (an icon plus one line saying what belongs
// here), and gains a bold headline ONLY when the tab is genuinely empty.
// This is deliberately the return of the original screen's own "every
// section teaches itself" idea, at a size a later product pass asked to
// shrink: compact enough to sit under real content without reading as
// leftover space, not a full-page "nothing here" card.
//
// EVERY ROW ON THIS SCREEN IS ONE `ContentCard`, REGARDLESS OF TAB OR
// SOURCE. `EliteLoanRow`/`EliteQueueRow` (below, beside `BorrowedBookRow`/
// `DownloadRow`/`BookmarkGroupRow`) render Elite's two navigable states
// through it too — only the badge composition (an "Access expires" line, a
// queue position, a progress fraction) tells one row kind from another, the
// same device `BorrowedBookRow`'s due-date badge already used. The two
// bespoke Elite card components this replaced (`EliteActiveAccessCard`,
// `EliteQueueCard`) are gone — they had drifted from `ContentCard`'s own
// image-loading fix (a plain RN `Image` with no `onError` fallback), which
// is exactly the class of inconsistency one shared row shape stops from
// recurring. `ElitePendingAccessCard` is the one exception, and stays a
// dedicated component: it is an ACTION PROMPT (Accept/Reject buttons, no
// tap-through, no chevron), not a navigable content row, so forcing it
// through the same card would mean either losing its two buttons or
// misusing `ContentCard`'s single `action` slot for a two-button decision
// it was never shaped for. Shared between `All` and `Premium` regardless —
// one implementation of that state, composed into both views.
//
// EVERY ROW TAPS THROUGH TO THE ITEM'S OWN DETAIL PAGE, THE SAME AS
// CATALOGUE/SEARCH/SHELF. Reading itself happens from that page's own
// ActionBar, not from a direct open on the shelf — `LibraryStackParamList`
// registers `ItemDetail` for exactly this. The one exception is a bookmark
// GROUP's own "Read" action (see `BookmarkGroupRow`), which still resumes at
// the exact saved position through the provider seam below, because that is
// a real capability only this screen's own bookmark data can offer and
// `ItemDetail` cannot reproduce it.
//
// ACCEPT/DECLINE LIVE ON THE OFFER CARD ITSELF, via the same
// `getLicenceSource().acceptOffer`/`.cancelHold` calls `ItemDetailScreen`
// already makes for the identical actions on its own ActionBar — not a new
// implementation of the two buttons, and it deliberately does not silence
// `QueueNotificationHost`'s floating banner for the same offer, mirroring
// `ItemDetailScreen`'s own already-precedented coexistence with it.
//
// NO COMPONENT ON THIS SCREEN READS A CLOCK. Every countdown or due date is a
// difference against the `serverTime` that arrived with the holdings.
// `Date.now()` is called only inside `@hooks/useServerClock`, and only ever
// to measure an ELAPSED interval between two readings of the same clock —
// safe even when that clock is wrong.
//
// UNDER-SHOW, NEVER OVER-SHOW. An unhydrated loan is bucketed as subscription
// rather than briefly claiming Elite (see `partitionLoansByTier`), and an
// offer whose expiry cannot be read still renders rather than being hidden.
//
// TITLES ARE HYDRATED, NOT STORED. `getLibrary` carries item ids; titles,
// covers, formats and access tiers come from ONE `getItemsBatch` call. A
// title that fails to arrive leaves the row rendered against its id with a
// retry, because the reader still has the book — a title is decoration,
// possession is not.
//
// ─── WHAT IS DELIBERATELY NOT HERE ──────────────────────────────────────────
//
// A NEW ROUTE FOR A TITLE'S BOOKMARKS. An in-place expansion under the title
// that was just tapped shows the same real rows a pushed screen would, at
// the cost of zero new navigation — a second place that rendered a bookmark
// row would be CONVENTIONS §7's duplication.
//
// A DOWNLOAD SIZE, A DOWNLOAD DATE, A READING-PROGRESS PERCENT, A LOAN
// DURATION, AN ESTIMATED WAIT, A FABRICATED ROW OF ANY KIND. None of these
// are in the data this screen can see — see `downloadedLabel`, `dueLabel`
// and `queueProgressFraction`'s own comments in `LibraryScreen.holdings.ts`
// for exactly which fields the contract drops and why guessing one would be
// worse than omitting it. Sparse real data (today, often exactly one item)
// is rendered exactly as sparse — `TabHint` is what keeps that from looking
// broken rather than a reason to invent more rows.
import { useCallback, useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import type { Bookmark } from '@/shared/contracts';
import { useLibraryProvider } from '@/features/library/context';
import { ReaderUnavailableError } from '@/features/library/ports';
import type { ContentFormat, ReaderTargetLike } from '@/features/library/ports';
import { AccessTierBadge } from '@components/AccessTierBadge';
import { ActionButton } from '@components/ActionButton';
import { ContentCard } from '@components/ContentCard';
import { ElitePendingAccessCard } from '@components/ElitePendingAccessCard';
import { OfflineBanner } from '@components/OfflineBanner';
import { Skeleton } from '@components/Skeleton';
import { type TabItem, Tabs } from '@components/Tabs';
import { getCatalogueSource } from '@config/catalogue';
import { getLicenceSource } from '@config/licence';
import { useNetworkStatus } from '@hooks/useNetworkStatus';
import { type ServerClock, useServerClock } from '@hooks/useServerClock';
import type { BookSummary, Loan } from '@model/types';
import { useBookmarkStore } from '@store/bookmarkStore';
import { type DownloadRecord, useDownloadStore } from '@store/downloadStore';
import { useLibraryStore } from '@store/libraryStore';
import { color, radius, space, type } from '@theme/tokens';

import {
  activeLoans,
  bookmarkLocationLabel,
  type BookmarkGroup,
  collectItemIds,
  downloadedLabel,
  downloadsSummaryLabel,
  dueLabel,
  groupBookmarksByTitle,
  mergeContentItems,
  type MergedLibraryItem,
  offerCountdownLabel,
  partitionHolds,
  partitionLoansByTier,
  queueLabel,
  queueProgressFraction,
  sortedBookmarks,
  sortedDownloads,
} from './LibraryScreen.holdings';

// How often the offer/queue countdowns re-render. `QueueNotification` also
// re-renders on this cadence; ticking faster would redraw the tree for a
// label that cannot change yet, and slower would let "Expiring now" arrive
// late in the one window that matters most.
const TICK_MS = 30_000;

// The holdings skeleton's row count — a plausible shape for a shelf whose
// length is not yet known, not a count of anything real.
const SKELETON_ROWS = 2;

// A single shared empty map, so "no titles yet" is the same object on every
// render. A fresh `new Map()` would be a new identity each time and re-run
// anything downstream that compares it.
const EMPTY_TITLES: Map<string, BookSummary> = new Map();

type LibraryTabId = 'all' | 'loans' | 'downloads' | 'bookmarks' | 'holds';

// Plain text, no count badge on the pill itself — on explicit instruction: a
// number beside every filter label ("Downloads 1", "Borrowed 0") read as
// noise before the reader had chosen anything. The identical count instead
// appears inside each tab's own content, beside its restated heading — see
// `TabHeading`.
const LIBRARY_TABS: TabItem[] = [
  { id: 'all', label: 'All' },
  // Shown as "Borrowed"; the id stays `loans` because that is the partition
  // it selects. Not "Borrowed Books" — the shelf holds books, journals and
  // audiobooks alike, and the label must not name just one of them.
  { id: 'loans', label: 'Borrowed' },
  { id: 'downloads', label: 'Downloads' },
  { id: 'bookmarks', label: 'Bookmarks' },
  // Shown as "Premium"; the id stays `holds` because that is the partition
  // it selects (Offered + Elite loans + Waiting).
  { id: 'holds', label: 'Premium' },
];

// Hand-typed to the one real call this screen makes, the same reason
// `ItemDetailScreen`'s own `navigation` prop is hand-typed rather than one
// stack's generated `NativeStackScreenProps` — this screen's `navigation`
// prop is really `LibraryStackParamList`'s, but writing only the shape used
// means a test can hand it a plain `{ navigate: jest.fn() }` rather than
// standing up a real `NavigationContainer`.
interface LibraryScreenProps {
  navigation: {
    navigate: (screen: 'ItemDetail', params: { itemId: string }) => void;
  };
}

export default function LibraryScreen({ navigation }: LibraryScreenProps) {
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
  // The seam to the reader/download stack (Team 4's, merged later). Defaults to a
  // stand-in whose `openBook` politely refuses. Only `BookmarkGroupRow`'s own
  // "Read" action still calls through this — see the file header.
  const provider = useLibraryProvider();

  // Titles for the ids the holdings carry. Empty until a batch call lands; a
  // row with no entry renders against its id, which is the documented fallback
  // rather than a missing state.
  const [titles, setTitles] = useState<Map<string, BookSummary>>(EMPTY_TITLES);
  const [hydrationFailed, setHydrationFailed] = useState(false);
  // LOCAL, NOT ROUTE STATE — a filter is not worth a back-stack entry, and it
  // resets to the overview when the reader returns to the tab.
  const [activeTab, setActiveTab] = useState<LibraryTabId>('all');
  // A transient line shown when a bookmark's own "Read" can't resume yet —
  // the reader isn't in this build. Cleared on a successful open once the
  // real provider is mounted.
  const [openNotice, setOpenNotice] = useState<string | undefined>(undefined);
  // Which offer/hold is mid-Accept-or-Decline, and which. One at a time: two
  // concurrent licence calls on the same reader's holds would race each
  // other's `refresh()`.
  const [pendingHoldAction, setPendingHoldAction] = useState<
    { holdId: string; action: 'accept' | 'reject' } | undefined
  >(undefined);
  // A generic failure line for an Elite action or a bookmark-title download —
  // deliberately not itemised per row: this screen has no per-row error
  // affordance today, and a shared pinned notice (same slot `openNotice`
  // already uses) is the smaller thing to build than one for every card.
  const [actionNotice, setActionNotice] = useState<string | undefined>(undefined);
  // Which bookmark GROUP (by book id) is expanded in place. One at a time —
  // the reference mockup shows one title's bookmarks at a time, and a reader
  // flicking between several would otherwise stack every group's rows into
  // one very long screen.
  const [expandedBookId, setExpandedBookId] = useState<string | undefined>(undefined);
  // Which book is mid-download from the Bookmarks tab's own group action.
  const [downloadingBookId, setDownloadingBookId] = useState<string | undefined>(undefined);

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

  const titleFor = (itemId: string): string => titles.get(itemId)?.title ?? itemId;
  const publisherFor = (itemId: string): string | undefined =>
    titles.get(itemId)?.authors?.join(', ');
  const summaryFor = (itemId: string): BookSummary | undefined => titles.get(itemId);

  // Every row taps through to the item's own detail page — see the file
  // header. `goToDetail` is the one place that navigation happens, so every
  // row/card below hands this the same itemId rather than building its own
  // `navigation.navigate` call.
  const goToDetail = useCallback(
    (itemId: string) => navigation.navigate('ItemDetail', { itemId }),
    [navigation],
  );

  // Borrowed means subscription loans only — Elite is a different tier with a
  // different lifecycle. See `partitionLoansByTier`'s own comment.
  const { subscriptionLoans, eliteLoans } = partitionLoansByTier(live, (itemId) => summaryFor(itemId)?.accessTier);
  const bookmarkGroups = groupBookmarksByTitle(bookmarks);

  // Guards against a second tap while a bookmark's own resume-open is in
  // flight — with the real provider two concurrent `openBook` calls would
  // race a licence session. A ref rather than state so it takes effect
  // synchronously and never re-renders; read only inside this callback.
  const openingRef = useRef(false);

  // Resume a bookmark at its exact saved position through the provider seam:
  // the licence gate (`openBook`) THEN the reader (`openReader`) — never one
  // without the other. Today the stand-in's `openBook` throws
  // `ReaderUnavailableError`, so this lands on the honest notice; at merge
  // the same path opens for real. `ItemDetail` cannot reproduce this exact
  // capability (it has no bookmark position to resume from), which is why
  // this is the one row that does not simply navigate there instead.
  const openBookmark = useCallback(
    async (itemId: string, format: ContentFormat | undefined, target?: ReaderTargetLike) => {
      if (format === undefined) {
        // A title still hydrating has no known format to open against.
        setOpenNotice('This one isn’t ready to open yet — still loading its details.');
        return;
      }
      if (openingRef.current) return;
      openingRef.current = true;
      try {
        await provider.openBook(itemId, format);
        provider.openReader({ itemId, format, ...(target === undefined ? {} : { initialTarget: target }) });
        setOpenNotice(undefined);
      } catch (err) {
        // ONLY the "no reader in this build" case gets the placeholder line. Every
        // other error — a real network or licence failure once the reader is wired
        // — must propagate rather than be disguised as "coming soon".
        if (err instanceof ReaderUnavailableError) {
          setOpenNotice('This title isn’t available to read yet.');
        } else {
          throw err;
        }
      } finally {
        openingRef.current = false;
      }
    },
    [provider],
  );

  // Accept/Decline an Elite offer — the same two `LicenceSource` calls
  // `ItemDetailScreen`'s own ActionBar makes for the identical actions. See
  // the file header for why this does not need `QueueNotificationHost` to
  // stand down.
  const handleAcceptOffer = useCallback(
    (holdId: string) => {
      setActionNotice(undefined);
      setPendingHoldAction({ holdId, action: 'accept' });
      getLicenceSource()
        .acceptOffer(holdId)
        .catch(() => setActionNotice('Couldn’t accept that offer. Pull to refresh and try again.'))
        .then(() => refresh())
        .catch(() => {})
        .finally(() => setPendingHoldAction(undefined));
    },
    [refresh],
  );

  const handleRejectOffer = useCallback(
    (holdId: string) => {
      setActionNotice(undefined);
      setPendingHoldAction({ holdId, action: 'reject' });
      getLicenceSource()
        .cancelHold(holdId)
        .catch(() => setActionNotice('Couldn’t decline that offer. Pull to refresh and try again.'))
        .then(() => refresh())
        .catch(() => {})
        .finally(() => setPendingHoldAction(undefined));
    },
    [refresh],
  );

  // Start a download for a bookmarked title, from the Bookmarks tab's own
  // group action — the same borrow-then-record shape `ItemDetailScreen`'s
  // `download` action already uses (`source.borrow` then
  // `downloadStore.markDownloaded`), not a second implementation of it.
  const handleDownloadBookmarkedTitle = useCallback(
    (bookId: string) => {
      setActionNotice(undefined);
      setDownloadingBookId(bookId);
      getLicenceSource()
        .borrow(bookId)
        .then(() => {
          useDownloadStore.getState().markDownloaded({ itemId: bookId, downloadedAt: Date.now() });
        })
        .catch(() => setActionNotice('Couldn’t download that title. Try again from its detail page.'))
        .finally(() => setDownloadingBookId(undefined));
    },
    [],
  );

  // Any row will do — `serverTime` is stamped once for the whole response, so
  // every loan and hold in one response carries the same value.
  const clock = useServerClock(offered[0]?.serverTime ?? waiting[0]?.serverTime, idKey, TICK_MS);

  // FIRST LOAD OF THE SERVER-SOURCED HOLDINGS ONLY. Downloads and bookmarks are
  // already in hand — they came off this device — so a whole-screen skeleton
  // would hide rows that are ready in order to wait for rows that are not.
  const holdingsLoading = loading && live.length === 0 && holds.length === 0;

  function renderPendingOffers(): ReactNode {
    return offered.map((hold) => {
      const holdId = hold.holdId;
      if (holdId === undefined) return null;
      const expiryLabel = clock.ready ? offerCountdownLabel(hold, clock.offsetMs, clock.nowMs) : undefined;
      const pending = pendingHoldAction?.holdId === holdId ? pendingHoldAction.action : undefined;
      return (
        <View key={holdId} style={styles.row}>
          <ElitePendingAccessCard
            title={titleFor(hold.itemId)}
            {...(expiryLabel === undefined ? {} : { expiryLabel })}
            {...(pending === undefined ? {} : { pending })}
            onAccept={() => handleAcceptOffer(holdId)}
            onReject={() => handleRejectOffer(holdId)}
          />
        </View>
      );
    });
  }

  function renderEliteActiveLoans(): ReactNode {
    return eliteLoans.map((loan) => (
      <View key={loan.loanId ?? loan.itemId} style={styles.row}>
        <EliteLoanRow
          loan={loan}
          title={titleFor(loan.itemId)}
          publisher={publisherFor(loan.itemId)}
          summary={summaryFor(loan.itemId)}
          clock={clock}
          onPress={() => goToDetail(loan.itemId)}
        />
      </View>
    ));
  }

  function renderSubscriptionLoans(): ReactNode {
    return subscriptionLoans.map((loan) => (
      <View key={loan.loanId ?? loan.itemId} style={styles.row}>
        <BorrowedBookRow
          loan={loan}
          title={titleFor(loan.itemId)}
          publisher={publisherFor(loan.itemId)}
          summary={summaryFor(loan.itemId)}
          clock={clock}
          onPress={() => goToDetail(loan.itemId)}
        />
      </View>
    ));
  }

  function renderDownloadRows(): ReactNode {
    return downloads.map((record) => (
      <View key={record.itemId} style={styles.row}>
        <DownloadRow
          record={record}
          title={titleFor(record.itemId)}
          publisher={publisherFor(record.itemId)}
          summary={summaryFor(record.itemId)}
          onPress={() => goToDetail(record.itemId)}
        />
      </View>
    ));
  }

  function renderBookmarkGroups(): ReactNode {
    return bookmarkGroups.map((group) => (
      <View key={group.bookId} style={styles.row}>
        <BookmarkGroupRow
          group={group}
          title={titleFor(group.bookId)}
          expanded={expandedBookId === group.bookId}
          alreadyDownloaded={downloads.some((d) => d.itemId === group.bookId)}
          downloading={downloadingBookId === group.bookId}
          onToggle={() =>
            setExpandedBookId((current) => (current === group.bookId ? undefined : group.bookId))
          }
          onRead={() => {
            const mostRecent = group.bookmarks[0];
            void openBookmark(group.bookId, mostRecent.locator.type, bookmarkTarget(mostRecent.locator));
          }}
          onDownload={() => handleDownloadBookmarkedTitle(group.bookId)}
        />
      </View>
    ));
  }

  function renderWaitingQueue(): ReactNode {
    return waiting.map((hold) => {
      const summary = summaryFor(hold.itemId);
      return (
        <View key={hold.holdId ?? hold.itemId} style={styles.row}>
          <EliteQueueRow
            title={titleFor(hold.itemId)}
            {...(summary?.coverUrl === undefined ? {} : { imageUrl: summary.coverUrl })}
            {...(summary?.format === undefined ? {} : { format: summary.format })}
            {...(queueLabel(hold) === undefined ? {} : { queueLabel: queueLabel(hold) })}
            {...(queueProgressFraction(hold) === undefined
              ? {}
              : { progressFraction: queueProgressFraction(hold) })}
            onPress={() => goToDetail(hold.itemId)}
          />
        </View>
      );
    });
  }

  // One row per BOOK, not per fact about it — see `mergeContentItems`'s own
  // comment. Replaces calling `renderEliteActiveLoans`/`renderSubscription-
  // Loans`/`renderDownloadRows`/`renderBookmarkGroups` back to back in
  // `All`, which is what put "Playful Identities" on screen twice (once for
  // its loan, once for its download) — a real reader-visible defect this
  // function exists to fix, not four separate lists this tab happens to
  // concatenate.
  function renderMergedContentRow(item: MergedLibraryItem): ReactNode {
    const summary = summaryFor(item.itemId);

    // An Elite loan still gets its own branch, whether or not it happens to
    // also be bookmarked — Elite can never also be a download (see
    // `mergeContentItems`'s own comment) and always shows the fixed "Access
    // expires" + ELITE-tier badge pair rather than the tier-from-summary
    // badge every other row below computes. It renders through the SAME
    // `EliteLoanRow` (→ `ContentCard`) as every other row on this screen —
    // only the badge composition differs, not the card.
    if (item.isElite && item.loan !== undefined) {
      return (
        <View key={item.itemId} style={styles.row}>
          <EliteLoanRow
            loan={item.loan}
            title={titleFor(item.itemId)}
            publisher={publisherFor(item.itemId)}
            summary={summary}
            clock={clock}
            onPress={() => goToDetail(item.itemId)}
          />
        </View>
      );
    }

    const badges: ReactNode[] = [];

    if (item.loan !== undefined) {
      const due = clock.ready ? dueLabel(item.loan, clock.offsetMs, clock.nowMs) : undefined;
      if (due !== undefined) badges.push(<Text key="due" style={styles.badgeLabel}>{due}</Text>);
    }
    if (summary !== undefined && item.loan !== undefined) {
      badges.push(<AccessTierBadge key="tier" tier={summary.accessTier} />);
    }
    if (item.download !== undefined) {
      badges.push(
        <Text key="download" style={styles.badgeLabel}>
          {downloadedLabel(item.download)}
        </Text>,
      );
    }
    if (item.bookmarkGroup !== undefined) {
      const count = item.bookmarkGroup.bookmarks.length;
      badges.push(
        <Text key="bookmarks" style={styles.badgeLabel}>
          {count === 1 ? '1 bookmark' : `${count} bookmarks`}
        </Text>,
      );
    }

    return (
      <View key={item.itemId} style={styles.row}>
        <ContentCard
          title={titleFor(item.itemId)}
          onPress={() => goToDetail(item.itemId)}
          {...(publisherFor(item.itemId) === undefined ? {} : { publisher: publisherFor(item.itemId) })}
          {...(summary?.coverUrl === undefined ? {} : { imageUrl: summary.coverUrl })}
          {...(summary?.format === undefined ? {} : { format: summary.format })}
          {...(badges.length === 0
            ? {}
            : { badge: <View style={styles.badgeStack}>{badges}</View> })}
        />
      </View>
    );
  }

  function renderAllTab(): ReactNode {
    if (holdingsLoading) {
      return (
        <>
          {renderPendingOffers()}
          <HoldingsSkeleton />
        </>
      );
    }

    const mergedContent = mergeContentItems(eliteLoans, subscriptionLoans, downloads, bookmarkGroups);
    const hasContent = mergedContent.length > 0;
    const hasWaiting = waiting.length > 0;

    if (!hasContent && !hasWaiting && offered.length === 0) {
      return <Text style={styles.sectionEmpty}>Your library is empty right now.</Text>;
    }

    return (
      <>
        {renderPendingOffers()}
        {hasContent && (
          <View style={styles.section}>
            <TabHeading title="Your content" count={mergedContent.length} />
            {mergedContent.map(renderMergedContentRow)}
          </View>
        )}
        {hasWaiting && (
          <View style={styles.section}>
            <TabHeading title="Premium waiting" count={waiting.length} />
            {renderWaitingQueue()}
          </View>
        )}
      </>
    );
  }

  function renderBorrowedTab(): ReactNode {
    if (holdingsLoading) return <HoldingsSkeleton />;
    const count = subscriptionLoans.length;
    return (
      <>
        <TabHeading title="Borrowed" count={count} />
        {count > 0 && renderSubscriptionLoans()}
        <TabHint
          icon="library-outline"
          headline={count === 0 ? 'No items currently borrowed.' : undefined}
          caption="Items you borrow will appear here until they’re due."
        />
      </>
    );
  }

  function renderDownloadsTab(): ReactNode {
    const count = downloads.length;
    // `downloadsSummaryLabel` restates the same count on its own ("1 item")
    // when no download reported a size — `TabHeading`'s count already says
    // that, so the caption only earns its own line when it adds the size
    // ("· 22.8 MB") on top.
    const sizeLabel = downloadsSummaryLabel(downloads);
    const showSizeCaption = sizeLabel !== undefined && sizeLabel.includes('·');
    return (
      <>
        <TabHeading title="Downloads" count={count} />
        {count > 0 && (
          <>
            {showSizeCaption && <Text style={styles.sizeCaption}>{sizeLabel}</Text>}
            {renderDownloadRows()}
          </>
        )}
        <TabHint
          icon="download-outline"
          headline={count === 0 ? 'No downloads yet.' : undefined}
          caption="Only items you’ve downloaded will appear here."
        />
      </>
    );
  }

  function renderBookmarksTab(): ReactNode {
    const count = bookmarkGroups.length;
    return (
      <>
        <TabHeading title="Bookmarks" count={count} />
        {count > 0 && renderBookmarkGroups()}
        <TabHint
          icon="bookmark-outline"
          headline={count === 0 ? 'No bookmarked pages yet.' : undefined}
          caption="Pages you bookmark while reading will appear here."
        />
      </>
    );
  }

  function renderPremiumTab(): ReactNode {
    if (holdingsLoading) return <HoldingsSkeleton />;
    return (
      <>
        {/* Never a reserved empty slot — product spec §4: "If there is no
            pending access notification/action... do NOT reserve an empty
            area for it." */}
        {offered.length > 0 && (
          <View style={styles.section}>
            <TabHeading title="Access available" count={offered.length} />
            {renderPendingOffers()}
          </View>
        )}

        <View style={styles.section}>
          <TabHeading title="Your Elite access" count={eliteLoans.length} />
          {eliteLoans.length > 0 ? (
            renderEliteActiveLoans()
          ) : (
            <TabHint
              icon="crown-outline"
              headline="No active Elite access."
              caption="When you have access, your titles will appear here."
              iconSet="material"
            />
          )}
        </View>

        <View style={styles.section}>
          <TabHeading title="Waiting for access" count={waiting.length} />
          {waiting.length > 0 ? (
            renderWaitingQueue()
          ) : (
            <TabHint
              icon="hourglass-outline"
              headline="No items currently waiting."
              caption="Titles waiting for Elite access will appear here."
            />
          )}
        </View>
      </>
    );
  }

  return (
    <View style={styles.screen} testID="library-screen">
      <OfflineBanner visible={!isOnline} />

      {/* PINNED ABOVE THE SCROLL: a heading and a filter that scrolled away
          would leave a reader deep in Bookmarks with no way back to the
          overview but a flick to the top. */}
      <View style={styles.headerBlock}>
        <Text style={styles.libraryHeading}>Library</Text>
        <Text style={styles.librarySubtitle}>Your scholarly content and access in one place.</Text>
        {/* A real, accurate caveat, not a hedge — a downloaded title's bytes
            stay on this phone, but the LICENCE behind them is checked and
            can lapse automatically the next time the app syncs, even if
            that sync happens while the device is offline (a queued check
            resolving the moment connectivity returns). Telling the reader
            this in advance is cheaper than them discovering a "still
            downloaded" book that no longer opens — see `DownloadRow`'s own
            comment on why this screen cannot promise a download stays
            readable. */}
        <View style={styles.disclaimer}>
          <Ionicons name="information-circle-outline" size={type.smallLabel.size} color={color.textSecondary} />
          <Text style={styles.disclaimerText}>
            Access is checked automatically and can expire even while you’re offline.
          </Text>
        </View>
      </View>

      <View style={styles.tabBar}>
        <Tabs
          tabs={LIBRARY_TABS}
          activeId={activeTab}
          variant="pills"
          // The five partitions are fixed, so the bar is a control with a known
          // width rather than a strip that continues off-screen.
          fill
          onChange={(id) => setActiveTab(id as LibraryTabId)}
        />
      </View>

      {/* PINNED, not inside the scroll: feedback for a tap the reader just made
          on a row that may be well below the fold. */}
      {(openNotice !== undefined || actionNotice !== undefined) && (
        <Text style={[styles.notice, styles.pinnedNotice]} testID="library-open-notice">
          {openNotice ?? actionNotice}
        </Text>
      )}

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

        {activeTab === 'all' && renderAllTab()}
        {activeTab === 'loans' && renderBorrowedTab()}
        {activeTab === 'downloads' && renderDownloadsTab()}
        {activeTab === 'bookmarks' && renderBookmarksTab()}
        {activeTab === 'holds' && renderPremiumTab()}
      </ScrollView>
    </View>
  );
}

// ─── loading ─────────────────────────────────────────────────────────────────

function HoldingsSkeleton() {
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

// ─── heading + hint ──────────────────────────────────────────────────────────

// A tab's own name, restated as a page heading, with a real count beside it
// when non-zero — see the file header for why this replaced a badge on the
// tab pill itself. `count === undefined` and `count === 0` both draw no
// number: a heading with "0 items" reads as an apology, where the hint
// block below already says the same thing at greater length.
function TabHeading({ title, count }: { title: string; count?: number }) {
  // A stable, title-derived testID — the tab pill and an Elite card can both
  // carry the exact same words ("Bookmarks", "Access available"), and a test
  // asserting on this specific heading needs a way to say which one it means.
  const testId = `tab-heading-${title.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <View style={styles.tabHeadingRow}>
      <Text testID={testId} style={styles.tabHeadingTitle}>
        {title}
      </Text>
      {count !== undefined && count > 0 && (
        <Text testID={`${testId}-count`} style={styles.tabHeadingCount}>
          {count === 1 ? '1 item' : `${count} items`}
        </Text>
      )}
    </View>
  );
}

// The compact, permanent footer under a single-purpose tab — see the file
// header's "A QUIET HINT" note. `headline` is optional and appears ONLY for
// the genuinely-empty case; a non-empty tab still gets the plain `caption`
// underneath its real rows, unchanged, so the explanation of what this tab
// is for never disappears just because it now has something in it.
function TabHint({
  icon,
  headline,
  caption,
  iconSet = 'ionicons',
}: {
  icon: string;
  headline?: string;
  caption: string;
  iconSet?: 'ionicons' | 'material';
}) {
  return (
    <View style={styles.hint}>
      <View style={styles.hintIconWrap}>
        {iconSet === 'material' ? (
          // Only `crown-outline` (Elite) needs MaterialCommunityIcons — every
          // other hint icon is a plain Ionicon, same as the rest of this file.
          <MaterialCommunityIcons
            name={icon as ComponentProps<typeof MaterialCommunityIcons>['name']}
            size={type.pageTitle.size}
            color={color.primary}
          />
        ) : (
          <Ionicons
            name={icon as ComponentProps<typeof Ionicons>['name']}
            size={type.pageTitle.size}
            color={color.primary}
          />
        )}
      </View>
      {headline !== undefined && <Text style={styles.hintHeadline}>{headline}</Text>}
      <Text style={styles.hintCaption}>{caption}</Text>
    </View>
  );
}

// ─── rows ────────────────────────────────────────────────────────────────────

// The mockup's "Reading Now" card, minus the one thing this app cannot know:
// the reading PROGRESS (percent, page x/y, "28 min left") lives behind CAP-7's
// reader, which is not in this repo, so inventing "64%" would be exactly the
// over-show the rest of this screen refuses. What the card CAN carry is real
// — the cover, the file format, the access tier, and the due date — so it
// carries those and stops there.
//
// SUBSCRIPTION LOANS ONLY reach this row now — an Elite loan uses
// `EliteLoanRow` instead, for its own Elite-flavoured badge (a fixed
// "Access expires" + ELITE-tier pair rather than the tier-from-summary
// badge below).
function BorrowedBookRow({
  loan,
  title,
  publisher,
  summary,
  clock,
  onPress,
}: {
  loan: Loan;
  title: string;
  publisher?: string;
  summary?: BookSummary;
  clock: ServerClock;
  /** Tap → this item's detail page. */
  onPress: () => void;
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
    <ContentCard
      title={title}
      onPress={onPress}
      {...(publisher === undefined ? {} : { publisher })}
      {...(summary?.coverUrl === undefined ? {} : { imageUrl: summary.coverUrl })}
      {...(summary?.format === undefined ? {} : { format: summary.format })}
      {...(badge === undefined ? {} : { badge })}
    />
  );
}

// An Elite title the reader currently holds — access already granted, not
// queued. Same card as every other row on this screen (CONVENTIONS §7: one
// row shape, not a component per business state) — only the badge differs.
//
// FORMERLY ITS OWN COMPONENT (`EliteActiveAccessCard`), NOW RETIRED. That
// version drew its cover with plain RN `Image` and no `onError` fallback, so
// a signed URL that failed to load (this app's known cloud-storage rate-limit
// issue) rendered a blank box instead of `ContentCard`'s placeholder icon —
// a real, visible inconsistency between an Elite row and every other row on
// this same screen. Routing through `ContentCard` fixes that for free, since
// there is now only one image-loading path to keep correct.
function EliteLoanRow({
  loan,
  title,
  publisher,
  summary,
  clock,
  onPress,
}: {
  loan: Loan;
  title: string;
  publisher?: string;
  summary?: BookSummary;
  clock: ServerClock;
  /** Tap → this item's detail page. */
  onPress: () => void;
}) {
  const expiresLabel =
    clock.ready && loan.expiresAt !== undefined ? dueLabel(loan, clock.offsetMs, clock.nowMs) : undefined;
  return (
    <ContentCard
      title={title}
      onPress={onPress}
      {...(publisher === undefined ? {} : { publisher })}
      {...(summary?.coverUrl === undefined ? {} : { imageUrl: summary.coverUrl })}
      {...(summary?.format === undefined ? {} : { format: summary.format })}
      badge={
        <View style={styles.badgeStack}>
          {expiresLabel !== undefined && (
            <Text style={styles.badgeLabel}>{`Access expires: ${expiresLabel}`}</Text>
          )}
          <AccessTierBadge tier="ELITE" size="sm" />
        </View>
      }
    />
  );
}

// An Elite title the reader is waiting for — a real place in a real queue,
// same card and same "formerly its own component" reasoning as
// `EliteLoanRow` above (the retired `EliteQueueCard` had the identical
// blank-cover-on-load-failure bug). `progress` is `ContentCard`'s own slot
// for exactly this fraction — see that file's header comment on why it takes
// an already-derived number rather than computing one itself.
function EliteQueueRow({
  title,
  imageUrl,
  format,
  queueLabel: label,
  progressFraction,
  onPress,
}: {
  title: string;
  imageUrl?: string;
  format?: string;
  /** "#3 of 7" — see `queueLabel`. Absent renders no line. */
  queueLabel?: string;
  /** 0–1 fill toward the front — see `queueProgressFraction`. Absent draws no bar. */
  progressFraction?: number;
  /** Tap → this item's detail page. */
  onPress: () => void;
}) {
  return (
    <ContentCard
      title={title}
      onPress={onPress}
      {...(imageUrl === undefined ? {} : { imageUrl })}
      {...(format === undefined ? {} : { format })}
      badge={
        <View style={styles.badgeStack}>
          {label !== undefined && <Text style={styles.badgeLabel}>{label}</Text>}
          <AccessTierBadge tier="ELITE" size="sm" />
        </View>
      }
      {...(progressFraction === undefined ? {} : { progress: progressFraction })}
    />
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
  onPress,
}: {
  record: DownloadRecord;
  title: string;
  publisher?: string;
  summary?: BookSummary;
  /** Tap → this item's detail page. */
  onPress: () => void;
}) {
  return (
    <ContentCard
      title={title}
      onPress={onPress}
      {...(publisher === undefined ? {} : { publisher })}
      {...(summary?.coverUrl === undefined ? {} : { imageUrl: summary.coverUrl })}
      // The format is the book's real type from the batch call; the
      // "Downloaded" badge stays on `downloadedLabel`'s own honest wording.
      {...(summary?.format === undefined ? {} : { format: summary.format })}
      badge={<Text style={styles.badgeLabel}>{downloadedLabel(record)}</Text>}
    />
  );
}

// One book's worth of bookmarks, collapsed to a title row until tapped.
//
// GROUPED, NOT ONE ROW PER BOOKMARK. The count badge is
// `group.bookmarks.length`, the same array the expansion below renders, so
// the two cannot disagree.
function BookmarkGroupRow({
  group,
  title,
  expanded,
  alreadyDownloaded,
  downloading,
  onToggle,
  onRead,
  onDownload,
}: {
  group: BookmarkGroup;
  title: string;
  expanded: boolean;
  alreadyDownloaded: boolean;
  downloading: boolean;
  onToggle: () => void;
  /** Tap → resume at the group's most recent bookmark. */
  onRead: () => void;
  onDownload: () => void;
}) {
  const count = group.bookmarks.length;
  return (
    <View>
      <ContentCard
        title={title}
        onPress={onToggle}
        badge={<Text style={styles.badgeLabel}>{count === 1 ? '1 bookmark' : `${count} bookmarks`}</Text>}
      />

      {expanded && (
        <View testID={`bookmark-group-${group.bookId}`} style={styles.bookmarkExpansion}>
          {group.bookmarks.map((bookmark, index) => {
            // A reader-typed name outranks a raw position — see
            // `bookmarkLocationLabel`'s own comment on why an EPUB CFI never
            // reaches the screen as text. Neither is invented: a bookmark with
            // no name and no derivable position renders its ordinal alone.
            const label = bookmark.name ?? bookmarkLocationLabel(bookmark);
            return (
              <Text key={bookmark.id} style={styles.bookmarkLine}>
                {String(index + 1).padStart(2, '0')}
                {label !== undefined ? `  ${label}` : ''}
              </Text>
            );
          })}

          <View style={styles.bookmarkActions}>
            <View style={styles.actionSlot}>
              <ActionButton action="read" onPress={onRead} />
            </View>
            {!alreadyDownloaded && (
              <View style={styles.actionSlot}>
                <ActionButton action="download" state={downloading ? 'loading' : 'idle'} onPress={onDownload} />
              </View>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

// A bookmark's stored `Locator` → the reader target that reaches it, mirroring
// Team 4's `toTarget` (readerBookmarks.ts). EPUB anchors by CFI, PDF by page —
// the two schemes `ReaderTargetLike` carries. AUDIO has neither (matches the real
// `toTarget`, which also returns null for AUDIO locators) — `openBookmark`'s
// `target` param is optional, so callers fall back to the stored reading position.
function bookmarkTarget(locator: Bookmark['locator']): ReaderTargetLike | undefined {
  if (locator.type === 'EPUB') {
    return { kind: 'href', href: locator.cfi };
  }
  if (locator.type === 'PDF') {
    return { kind: 'page', page: locator.page };
  }
  return undefined;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.white },
  headerBlock: {
    paddingHorizontal: space.md,
    paddingTop: space.md,
    gap: space.xs,
  },
  // Aleo, compact — the screen's own editorial heading, distinct from the
  // shared navy TopAppBar's own "Library" title (Open Sans, UI chrome). Sized
  // below `editorialTitle` (the Catalogue hero's own headline): this is a
  // utility screen's page heading, not a promotional banner.
  libraryHeading: {
    fontFamily: type.cardTitle.fontFamily,
    fontSize: type.pageTitle.size,
    lineHeight: type.pageTitle.lineHeight,
    letterSpacing: -0.3,
    color: color.textPrimary,
  },
  librarySubtitle: {
    fontFamily: type.body.fontFamily,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: color.textSecondary,
  },
  // A small, permanent caveat — not a coloured banner like `OfflineBanner`,
  // which is transient chrome for a real connectivity change. This is a
  // standing fact about how licences work, so it stays quiet and always
  // there rather than appearing/disappearing with the network.
  disclaimer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.xs,
    marginTop: space.xs / 2,
  },
  disclaimerText: {
    flex: 1,
    fontFamily: type.meta.fontFamily,
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
    color: color.textSecondary,
  },
  // The bar owns its own inset because `Tabs` sets no outer margin, by its own
  // rule — the screen places the control. A touch of trailing room keeps the
  // last pill ("Premium") from sitting flush against the scroll edge.
  tabBar: { paddingHorizontal: space.md, paddingTop: space.sm },
  scroll: { flex: 1 },
  content: { padding: space.md },
  section: { gap: space.sm, marginBottom: space.md },
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
    fontFamily: type.smallLabel.fontFamily,
    fontSize: type.smallLabel.size,
    lineHeight: type.smallLabel.lineHeight,
  },
  // The pinned open-notice sits outside the scroll's content padding, so it
  // carries its own horizontal inset to line up with the tab bar above it.
  pinnedNotice: {
    marginHorizontal: space.md,
    marginTop: space.sm,
  },
  sectionEmpty: {
    paddingHorizontal: space.xs,
    paddingTop: space.xs,
    color: color.textSecondary,
    fontFamily: type.meta.fontFamily,
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
  },
  // A tab's own restated name, Aleo, with its real count on the same line —
  // see `TabHeading`'s own comment.
  tabHeadingRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  tabHeadingTitle: {
    fontFamily: type.sectionHeader.fontFamily,
    fontSize: type.sectionHeader.size,
    lineHeight: type.sectionHeader.lineHeight,
    color: color.textPrimary,
  },
  tabHeadingCount: {
    fontFamily: type.meta.fontFamily,
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
    color: color.textSecondary,
  },
  // The download total ("2 items · 22.8 MB") — a plain caption line under
  // the heading, not a pill: `TabHeading`'s own count already carries the
  // pill-shaped emphasis for "how many"; this line only adds the size.
  sizeCaption: {
    marginTop: -space.xs,
    marginBottom: space.xs,
    fontFamily: type.meta.fontFamily,
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
    color: color.textSecondary,
  },
  // The due date and the tier pill on a Borrowed row, side by side and
  // wrapping to a second line on a narrow phone rather than pushing either off.
  badgeStack: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.xs,
  },
  // ONE STYLE FOR EVERY ROW BADGE — a due date, a downloaded marker and a
  // bookmark count are three different sentences in the same slot, and they
  // looked identical because they ARE the same thing: the row's secondary
  // line. Byte-identical copies invited one of them drifting.
  badgeLabel: {
    color: color.textSecondary,
    fontFamily: type.smallLabel.fontFamily,
    fontSize: type.smallLabel.size,
    lineHeight: type.smallLabel.lineHeight,
  },
  // A bookmark group's own expansion — indented under the row it belongs to,
  // rather than a new card, so it reads as "inside this title" and not as a
  // sibling row of its own.
  bookmarkExpansion: {
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    paddingBottom: space.xs,
    gap: space.xs,
  },
  bookmarkLine: {
    fontFamily: type.body.fontFamily,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: color.textPrimary,
  },
  bookmarkActions: {
    flexDirection: 'row',
    gap: space.sm,
    marginTop: space.xs,
  },
  actionSlot: {
    flex: 1,
  },
  // The permanent, compact footer under every single-purpose tab — see
  // `TabHint`'s own comment. Centred and quiet: this is a caption, not a
  // second empty-state card competing with real content above it.
  hint: {
    alignItems: 'center',
    paddingVertical: space.lg,
    gap: space.xs,
  },
  hintIconWrap: {
    width: space.xl * 1.5,
    height: space.xl * 1.5,
    borderRadius: radius.pill,
    backgroundColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.xs,
  },
  hintHeadline: {
    fontFamily: type.sectionHeader.fontFamily,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: color.textPrimary,
    textAlign: 'center',
  },
  hintCaption: {
    fontFamily: type.body.fontFamily,
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
    color: color.textSecondary,
    textAlign: 'center',
    maxWidth: '80%',
  },
});
