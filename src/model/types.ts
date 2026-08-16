// src/model/types.ts
// Catalogue domain model — foundation for CAP-2 / CAP-3 (Discovery & Selection).
//
// THE CONTRACT for everything above the adapter layer. Screens, stores and the
// gallery code against these types and must never see an OPDS document: the
// nested metadata/links/properties shape and the full rel URIs stop at
// `opds/normalize.ts`. If a component ever needs to read `links[]` or match on
// 'http://opds-spec.org/acquisition/borrow', a field is missing here — add it
// here rather than leaking the wire format upward.
//
// Reuses `BookId` and `ContentFormat` from the frozen primitives rather than
// redeclaring them, so a catalogue publication and a decrypt session agree on
// identity and format by construction.
import type { BookId, ContentFormat } from '@/shared/types/primitives';

// The OPDS acquisition rel, normalized to a closed union. A union, not a
// string, so an unrecognised rel fails loudly in rels.ts instead of flowing
// onward as an arbitrary value.
//
// NOT THE BUTTON VOCABULARY, and the distinction now matters. `borrow` here is
// the wire rel — literally what wokay's feed sends, and the contract still lists
// it. It survived the 12 Aug flow change untouched even though the borrow BUTTON
// did not; see ACTION_IDS below. Two similar words, only one of them moved.
//
//   http://opds-spec.org/acquisition/borrow       → 'borrow'
//   http://opds-spec.org/acquisition              → 'acquire'
//   http://opds-spec.org/acquisition/open-access  → 'openAccess'
//   http://opds-spec.org/acquisition/subscribe    → 'subscribe'
//
// `subscribe` is the fourth rel, and it is the odd one: it leads to a page
// explaining how to get access, not to a file. So it carries no
// `indirectAcquisition`, which means no format can be derived from it.
export type AcquisitionRel = 'borrow' | 'acquire' | 'openAccess' | 'subscribe';

// The RESOLVED button vocabulary — what `AccessResult.actions` will hold once
// `src/access/resolveAccess` exists. Distinct from `AcquisitionRel` above: a
// rel says which acquisition mechanism a publication uses, this says which
// buttons to draw once session and licence state is folded in (e.g. an
// 'acquire' rel while signed out resolves to 'signIn', not 'acquire').
// Declared as a const array first, with the union derived from it, so
// validate.ts, the state gallery and ActionButton all enumerate the same
// runtime values the type is derived from — one definition, not several kept in
// sync by hand.
//
// L-3 IS CLOSED. Still six words, but not the same six as of the 12 Aug flow
// change: `borrow` is gone and `revokeLicence` takes its place, `waitlist`
// becomes `addToQueue`, `signin` becomes `signIn`. The reader no longer borrows
// anything — the first tap generates a licence, every tap after it checks one,
// and the reader is never shown the difference. Anything that still describes a
// Borrow button is superseded, including the signed design specification.
//
// `subscribe` STAYS — decided 11 Aug. B2C is not cut. Tapping it resolves the
// title to read + download, if the title falls inside the reader's licence.
//
// `download` IS NOT AN ELITE ACTION — decided 13 Aug. Elite is read-only: it
// offers addToQueue, then read + revokeLicence once a licence is held, and no
// path to an offline copy at any point. That rule lives in resolveAccess and
// never in a component, which is exactly why `download` stays in this union —
// Open Access and Subscription both still use it.
export const ACTION_IDS = [
  'read',
  'download',
  'addToQueue',
  'revokeLicence',
  'subscribe',
  'signIn',
] as const;
export type ActionId = (typeof ACTION_IDS)[number];

// The one tier vocabulary. Across wokay's whole surface the same three values
// appear in `licenceModel` in a feed, in `accessTier` on a book and in the
// `?accessTier=` filter, so there is nothing to translate.
//
// Beware flambeau's `ENTITLED_UNLIMITED` / `ENTITLED_CONCURRENT`: that is a
// different, live enum on the far side of the Java seam, not an older spelling of
// these. flambeau owns the translation — see docs/contracts/.
export const ACCESS_TIERS = ['OPEN_ACCESS', 'SUBSCRIPTION', 'ELITE'] as const;
export type AccessTier = (typeof ACCESS_TIERS)[number];

