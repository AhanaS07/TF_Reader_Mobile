// Route param types for the entire navigation tree — P0-6 (Keshav)
// Keep in sync with RootNavigator.tsx. If a param changes here, update the navigator.

/** Root stack wraps the tab navigator + the dev Gallery modal. */
export type RootStackParamList = {
  Main: undefined;
  Gallery: undefined;
};

/** Four bottom tabs. */
export type RootTabParamList = {
  Catalogue: undefined;
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
  // Shelf detail — Prayas wires CategoryCard.onPress to this route (C1).
  // title is passed so the AppHeader can display it without a network call.
  Shelf: { shelfId: string; title: string };
};

/** Search nested stack — shares ItemDetail shape. */
export type SearchStackParamList = {
  SearchHome: undefined;
  ItemDetail: { itemId: string };
};

/** Single-screen stacks — no pushed screens in Week 1. */
export type LibraryStackParamList = { LibraryHome: undefined };
export type ProfileStackParamList = { ProfileHome: undefined };
