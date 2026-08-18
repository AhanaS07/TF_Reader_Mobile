// Screen 05 — book detail. Reused by both CatalogueStack and SearchStack, which
// is why the route type below stays the minimal shape both stacks agree on
// rather than either stack's own NativeStackScreenProps.
//
// WORK TYPE IS HARDCODED, NOT DERIVED. Screens 04 and 05 are meant to differ only
// by which fields they show — both are built on the shared `ItemDetail` model —
// but nothing in the feed says which one a title needs yet: wokay's published
// `@type` enum only confirms Book and Audiobook, so there is no article/journal
// value to branch on. Until that lands, this screen always builds a book. Screen
// 04 is a separate task and will pass 'article' the same explicit way.
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
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';

import { resolveAccess } from '@access/resolveAccess';
import { ActionBar } from '@components/ActionBar';
import { AccessTierBadge } from '@components/AccessTierBadge';
import { ErrorState, type ErrorStateVariant } from '@components/ErrorState';
import { OfflineBanner } from '@components/OfflineBanner';
import { Skeleton } from '@components/Skeleton';
import { getCatalogueSource } from '@config/catalogue';
import { useNetworkStatus } from '@hooks/useNetworkStatus';
import { buildItemDetail, type ItemDetail } from '@model/detail';
import { CatalogueError, isCatalogueFailure } from '@model/errors';
import type { ActionId, WorkType } from '@model/types';
import { useInstitutionStore } from '@store/institutionStore';
import { color, radius, space, type as typeScale } from '@theme/tokens';

interface ItemDetailRouteProps {
  route: { params: { itemId: string } };
}

// Explicit and typed, so this line breaks to a compile error rather than a typo
// if 'book' is ever removed from the work-type vocabulary.
const BOOK_WORK_TYPE: WorkType = 'book';

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

export default function ItemDetailScreen({ route }: ItemDetailRouteProps) {
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

  // Not wired to a real call. The four flambeau calls behind these actions
  // (generate, check, revoke, join queue) are Akriti's D9/D13 — Week 3 — so this
  // screen renders the resolved buttons and stops there rather than pretending
  // a tap does something it does not yet do.
  const handleAction = useCallback((_action: ActionId) => {}, []);

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
    body = (
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

        <AccessTierBadge tier={detail.access.tier} />

        {/* Publisher, published date, ISBN and page count are each shown only
            when the feed actually supplied them — "render whatever fields are
            present; leave gaps blank rather than blocking" applies here exactly
            as it does on screen 04. */}
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

        <ActionBar actions={detail.access.actions} onAction={handleAction} />
      </ScrollView>
    );
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
});
