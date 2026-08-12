// src/search/searchPublications.ts
// B1 — catalogue search over publications already in hand.
//
// FETCH-AND-FILTER, DELIBERATELY. `CatalogueSource` has no search method and
// Q-E (does wokay expose a search link template?) is unresolved. The Foundation
// Spec's contingency is to build fetch-and-filter first because it works either
// way and is the fallback needed regardless. When a server-side search endpoint
// lands, it becomes another source of `Publication[]` and this ranking still
// applies to whatever comes back.
//
// PURE. No adapter, no store, no React. The screen owns the publications and the
// query string; this decides what matches and in what order. That is what makes
// the whole of B1 testable against fixtures with nothing mounted.
import type { Publication } from '@model/types';

import { isPrefixMatch, tokenise } from './tokenise';

// Field weights. A title hit is worth far more than a description hit — a reader
// searching "climate" wants the book called Climate, not the twelve books whose
// blurb mentions it. The exact numbers matter less than the ORDER of magnitude
// between tiers, which is why they are spaced rather than adjacent.
const WEIGHTS = {
  title: 10,
  subtitle: 6,
  authors: 5,
  subjects: 4,
  publisher: 2,
  description: 1,
} as const;

// A whole-word hit beats a prefix hit inside the same field, so "art" ranks a
// book called "Art" above one called "Artificial Intelligence".
const EXACT_BONUS = 2;

export interface ScoredPublication {
  publication: Publication;
  score: number;
}

// Every searchable field flattened to a token list once per publication, so the
// per-term loop below is not re-splitting the same description N times.
interface TokenisedFields {
  title: string[];
  subtitle: string[];
  authors: string[];
  subjects: string[];
  publisher: string[];
  description: string[];
}

function tokeniseFields(publication: Publication): TokenisedFields {
  return {
    title: tokenise(publication.title),
    subtitle: publication.subtitle ? tokenise(publication.subtitle) : [],
    authors: publication.authors.flatMap(tokenise),
    subjects: publication.subjects.flatMap(tokenise),
    publisher: publication.publisher ? tokenise(publication.publisher) : [],
    description: publication.description ? tokenise(publication.description) : [],
  };
}

// Best score this term can earn anywhere in the publication, or 0 if it appears
// nowhere. Summing every hit instead would let a description that repeats a word
// nine times outrank a title, which is the classic keyword-stuffing failure.
function scoreTerm(fields: TokenisedFields, term: string): number {
  let best = 0;

  for (const [field, weight] of Object.entries(WEIGHTS) as [
    keyof TokenisedFields,
    number,
  ][]) {
    for (const token of fields[field]) {
      if (!isPrefixMatch(token, term)) continue;

      const score = token === term ? weight + EXACT_BONUS : weight;
      if (score > best) best = score;
    }
  }

  return best;
}

/**
 * Scores one publication against already-tokenised query terms.
 *
 * EVERY TERM MUST MATCH SOMETHING — the terms are ANDed. "climate policy"
 * means both words, not either: OR semantics on a two-word query returns most
 * of the catalogue and reads as though search is broken.
 *
 * Returns 0 when any term is unmatched, which is the caller's signal to drop it.
 */
export function scorePublication(publication: Publication, terms: string[]): number {
  if (terms.length === 0) return 0;

  const fields = tokeniseFields(publication);
  let total = 0;

  for (const term of terms) {
    const termScore = scoreTerm(fields, term);
    if (termScore === 0) return 0;
    total += termScore;
  }

  return total;
}

/**
 * Ranks publications against a raw query string, best first.
 *
 * A BLANK QUERY IS NOT A FAILED SEARCH — it is the absence of a constraint, so
 * everything comes back in the order it arrived. That lets the caller apply
 * filters on their own with no query typed, and keeps "nothing searched yet"
 * a presentation decision on the screen rather than a rule buried in here.
 * A query of pure punctuation tokenises to nothing and is treated the same way.
 */
export function searchPublications(publications: Publication[], query: string): Publication[] {
  return rankPublications(publications, query).map((scored) => scored.publication);
}

/**
 * As `searchPublications`, but keeps the scores. Exported for the tests and for
 * anything that later wants to show relevance; the screen wants the plain list.
 */
export function rankPublications(
  publications: Publication[],
  query: string,
): ScoredPublication[] {
  const terms = tokenise(query);

  if (terms.length === 0) {
    return publications.map((publication) => ({ publication, score: 0 }));
  }

  return publications
    .map((publication) => ({ publication, score: scorePublication(publication, terms) }))
    .filter((scored) => scored.score > 0)
    .sort(compareByScoreThenTitle);
}

// Ties break on title so the order is STABLE between renders. Two publications
// with the same score reordering on every keystroke looks like a rendering bug
// and makes the list impossible to tap.
function compareByScoreThenTitle(a: ScoredPublication, b: ScoredPublication): number {
  if (b.score !== a.score) return b.score - a.score;
  return a.publication.title.localeCompare(b.publication.title);
}
