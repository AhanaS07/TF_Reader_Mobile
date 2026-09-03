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
