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

// What the user can DO with a publication, normalized from the OPDS acquisition
// rel. A union, not a string, because the action vocabulary is explicitly still
// moving (CLAUDE.md L-3: `Buy` removed, `borrow` redefined, `subscribe` B2C-only)
// — component variants come off this union, so a vocabulary change edits this one
// line and the compiler then finds every affected call site.
//
//   http://opds-spec.org/acquisition/borrow       → 'borrow'
//   http://opds-spec.org/acquisition              → 'acquire'
//   http://opds-spec.org/acquisition/open-access  → 'openAccess'
export type ActionId = 'borrow' | 'acquire' | 'openAccess';

// How many simultaneous readers the institution's licence allows. Absent for
// open access, which is unlicensed by definition.
export type LicenceModel = 'CONCURRENT' | 'UNLIMITED';

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
  actionId: ActionId;
  // Where the action is performed (loan creation, direct download). Absolute, as
  // supplied by the feed — the adapter does not rewrite hosts.
  href: string;
  // Absent ⇒ open access (unlicensed), not "unknown".
  licenceModel?: LicenceModel;
  // Total copies the institution holds. Present only for CONCURRENT.
  copiesTotal?: number;
  // null ⇒ plaintext: open access, or ANY audio. Not `undefined` — the frozen
  // content-provider contract already defines null as exactly this state, so a
  // missing `encrypted` block is a meaningful value rather than absent data.
  encryption: CatalogueEncryption | null;
  // Whether a bundled search index ships with the book. Always false for AUDIO.
  hasSearchIndex: boolean;
  // Whether the book may be written to device storage. false ⇒ memory-only.
  canPersist: boolean;
  // UNSETTLED (CLAUDE.md Q-D): OPDS 2.0 has no equivalent and wokay may never
  // supply it, so it is read from our own fixture field and stays optional. When
  // wokay decides, only rels.ts and resolveAccess should need to change.
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
// NAVIGATION IS DATA, NOT CODE. CLAUDE.md L-5 (three feed tabs, or one merged
// list?) is unsettled, so the UI renders whatever array it is handed and no tab
// is named in a type or a branch anywhere.
export interface NavLink {
  title: string;
  href: string;
  // Tail of the href ('.../groups/ebooks' → 'ebooks'), so a nav tap maps
  // straight to getShelf(institutionId, shelfId) without re-parsing a URL.
  shelfId: string;
}

// A group of publications — one shelf/carousel on the home screen, or a full
// paginated listing when fetched on its own.
export interface Shelf {
  // Tail of the shelf's `self` href ('.../groups/new-this-term').
  //
  // IDENTITY, NOT TITLE. The two are independent in real data: the "Free to
  // read" shelf and the "Open access" nav entry are both id 'open-access'
  // despite differing titles. Never key a shelf by its title.
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
