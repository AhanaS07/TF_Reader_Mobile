// The personal library — CAP-4 Module E (Library & Sync), flambeau.
//
// The screen the app opens on for a signed-in reader: what they are holding,
// and what they are standing in line for. It renders `GET /api/v1/library`,
// which this repo reaches through `LicenceSource.getLibrary()` rather than
// through HTTP — see `src/licence/`.
//
// THREE SECTIONS, IN THIS ORDER, AND THE ORDER IS A DECISION RATHER THAN A
// LAYOUT PREFERENCE:
//
//   1 · Offered to you — loudest, and first. It is the only list that dies. A
//       reader who misses the countdown loses a book they queued for and the
//       queue moves on without them, so anything below the fold here is a lost
//       book.
//   2 · On loan        — what the reader came to the app to do: open a book.
//   3 · Waiting        — reassurance, not action. Nothing here expires.
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
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ContentCard } from '@components/ContentCard';
import { EmptyState } from '@components/EmptyState';
import { OfflineBanner } from '@components/OfflineBanner';
import { SectionHeader } from '@components/SectionHeader';
import { Skeleton } from '@components/Skeleton';
import { getCatalogueSource } from '@config/catalogue';
import { useNetworkStatus } from '@hooks/useNetworkStatus';
import { type ServerClock, useServerClock } from '@hooks/useServerClock';
import type { BookSummary, Hold, Loan } from '@model/types';
import { useLibraryStore } from '@store/libraryStore';
import { color, radius, space, type } from '@theme/tokens';

import {
  activeLoans,
  collectItemIds,
  dueLabel,
  offerExpiryLabel,
  offerMinutesRemaining,
  partitionHolds,
  queueLabel,
} from './LibraryScreen.holdings';

// How often the offer countdowns re-render. A minute is the resolution
// `QueueNotification` displays, so ticking faster would re-render the tree for
// a label that cannot change. Ticking slower would let "Expiring now" arrive up
// to a minute late, and the last minute is the one that matters.
const TICK_MS = 30_000;

// Enough rows to fill a phone screen. The skeleton stands in for a shelf whose
// length is not yet known, so this is a plausible shape rather than a count of
// anything.
const SKELETON_ROWS = 3;

// A single shared empty map, so "no titles yet" is the same object on every
// render. A fresh `new Map()` would be a new identity each time and re-run
// anything downstream that compares it.
const EMPTY_TITLES: Map<string, BookSummary> = new Map();

export default function LibraryScreen() {
  const loans = useLibraryStore((s) => s.loans);
  const holds = useLibraryStore((s) => s.holds);
  const loading = useLibraryStore((s) => s.loading);
  const refresh = useLibraryStore((s) => s.refresh);
  const isOnline = useNetworkStatus();

  // Titles for the ids the holdings carry. Empty until a batch call lands; a
  // row with no entry renders against its id, which is the documented fallback
  // rather than a missing state.
  const [titles, setTitles] = useState<Map<string, BookSummary>>(EMPTY_TITLES);
  const [hydrationFailed, setHydrationFailed] = useState(false);

  const { offered, waiting } = partitionHolds(holds);
  const live = activeLoans(loans);
  const { ids, truncated } = collectItemIds(live, offered, waiting);

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

  // First load, nothing to show yet. Skeleton rows rather than a spinner over a
  // blank page, because this is the screen the app opens on and a spinner says
  // "wait" where a skeleton says "your shelf is arriving".
  if (loading && live.length === 0 && holds.length === 0) {
    return (
      <View style={styles.screen} testID="library-loading">
        <OfflineBanner visible={!isOnline} />
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

  const nothingHeld = offered.length === 0 && live.length === 0 && waiting.length === 0;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} />}
      testID="library-screen"
    >
      <OfflineBanner visible={!isOnline} />

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

      {nothingHeld ? (
        // The most common state on a fresh demo database, and the one that gets
        // forgotten until the demo runs from an empty database.
        <EmptyState variant="no_content" />
      ) : (
        <>
          {offered.length > 0 && (
            <View style={styles.section}>
              <SectionHeader title="Offered to you" />
              {offered.map((hold) => (
                <OfferRow
                  key={hold.holdId ?? hold.itemId}
                  hold={hold}
                  title={titleFor(hold.itemId)}
                  clock={clock}
                />
              ))}
            </View>
          )}

          {live.length > 0 && (
            <View style={styles.section}>
              <SectionHeader title="On loan" />
              {live.map((loan) => (
                <LoanRow
                  key={loan.loanId ?? loan.itemId}
                  loan={loan}
                  title={titleFor(loan.itemId)}
                  publisher={publisherFor(loan.itemId)}
                  clock={clock}
                />
              ))}
            </View>
          )}

          {waiting.length > 0 && (
            <View style={styles.section}>
              <SectionHeader title="Waiting" />
              {waiting.map((hold) => (
                <WaitingRow
                  key={hold.holdId ?? hold.itemId}
                  hold={hold}
                  title={titleFor(hold.itemId)}
                />
              ))}
            </View>
          )}
        </>
      )}
    </ScrollView>
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
function OfferRow({ hold, title, clock }: { hold: Hold; title: string; clock: ServerClock }) {
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
        badge={expiry === undefined ? undefined : <Text style={styles.expiry}>{expiry}</Text>}
      />
    </View>
  );
}

function LoanRow({
  loan,
  title,
  publisher,
  clock,
}: {
  loan: Loan;
  title: string;
  publisher?: string;
  clock: ServerClock;
}) {
  // Held back until the clock has a sample, for the same reason as the offer
  // countdown. A due date is far less urgent than an offer, but a row that
  // said "Due in 19710 days" for one frame is worse than one that says nothing.
  const due = clock.ready ? dueLabel(loan, clock.offsetMs, clock.nowMs) : undefined;
  return (
    <View style={styles.row}>
      <ContentCard
        title={title}
        {...(publisher === undefined ? {} : { publisher })}
        badge={due === undefined ? undefined : <Text style={styles.due}>{due}</Text>}
      />
    </View>
  );
}

// Reassurance, not action: no buttons, and nothing here expires. Cancelling a
// hold is a real action the reader may want, but it belongs beside a decision
// about where it lives — it is not on this screen's spec.
function WaitingRow({ hold, title }: { hold: Hold; title: string }) {
  const place = queueLabel(hold);
  return (
    <View style={styles.row}>
      <ContentCard
        title={title}
        badge={place === undefined ? undefined : <Text style={styles.place}>{place}</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.white },
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
  due: {
    color: color.textSecondary,
    fontWeight: type.smallLabel.weight,
    fontFamily: type.smallLabel.fontFamily,
    fontSize: type.smallLabel.size,
    lineHeight: type.smallLabel.lineHeight,
  },
  place: {
    color: color.textSecondary,
    fontWeight: type.smallLabel.weight,
    fontFamily: type.smallLabel.fontFamily,
    fontSize: type.smallLabel.size,
    lineHeight: type.smallLabel.lineHeight,
  },
});
