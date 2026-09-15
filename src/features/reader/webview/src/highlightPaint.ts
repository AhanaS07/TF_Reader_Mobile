// Owner: Reader (Ahana).
//
// The pure half of `paintHighlights` — narrowing the payload to the shell that received it, and
// working out what actually changed since the last paint. Both are arithmetic over plain data, so
// they live here rather than in an entry (CLAUDE.md's split: DOM-reading code in the entries,
// everything else next door where a test can call it).
//
// >>> WHY A SHELL HAS TO NARROW A PAYLOAD IT SHOULD ALREADY KNOW THE SHAPE OF. <<<
// `paintHighlights` carries `EpubHighlightPaint[] | PdfHighlightPaint[]` — a union, because
// `CommandArgs` maps ONE argument tuple per command name and both shells share that command (the
// same reason `goTo` carries the whole `ReaderTarget` union rather than one type per shell). The
// union is NOT discriminated by format, and must not become so: `ContentFormat` is a frozen contract
// and WEBVIEW_BRIDGE.md forbids its values on the wire — `readerHighlights.ts` strips the `format`
// field host-side precisely so nothing here has to carry it. So the shells discriminate the only
// honest way left, on the FIELDS each shape actually has, exactly as `goTo` discriminates on `kind`.
//
// In practice a mismatch is unreachable — one shell is loaded per book, and the host picks
// `highlights.epub` or `highlights.pdf` from the same typechecked `switch (format)` that picked
// `openEpub`/`openPdf`. Counted rather than assumed away, because "unreachable" and "silently
// dropped" look identical from the outside.

import type {
  EpubHighlightPaint,
  PdfHighlightPaint,
} from '@/features/personalization/readerHighlights';

/** What `paintHighlights` carries. One array per shell; a book is one format, so one of them. */
export type HighlightPaintPayload = readonly (EpubHighlightPaint | PdfHighlightPaint)[];

/** The result of narrowing a payload: what this shell can paint, and how much it could not. */
export interface PartitionedHighlights<T> {
  mine: T[];
  /** How many entries were the OTHER shell's shape. Non-zero is a host bug, never a book's doing. */
  foreign: number;
}

function isEpub(entry: EpubHighlightPaint | PdfHighlightPaint): entry is EpubHighlightPaint {
  return typeof (entry as EpubHighlightPaint).startCfi === 'string';
}

/** Narrow a `paintHighlights` payload to the EPUB shell's shape. */
export function epubHighlights(
  payload: HighlightPaintPayload,
): PartitionedHighlights<EpubHighlightPaint> {
  const mine: EpubHighlightPaint[] = [];
  let foreign = 0;
  for (const entry of payload) {
    if (isEpub(entry)) mine.push(entry);
    else foreign++;
  }
  return { mine, foreign };
}

/** Narrow a `paintHighlights` payload to the PDF shell's shape. */
export function pdfHighlights(
  payload: HighlightPaintPayload,
): PartitionedHighlights<PdfHighlightPaint> {
  const mine: PdfHighlightPaint[] = [];
  let foreign = 0;
  for (const entry of payload) {
    if (isEpub(entry)) foreign++;
    else mine.push(entry);
  }
  return { mine, foreign };
}

/** What one repaint has to do to the shell's currently-painted set. */
export interface HighlightDiff<T> {
  added: T[];
  removedIds: string[];
}

/**
 * The incoming set against what is painted now.
 *
 * >>> THIS DIFF IS WHAT MAKES DELETE WORK, AND IT IS WHY THE HOST SENDS THE WHOLE SET. <<<
 * `readerHighlights.ts` returns the fresh, full, authoritative set from every add and every remove,
 * so the host never sends a patch — it re-sends everything. A deleted highlight is therefore simply
 * ABSENT from the next payload, and un-painting it is the same operation as not painting it: it
 * falls out of `removedIds` here. There is no separate `unpaintHighlight` command and there must not
 * be one; a second command would be a second way for the shell's state to disagree with storage.
 *
 * Ids alone decide, not contents. That is sound only because highlights are CREATE + DELETE ONLY —
 * there is no recolour or edit op (see READER_HIGHLIGHTS_WIRING.md's locked constraints, where that
 * restriction is what lets plain last-write-wins behave as a union across devices). If an edit op
 * ever lands, an unchanged id will no longer mean unchanged paint, and this has to compare colour too.
 */
export function diffHighlights<T extends { id: string }>(
  painted: ReadonlySet<string>,
  next: readonly T[],
): HighlightDiff<T> {
  const incoming = new Set<string>();
  const added: T[] = [];

  for (const entry of next) {
    incoming.add(entry.id);
    if (!painted.has(entry.id)) added.push(entry);
  }

  const removedIds: string[] = [];
  for (const id of painted) {
    if (!incoming.has(id)) removedIds.push(id);
  }

  return { added, removedIds };
}