// The subset of the OPDS `encrypted` block the catalogue legitimately knows.
//
// DELIBERATELY NARROW. `EncryptionDescriptor` in shared/contracts carries
// wrappedBek / keyId / keyFingerprint — those arrive with the download grant,
// NOT in a catalogue listing, and inventing them here would be fiction.
// `cipherLength` is likewise absent: the contract's
// `content.length === cipherLength === 12 + originalLength + 16` invariant is
// asserted at store() time, and deriving two of its three terms from a listing
// is exactly the silent drift that invariant exists to catch.
export interface CatalogueEncryption {
  // Normalized from the W3C URI in the feed ('...xmlenc11#aes256-gcm') to the
  // literal the frozen EncryptionDescriptor uses, so the two agree on sight.
  algorithm: 'AES-256-GCM';
  // PLAINTEXT byte length. Not derivable from the ciphertext without decrypting,
  // so it ships even though it looks redundant next to a download's byte count.
  originalLength: number;
}

// The single acquisition option for a publication, flattened from the OPDS
// acquisition link plus its `properties` bag.
//
// EVERY FIELD HERE IS AN INPUT TO ACCESS, NEVER A VERDICT. Design Spec §5.1:
// "the UI must never calculate access rights". `src/access/resolveAccess` is the
// only place licenceModel / copiesTotal / accessTier may be interpreted; a
// component that reads them to decide what to render has moved access logic into
// the view.
export interface Acquisition {
  actionId: AcquisitionRel;
  // Where the action is performed (loan creation, direct download). Absolute, as
  // supplied by the feed — the adapter does not rewrite hosts.
  href: string;
  // ALWAYS PRESENT, including for open access. The contract requires it on every
  // acquisition link: `rel` says how the book is obtained, `licenceModel` says
  // what to render, and one field is read rather than two.
  licenceModel: AccessTier;
  // Total copies the institution holds. Present only for ELITE.
  copiesTotal?: number;
  // null ⇒ plaintext: open access, or ANY audio. Not `undefined` — the frozen
  // content-provider contract already defines null as exactly this state, so a
  // missing `encrypted` block is a meaningful value rather than absent data.
  encryption: CatalogueEncryption | null;
  // Whether a bundled search index ships with the book. Always false for AUDIO.
  hasSearchIndex: boolean;
  // Whether the book may be written to device storage. false ⇒ memory-only.
  canPersist: boolean;
  // STILL OPEN (CLAUDE.md Q-D), but narrower than it was: wokay do publish an
  // `accessTier` on their `/api/v1/catalogue/**` fetch surfaces, carrying the
  // same three values as `licenceModel` above. What is unsettled is whether we
  // ever read it, given the feed already answers the question. Kept optional
  // until someone decides — the feed path never populates it.
  accessTier?: string;
}

// One book or audiobook, flattened for display.
export interface Publication {
  // Stable identity, taken from the tail of the publication's `self` href
  // ('.../publications/item_42' → 'item_42'). NOT the ISBN: the backend keys by
  // itemId, and open-access titles may lack an ISBN entirely.
  id: BookId;
  // Bare ISBN, unwrapped from the 'urn:isbn:' prefix. Optional — it is a
  // display/lookup detail, never identity.
  isbn?: string;
  title: string;
  subtitle?: string;
  // Flattened from [{ name, sortAs? }]. Order preserved (it is credit order);
  // `sortAs` is dropped until something actually sorts by author.
  authors: string[];
  publisher?: string;
  language?: string;
  // Publication date as supplied by the feed ('2020-09-30'). Kept a string, not
  // a Timestamp: primitives.ts reserves Timestamp for epoch-ms client wall-time,
  // and a date-only value has no meaningful time component to invent.
  published?: string;
  subjects: string[];
  description?: string;
  numberOfPages?: number;
  // Derived from the acquisition link's mime type, not from metadata.
  format: ContentFormat;
  // Widest supplied image; the narrowest becomes thumbnailUrl. Both optional —
  // a publication with no cover renders a placeholder, it is not an error.
  coverUrl?: string;
  thumbnailUrl?: string;
  acquisition: Acquisition;
}

// A tab/section pointer in the catalogue's navigation.
//
// NAVIGATION IS DATA, NOT CODE. Settled 16 Aug 2026 (AGENTS.md L-5): an
// administrator configures the shelves per institution, so the count, the titles
// and the ids are all theirs. The UI renders whatever array it is handed, in the
// order it arrives, and no shelf is named in a type or a branch anywhere.
export interface NavLink {
  title: string;
  href: string;
  // Tail of the href ('.../groups/shelf_2' → 'shelf_2'), so a nav tap maps
  // straight to getShelf(institutionId, shelfId) without re-parsing a URL.
  // An OPAQUE KEY: it is whatever the server put in the URL, and nothing may
  // read meaning into it.
  shelfId: string;
}

