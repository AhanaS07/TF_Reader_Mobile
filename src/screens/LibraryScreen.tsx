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
// Sept 2026). The tab rail is now real navigation — each tab renders a
// DIFFERENT view of the same underlying data, not a filtered slice of one
// long scroll with a "See all". Five tabs:
//
//   All       — a genuine overview: a pending Elite offer first if one
//               exists, then the reader's actual holdings composed together
//               ("Your library"), never as five headed sub-sections.
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
// THE THREE ELITE-STATE CARDS ARE SHARED BETWEEN `All` AND `Premium` —
// `ElitePendingAccessCard`, `EliteActiveAccessCard`, `EliteQueueCard` — one
// implementation of each business state, composed into both views, per the
// product spec's own instruction not to build the Elite logic twice.
//
// ACCEPT/DECLINE NOW LIVE ON THE CARD ITSELF, via the same
// `getLicenceSource().acceptOffer`/`.cancelHold` calls `ItemDetailScreen`
// already makes for the identical actions on its own ActionBar. This is not
// a new implementation of the two buttons — `ActionButton` still owns their
// label/icon/emphasis — and it deliberately does not silence
// `QueueNotificationHost`'s floating banner for the same offer:
// `ItemDetailScreen` already shows Accept/Decline inline WHILE that banner
// can also be on screen, and there is no suppression mechanism for that
// today. This screen now follows the identical, already-precedented shape.
//
// TAB COUNTS ARE REAL, NEVER INVENTED. Where a badge appears on a tab
// (Borrowed/Downloads/Bookmarks/Premium — never `All`, where one number
// could not honestly describe five different kinds of row), it is the exact
// length of the array that tab renders, computed the same render as the
// content it counts.
//
// NO COMPONENT ON THIS SCREEN READS A CLOCK. Every countdown or due date is a
// difference against the `serverTime` that arrived with the holdings.
// `Date.now()` is called only inside `@hooks/useServerClock`, and only ever
// to measure an ELAPSED interval between two readings of the same clock —
// safe even when that clock is wrong. A device five minutes fast must not
// show an offer dying five minutes early, because the reader then abandons a
// copy that is still theirs.
//
// UNDER-SHOW, NEVER OVER-SHOW. An unhydrated loan is bucketed as subscription
// rather than briefly claiming Elite (see `partitionLoansByTier`), and an
// offer whose expiry cannot be read still renders rather than being hidden —
// the same rule this screen has always applied.
//
// TITLES ARE HYDRATED, NOT STORED. `getLibrary` carries item ids; titles,
// covers, formats and access tiers come from ONE `getItemsBatch` call. A
// title that fails to arrive leaves the row rendered against its id with a
// retry, because the reader still has the book — a title is decoration,
// possession is not.
//
// ─── WHAT IS DELIBERATELY NOT HERE ──────────────────────────────────────────
//
// A NEW ROUTE FOR A TITLE'S BOOKMARKS. The product spec's own mockup calls it
// "the bookmark view for that title", but the shape it actually needs — a
// short, real list under the title that was just tapped — is exactly what an
// in-place expansion already shows, at the cost of zero new navigation. A
// pushed screen that rendered the same rows would be CONVENTIONS §7's "second
// place that renders a bookmark row".
//
// A DOWNLOAD SIZE, A DOWNLOAD DATE, A READING-PROGRESS PERCENT, A LOAN
// DURATION, AN ESTIMATED WAIT. None of these are in the data this screen can
// see — seen `downloadedLabel`, `dueLabel` and `queueProgressFraction`'s own
// comments in `LibraryScreen.holdings.ts` for exactly which fields the
// contract drops and why guessing one would be worse than omitting it.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { Bookmark } from '@/shared/contracts';
import { useLibraryProvider } from '@/features/library/context';
import { ReaderUnavailableError } from '@/features/library/ports';
import type { ContentFormat, ReaderTargetLike } from '@/features/library/ports';
import { AccessTierBadge } from '@components/AccessTierBadge';
import { ActionButton } from '@components/ActionButton';
import { ContentCard } from '@components/ContentCard';
import { EliteActiveAccessCard } from '@components/EliteActiveAccessCard';
import { ElitePendingAccessCard } from '@components/ElitePendingAccessCard';
import { EliteQueueCard } from '@components/EliteQueueCard';
import { OfflineBanner } from '@components/OfflineBanner';
import { SectionHeader } from '@components/SectionHeader';
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
  offerExpiryLabel,
  offerMinutesRemaining,
  partitionHolds,
  partitionLoansByTier,
  queueLabel,
  queueProgressFraction,
  sortedBookmarks,
  sortedDownloads,
} from './LibraryScreen.holdings';

