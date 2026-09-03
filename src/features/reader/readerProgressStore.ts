// Owner: Reader (Ahana).
//
// Converts between this feature's own `ReaderPosition`/`ReaderTarget` (readerBridge.ts, discriminated
// on `kind`, no notion of BookId or persistence) and Sync's `Locator` (the durable/synced shape
// `progressStore.ts` stores, and the ONLY resume source now — there is no in-memory session cache;
// see `ReaderRouteScreen.tsx`'s header for why one existed briefly and why it was removed). These
// two functions are what let `ReaderRouteScreen.tsx` read/write `progressStore` without either side
// needing to know the other's shape.
//
// AUDIO's `Locator` variant is out of scope here on purpose — this module only ever sees EPUB/PDF
// positions, and `targetFromLocator` treats an AUDIO row for this book as "nothing to resume from"
// rather than a case it should convert, the same way a null/legacy locator is.

import type { ReaderPosition, ReaderTarget } from '@/features/reader/readerBridge';
import type { Locator } from '@/shared/contracts';

/**
 * A durable `Locator` for this position, or null when there is nothing worth persisting yet — an
 * EPUB that reported `relocated` before its rendition had produced a CFI. Writing `null` as a CFI
 * would make a later resume `goTo` nowhere, so this is the guard that stops that.
 */
export function toLocator(position: ReaderPosition): Locator | null {
  if (position.kind === 'page') return { type: 'PDF', page: position.page };
  return position.cfi === null ? null : { type: 'EPUB', cfi: position.cfi };
}

/**
 * A resumable `ReaderTarget` for `goTo` from a stored `Locator`, or null when there is nothing to
 * resume (no row, or the row belongs to an AUDIO book). CFI travels as `href` — `ReaderTarget` has
 * no `cfi` kind, but `epub.entry.ts`'s own `goTo` forwards `target.href` straight to epub.js's
 * `display()`, which already accepts a bare CFI string. Not new bridge surface.
 */
export function targetFromLocator(locator: Locator | null): ReaderTarget | null {
  if (locator === null) return null;
  if (locator.type === 'PDF') return { kind: 'page', page: locator.page };
  if (locator.type === 'EPUB') return { kind: 'href', href: locator.cfi };
  return null;
}

/**
 * Structural equality for the fields each `Locator` variant actually carries meaning in — NOT
 * `JSON.stringify` comparison, which would depend on key order matching between two values built
 * by different code paths (one from `toLocator`, one from `progressStore`'s own row mapper) and
 * happens to hold today only by accident. Used by `ReaderRouteScreen.tsx`'s cross-device conflict
 * check to tell "the sync pull that just landed changed nothing I don't already know" from "someone
 * else moved this book" — `PDF`'s optional `offset` is deliberately excluded, since it is a lower
 * bound Sync derives, not part of what a reader would recognise as "the same position".
 */
export function locatorsEqual(a: Locator | null, b: Locator | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.type !== b.type) return false;
  if (a.type === 'EPUB' && b.type === 'EPUB') return a.cfi === b.cfi;
  if (a.type === 'PDF' && b.type === 'PDF') return a.page === b.page;
  if (a.type === 'AUDIO' && b.type === 'AUDIO') return a.positionMs === b.positionMs;
  return false;
}