// A group of publications — one shelf/carousel on the home screen, or a full
// paginated listing when fetched on its own.
export interface Shelf {
  // Tail of the shelf's `self` href ('.../groups/shelf_2').
  //
  // IDENTITY, NOT TITLE. The two are independent in real data, and so are the two
  // titles for one shelf: a nav row and the shelf's own feed can name the same id
  // differently, and both are correct. Never key a shelf by its title.
  id: string;
  title: string;
  publications: Publication[];
  // Server-reported total across all pages. Absent on home-screen shelves,
  // which are previews rather than paginated listings.
  totalItems?: number;
  itemsPerPage?: number;
  // Next page index, derived from the presence of a `next` link. Absent ⇒ this
  // is the last page. A number rather than the raw href so callers page by
  // index and never hand-build a URL.
  nextPage?: number;
}

// The institution's home catalogue: what tabs exist, plus preview shelves.
export interface Catalogue {
  title: string;
  // Feed's last-modified, ISO-8601 as supplied (wire string, not a Timestamp).
  modified?: string;
  navigation: NavLink[];
  shelves: Shelf[];
  // Templated search endpoint ('...{?query}'), kept raw for the search feature
  // to expand. Absent ⇒ this catalogue is not searchable.
  searchHref?: string;
}

// One page of catalogue search results — what `normalizeSearchFeed` produces and
// what the search pipeline (B1) hands the UI.
//
// SEARCH IS SERVER-SIDE AND ENTITLEMENT-SCOPED. Matching, tokenising and ranking
// all happen behind the search endpoint; nothing above the adapter re-orders or
// re-filters this list. "We filter, you render."
//
// THREE FIELDS THAT LOOK ALIKE AND ARE NOT:
//
//   `publications` is ALWAYS AN ARRAY HERE, even when the response omitted the
//   key entirely. A zero-result search legitimately comes back as a navigation
//   feed with no `publications` at all, and that is a valid empty state — not a
//   malformed feed. Defaulting it here is what stops every consumer having to
//   remember that.
//
//   `browseInstead` is what the server offers INSTEAD of results: somewhere to go
//   when the query matched nothing. Empty on a successful search. Reuses
//   `NavLink` because a browse target is exactly a navigation entry — same title,
//   same href, same precomputed shelfId.
//
//   `next` is the response's own `next` value, KEPT VERBATIM as an opaque string.
//   Deliberately NOT `Shelf.nextPage`: that is a page INDEX parsed out of the
//   href, which forces the client to understand the server's paging scheme and
//   throws MALFORMED_FEED on a cursor it cannot parse. A search response is
//   followed, not reconstructed — so no caller ever builds this value, and a
//   cursor-based server needs no change here. Absent ⇒ last page.
export interface SearchFeed {
  publications: Publication[];
  // Server-reported total across all pages. Absent ⇒ the server did not say.
  totalItems?: number;
  next?: string;
  browseInstead: NavLink[];
}

// ─────────────────────────────────────────────────────────────────────────────
// From Akriti's dcd04fe types.ts — net-new scope only. Everything below is
// additive: it does not touch OPDS normalization (rels.ts/normalize.ts) or
// re-shape Publication/Acquisition/Shelf/Catalogue above. Her ContentItem,
// AcquisitionLink/Properties, Group, CatalogueRoot, Feed, DataAdapter and the
// OPDS_REL_BY_URI/MIME_TO_CONTENT_FORMAT/SCHEMA_TYPE_TO_WORK_TYPE tables are
// deliberately NOT here — those compete with code already built and tested in
// this branch and need a real conversation with her before merging.
// ─────────────────────────────────────────────────────────────────────────────

// OURS. The *work* type, which decides whether we render article detail
// (screen 04) or book detail (screen 05). `@type` is OFFICIAL — confirmed
// 11 Aug. 'book' and 'audiobook' are confirmed values; journal and article are
// still to come (Q-1b).
export const WORK_TYPES = ['book', 'journal', 'article', 'audiobook'] as const;
export type WorkType = (typeof WORK_TYPES)[number];