// How often the offer/queue countdowns re-render. A minute is the resolution
// `QueueNotification` displays, so ticking faster would re-render the tree for
// a label that cannot change. Ticking slower would let "Expiring now" arrive up
// to a minute late, and the last minute is the one that matters.
const TICK_MS = 30_000;

// The holdings skeleton's row count — a plausible shape for a shelf whose
// length is not yet known, not a count of anything real.
const SKELETON_ROWS = 2;

// A single shared empty map, so "no titles yet" is the same object on every
// render. A fresh `new Map()` would be a new identity each time and re-run
// anything downstream that compares it.
const EMPTY_TITLES: Map<string, BookSummary> = new Map();

type LibraryTabId = 'all' | 'loans' | 'downloads' | 'bookmarks' | 'holds';

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
  // The seam to the reader/download stack (Team 4's, merged later). Defaults to a
  // stand-in whose `openBook` politely refuses — so a tapped row shows an honest
  // "not yet" rather than opening nothing. See `@/features/library`.
  const provider = useLibraryProvider();

  // Titles for the ids the holdings carry. Empty until a batch call lands; a
  // row with no entry renders against its id, which is the documented fallback
  // rather than a missing state.
  const [titles, setTitles] = useState<Map<string, BookSummary>>(EMPTY_TITLES);
  const [hydrationFailed, setHydrationFailed] = useState(false);
  // LOCAL, NOT ROUTE STATE — same reasoning as before: a filter is not worth a
  // back-stack entry, and it resets to the overview when the reader returns.
  const [activeTab, setActiveTab] = useState<LibraryTabId>('all');
  // A transient line shown when a tap can't open a book yet — the reader isn't in
  // this build. Cleared on a successful open once the real provider is mounted.
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
  // the product spec's own mockup shows one title's bookmarks at a time, and
  // a reader flicking between several would otherwise stack every group's
  // rows into one very long screen.
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

  // Borrowed means subscription loans only — Elite is a different tier with a
  // different lifecycle. See `partitionLoansByTier`'s own comment.
  const { subscriptionLoans, eliteLoans } = partitionLoansByTier(live, (itemId) => summaryFor(itemId)?.accessTier);
  const bookmarkGroups = groupBookmarksByTitle(bookmarks);

  // Guards against a second tap while an open is in flight — with the real
  // provider two concurrent `openBook` calls would race a licence session. A ref
  // rather than state so it takes effect synchronously and never re-renders; read
  // only inside this callback, never during render.
  const openingRef = useRef(false);

  // Open a book through the provider: the licence gate (`openBook`) THEN the
  // reader (`openReader`) — never one without the other, and the screen decides
  // no access itself. Today the stand-in's `openBook` throws `ReaderUnavailableError`,
  // so this lands on the honest notice; at merge the same path opens for real.
  const openItem = useCallback(
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
        // — must propagate rather than be disguised as "coming soon". At merge,
        // that branch becomes the `DownloadFailure.code` → copy mapping (see
        // INTEGRATION.md), not a rethrow.
        if (err instanceof ReaderUnavailableError) {
          setOpenNotice('Reading opens here once the reader ships in the merged app.');
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

  const libraryTabs: TabItem[] = [
    { id: 'all', label: 'All' },
    // Shown as "Borrowed"; the id stays `loans` because that is the partition
    // it selects. Not "Borrowed Books" — the shelf holds books, journals and
    // audiobooks alike, and the label must not name just one of them. The
    // count is subscription loans only, matching what the tab itself shows.
    { id: 'loans', label: 'Borrowed', count: subscriptionLoans.length },
    { id: 'downloads', label: 'Downloads', count: downloads.length },
    { id: 'bookmarks', label: 'Bookmarks', count: bookmarkGroups.length },
    // Shown as "Premium"; the id stays `holds` because that is the partition
    // it selects (Offered + Elite loans + Waiting). The count spans all three
    // Elite states this tab shows, in the same order it shows them.
    { id: 'holds', label: 'Premium', count: offered.length + eliteLoans.length + waiting.length },
  ];

  function renderPendingOffers(): ReactNode {
    // Nothing is wrong when this is empty — most readers are never mid-offer
    // — so nothing renders at all rather than reserving an empty area for it
    // (product spec §4: "do NOT reserve an empty area for it").
    return offered.map((hold) => {
      const holdId = hold.holdId;
      if (holdId === undefined) return null;
      const minutes = clock.ready ? offerMinutesRemaining(hold, clock.offsetMs, clock.nowMs) : undefined;
      const pending = pendingHoldAction?.holdId === holdId ? pendingHoldAction.action : undefined;
      return (
        <View key={holdId} style={styles.row}>
          <ElitePendingAccessCard
            title={titleFor(hold.itemId)}
            expiryLabel={offerExpiryLabel(minutes)}
            pending={pending}
            onAccept={() => handleAcceptOffer(holdId)}
            onReject={() => handleRejectOffer(holdId)}
          />
        </View>
      );
    });
  }

  function renderEliteActiveLoans(): ReactNode {
    return eliteLoans.map((loan) => {
      const summary = summaryFor(loan.itemId);
      const expiresLabel =
        clock.ready && loan.expiresAt !== undefined ? dueLabel(loan, clock.offsetMs, clock.nowMs) : undefined;
      return (
        <View key={loan.loanId ?? loan.itemId} style={styles.row}>
          <EliteActiveAccessCard
            title={titleFor(loan.itemId)}
            {...(summary?.coverUrl === undefined ? {} : { imageUrl: summary.coverUrl })}
            {...(summary?.format === undefined ? {} : { format: summary.format })}
            {...(expiresLabel === undefined ? {} : { expiresLabel })}
            onRead={() => void openItem(loan.itemId, summary?.format)}
          />
        </View>
      );
    });
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
          onRead={() => void openItem(loan.itemId, summaryFor(loan.itemId)?.format)}
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
          onOpen={() => void openItem(record.itemId, summaryFor(record.itemId)?.format)}
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
            void openItem(group.bookId, mostRecent.locator.type, bookmarkTarget(mostRecent.locator));
          }}
          onDownload={() => handleDownloadBookmarkedTitle(group.bookId)}
        />
      </View>
    ));
  }

  function renderWaitingQueue(): ReactNode {
    return waiting.map((hold) => (
      <View key={hold.holdId ?? hold.itemId} style={styles.row}>
        <EliteQueueCard
          title={titleFor(hold.itemId)}
          {...(summaryFor(hold.itemId)?.coverUrl === undefined
            ? {}
            : { imageUrl: summaryFor(hold.itemId)?.coverUrl })}
          {...(summaryFor(hold.itemId)?.format === undefined ? {} : { format: summaryFor(hold.itemId)?.format })}
          {...(queueLabel(hold) === undefined ? {} : { queueLabel: queueLabel(hold) })}
          {...(queueProgressFraction(hold) === undefined
            ? {}
            : { progressFraction: queueProgressFraction(hold) })}
        />
      </View>
    ));
  }

  function renderAllTab(): ReactNode {
    const hasHoldings =
      eliteLoans.length > 0 ||
      subscriptionLoans.length > 0 ||
      downloads.length > 0 ||
      bookmarkGroups.length > 0 ||
      waiting.length > 0;

    if (holdingsLoading) {
      return (
        <>
          {renderPendingOffers()}
          <HoldingsSkeleton />
        </>
      );
    }

    if (!hasHoldings && offered.length === 0) {
      return <Text style={styles.sectionEmpty}>Your library is empty right now.</Text>;
    }

    return (
      <>
        {renderPendingOffers()}
        {hasHoldings && (
          <View style={styles.section}>
            <SectionHeader title="Your library" emphasis="editorial" />
            {renderEliteActiveLoans()}
            {renderSubscriptionLoans()}
            {renderDownloadRows()}
            {renderBookmarkGroups()}
            {renderWaitingQueue()}
          </View>
        )}
      </>
    );
  }

  function renderBorrowedTab(): ReactNode {
    if (holdingsLoading) return <HoldingsSkeleton />;
    if (subscriptionLoans.length === 0) {
      return <Text style={styles.sectionEmpty}>No items currently borrowed.</Text>;
    }
    return <>{renderSubscriptionLoans()}</>;
  }

  function renderDownloadsTab(): ReactNode {
    if (downloads.length === 0) {
      return (
        <Text style={styles.sectionEmpty}>
          Open access and subscription books you download will be readable here offline.
        </Text>
      );
    }
    return (
      <>
        <Text style={styles.sectionCaption}>{downloadsSummaryLabel(downloads)}</Text>
        {renderDownloadRows()}
      </>
    );
  }

  function renderBookmarksTab(): ReactNode {
    if (bookmarkGroups.length === 0) {
      return <Text style={styles.sectionEmpty}>No bookmarked pages yet.</Text>;
    }
    return <>{renderBookmarkGroups()}</>;
  }

  function renderPremiumTab(): ReactNode {
    if (holdingsLoading) return <HoldingsSkeleton />;
    const total = offered.length + eliteLoans.length + waiting.length;
    if (total === 0) {
      return <Text style={styles.sectionEmpty}>No Elite content currently available.</Text>;
    }
    return (
      <>
        {renderPendingOffers()}
        {renderEliteActiveLoans()}
        {renderWaitingQueue()}
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
      </View>

      <View style={styles.tabBar}>
        <Tabs
          tabs={libraryTabs}
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

// ─── rows ────────────────────────────────────────────────────────────────────

// The mockup's "Reading Now" card, minus the one thing this app cannot know:
// the reading PROGRESS (percent, page x/y, "28 min left") lives behind CAP-7's
// reader, which is not in this repo, so inventing "64%" would be exactly the
// over-show the rest of this screen refuses. What the card CAN carry is real
// — the cover, the file format, the access tier, and the due date — so it
// carries those and stops there.
//
// SUBSCRIPTION LOANS ONLY reach this row now — an Elite loan is
// `EliteActiveAccessCard`'s, drawn by its own caller in `LibraryScreen.tsx`.
function BorrowedBookRow({
  loan,
  title,
  publisher,
  summary,
  clock,
  onRead,
}: {
  loan: Loan;
  title: string;
  publisher?: string;
  summary?: BookSummary;
  clock: ServerClock;
  onRead: () => void;
}) {
  // Held back until the clock has a sample, for the same reason the offer
  // countdown is. A due date is far less urgent than an offer, but a row that
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
      {...(publisher === undefined ? {} : { publisher })}
      {...(summary?.coverUrl === undefined ? {} : { imageUrl: summary.coverUrl })}
      {...(summary?.format === undefined ? {} : { format: summary.format })}
      {...(badge === undefined ? {} : { badge })}
      action={<ActionButton action="read" onPress={onRead} />}
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
  onOpen,
}: {
  record: DownloadRecord;
  title: string;
  publisher?: string;
  summary?: BookSummary;
  /** Tap → open through the provider seam (see `openItem`). */
  onOpen: () => void;
}) {
  return (
    <ContentCard
      title={title}
      onPress={onOpen}
      {...(publisher === undefined ? {} : { publisher })}
      {...(summary?.coverUrl === undefined ? {} : { imageUrl: summary.coverUrl })}
      // The "PDF · Downloaded" split from the mockup: the format is the book's
      // real type from the batch call, and the size stays on the "Downloaded"
      // badge where `downloadedLabel` owns the honest wording.
      {...(summary?.format === undefined ? {} : { format: summary.format })}
      badge={<Text style={styles.badgeLabel}>{downloadedLabel(record)}</Text>}
    />
  );
}

// One book's worth of bookmarks, collapsed to a title row until tapped.
//
// GROUPED, NOT ONE ROW PER BOOKMARK — product spec, Sept 2026. The count badge
// is `group.bookmarks.length`, the same array the expansion below renders, so
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
  /** Tap → open at the group's most recent bookmark. */
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
// `toTarget`, which also returns null for AUDIO locators) — `openItem`'s `target`
// param is optional, so callers fall back to the stored reading position.
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
  // The bar owns its own inset because `Tabs` sets no outer margin, by its own
  // rule — the screen places the control.
  tabBar: { paddingHorizontal: space.md, paddingTop: space.sm },
  scroll: { flex: 1 },
  content: { padding: space.md },
  section: { gap: space.sm },
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
  // A line of explanation, not an error: compact and quiet — product spec
  // §12's own rule against a large empty area. Indented to the row inset so
  // the copy hangs at the same margin a card's own text would.
  sectionEmpty: {
    paddingHorizontal: space.xs,
    paddingTop: space.xs,
    color: color.textSecondary,
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
    fontFamily: type.meta.fontFamily,
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
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
});
