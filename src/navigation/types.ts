// Route param types for the entire navigation tree — P0-6 (Keshav)
// Keep in sync with RootNavigator.tsx. If a param changes here, update the navigator.
import type { NavigatorScreenParams } from '@react-navigation/native';

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
  Shelf: { shelfId: string; title: string };
};

/** Search nested stack — shares ItemDetail shape. */
export type SearchStackParamList = {
  SearchHome: undefined;
  ItemDetail: { itemId: string };
  // Same reason ItemDetail is registered in both stacks: the gate can be
  // raised from either origin. "Through my institution" crosses back into
  // the Catalogue tab from here, since SignIn/InstitutionList exist only
  // there — see AccessGateScreen.tsx.
  AccessGate: { itemId: string; title: string; authors: string };
};

/** Single-screen stacks — no pushed screens in Week 1. */
export type LibraryStackParamList = { LibraryHome: undefined };
export type ProfileStackParamList = { ProfileHome: undefined };
