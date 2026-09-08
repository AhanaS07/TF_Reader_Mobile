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
//   • Adjacency is by TOKEN SEQUENCE (posting.seq), not character distance: word
//     N is adjacent to word N+1 iff their seq values are consecutive in the same
//     unit. The earlier char-offset rule (a small MAX_SEP_GAP over CFI/offset)
//     silently lost a phrase whenever the source XHTML put >2 chars between two
//     words — newline + indentation, routine in pretty-printed EPUBs — so the
//     same phrase matched in one chapter and missed in the next. A pre-seq index
//     (version < 2) has no seq, so it cannot phrase-match; single-word is fine.

import type { BookSearchIndex, Posting, SearchHit } from '@/shared/contracts';
import { termTokens } from './text';

/**
 * A posting's position for phrase matching: the adjacency UNIT it lives in, and its token
 * SEQUENCE within the book. The unit prevents a phrase from spanning two text nodes / pages
 * (end of one block + start of the next are consecutive in seq but not a phrase); `seq` is
 * what makes "side by side" whitespace-independent.
 *
 * EPUB unit = the CFI's node path (everything before the terminal `:offset`; the offset
 * itself is no longer read for adjacency). PDF unit = the page. Null when the posting has
 * no `seq` — a pre-seq index (version < 2), which therefore cannot phrase-match.
 */
function postingPosition(posting: Posting): { node: string; seq: number } | null {
  if (posting.seq == null) return null;
  const loc = posting.locator;
  if (loc.type === 'PDF') {
    return { node: `p:${loc.page}`, seq: posting.seq };
  }
  // AUDIO is unreachable here - BookSearchIndex.format never includes it, so no posting is ever
  // built from one - but the check keeps this function total over the Locator union.
  if (loc.type === 'AUDIO') return null;
  // The unit is the CFI's node path. A point CFI is `epubcfi(<path>:<charOffset>)`, and the
  // terminal char offset is the only ':' (the spine `!` and `[id]` assertions carry none),
  // so everything before the last ':' is the node.
  const m = /^(.*):(\d+)\)?$/.exec(loc.cfi);
  return { node: m ? m[1] : loc.cfi, seq: posting.seq };
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
    // Index each token's occurrences by unit -> seq -> posting, so extending a candidate
    // phrase by one word is an O(1) lookup rather than a scan. A posting with no seq
    // (pre-v2 index) drops out here via postingPosition, so it can never form a phrase.
    const byNodeSeq = perToken.map((postings) => {
      const nodes = new Map<string, Map<number, Posting>>();
      for (const p of postings) {
        const pos = postingPosition(p);
        if (!pos) continue;
        let seqs = nodes.get(pos.node);
        if (!seqs) nodes.set(pos.node, (seqs = new Map()));
        seqs.set(pos.seq, p);
      }
      return nodes;
    });

    // A phrase hit is a first-word occurrence whose every later token sits at the NEXT
    // token position (start.seq + i) in the SAME unit — adjacency by token sequence, not
    // character distance, so whitespace/indentation in the source is irrelevant. Emit the
    // first word so Reader seeks to the phrase start.
    matches = [];
    for (const first of perToken[0]) {
      const start = postingPosition(first);
      if (!start) continue;
      let complete = true;
      for (let i = 1; i < tokens.length; i++) {
        if (!byNodeSeq[i].get(start.node)?.has(start.seq + i)) {
          complete = false;
          break;
        }
      }
      if (complete) matches.push(first);
    }
    if (matches.length === 0) return [];
  }

  return [...matches].sort(readingOrder).map((p) => toHit(index.bookId, p));
}
