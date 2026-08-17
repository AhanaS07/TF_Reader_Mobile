// C2 — the institution detail screen (K6). The route wrapper, with its interior
// filled in against MockAdapter, which has now landed (Prayas P0-4).
//
// THE WRAPPER OWNS THE MAPPING, NOT THE VIEW. InstitutionDetailView takes three
// primitives rather than an `Institution`, because two Institution shapes exist —
// `@model/institution`, which the adapter returns, and the unrelated one in
// `@model/types` — and `crestUrl` is mid-rename to `logoUrl`. That rename crosses
// here, in one line, which is the whole reason the component takes primitives.
//
// `authType` IS FETCHED BUT NEVER RENDERED. Sign-in is always SAML, so there is
// nothing to display and nothing for a reader to choose. The view has no prop for
// it, and adding one would put flambeau's routing vocabulary on a screen.
//
// THREE STATES, KEPT VISIBLY DISTINCT: a skeleton while the fetch is in flight,
// an ErrorState on rejection, the view once resolved (CONVENTIONS §6). No
// ActivityIndicator anywhere — skeletons replace spinners, which is a hard design
// rule rather than a preference.
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { InstitutionSource } from '@adapters/InstitutionSource';
import { ErrorState, type ErrorStateVariant } from '@components/ErrorState';
import { InstitutionDetailView } from '@components/InstitutionDetailView';
import { Skeleton } from '@components/Skeleton';
import { getCatalogueSource } from '@config/catalogue';
import { CatalogueError, isCatalogueFailure } from '@model/errors';
import type { Institution } from '@model/institution';
import { useInstitutionStore } from '@store/institutionStore';
import { color, space, type as typeScale } from '@theme/tokens';
import type { CatalogueStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<CatalogueStackParamList, 'InstitutionDetail'>;

// Mirrors InstitutionDetailView's own LOGO_SIZE, which is private to that file.
// Duplicated rather than exported, following the call the view itself made about
// InstitutionRow's getInitials: promote to a shared constant if a third caller
// appears. Composed from the spacing scale so no bare number enters a StyleSheet.
const LOGO_SIZE = space.xl + space.xl + space.md;

// Placeholder widths approximate a realistic name and country. Approximate is the
// best available: the real strings are what we are waiting for.
const NAME_WIDTH = space.xl * 6;
const COUNTRY_WIDTH = space.xl * 3;
const ACTION_WIDTH = space.xl * 6;

// The primary action's real height — its own vertical padding, plus one line of
// button text.
const ACTION_HEIGHT = space.sm * 2 + typeScale.button.lineHeight;

// Used for both the unclassifiable failure and the unreachable null case below,
// so the two cannot drift apart.
const GENERIC_MESSAGE = "We couldn't load this institution.";

// Copy for every way the fetch can fail. Variant and message travel together
// because the variant decides which affordance renders: ErrorState treats only
// `network` and `not_ready` as retryable, so `not_found` deliberately gets no
// Retry — repeating a well-formed request for something that is not there cannot
// make it appear.
//
// NO `code` IS PASSED. ErrorState's `code` is wokay's envelope enumeration
// (ERROR_CODES in @model/types), a different vocabulary from CatalogueError, and
// no wokay envelope is involved on this path. The code-to-copy map is D14.
function describeFailure(err: unknown): { variant: ErrorStateVariant; message: string } {
  if (isCatalogueFailure(err)) {
    switch (err.code) {
      case CatalogueError.NOT_FOUND:
        // Not-found, never forbidden. An inactive institution returns the same
        // 404 as one that never existed, so its existence is not disclosed.
        return { variant: 'not_found', message: "We couldn't find this institution." };
      case CatalogueError.NETWORK_UNAVAILABLE:
        return {
          variant: 'network',
          message: 'You appear to be offline. Check your connection and try again.',
        };
      case CatalogueError.TIMEOUT:
        // Its own line rather than the offline one. errors.ts keeps the two codes
        // apart precisely because a slow server and no connection read
        // differently to a reader.
        return { variant: 'network', message: 'That took longer than expected. Try again.' };
      case CatalogueError.MALFORMED_FEED:
        return { variant: 'not_ready', message: "We couldn't read this institution's details." };
    }
  }

  // Not a CatalogueFailure at all, so it is a bug rather than a condition: the
  // honest generic line and a retry, rather than an invented reason.
  //
  // MALFORMED_FEED lands on `not_ready` above for the same reason — none of
  // ErrorState's four variants means "the payload is wrong". Raised at the Friday
  // review rather than widening the union here.
  return { variant: 'not_ready', message: GENERIC_MESSAGE };
}

export default function InstitutionDetailScreen({ route, navigation }: Props) {
  const { institutionId } = route.params;

  const [institution, setInstitution] = useState<Institution | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<unknown>(null);

  const setSelectedInstitution = useInstitutionStore((s) => s.setSelectedInstitution);

  // No synchronous setState in here: a setState reachable directly from an effect
  // body trips the cascading-renders lint, and `loading`/`failure` already hold
  // these values on mount. Retry is the one path that must reset them, and it
  // runs from a press handler — see below.
  const fetchInstitution = useCallback(() => {
    // Narrowed to the institution half of the seam. This screen never calls a
    // catalogue method, so it should not depend on a type that carries four.
    const source: InstitutionSource = getCatalogueSource();
    source
      .getInstitution(institutionId)
      .then(setInstitution)
      .catch((err: unknown) => setFailure(err))
      .finally(() => setLoading(false));
  }, [institutionId]);

  useEffect(() => {
    fetchInstitution();
  }, [fetchInstitution]);

  const retry = useCallback(() => {
    setLoading(true);
    setFailure(null);
    fetchInstitution();
  }, [fetchInstitution]);

  const handleBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  if (loading) {
    return (
      <View style={styles.screen}>
        {/* Skeleton blocks at the real content's dimensions, so nothing jumps when
            the institution lands (§6). The testID sits on the wrapper because
            Skeleton takes none — the same idiom ContentCard and CategoryCard use
            for their own loading state. */}
        <View style={styles.loading} testID="institution-detail-skeleton">
          <Skeleton variant="block" width={LOGO_SIZE} height={LOGO_SIZE} />
          <Skeleton variant="text" width={NAME_WIDTH} height={typeScale.pageTitle.lineHeight} />
          <Skeleton variant="text" width={COUNTRY_WIDTH} height={typeScale.body.lineHeight} />
          {/* `text`, not `block`: its pill radius is the one the primary action
              uses, and React Native clamps that to a stadium at this height. */}
          <Skeleton variant="text" width={ACTION_WIDTH} height={ACTION_HEIGHT} />
        </View>
      </View>
    );
  }

  if (failure !== null) {
    const { variant, message } = describeFailure(failure);
    return (
      <View style={[styles.screen, styles.centre]}>
        {/* onRetry is passed for every variant; ErrorState decides whether to
            render it, and that decision belongs there rather than here. */}
        <ErrorState variant={variant} message={message} onRetry={retry} />
      </View>
    );
  }

  if (institution === null) {
    // Unreachable: `finally` clears `loading` only after one of the two branches
    // above has been given a value. Present so the compiler can narrow, and so a
    // future change that breaks that invariant shows a retry rather than a blank
    // screen.
    return (
      <View style={[styles.screen, styles.centre]}>
        <ErrorState variant="not_ready" message={GENERIC_MESSAGE} onRetry={retry} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <InstitutionDetailView
        name={institution.name}
        country={institution.country}
        // branding.logoUrl is absent when the institution has no logo — the
        // initials path in InstitutionDetailView handles that case (W-17).
        logoUrl={institution.branding?.logoUrl}
        onSelect={() => {
          // The whole object, not the id — the store persists it so the list
          // screen can draw its recently-used row on a cold start without a
          // fetch. setSelectedInstitution maintains recentlyUsedIds itself, so
          // there is nothing else to update here.
          setSelectedInstitution(institution);
          // Selecting dismisses, matching InstitutionListScreen's own handleSelect.
          navigation.goBack();
        }}
        onBack={handleBack}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: color.surface,
  },
  // ErrorState pads itself but does not stretch, so centring it is the caller's
  // job (§8).
  centre: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Mirrors InstitutionDetailView's own container, so the skeleton occupies the
  // space the view will: top-aligned, centred across, one gap between blocks.
  loading: {
    alignItems: 'center',
    padding: space.lg,
    gap: space.md,
  },
});
