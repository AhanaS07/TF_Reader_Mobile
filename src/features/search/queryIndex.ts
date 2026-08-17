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
//   • Multi-word -> PHRASE match: the query words must appear SIDE BY SIDE, in
//     order, within one text node (EPUB) / page (PDF). The hit is emitted at the
//     phrase's FIRST word, so Reader seeks to the start of the phrase. Words that
//     merely co-occur do NOT match: "finding chapter" does not match the text
//     "finding a chapter" because they are not adjacent. (This replaces the
//     earlier AND-within-a-unit rule, which returned every posting of every token
//     in any unit holding them all.)

import type { BookSearchIndex, Posting, SearchHit } from '@/shared/contracts';
import { termTokens } from './text';

/**
 * A posting's position as the (text-node/page, char-offset) pair phrase matching
 * needs. EPUB: the CFI's node path and its terminal `:offset`. PDF: the page and
 * `locator.offset`. Null when there is no offset to compare — a PDF posting
 * without one cannot be adjacency-checked, so it can never be part of a phrase.
 */
function postingPosition(posting: Posting): { node: string; offset: number } | null {
  const loc = posting.locator;
  if (loc.type === 'PDF') {
    return loc.offset == null ? null : { node: `p:${loc.page}`, offset: loc.offset };
  }
  // A point CFI is `epubcfi(<path>:<charOffset>)`. The terminal char offset is the
  // only ':' (the spine `!` and `[id]` assertions carry none), so split on the last.
  const m = /^(.*):(\d+)\)?$/.exec(loc.cfi);
  if (!m) return { node: loc.cfi, offset: 0 };
  return { node: m[1], offset: Number(m[2]) };
}

/**
 * The integer steps + terminal offset of a CFI, e.g.
 * `epubcfi(/6/2[ch1]!/4/4/1:113)` -> [6, 2, 4, 4, 1, 113]. `[id]` assertions and
 * the `!` spine delimiter are ignored. Enough to order the point-CFIs the
 * extractor emits; NOT a general CFI comparator (no ranges, no ignoreClass).
 *
 * A range CFI (comma-separated parent,start,end) is rejected outright: without the guard its
 * digits from both endpoints concatenate into one nonsense step array that sorts wrong and never
 * complains. The extractor emits only point CFIs and search is not adding range support, so a
 * range reaching here is a bug in the caller, not an input to handle — fail loudly. If a
 * range-emitting feature ever lands (e.g. multi-word/highlight-spanning), this needs a real
 * comparator, not a guard: compare the parent path, then the start offset.
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
  // Ordered, NOT deduped: a phrase needs word order and can repeat a word
  // ("the the"), unlike the old AND rule which only cared about presence.
  const tokens = termTokens(term);
  if (tokens.length === 0) return [];

  const perToken = tokens.map((t) => index.index[t] ?? []);

  // Any token missing entirely -> the phrase can never occur.
  if (perToken.some((postings) => postings.length === 0)) return [];

  let matches: Posting[];
  if (tokens.length === 1) {
    matches = perToken[0];
  } else {
    // A following word may sit at most this many separator chars past the previous
    // word's end. 1 is a single space; 2 also allows "a, b" or a double space. A gap
    // of 3+ has room for another word between them (a word is >=1 char with a
    // separator each side), so it is no longer "side by side".
    const MAX_SEP_GAP = 2;

    // Index each token's occurrences by node -> offset -> posting, so extending a
    // candidate phrase by one word is an O(1) lookup rather than a scan.
    const byNodeOffset = perToken.map((postings) => {
      const nodes = new Map<string, Map<number, Posting>>();
      for (const p of postings) {
        const pos = postingPosition(p);
        if (!pos) continue;
        let offsets = nodes.get(pos.node);
        if (!offsets) nodes.set(pos.node, (offsets = new Map()));
        offsets.set(pos.offset, p);
      }
      return nodes;
    });

    // A phrase hit is a first-word occurrence from which every later token can be
    // reached, each adjacent to the one before, in the same node. Emit the first
    // word so Reader seeks to the phrase start.
    matches = [];
    for (const first of perToken[0]) {
      const start = postingPosition(first);
      if (!start) continue;
      let offset = start.offset;
      let complete = true;
      for (let i = 1; i < tokens.length; i++) {
        const prevEnd = offset + tokens[i - 1].length;
        const offsets = byNodeOffset[i].get(start.node);
        let nextOffset = -1;
        for (let gap = 1; gap <= MAX_SEP_GAP; gap++) {
          if (offsets?.has(prevEnd + gap)) {
            nextOffset = prevEnd + gap;
            break;
          }
        }
        if (nextOffset < 0) {
          complete = false;
          break;
        }
        offset = nextOffset;
      }
      if (complete) matches.push(first);
    }
    if (matches.length === 0) return [];
  }

  return [...matches].sort(readingOrder).map((p) => toHit(index.bookId, p));
}
