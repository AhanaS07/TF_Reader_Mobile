// P0-3/P0-4 (Prayas) — wires CategoryCard and ContentCard to the DataSource seam.
//
// SHAPE FOLLOWS THE FEED, NOT THE MOCKUP'S TAB BEHAVIOUR. The top strip is one
// CategoryCard per `catalogue.navigation` entry; the "Recently published" section
// below is the home catalogue's OWN shelves, each under its own heading. Both
// lists come from the feed and neither has a fixed length or a known name — an
// administrator configures the shelves per institution (AGENTS.md L-5, settled
// 16 Aug 2026), so handle none, one and many.
//
// Tapping a category card does not filter the list below. A shelf is not a
// filter: it pushes ShelfDetail (ShelfScreen), which fetches that shelf's own
// full, paginated listing via getShelf(). See ShelfScreen.tsx.
//
// THE INSTITUTION ARRIVES AS A PROP, and there is no fallback id any more.
// CatalogueHomeScreen owns the choice: a reader without an institution gets
// PublicCatalogueScreen instead of this one, so by the time this renders there
// is always a real institution. The old `?? 'inst_7f3'` quietly served one
// institution's catalogue to a reader who had picked none — the bug A1 fixes.
// The picker above the category row still navigates to the list to change it.
//
// THE BADGE IS RESOLVED, NEVER DERIVED HERE. Each row calls `resolveAccess` and
// passes only the resulting `.tier` into ContentCard's slot — reading
// `publication.acquisition.licenceModel` in this file would be the Design Spec
// §5.1 violation ("the UI must never calculate access rights"). The session
// comes from `handToggledSession` — A7's stand-in for real sign-in — which is
// never null here: CatalogueHomeScreen only renders this screen once an
// institution is selected. `loan`/`hold` stay omitted, which still resolves
// Open Access and Elite-with-nothing-held from feed data alone.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import EmptyState from '@/components/EmptyState';
import { handToggledSession } from '@access/handToggledSession';
import { resolveAccess } from '@access/resolveAccess';
import { AccessTierBadge } from '@components/AccessTierBadge';
import { CategoryCard, type CategoryAccent } from '../components/CategoryCard';
import { ContentCard } from '../components/ContentCard';
import { ErrorState } from '@components/ErrorState';
import { SectionHeader } from '../components/SectionHeader';
import { getCatalogueSource } from '../config/catalogue';
import { type CatalogueError, isCatalogueFailure } from '@model/errors';
import { CATALOGUE_ERROR_COPY, catalogueErrorVariant } from '@model/errorCopy';
import type { Catalogue } from '../model/types';
import type { CatalogueStackParamList } from '../navigation/types';
import type { Institution } from '@model/institution';
import { color, space, type as typeScale } from '../theme/tokens';
import { useFeedScrollMemory } from '@hooks/useFeedScrollMemory';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import OfflineBanner from '@/components/OfflineBanner';

type Nav = NativeStackNavigationProp<CatalogueStackParamList, 'CatalogueHome'>

// Cycled by POSITION, never by shelf name — types.ts: "NAVIGATION IS DATA, NOT
// CODE ... no shelf is named in a type or a branch anywhere". There are already
// more shelves than accents, so the cycle wraps rather than running out.
const ACCENTS: CategoryAccent[] = ['primary', 'navy', 'success', 'subscription', 'elite'];

// How many skeleton rows/cards to show before the first real payload arrives.
// Arbitrary — there is no data yet to size it from.
const SKELETON_COUNT = 3;

export interface CatalogueScreenProps {
  institution: Institution;
}

