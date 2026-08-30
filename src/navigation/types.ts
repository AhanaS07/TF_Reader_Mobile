// Route param types for the entire navigation tree — P0-6 (Keshav)
// Keep in sync with RootNavigator.tsx. If a param changes here, update the navigator.
import type { NavigatorScreenParams } from '@react-navigation/native';

/**
 * Which form PersonalAccountScreen shows. It rides in the route params rather than
 * the screen's own state so the header title and the form cannot disagree.
 */
export type PersonalAccountMode = 'signIn' | 'signUp';

/** Root stack wraps the tab navigator + the dev Gallery modal. */
export type RootStackParamList = {
  Main: undefined;
  Gallery: undefined;
};

/** Four bottom tabs. */
export type RootTabParamList = {
  // NavigatorScreenParams allows cross-tab navigation with a nested screen target,
  // e.g. navigation.navigate('Catalogue', { screen: 'InstitutionList' }) from Profile.
  Catalogue: NavigatorScreenParams<CatalogueStackParamList> | undefined;
  Search: undefined;
  Library: undefined;
  Profile: undefined;
};

/** Catalogue nested stack — has pushed detail screens. */
export type CatalogueStackParamList = {
  CatalogueHome: undefined;
  // Institution picker — CAP-3 selection flow.
  InstitutionList: undefined;
  InstitutionDetail: { institutionId: string };
  ItemDetail: { itemId: string };
  // Screen 02 — sign-in sheet. Institution is read from institutionStore;
  // no params needed because selection always precedes navigation here.
  SignIn: undefined;
  // Screen 03 — access gate, raised when `resolveAccess` returns
  // `requires_signin`. title/authors ride along with itemId for the same
  // reason `Shelf`'s `title` does: display data the caller already has,
  // rather than a second fetch for a value that never changes here.
  AccessGate: { itemId: string; title: string; authors: string };
  // Shelf detail — Prayas wires CategoryCard.onPress to this route (C1).
  // title is passed so the AppHeader can display it without a network call.
  //
  // `title` is the NAV ENTRY's label, not the shelf feed's own title: the two
  // legitimately differ (the "Open access" nav entry points at a shelf the feed
  // titles "Free to read"), and only the nav label is known at push time.
  //
  // `institutionId` is a param rather than something ShelfScreen reads from the
  // store, so a caller cannot reach the screen without naming an institution.
  // A shelf only exists inside one institution's catalogue.
  Shelf: { shelfId: string; title: string; institutionId: string };
  // Personal-account (OIDC) form, reached from the access gate's "Personal
  // account" card. Registered here as well as in Profile for the same reason
  // SignIn is: a flow that started in this tab finishes in it.
  PersonalAccount: { mode: PersonalAccountMode };
};

/** Search nested stack — shares ItemDetail shape. */
export type SearchStackParamList = {
  SearchHome: undefined;
  ItemDetail: { itemId: string };
  // Same reason ItemDetail is registered in both stacks: the gate can be
  // raised from either origin. SignIn and InstitutionList are registered here
  // too, for the same reason — so "Through my institution" can stay on
  // whichever tab it started on instead of jumping to Catalogue. See
  // AccessGateScreen.tsx.
  AccessGate: { itemId: string; title: string; authors: string };
  SignIn: undefined;
  InstitutionList: undefined;
  PersonalAccount: { mode: PersonalAccountMode };
};

/** Single-screen stack — no pushed screens in Week 1. */
export type LibraryStackParamList = { LibraryHome: undefined };

/** Profile stack — screen 10, plus the settings screens it pushes. */
export type ProfileStackParamList = {
  ProfileHome: undefined;
  // Reader preferences — theme, font, layout and typography, pushed from the
  // "Reading Preferences" row on screen 10.
  //
  // NO PARAMS, and that is the contract rather than a simplification: prefs are
  // a per-user SINGLETON applied across every book, not scoped per book (see
  // `src/shared/contracts/prefs.ts`, which removed `bookId` for exactly this
  // reason). There is no id to pass, so a caller cannot reach this screen with
  // the wrong one.
  ReaderPreferences: undefined;

  // ─── Signed-out sign-in flow, pushed from the account block on screen 10 ────
  //
  // ALL FOUR LIVE IN THIS STACK ON PURPOSE. Sending the reader to Catalogue's
  // copies would relocate them to a tab they never chose, and land them there
  // after signing in. Same argument that already registers SignIn and
  // InstitutionList in the Search stack.
  SignInMethod: undefined;
  PersonalAccount: { mode: PersonalAccountMode };
  InstitutionList: undefined;
  SignIn: undefined;
};
