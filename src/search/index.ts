// src/search/index.ts
// The search shell's public surface — the interaction layer both pipelines
// consume (catalogue search today, institution search when B9 lands). Callers
// import from here rather than reaching into the individual files.
export { tokenise, isPrefixMatch } from './tokenise';
export {
  searchPublications,
  rankPublications,
  scorePublication,
  type ScoredPublication,
} from './searchPublications';
export {
  ALL_FORMATS,
  ACCESS_FILTERS,
  CONTENT_TYPES,
  DATE_RANGES,
  SORT_OPTIONS,
  availableFormats,
  filterByContentType,
  filterByDateRange,
  filterByFormat,
  isAccessFilterSupported,
  isContentTypeSupported,
  isSortSupported,
  sortPublications,
  type AccessFilter,
  type ContentTypeFilter,
  type DateRangeFilter,
  type FormatFilter,
  type SortOption,
} from './filters';
export { runCatalogueSearch, type CatalogueSearchInput } from './runCatalogueSearch';
