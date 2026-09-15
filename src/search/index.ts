// src/search/index.ts
// The search shell's public surface. Callers import from here rather than
// reaching into the individual files.
//
// WHAT IS DELIBERATELY NOT HERE, because B1's scope changed and this is the
// clearest place to record it: there is no `tokenise`, no `searchPublications`,
// no `rankPublications`, no `filterBy*` and no `runCatalogueSearch`. Catalogue
// search is server-side and entitlement-scoped — "we filter, you render" — so
// matching, tokenisation and ranking are not ours, and neither is narrowing a
// page after it arrives. Those four files existed and were removed rather than
// left to rot behind an unused export; a second, client-side search path would
// have been the thing that quietly diverged from the real one.
//
// In-book full-text search is a DIFFERENT capability and is not here either —
// t4targaryen own it (`src/shared/contracts/search.ts`).
export {
  ACCESS_TIER_FILTER_CONFIRMED,
  SEARCH_PARAM,
  expandSearchLink,
  searchParams,
  type SearchLinkParams,
} from './searchLink';
export { BROWSE_PARAM, browseParams, type BrowseFilters } from './browseLink';
export type { CatalogueSearchPipeline, SearchFilters, SearchRequest } from './pipeline';
export {
  FixtureSearchPipeline,
  type FixtureSearchPipelineOptions,
} from './FixtureSearchPipeline';
export {
  initialSearchState,
  searchReducer,
  type SearchAction,
  type SearchState,
  type SearchStatus,
} from './searchState';
export {
  useCatalogueSearch,
  type UseCatalogueSearch,
  type UseCatalogueSearchOptions,
} from './useCatalogueSearch';
// Screen 11. Voice is a second way to produce a query string, so it lives
// beside the query state rather than in a feature folder of its own — and the
// recogniser is exported only as a hook, so no screen can reach the native
// module directly. `MockSpeechRecognition` is deliberately absent: it is a Jest
// artefact registered in jest.setup.js, not part of this surface.
export {
  initialVoiceState,
  voiceReducer,
  type VoiceAction,
  type VoiceErrorCode,
  type VoiceState,
  type VoiceStatus,
} from './voiceState';
export { VOICE_ERROR_COPY } from './voiceErrorCopy';
export { useVoiceSearch, type UseVoiceSearch } from './useVoiceSearch';
