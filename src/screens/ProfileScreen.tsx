// Screen 10 — Profile and settings.
//
// THE ACCOUNT HEADER IS BUILT, BUT ITS NAME AND EMAIL ARE NOT AVAILABLE, and the
// difference between those two statements is the whole of this comment. The plan
// says "name, email and avatar from flambeau's GET /api/v1/auth/me". Taking that
// apart against what actually exists:
//
//   THE AVATAR NEEDS NO DATA. The mockup's avatar is a generic person glyph on a
//   teal disc, not a photograph — there is no avatar URL in it to fetch. So it is
//   drawn here as designed, and nothing is faked by drawing it.
//
//   THE NAME AND EMAIL HAVE NO SOURCE, for two independent reasons:
//     1. THE CONTRACT HAS NO SUCH FIELDS. `AuthMeResponse` in
//        `docs/contracts/flambeau-api.yaml` requires exactly
//        `userId, type, roles, collections, expiresAt, serverTime, token`, with
//        an optional `institutionId`. There is no name, no email and no avatar
//        anywhere in it, and the endpoint's own description says every field is
//        copied from the validated token. A display name cannot be derived from
//        `user_9c2`. That is a question for flambeau, not grounds to invent one.
//     2. THERE IS NO SESSION. No auth client, no session store, and nothing that
//        holds a bearer token — `config/licence.ts` and `access/resolveAccess.ts`
//        both record the session store as unbuilt, and `SignInScreen`'s handoff
//        is still a stub pending flambeau's Question 5. A call to `/auth/me`
//        today would be an unauthenticated one, which is a 401 by design.
//
// So the block renders its signed-out state: the avatar as drawn, and one honest
// line where the name goes. WHEN THE SESSION LANDS, the edit is to swap that line
// for the real name and add the email beneath it — the layout does not move.
//
// IT IS LAID OUT INLINE RATHER THAN AS A COMPONENT. It has exactly one caller and
// no variants, so a shared component would be the speculative one CONVENTIONS §10
// rules out, and a screen-local copy is what §7 forbids. Screen composition it is.
import { useCallback } from 'react';
import { useNavigation, type NavigationProp, type CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { InstitutionRow } from '@components/InstitutionRow';
import { ListRow } from '@components/ListRow';
import { useInstitutionStore } from '@store/institutionStore';
import { useSessionStore } from '@store/sessionStore';
import type {
  ProfileStackParamList,
  RootStackParamList,
  RootTabParamList,
} from '@navigation/types';
import { color, radius, space, type } from '@theme/tokens';

// This screen navigates in three directions, so the type composes three props.
// Same shape as SearchScreen, which has the same problem: its own stack first,
// then the tab and root props.
//
//   ProfileStack   ReaderPreferences, pushed onto this screen's own stack
//   Tab            nested screens in sibling tabs (InstitutionList in Catalogue)
//   RootStack      the dev Gallery, which sits above the tabs
type Nav = CompositeNavigationProp<
  NativeStackNavigationProp<ProfileStackParamList, 'ProfileHome'>,
  CompositeNavigationProp<
    BottomTabNavigationProp<RootTabParamList, 'Profile'>,
    NavigationProp<RootStackParamList>
  >
>;

// Composed from the spacing scale rather than written as 20, so no bare number
// reaches a style or a size prop (CONVENTIONS §5) — the same trick as
// `HEIGHT = space.xl + space.md` in ActionButton. The value is unchanged; it is
// now traceable to the scale.
const SETTING_ICON_SIZE = space.md + space.xs;

// Avatar sizes composed from the spacing scale rather than written as numbers,
// the way InstitutionRow composes its own CREST_SIZE.
const AVATAR_SIZE = space.xl * 2 + space.md;
const AVATAR_GLYPH_SIZE = space.xl + space.sm;

export default function ProfileScreen() {
  const navigation = useNavigation<Nav>();

  const selectedInstitution = useInstitutionStore((s) => s.selectedInstitution);
  const clearSelectedInstitution = useInstitutionStore((s) => s.clearSelectedInstitution);
  const clearSession = useSessionStore((s) => s.clearSession);

  const handleChangeInstitution = useCallback(() => {
    // Screen 06 is the institution list, and it lives in the Catalogue stack as
    // `InstitutionList` — the same route CatalogueScreen's picker pushes. React
    // Navigation resolves cross-tab routes by switching to the owning tab first,
    // then pushing the screen.
    navigation.navigate('Catalogue', { screen: 'InstitutionList' });
  }, [navigation]);

  // Pushed onto this screen's own stack, so no tab or nested target is named —
  // unlike `handleChangeInstitution` above, which crosses into Catalogue.
  const handleReadingPreferences = useCallback(() => {
    navigation.navigate('ReaderPreferences');
  }, [navigation]);

  const handleSignOut = useCallback(() => {
    // ORDER: session first, institution second, then navigate.
    // clearSession() drops the access token immediately so any in-flight request
    // that resolves after this sees no token. clearSelectedInstitution() rescopes
    // the catalogue before it mounts, so it never flashes the wrong institution.
    clearSession();
    clearSelectedInstitution();
    navigation.navigate('Catalogue', { screen: 'CatalogueHome' });
  }, [clearSession, clearSelectedInstitution, navigation]);

  return (
    // Scrolls because the row count is fixed and already taller than a small
    // handset — the settings block, sign out and the dev entry cannot all fit.
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Account header — see the note at the top of this file for why the name
          slot reads the way it does and why there is no email line yet. */}
      <View style={styles.account}>
        {/* Decorative: a generic glyph standing in for a person, carrying no
            information a screen reader needs. Hidden from the accessibility
            tree on both platforms, the way VoiceOverlay hides its own. */}
        <View
          testID="profile-avatar"
          style={styles.avatar}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Ionicons name="person" size={AVATAR_GLYPH_SIZE} color={color.white} />
        </View>

        <View style={styles.accountText}>
          <Text style={styles.accountName}>Not signed in</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.groupLabel}>Institution</Text>
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

      {/* ONE ROW LEADS SOMEWHERE; THE REST ARE DISABLED AND STILL DRAWN. Same
          rule the screen 12 filter sheet already follows: a row with nothing
          behind it is greyed and announced as disabled rather than dropped, so
          the settings list does not read as complete when it is not.

            · Reading Preferences NOW HAS A DESTINATION — `ReaderPreferences` on
              this screen's own stack. The values it writes are consumed by
              t4targaryen's reader, but the screen that writes them is ours, so
              this row is live. It was disabled while there was nothing to push.
            · Download Settings still belongs to t4targaryen's reader, and there
              is no sub-screen on our side for it.
            · Notifications has no backing setting anywhere in the app.
            · Privacy & Security has no destination.
            · About T&F Reader has no destination either, and its version string
              has no source we can read without adding `expo-constants` as a
              declared dependency — a dependency decision, not this screen's. The
              row is drawn without the number rather than with an invented one. */}
      <View style={styles.section}>
        <Text style={styles.groupLabel}>Settings</Text>
        <ListRow
          title="Reading Preferences"
          subtitle="Font size, theme"
          variant="chevron"
          onPress={handleReadingPreferences}
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
        <View style={styles.signOut}>
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
          <Text style={styles.groupLabel}>Developer</Text>
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
  // WHITE PAGE, TINTED ROWS — and this is a fix, not a preference. `ListRow`
  // paints itself `color.surface`, and this page was painting itself
  // `color.surface` too. That was invisible while `surface` was #F8F9FA, because
  // near-white on near-white still reads as one continuous sheet and the
  // hairlines did all the work. The brand palette makes `surface` #EBF0FF
  // Cornflower Neutral, and identical-on-identical is now a settings list with
  // no visible rows at all — see the emulator against the mockup.
  //
  // The page takes `white` and the rows keep `surface`, which is what tokens.ts
  // already says `surface` is for: "cards, section backgrounds". The rows are
  // the cards. The page showing through between the sections is what makes each
  // group read as a group, so the section gaps below are load-bearing now
  // rather than decorative.
  container: {
    flex: 1,
    backgroundColor: color.white,
  },
  content: {
    paddingBottom: space.xl,
  },
  account: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.lg,
    backgroundColor: color.surface,
    // The divider the mockup draws under this block. Sections below it are
    // separated by their own top margin, which is the existing layout.
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.border,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    // A fixed-size square at pill radius is a circle; React Native clamps the
    // radius to half the side, so this needs no derived number.
    borderRadius: radius.pill,
    backgroundColor: color.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountText: {
    flex: 1,
    gap: space.xs,
  },
  accountName: {
    fontWeight: type.pageTitle.weight,
    fontSize: type.pageTitle.size,
    lineHeight: type.pageTitle.lineHeight,
    color: color.textPrimary,
  },
  section: {
    marginTop: space.lg,
  },
  // Sign out is not the sixth setting, and on a white page the gap is what says
  // so. `xl` rather than the sections' `lg`, which is how far the mockup holds
  // it off the list above it.
  signOut: {
    marginTop: space.xl,
  },
  // The developer block sits further down again — it is not part of the settings
  // list and should not look like one more group of it.
  dev: {
    marginTop: space.xl,
  },
  // One style for both group labels. These were two identical declarations,
  // `sectionLabel` and `devLabel`, which is two places to edit the next time the
  // type scale moves.
  groupLabel: {
    fontWeight: type.smallLabel.weight,
    fontFamily: type.smallLabel.fontFamily,
    fontSize: type.smallLabel.size,
    lineHeight: type.smallLabel.lineHeight,
    color: color.textSecondary,
    paddingHorizontal: space.md,
    paddingBottom: space.xs,
  },
});
