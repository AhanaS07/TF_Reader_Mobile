// src/model/validate.ts
// Cross-field invariants — the backstop for rules TypeScript cannot state.
//
// SCOPE, so this does not become a second normalizer: `strict` already proves
// every field's TYPE, and normalize.ts already rejects malformed WIRE data. The
// only gap left is relationships BETWEEN fields — "an audiobook has no
// encryption", "open access has no licence". Those are frozen contract claims,
// and nothing in the type system can hold us to them.
//
// Asserted at the adapter boundary so a bad feed fails where it entered, with the
// offending id in the message, instead of surfacing as an unexplained blank row
// or a decrypt attempt on a plain MP3.
import type { Publication } from '@model/types';
import { CatalogueError, CatalogueFailure } from '@model/errors';

function invalid(id: string, why: string): CatalogueFailure {
  return new CatalogueFailure(CatalogueError.MALFORMED_FEED, `${id}: ${why}`);
}

export function assertPublication(publication: Publication): void {
  const { id, format, acquisition } = publication;

  // primitives.ts, verbatim: "AUDIO is never encrypted and never has a search
  // index." Encrypted audio would send the crypto layer after a key that was
  // never issued.
  if (format === 'AUDIO') {
    if (acquisition.encryption !== null) {
      throw invalid(id, 'AUDIO is never encrypted, but an encryption block is present');
    }
    if (acquisition.hasSearchIndex) {
      throw invalid(id, 'AUDIO never has a search index, but hasSearchIndex is true');
    }
  }

  // The tier and the rel must agree, both ways, or resolveAccess gets two answers
  // about one title. `rel` says how a book is obtained and `licenceModel` says
  // what to render; they describe the same fact from two sides.
  const openAccessRel = acquisition.actionId === 'openAccess';
  const openAccessTier = acquisition.licenceModel === 'OPEN_ACCESS';
  if (openAccessRel !== openAccessTier) {
    throw invalid(id, `rel ${acquisition.actionId} disagrees with tier ${acquisition.licenceModel}`);
  }

  // Open access is plaintext by definition. Keyed off the TIER, not the rel: the
  // contract states this rule about the tier, and says to read one field rather
  // than two.
  if (openAccessTier && acquisition.encryption !== null) {
    throw invalid(id, 'open access carries an encryption block');
  }

  // ELITE is the copy-limited tier, and the count is the point of it: without one
  // there is nothing for resolveAccess to compare against.
  //
  // EXCEPT `subscribe`, same as `hasSearchIndex`/`canPersist` in normalize.ts and
  // for the same reason: a subscribe link leads to a page, not to the loan
  // endpoint, so there is no free-copy count to report. Every subscribe example
  // in the contract omits `copies` regardless of tier — this used to be
  // unreachable because normalize.ts rejected these publications outright; now
  // that it does not, this is the second of the two places that rule had to move.
  if (
    acquisition.licenceModel === 'ELITE' &&
    acquisition.copiesTotal === undefined &&
    acquisition.actionId !== 'subscribe'
  ) {
    throw invalid(id, 'ELITE licence has no copiesTotal');
  }
}
