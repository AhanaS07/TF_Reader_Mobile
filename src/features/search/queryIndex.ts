// Owner: Search (Vaishnavi).
//
// The query half of the Day-4 prototype: the PURE, in-memory lookup core. No
// I/O, no crypto, no session — it runs over an already-decoded BookSearchIndex
// (whatever ContentProvider.getIndex hands back, decoded to the frozen shape).
// This is the unit-testable heart of `QueryIndex(bookId, term)`; the session/
// decrypt wrapper around it is separate (and not part of the prototype).
//
// Semantics (from the design note):
//   • The term is tokenized with the SAME rules as the index (text.ts).
//   • Single token -> every posting for that word, in reading order.
//   • Multi-word -> AND of tokens within one addressing UNIT (page for PDF,
//     chapter for EPUB): return postings of the query words that live in a unit
//     containing ALL query tokens. No phrase/adjacency matching in the prototype.

import type { BookSearchIndex, Locator, Posting, SearchHit } from '@/shared/contracts';
import { termTokens } from './text';

/**
 * The addressing unit a posting belongs to, per the AND rule: page for PDF,
 * chapter for EPUB. Stringified so it keys a Set/Map uniformly.
 */
function unitKey(posting: Posting): string {
  const loc: Locator = posting.locator;
  return loc.type === 'PDF' ? `p:${loc.page}` : `c:${posting.chapterId}`;
}

/**
 * The integer steps + terminal offset of a CFI, e.g.
 * `epubcfi(/6/2[ch1]!/4/4/1:113)` -> [6, 2, 4, 4, 1, 113]. `[id]` assertions and
 * the `!` spine delimiter are ignored. Enough to order the point-CFIs the
 * extractor emits; NOT a general CFI comparator (no ranges, no ignoreClass).
 *
 * FLAGGED, pending Vaishnavi review: a range CFI (comma-separated parent,start,end, e.g. for a
 * future multi-word-highlight feature) used to fall through the regex below silently — every
 * digit from BOTH range endpoints got concatenated into one nonsense step array, sorting wrong
 * without ever throwing. extractor.ts never emits range CFIs today so this was unreachable, but
 * "unreachable today" and "silently wrong forever if that changes" is exactly the kind of trap
 * this comment used to just note rather than guard against. Throwing here converts a future
 * silent-sort bug into a loud one; it does not add range-CFI support, which is a real design
 * decision that isn't mine to make in this file.
 */
function cfiSteps(cfi: string): number[] {
  if (cfi.includes(',')) {
    throw new Error(
      `cfiSteps: range CFI (comma-separated parent,start,end) is not a supported comparator input — got "${cfi}"`
    );
  }
  const steps: number[] = [];
  const re = /[/:](\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cfi)) !== null) steps.push(Number(m[1]));
  return steps;
}

/** Reading-position sort. PDF: (page, offset). EPUB: numeric CFI-step order. */
function readingOrder(a: Posting, b: Posting): number {
  if (a.locator.type === 'PDF' && b.locator.type === 'PDF') {
    return a.locator.page - b.locator.page || (a.locator.offset ?? 0) - (b.locator.offset ?? 0);
  }
  if (a.locator.type === 'EPUB' && b.locator.type === 'EPUB') {
    const sa = cfiSteps(a.locator.cfi);
    const sb = cfiSteps(b.locator.cfi);
    for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
      const d = (sa[i] ?? 0) - (sb[i] ?? 0);
      if (d !== 0) return d;
    }
    return 0;
  }
  return 0;
}

function toHit(bookId: string, posting: Posting): SearchHit {
  return { bookId, chapterId: posting.chapterId, locator: posting.locator, snippet: posting.snippet };
}

/**
 * Look `term` up in an already-decoded index and return hits in reading order.
 * Empty term, no matches, or (for multi-word) no unit containing every token all
 * yield `[]`.
 */
export function queryIndex(index: BookSearchIndex, term: string): SearchHit[] {
  const tokens = termTokens(term);
  if (tokens.length === 0) return [];

  // Postings per query token (dedup tokens so a repeated word isn't over-counted).
  const uniqueTokens = [...new Set(tokens)];
  const perToken = uniqueTokens.map((t) => index.index[t] ?? []);

  // Any token missing entirely -> the AND can never be satisfied.
  if (perToken.some((postings) => postings.length === 0)) return [];

  let matches: Posting[];
  if (perToken.length === 1) {
    matches = perToken[0];
  } else {
    // Units that contain EVERY query token.
    const unitsPerToken = perToken.map((postings) => new Set(postings.map(unitKey)));
    const commonUnits = unitsPerToken.reduce((acc, units) => {
      const next = new Set<string>();
      for (const u of acc) if (units.has(u)) next.add(u);
      return next;
    });
    if (commonUnits.size === 0) return [];

    // Return the query words' postings that live in a qualifying unit. Dedup by
    // identity so a word appearing once isn't emitted twice.
    const seen = new Set<Posting>();
    matches = [];
    for (const postings of perToken) {
      for (const p of postings) {
        if (commonUnits.has(unitKey(p)) && !seen.has(p)) {
          seen.add(p);
          matches.push(p);
        }
      }
    }
  }

  return [...matches].sort(readingOrder).map((p) => toHit(index.bookId, p));
}