export default function CatalogueScreen({ institution }: CatalogueScreenProps) {
  const navigation = useNavigation<Nav>();
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // Undefined covers both "no failure" and "failed with something that was not
  // a CatalogueFailure" — the fallback copy below handles the second case, the
  // same way SearchScreen's own errorCode does.
  const [errorCode, setErrorCode] = useState<CatalogueError | undefined>(undefined);

  const isOnline = useNetworkStatus();

  const institutionId = institution.id;

  // A7 — keyed on the institution, not one shared offset: signing out swaps this
  // screen for the public feed, and each has its own place to return to. Changing
  // institution is a different feed too, so it starts at the top.
  const { scrollRef, onScroll, onContentSizeChange } = useFeedScrollMemory(institutionId);

  let body: ReactNode;
  // No synchronous setState here — only inside the async continuations. A
  // setState reachable directly from an effect body triggers a lint error
  // ("cascading renders"); `loading`/`failed` are also already at these exact
  // values on mount, so resetting them here would be redundant anyway. Retry
  // is the one path that truly needs to reset them, and it runs from a press
  // handler, not an effect — see below.
  const fetchCatalogue = useCallback(() => {
    getCatalogueSource()
      .getHomeCatalogue(institutionId)
      .then(setCatalogue)
      .catch((err: unknown) => {
        setErrorCode(isCatalogueFailure(err) ? err.code : undefined);
        setFailed(true);
      })
      .finally(() => setLoading(false));
  }, [institutionId]);

  useEffect(() => {
    fetchCatalogue();
  }, [fetchCatalogue]);

  const retry = useCallback(() => {
    setLoading(true);
    setFailed(false);
    fetchCatalogue();
  }, [fetchCatalogue]);

  if (failed) {
    body = (
      <View style={styles.center}>
        <ErrorState
          variant={errorCode === undefined ? 'not_ready' : catalogueErrorVariant(errorCode)}
          message={errorCode === undefined ? "Couldn't load the catalogue." : CATALOGUE_ERROR_COPY[errorCode]}
          onRetry={retry}
        />
      </View>
    );
  }
  else{
    body = (
      <ScrollView
        testID="catalogue-feed"
        ref={scrollRef}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onContentSizeChange={onContentSizeChange}
        style={styles.screen}
        contentContainerStyle={styles.content}
      >
      <Pressable
        style={styles.institutionPicker}
        onPress={() => navigation.navigate('InstitutionList')}
        accessibilityRole="button"
        accessibilityLabel="Change institution"
      >
        <Text style={styles.institutionName} numberOfLines={1}>
          {institution.name}
        </Text>
        <Text style={styles.institutionChange}>Change</Text>
      </Pressable>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.categoryStrip}
      >
        {loading
          ? ACCENTS.slice(0, SKELETON_COUNT).map((accent, index) => (
              <View key={index} style={styles.categoryCard}>
                <CategoryCard title="" state="loading" accent={accent} />
              </View>
            ))
          : catalogue?.navigation.map((entry, index) => (
              <View key={entry.shelfId} style={styles.categoryCard}>
                <CategoryCard
                  title={entry.title}
                  accent={ACCENTS[index % ACCENTS.length]}
                  // `title` rides along so the pushed screen's app bar can name
                  // the shelf immediately, before its feed has loaded, and
                  // `institutionId` so the listing is fetched for the same
                  // institution whose catalogue advertised this entry.
                  onPress={() =>
                    navigation.navigate('Shelf', {
                      shelfId: entry.shelfId,
                      title: entry.title,
                      institutionId,
                    })
                  }
                />
              </View>
            ))}
      </ScrollView>

      {loading
        ? Array.from({ length: SKELETON_COUNT }, (_, index) => (
            <ContentCard key={index} state="loading" title="" />
          ))
        :catalogue?.shelves.length !== 0 ? catalogue?.shelves.map((shelf) => (
            <View key={shelf.id} style={styles.section}>
              {/* No `actionLabel`: these are the home-catalogue's own preview
                  shelves, not one of the tappable navigation categories above,
                  so there is no "See all" destination for them. Screen 01's
                  design shows no action on these headers either. */}
              <SectionHeader title={shelf.title} />
              <View style={styles.list}>
                {shelf.publications.map((publication) => (
                  <ContentCard
                    key={publication.id}
                    title={publication.title}
                    publisher={publication.publisher}
                    imageUrl={publication.coverUrl}
                    format={publication.format}
                    badge={
                      <AccessTierBadge
                        tier={
                          resolveAccess({
                            item: publication,
                            institutionId,
                            session: handToggledSession(institutionId),
                          }).tier
                        }
                      />
                    }
                    onPress={() =>
                      navigation.navigate('ItemDetail', { itemId: publication.id })
                    }
                  />
                ))}
              </View>
            </View>
          )) : (
            <EmptyState variant="no_content"/>
          )}
    </ScrollView>
    );
  }

  return (
    <View style={styles.screen}>
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
  institutionPicker: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    backgroundColor: color.surface,
    borderRadius: space.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.border,
  },
  institutionName: {
    flex: 1,
    fontWeight: typeScale.body.weight,
    fontSize: typeScale.body.size,
    lineHeight: typeScale.body.lineHeight,
    color: color.textPrimary,
  },
  institutionChange: {
    fontWeight: typeScale.button.weight,
    fontSize: typeScale.button.size,
    lineHeight: typeScale.button.lineHeight,
    color: color.primary,
    marginLeft: space.sm,
  },
  content: {
    padding: space.md,
    gap: space.lg,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    backgroundColor: color.surface,
  },
  categoryStrip: {
    gap: space.md,
    paddingHorizontal: space.xs,
  },
  // The strip owns tile width; neither card sets its own (CONVENTIONS §8).
  categoryCard: {
    width: space.xl * 5,
  },
  section: {
    gap: space.sm,
  },
  list: {
    gap: space.sm,
  },
});
