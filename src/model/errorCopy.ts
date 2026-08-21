// src/model/errorCopy.ts
// The single CatalogueError → copy map. Every screen with a catalogue-backed
// error state (search, home catalogue, shelf) reads from here rather than
// keeping its own — SearchScreen used to carry its own `ERROR_COPY`, and
// CatalogueScreen/ShelfScreen carried no code-specific copy at all, just a
// fixed "couldn't load" string regardless of why. One list means a code's
// wording only ever changes in one place, and a new CatalogueError member is a
// compile error here rather than a screen quietly falling back to nothing.
//
// KEYED ON CODE, NEVER ON HTTP STATUS. wokay's own vocabulary, not the
// transport's — see errors.ts. A reader is never shown a number.
import { CatalogueError } from '@model/errors';
import type { ErrorStateVariant } from '@components/ErrorState';

export const CATALOGUE_ERROR_COPY: Record<CatalogueError, string> = {
  [CatalogueError.NOT_FOUND]: 'This could not be found.',
  [CatalogueError.NETWORK_UNAVAILABLE]: 'You appear to be offline.',
  [CatalogueError.MALFORMED_FEED]: 'Something went wrong loading this content.',
  [CatalogueError.TIMEOUT]: 'This took too long to respond.',
  [CatalogueError.TOO_MANY_IDS]: 'Too many items requested at once.',
};

// Which ErrorState affordance a code renders with. NOT_FOUND is the one code
// nothing can fix by trying again — the thing asked for genuinely is not
// there — so it is the only one that resolves to a non-retryable variant.
const ERROR_STATE_VARIANT: Record<CatalogueError, ErrorStateVariant> = {
  [CatalogueError.NOT_FOUND]: 'not_found',
  [CatalogueError.NETWORK_UNAVAILABLE]: 'network',
  [CatalogueError.MALFORMED_FEED]: 'not_ready',
  [CatalogueError.TIMEOUT]: 'not_ready',
  [CatalogueError.TOO_MANY_IDS]: 'not_ready',
};

export function catalogueErrorVariant(code: CatalogueError): ErrorStateVariant {
  return ERROR_STATE_VARIANT[code];
}