// OURS. A UI state, not a wokay field — one value per distinct thing the action
// bar can render, so a state with no visible difference does not belong here.
//
// REBUILT for the 12 Aug flow change and the 13 Aug Elite decision. Two left:
//
//   `requires_loan` — there is no borrow step left to require.
//   `no_seats`      — Elite joins the queue whether or not a seat is free, so
//                     the seat count no longer changes a single button.
//                     `Availability` is still worth fetching for
//                     `queuePosition`, but that is a message to display, not a
//                     state that picks buttons.
//
// Two arrived, both Elite: `requires_queue` (no licence held — offer
// addToQueue) and `queued` (waiting — the same button reads "Added to queue"
// and cannot be tapped again).
//
// `available` covers two shapes rather than one, because the difference is in
// `actions` and not here: Open Access and Subscription resolve to
// read + download, Elite-with-a-licence to read + revokeLicence.
export const ACCESS_STATES = [
  'available',
  'requires_signin',
  'requires_queue',
  'queued',
  'not_entitled',
] as const;
export type AccessState = (typeof ACCESS_STATES)[number];

// wokay's enumerated failure reasons. ErrorState copy is keyed on these.
export const ERROR_CODES = [
  'UNAUTHENTICATED',
  'TOKEN_EXPIRED',
  'FORBIDDEN_INSTITUTION_MISMATCH',
  'NO_ENTITLEMENT',
  'ENTITLEMENT_EXPIRED',
  'ENTITLEMENT_SUSPENDED',
  'CONTENT_NOT_READY',
  'DOWNLOAD_NOT_PERMITTED',
  'INVALID_DEVICE_PUBLIC_KEY',
  'NOT_FOUND',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

// From `GET /api/v1/institutions` (list) and `/{id}` (detail). Both
// UNAUTHENTICATED, which is what the pre-sign-in flow needs. Only ACTIVE
// institutions appear; an inactive one is 404, not 403, so its existence is
// not disclosed.
//
// ⚠ No sample for this shape yet — hand-written from wokay's field names and
// the one part of this file still unverified against a fixture.
export interface Institution {
  id: string;
  code: string;
  name: string;
  // e.g. 'UNIVERSITY'
  type: string;
  country: string;
  city?: string;
  // Was `crestUrl`. May be absent — InstitutionRow initials fallback.
  logoUrl?: string;
  // `primaryColor` is per-institution and our token palette is fixed. DECIDED:
  // we do NOT theme per institution in the prototype — carried and
  // deliberately unused, so adopting it later is additive.
  branding?: { logoUrl?: string; primaryColor?: string };
  // Detail only. `method` is always SAML; stays in the payload so the client
  // needs no special case. `idpHint` is what we hand to flambeau.
  signIn?: { method: 'SAML'; idpHint: string };
  // Detail only. Handed to us so we never build wokay's URLs.
  catalogueUrl?: string;
}

// Issued by flambeau, `aud: 'tf-app'`. There is no service audience.
export interface Session {
  userId: string;
  institutionId?: string;
  roles: string[];
  collections: string[];
  exp: number;
  // RETAINED — decided 11 Aug. Individual (B2C) subscribers are not cut;
  // `subscribe` stays in `ActionId`, and the session payload is not settled to
  // `{ userId, institutionId, roles, exp }` because of it.
  type?: 'b2b' | 'b2c';
}

// Per-user, per-item, mutable. Never a property of the feed. Written for
// SUBSCRIPTION and ELITE. Never for OPEN_ACCESS.
export interface Loan {
  itemId: string;
  state: 'none' | 'active' | 'expired';
  expiresAt?: number;
}

// Elite only, detail screen only. `GET /api/v1/availability?itemId=` on
// flambeau — the app asks, wokay never do.
//
// IT NO LONGER DECIDES A BUTTON — 13 Aug. Elite queues whether or not a seat is
// free, so `total` and `available` are informational and `queuePosition` is the
// only field with a job: telling a queued reader where they stand. Nothing in
// `actions` depends on this call, which means an Elite item resolves the same on
// a list as on the detail screen.
export interface Availability {
  itemId: string;
  total: number;
  available: number;
  queuePosition?: number;
}

// REST pagination, used ONLY by the institutions endpoint — a different model
// from the OPDS `nextPage` pagination on `Shelf` above.
export interface PagedList<T> {
  items: T[];
  page: number;
  size: number;
  total: number;
}

// The resolved badge + buttons for one publication.
export interface AccessResult {
  // A badge label. Not an input to `actions`.
  tier: AccessTier;
  state: AccessState;
  actions: ActionId[];
}

// wokay's error envelope, on every non-2xx. `code` is what ErrorState renders
// copy from.
//
// ⚠ No sample for this shape yet.
export interface ApiError {
  timestamp: string;
  status: number;
  code: ErrorCode;
  message: string;
  path: string;
  traceId: string;
}
