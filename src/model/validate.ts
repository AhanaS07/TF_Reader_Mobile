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

  // Open access is unlicensed and plaintext by definition. Either contradiction
  // would hand resolveAccess two conflicting answers about the same title.
  if (acquisition.actionId === 'openAccess') {
    if (acquisition.licenceModel !== undefined) {
      throw invalid(id, 'open access carries a licenceModel');
    }
    if (acquisition.encryption !== null) {
      throw invalid(id, 'open access carries an encryption block');
    }
  }

  // A concurrent licence is a count of copies; without the count there is
  // nothing for resolveAccess to compare against.
  if (acquisition.licenceModel === 'CONCURRENT' && acquisition.copiesTotal === undefined) {
    throw invalid(id, 'CONCURRENT licence has no copiesTotal');
  }
}
