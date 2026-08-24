// Screen 10 — Profile and settings.
//
// THE ACCOUNT HEADER IS ABSENT, AND THAT IS THE FINDING RATHER THAN AN OMISSION.
// The plan says "name, email and avatar from flambeau's GET /api/v1/auth/me".
// Two separate things stop that, and neither is fixable from this file:
//
//   1. THE CONTRACT HAS NO SUCH FIELDS. `AuthMeResponse` in
//      `docs/contracts/flambeau-api.yaml` requires exactly
//      `userId, type, roles, collections, expiresAt, serverTime, token`, with an
//      optional `institutionId`. There is no name, no email and no avatar
//      anywhere in it, and the endpoint's own description says every field is
//      copied from the validated token. A display name cannot be derived from
//      `user_9c2`. That is a question for flambeau, not grounds to invent one.
//   2. THERE IS NO SESSION. No auth client, no session store, and nothing that
//      holds a bearer token — `config/licence.ts` and `access/resolveAccess.ts`
//      both record the session store as unbuilt, and `SignInScreen`'s handoff is
//      still a stub pending flambeau's Question 5. A call to `/auth/me` today
//      would be an unauthenticated one, which is a 401 by design.
//
// So the header is not built and not faked. Everything below it is real.
import { useCallback } from 'react';
import { useNavigation, type NavigationProp, type CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { InstitutionRow } from '@components/InstitutionRow';
import { ListRow } from '@components/ListRow';
import { useInstitutionStore } from '@store/institutionStore';
import type { RootStackParamList, RootTabParamList } from '@navigation/types';
import { color, space, type } from '@theme/tokens';

// CompositeNavigationProp lets this screen navigate to both the root stack
// (Gallery) and to nested screens in sibling tabs (InstitutionList in Catalogue).
type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<RootTabParamList, 'Profile'>,
  NavigationProp<RootStackParamList>
>;

const SETTING_ICON_SIZE = 20;

export default function ProfileScreen() {
  const navigation = useNavigation<Nav>();

  const selectedInstitution = useInstitutionStore((s) => s.selectedInstitution);
  const clearSelectedInstitution = useInstitutionStore((s) => s.clearSelectedInstitution);

  const handleChangeInstitution = useCallback(() => {
    // Screen 06 is the institution list, and it lives in the Catalogue stack as
    // `InstitutionList` — the same route CatalogueScreen's picker pushes. React
    // Navigation resolves cross-tab routes by switching to the owning tab first,
    // then pushing the screen.
    navigation.navigate('Catalogue', { screen: 'InstitutionList' });
  }, [navigation]);

  const handleSignOut = useCallback(() => {
    // WHAT SIGN-OUT CAN HONESTLY DO TODAY. There is no session to clear — see
    // the note at the top of this file — so this is not "clear the session"
    // pending a store that does not exist. It drops the institution selection,
    // which is the state the catalogue actually re-scopes on (CatalogueScreen
    // reads `selectedInstitution`), and then lands the reader on the catalogue
    // in that state. That is the sign-out half of A7 as far as the app can
    // currently express it; the token half is Keshav's session store.
    //
    // ORDER MATTERS ONLY ONE WAY ROUND: clear first, then navigate, so the
    // catalogue mounts already re-scoped rather than re-rendering after arrival.
    clearSelectedInstitution();
    navigation.navigate('Catalogue', { screen: 'CatalogueHome' });
  }, [clearSelectedInstitution, navigation]);

  return (
    // Scrolls because the row count is fixed and already taller than a small
    // handset — the settings block, sign out and the dev entry cannot all fit.
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Institution</Text>
        {selectedInstitution !== null ? (
          <>
            {/* Crest and name come from the store, and `InstitutionRow` already
                renders exactly that pair with the initials fallback for an
                institution with no branding asset (W-17). A second component
                that draws a crest would be the copy CONVENTIONS §7 forbids. */}
            <InstitutionRow
              institution={selectedInstitution}
              onPress={handleChangeInstitution}
            />
            <ListRow
              title="Change institution"
              variant="chevron"
              onPress={handleChangeInstitution}
            />
          </>
        ) : (
          <ListRow
            title="Select institution"
            subtitle="Required to access your library"
            variant="chevron"
            onPress={handleChangeInstitution}
          />
        )}
      </View>

      {/* EVERY ROW HERE IS DISABLED, AND EVERY ROW HERE IS STILL DRAWN. Same
          rule the screen 12 filter sheet already follows: a row with nothing
          behind it is greyed and announced as disabled rather than dropped, so
          the settings list does not read as complete when it is not.

            · Reading Preferences and Download Settings belong to t4targaryen's
              reader. There is no sub-screen on our side to push.
            · Notifications has no backing setting anywhere in the app.
            · Privacy & Security has no destination.
            · About T&F Reader has no destination either, and its version string
              has no source we can read without adding `expo-constants` as a
              declared dependency — a dependency decision, not this screen's. The
              row is drawn without the number rather than with an invented one. */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Settings</Text>
        <ListRow
          title="Reading Preferences"
          subtitle="Font size, theme"
          variant="chevron"
          disabled
          icon={<Ionicons name="book-outline" size={SETTING_ICON_SIZE} color={color.primary} />}
        />
        <ListRow
          title="Download Settings"
          subtitle="Wi-Fi only, storage location"
          variant="chevron"
          disabled
          icon={<Ionicons name="download-outline" size={SETTING_ICON_SIZE} color={color.primary} />}
        />
        <ListRow
          title="Notifications"
          variant="toggle"
          toggleValue={false}
          disabled
          icon={
            <Ionicons name="notifications-outline" size={SETTING_ICON_SIZE} color={color.primary} />
          }
        />
        <ListRow
          title="Privacy & Security"
          variant="chevron"
          disabled
          icon={
            <Ionicons
              name="shield-checkmark-outline"
              size={SETTING_ICON_SIZE}
              color={color.primary}
            />
          }
        />
        <ListRow
          title="About T&F Reader"
          variant="chevron"
          disabled
          icon={
            <Ionicons
              name="information-circle-outline"
              size={SETTING_ICON_SIZE}
              color={color.primary}
            />
          }
        />
      </View>

      {/* Offered only when there is something to sign out of. With no session
          store, a selected institution is the only "signed in" the app has, and
          a Sign out on an empty profile would be a button that does nothing. */}
      {selectedInstitution !== null && (
        <View style={styles.section}>
          <ListRow title="Sign out" variant="destructive" onPress={handleSignOut} />
        </View>
      )}

      {/* THE ONLY WAY INTO THE GALLERY, and deliberately the only one.

          `GalleryScreen` has been registered in RootNavigator since P0-6 with
          nothing linking to it, so the review surface was code that ran nowhere.
          This is the entry point.

          WHY `__DEV__` AND NOT A CONFIG FLAG: CONVENTIONS §9 requires that
          "nothing in the UI may navigate to it in a release build", and its own
          open questions list "what keeps GalleryScreen out of a release build"
          as unresolved. `__DEV__` is false in a production bundle and Metro's
          minifier drops the whole branch, so the answer is enforced by the
          bundler rather than by remembering. A runtime flag would ship the
          button and hide it, which is a weaker guarantee.

          The route itself stays registered — removing it would mean editing
          Keshav's navigator, and an unreachable route ships no UI. */}
      {__DEV__ && (
        <View style={styles.dev}>
          <Text style={styles.devLabel}>Developer</Text>
          <ListRow
            title="State Gallery"
            subtitle="Every component, variant and state — dev builds only"
            variant="chevron"
            onPress={() => navigation.navigate('Gallery')}
          />
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.white,
  },
  content: {
    paddingBottom: space.xl,
  },
  section: {
    marginTop: space.lg,
  },
  sectionLabel: {
    fontWeight: type.smallLabel.weight,
    fontSize: type.smallLabel.size,
    lineHeight: type.smallLabel.lineHeight,
    color: color.textSecondary,
    paddingHorizontal: space.md,
    paddingBottom: space.xs,
  },
  dev: {
    marginTop: space.xl,
  },
  devLabel: {
    fontWeight: type.smallLabel.weight,
    fontSize: type.smallLabel.size,
    lineHeight: type.smallLabel.lineHeight,
    color: color.textSecondary,
    paddingHorizontal: space.md,
    paddingBottom: space.xs,
  },
});
