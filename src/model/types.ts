/**
 *
 *
 *   1. `MockAdapter implements DataAdapter` and `ApiAdapter implements
 *      DataAdapter` — the Week 4 claim that "integration is a configuration
 *      change" is now checked rather than hoped for.
 *   2. The vocabularies below are declared ONCE, as arrays, with their union
 *      types derived from them. One source of truth for the runtime value and
 *      the type, so they cannot drift.
 *   3. `PropTypes` is no longer needed anywhere. It never worked on React 19
 *      regardless — it was silently ignored — so nothing is lost and one whole
 *      class of duplicated declaration goes away.
 *
 * BASIS — and the order of precedence matters:
 *   1. THE FROZEN SAMPLES in `wokay_docs/frozen/` are the contract.
 *
 * Where wokay name a field, we use wokay's name and casing. Where the shape is
 * ours alone, it is marked OURS. Where we compute it, it is marked DERIVED.
 *
 * Rules this file encodes:
 *   1. Follow hrefs, do not build URLs.       (wokay client rule 1)
 *   2. Paginate by following `next`.          (wokay client rule 2)
 *   3. An empty result is not an empty array. (wokay client rule 3)
 *   4. The acquisition link decides the buttons, not our logic.
 *                                             (wokay client rule 4)
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1 · VOCABULARIES — declared once, as values, with the types derived
// ─────────────────────────────────────────────────────────────────────────────
//
// These must exist at runtime, because three consumers enumerate them:
//   · validate.ts checks fixtures against them           (P0-4, Prayas)
//   · the state gallery iterates them to render variants  (P0-5, Khushi)
//   · filter chips and badges map over them               (Moktik, Akriti)
//
// Declaring the array and deriving the union with `typeof X[number]` means there
// is exactly ONE definition. Adding a value in one place and forgetting the
// other is now impossible rather than merely discouraged.

/**
 * OURS, as badge labels. Uppercase, unchanged.
 *
 * DERIVED, NOT SENT — see LICENCE_MODEL_TO_TIER. There is no access-tier field
 * on any surface we consume.
 */
export const ACCESS_TIERS = ['OPEN_ACCESS', 'SUBSCRIPTION', 'ELITE'] as const
export type AccessTier = (typeof ACCESS_TIERS)[number]

/**
 * The file format. wokay call this `contentType`.
 *
 * DERIVED on every surface we have a sample for — there is no `contentType`
 * field in any of the three frozen feeds. It comes from the acquisition link's
 * MIME, via MIME_TO_CONTENT_FORMAT. Keep the derivation in the adapter.
 *
 * ONE FORMAT PER WORK — confirmed 11 Aug. A publication has exactly one
 * acquisition link and one format, which removes the job FormatSelector exists
 * to do. That component is under review.
 */
export const CONTENT_FORMATS = ['PDF', 'EPUB', 'AUDIO'] as const
export type ContentFormat = (typeof CONTENT_FORMATS)[number]

/**
 * OURS. The *work* type, which decides whether we render article detail
 * (screen 04) or book detail (screen 05).
 *
 * `@type` is OFFICIAL — confirmed 11 Aug. `schema.org/Book` and
 * `schema.org/Audiobook` are confirmed values; journal and article are still to
 * come. See SCHEMA_TYPE_TO_WORK_TYPE and Q-1b.
 */
export const WORK_TYPES = ['book', 'journal', 'article', 'audiobook'] as const
export type WorkType = (typeof WORK_TYPES)[number]

/**
 * Normalised from the OPDS `rel`. The adapter maps the full URI to this short
 * form; nothing downstream ever sees a URI.
 *
 *   'open-access'  → plaintext, no entitlement, no loan, no licence, ever
 *   'acquisition'  → Subscription. Loan written, no copy limit, no queue
 *   'borrow'       → Elite. Loan + lease, consumes one of N copies
 */
export const ACQUISITION_RELS = ['open-access', 'acquisition', 'borrow'] as const
export type AcquisitionRel = (typeof ACQUISITION_RELS)[number]

export const LICENCE_MODELS = ['UNLIMITED', 'CONCURRENT'] as const
export type LicenceModel = (typeof LICENCE_MODELS)[number]

/**
 * OURS. A UI state, not a wokay field.
 * `no_seats` is ELITE ONLY — Subscription is UNLIMITED, so there is nothing to
 * run out of and no queue can form.
 */
export const ACCESS_STATES = [
  'available',
  'requires_loan',
  'requires_signin',
  'not_entitled',
  'no_seats',
] as const
export type AccessState = (typeof ACCESS_STATES)[number]

/**
 * OURS. One button each.
 *
 * ✅ `subscribe` STAYS — decided 11 Aug. Individual subscribers (B2C) are NOT cut
 * from scope. wokay will supply the details later, so the action, its button
 * variant and its style entry all remain in place. Anything in the planning
 * documents that says Subscribe is deleted is superseded.
 */
export const ACTION_IDS = [
  'read',
  'download',
  'borrow',
  'signin',
  'waitlist',
  'subscribe',
] as const
export type ActionId = (typeof ACTION_IDS)[number]

/** wokay's enumerated failure reasons. ErrorState copy is keyed on these. */
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
] as const
export type ErrorCode = (typeof ERROR_CODES)[number]

// ─────────────────────────────────────────────────────────────────────────────
// 2 · DERIVATION TABLES — the five things we work out rather than read
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `licenceModel` → AccessTier. wokay's rule, confirmed 11 Aug. This is the ONLY
 * source of the tier.
 *
 * ⚠ THE ABSENT CASE IS NOT IN THIS MAP, DELIBERATELY. No `licenceModel` key at
 * all means OPEN_ACCESS, so the derivation cannot be a bare lookup: "looked it
 * up and got undefined" and "the key is not there" are different facts, and
 * conflating them renders every Subscription title with a malformed link as free
 * to read. Use `deriveAccessTier` semantics:
 *
 *   key absent                  → 'OPEN_ACCESS'
 *   key present and recognised  → the mapped tier
 *   key present but unrecognised → undefined, and let validate.ts throw
 */
export const LICENCE_MODEL_TO_TIER = {
  UNLIMITED: 'SUBSCRIPTION',
  CONCURRENT: 'ELITE',
} as const satisfies Record<LicenceModel, AccessTier>

/**
 * The signature the adapter's tier derivation must have. Takes the whole
 * properties bag rather than a `licenceModel` string, so the absent case is
 * representable and cannot be lost at the call site.
 */
export type DeriveAccessTier = (
  properties: AcquisitionProperties | undefined
) => AccessTier | undefined

/**
 * The full `rel` URI as it appears in the feed → our short form. Verified
 * against all three frozen samples.
 *
 * ⚠⚠ EXACT LOOKUP ONLY — never `startsWith`. This was once called
 * OPDS_REL_PREFIX, which invited exactly the wrong implementation:
 * 'http://opds-spec.org/acquisition' is a string prefix of BOTH other keys, so
 * prefix-matching reads an Elite borrow link as a Subscription link. The visible
 * symptom is a Download button on a `canPersist: false` file — a wrong button on
 * a real screen, which is the class of bug the acquisition-link rule exists to
 * prevent. An unrecognised rel is ignored, never guessed at.
 */
export const OPDS_REL_BY_URI = {
  'http://opds-spec.org/acquisition/open-access': 'open-access',
  'http://opds-spec.org/acquisition': 'acquisition',
  'http://opds-spec.org/acquisition/borrow': 'borrow',
} as const satisfies Record<string, AcquisitionRel>

/**
 * The acquisition link's MIME → ContentFormat. The only source of format on an
 * OPDS surface. MIMEs confirmed in the frozen samples: 'application/pdf',
 * 'application/epub+zip', 'audio/mpeg'.
 *
 * Anything under `audio/` is AUDIO, so the adapter falls back to an 'audio/'
 * prefix test before giving up. An unmapped MIME surfaces as undefined and is
 * flagged by validate.ts — never silently defaulted to PDF.
 */
export const MIME_TO_CONTENT_FORMAT = {
  'application/pdf': 'PDF',
  'application/epub+zip': 'EPUB',
  'audio/mpeg': 'AUDIO',
} as const satisfies Record<string, ContentFormat>

/**
 * `metadata.@type` → WorkType. `@type` is official; the two values below marked
 * unconfirmed are our guess at what journal and article will emit, and are
 * exactly what Q-1b asks wokay to confirm. An unmapped `@type` must fall back to
 * the heuristic rather than throw.
 */
export const SCHEMA_TYPE_TO_WORK_TYPE = {
  'http://schema.org/Book': 'book',
  'http://schema.org/Audiobook': 'audiobook',
  'http://schema.org/ScholarlyArticle': 'article', // ⚠ unconfirmed — Q-1b
  'http://schema.org/PublicationIssue': 'journal', // ⚠ unconfirmed — Q-1b
} as const satisfies Record<string, WorkType>

// ─────────────────────────────────────────────────────────────────────────────
// 3 · THE ACQUISITION LINK — this is what decides the buttons
// ─────────────────────────────────────────────────────────────────────────────

export interface AcquisitionProperties {
  licenceModel?: LicenceModel
  /**
   * ⚠ TOTAL ONLY. wokay never call flambeau while building a feed, so they
   * cannot know how many copies are free. `available` comes from a separate
   * call — see Availability. CONSEQUENCE: a ContentCard can never render
   * `no_seats`. It is a detail-screen state only.
   */
  copies?: { total: number }
  /** Absent entirely for open access and for ALL audio, on any tier. */
  encrypted?: { algorithm: string; originalLength: number }
  hasSearchIndex?: boolean
  /** false for Elite. When false, the Download control is not rendered. */
  canPersist?: boolean
}

/** wokay emit this on every acquisition link. It decides which buttons we draw. */
export interface AcquisitionLink {
  rel: AcquisitionRel
  /** Points at flambeau's loan endpoint. Follow it. Never construct it. */
  href: string
  /**
   * MIME, e.g. 'application/pdf'. Also the ONLY source of ContentFormat on an
   * OPDS surface — see MIME_TO_CONTENT_FORMAT.
   */
  type: string
  /**
   * Detail feed only, e.g. 'Borrow'. Do NOT render it as the button label —
   * labels come from ActionId so they stay consistent and translatable.
   */
  title?: string
  properties: AcquisitionProperties
}

/** A generic OPDS link. Used for `next`, `self`, `search` and navigation. */
export interface Link {
  rel: string
  href: string
  type?: string
  /** true on the search link, '...{?query}' */
  templated?: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// 4 · CONTENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One publication, normalised from OPDS. Prayas owns the normalisation; this is
 * the shape it must produce.
 *
 * RECONCILED against the three frozen samples. Several of these are NOT flat
 * reads — the feed nests or encodes what wokay's document showed plainly, and
 * the normaliser is the only place that difference may live.
 */
export interface ContentItem {
  /**
   * Stable prefixed string, 'item_42'.
   * ⚠ NOT a field. The samples carry it only in the tail of the `self` href and
   * in the loan href's `?itemId=`. Parse it off `self`. `metadata.identifier` is
   * NOT the id. Needed for getItemsBatch.
   */
  id: string
  title: string
  /** Detail feed only. Screens 04/05. */
  subtitle?: string
  /**
   * From `metadata.author[].name`.
   * ⚠ MAY BE EMPTY — sample item_ab6 has `editor` and no `author` at all.
   * ContentCard must fall back to `editors` before rendering a blank byline.
   */
  authors: string[]
  /** From `metadata.editor[].name`. */
  editors?: string[]
  /** From `metadata.narrator[].name`. Audiobooks only. */
  narrators?: string[]
  /** From `metadata.subject[].name` — objects in the feed, not strings. */
  subjects: string[]
  /** DERIVED from the acquisition link's MIME. There is no field. */
  contentFormat: ContentFormat
  /**
   * DERIVED from the acquisition link's `licenceModel`. There is no tier field.
   * Computed once in the adapter so components still receive a plain value —
   * Design Spec §5.1, "the UI must never calculate access rights", still holds.
   */
  accessTier: AccessTier
  language?: string
  /** From `metadata.publisher.name` — an object in the feed, not a string. */
  publisher?: string
  /** Largest entry in `images[]`. May be absent — placeholder path. */
  coverUrl?: string
  /**
   * Smallest entry in `images[]`. Detail carries a '-thumb' variant; list feeds
   * carry one image only, so this is often undefined. ContentCard should take
   * `thumbUrl ?? coverUrl`.
   */
  thumbUrl?: string
  /**
   * What search matches against.
   * ⚠ DETAIL FEED ONLY — absent from list feeds, so no list surface may depend
   * on it.
   */
  description?: string
  /** From `metadata.numberOfPages`. */
  pageCount?: number
  /** From `metadata.duration`. Audiobooks only (sample: 2305). */
  durationSec?: number
  /**
   * ⚠ MAY BE EMPTY. No link means no button — never synthesise one.
   * Exactly ONE link per work, confirmed 11 Aug.
   */
  acquisition: AcquisitionLink[]
  /** From `metadata.@type`. See SCHEMA_TYPE_TO_WORK_TYPE and Q-1b. */
  workType?: WorkType
  /**
   * ⚠ URN PARSING REQUIRED. The feed encodes this in `metadata.identifier`:
   *   'urn:isbn:9780367211745'   → ISBN
   *   'urn:tf:catalogue:item_env' → no ISBN
   * The flat `isbn` in wokay's document is not in the feed. Strip the
   * 'urn:isbn:' prefix; treat any other URN as "no ISBN".
   */
  isbn?: string
  /**
   * ⚠ REMOVED FROM SCOPE. There is no DOI anywhere and there never will be —
   * confirmed 11 Aug. Kept in the type only so screen 04's removal is a
   * deliberate edit rather than a silent gap. Do not populate it.
   * @deprecated wokay will never send this. Drop DOI from screen 04.
   */
  doi?: never
  /**
   * From `metadata.published`, an ISO date ('2020-09-30') — a real publication
   * date, not the ingest `createdAt` this file once feared. Keep the full
   * string; format at the edge. Matches `sort=publishedAt,desc`.
   */
  publishedDate?: string
}

/**
 * Elite only, detail screen only. `GET /api/v1/availability?itemId=` on
 * flambeau — the app asks, wokay never do. One call on the screen where the user
 * is deciding; scrolling a shelf costs nothing.
 */
export interface Availability {
  itemId: string
  total: number
  available: number
  queuePosition?: number
}

/**
 * `POST /api/v1/catalogue/items:batch`. Loan records carry item ids only, so My
 * Library turns twelve ids into twelve titles in one call. Capped at 100.
 * `notFound` and `denied` are separate so one bad id does not break the screen,
 * and so the client can tell gone from not-yours.
 */
export interface BatchResult {
  items: ContentItem[]
  notFound: string[]
  denied: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// 5 · FEEDS — navigation, groups, pagination
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A row in the root feed's `navigation` array, or the browse-instead entry
 * returned by a zero-result search. A pointer only — never carries items.
 */
export interface NavigationEntry {
  title: string
  href: string
}

/**
 * A shelf. `id` is wokay's `gid`, parsed off the tail of `href`.
 *
 * ⚠⚠ NAVIGATION AND GROUPS ARE TWO DIFFERENT LISTS. The frozen root-feed sample
 * carries both, and they do not match:
 *
 *   navigation (3)  eBooks · Audiobooks · Open access    pointers, no items
 *   groups     (2)  New this term · Free to read         inline publications
 *
 * wokay's wording: "one request draws the home screen: navigation rows AND
 * shelves". So:
 *   · Tabs (L-5)            ← navigation rows
 *   · Screen 01's sections  ← groups, rendered from their inline `publications`
 *                             with no second request
 *
 * ⚠ They can overlap. In the sample, nav row "Open access" and group "Free to
 * read" point at the SAME href under different titles. Dedupe by href, or the
 * same shelf appears twice under two names.
 */
export interface Group {
  id: string
  title: string
  href: string
  /** From `metadata.numberOfItems`. */
  numberOfItems?: number
  /**
   * Inline preview items, present on the ROOT feed only. Screen 01 renders these
   * directly. Following `href` returns the full paged shelf via getFeed.
   */
  publications?: ContentItem[]
}

/** The root catalogue feed. One request draws the home screen. */
export interface CatalogueRoot {
  /** → Tabs. NOT the same list as `groups`. */
  navigation: NavigationEntry[]
  /** → screen 01's sections, with inline items. */
  groups: Group[]
  links: Link[]
  /** From `metadata.title`, e.g. 'Imperial College London Library'. TopAppBar. */
  title?: string
  /**
   * The templated search link, already extracted from `links`. Present on the
   * root feed AND on every shelf.
   */
  searchHref?: string
}

/**
 * OPDS pagination. Follow `nextHref` until it is absent. DO NOT COUNT PAGES.
 *
 * `items` may be EMPTY with `browseInstead` set — the OPDS schema forbids empty
 * arrays, so a zero-result search returns a feed with a navigation entry
 * pointing back at the catalogue. A missing `publications` key is NOT an error
 * and must not be rendered as one.
 */
export interface Feed<T> {
  items: T[]
  nextHref?: string
  browseInstead?: NavigationEntry
  /** From `metadata.title`, e.g. 'eBooks' — the shelf heading. */
  title?: string
  /**
   * From `metadata.numberOfItems`.
   * ⚠ CORRECTION: this file once said a total exists only on the institutions
   * endpoint. The frozen shelf sample carries numberOfItems and itemsPerPage, so
   * shelves and search CAN show "3 results". The next-link rule is unaffected —
   * we still never build a page URL, we just have a count to display.
   */
  total?: number
  itemsPerPage?: number
  searchHref?: string
}

/**
 * REST pagination, used ONLY by the institutions endpoint. Two pagination models,
 * split cleanly by endpoint family — not one interface that must support both.
 */
export interface PagedList<T> {
  items: T[]
  page: number
  size: number
  total: number
}

// ─────────────────────────────────────────────────────────────────────────────
// 6 · INSTITUTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * From `GET /api/v1/institutions` (list) and `/{id}` (detail). Both
 * UNAUTHENTICATED, which is what the pre-sign-in flow needs. Only ACTIVE
 * institutions appear; an inactive one is 404, not 403, so its existence is not
 * disclosed.
 *
 * REMOVED: `authType`. wokay are explicit — "institutional sign-in is ALWAYS
 * SAML, so there is no authMethod field". The oidc/email/unknown union is gone,
 * and with it the CAP-3 auth-routing fallback.
 *
 * ⚠ No sample for this shape yet. It is hand-written from wokay's field names
 * and is the one part of this file still unverified against a fixture.
 */
export interface Institution {
  id: string
  code: string
  name: string
  /** e.g. 'UNIVERSITY' */
  type: string
  country: string
  city?: string
  /** Was `crestUrl`. May be absent — InstitutionRow initials fallback. */
  logoUrl?: string
  /**
   * `primaryColor` is per-institution and our token palette is fixed.
   * DECIDED: we do NOT theme per institution in the prototype. The field is
   * carried and deliberately unused, so adopting it later is additive.
   */
  branding?: { logoUrl?: string; primaryColor?: string }
  /**
   * Detail only. `method` is always SAML; it stays in the payload so the client
   * needs no special case. `idpHint` is what we hand to flambeau — it is the
   * entire auth-routing contract.
   */
  signIn?: { method: 'SAML'; idpHint: string }
  /** Detail only. Handed to us so we never build wokay's URLs. */
  catalogueUrl?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// 7 · SESSION AND LOAN — flambeau's, not ours
// ─────────────────────────────────────────────────────────────────────────────

/** Issued by flambeau, `aud: 'tf-app'`. There is no service audience. */
export interface Session {
  userId: string
  institutionId?: string
  roles: string[]
  collections: string[]
  exp: number
  /**
   * ✅ RETAINED — decided 11 Aug. Individual subscribers are NOT cut. wokay
   * recommended cutting them at their own gate (item 7), and that
   * recommendation is not being taken: they will supply the B2C details later.
   *
   * ⚠ So this field is live, not vestigial, and two things follow:
   *   · `subscribe` stays in ActionId.
   *   · The session payload shape is NOT settled — flambeau were told we had
   *     reduced it to { userId, institutionId, roles, exp }. Re-open that with
   *     them, because a B2C session may carry no institutionId at all, which is
   *     exactly the case `institutionId?` above already allows for.
   */
  type?: 'b2b' | 'b2c'
}

/**
 * Per-user, per-item, mutable. Never a property of the feed.
 * Written for SUBSCRIPTION and ELITE. Never for OPEN_ACCESS.
 */
export interface Loan {
  itemId: string
  state: 'none' | 'active' | 'expired'
  expiresAt?: number
}

// ─────────────────────────────────────────────────────────────────────────────
// 8 · ACCESS RESOLUTION — the spine
// ─────────────────────────────────────────────────────────────────────────────

export interface AccessResult {
  /** A badge label. Not an input to `actions`. */
  tier: AccessTier
  state: AccessState
  actions: ActionId[]
}

/**
 * The resolver is an INTERPRETER of the feed, not a rules engine. wokay's client
 * rule 4: "the acquisition link decides the buttons, not your own logic. If we do
 * not send a link, the button does not exist."
 *
 *   rel=open-access                     → ['read','download']
 *   rel=acquisition  + canPersist true  → ['borrow'] → ['read','download']
 *   rel=borrow       + canPersist false → ['borrow'] → ['read']
 *   no link                             → []
 *
 * `session` decides only signed-in vs `requires_signin`. `loan` decides pre- or
 * post-borrow. `availability` (Elite, detail screen) decides `no_seats`. The tier
 * labels the badge and derives nothing.
 *
 * `availability` is null on EVERY list surface, because the number of free copies
 * is not in the feed. That is why a ContentCard can never render `no_seats` — it
 * is structural rather than something a reviewer must remember.
 *
 * ⚠ Q-6 — Design Spec §3.1 contradicts wokay's section 02 on two of three tiers.
 * We build to wokay's; the design spec is corrected to v0.3 and NOT YET
 * RATIFIED. Anyone reverting to the older table produces a wrong demo.
 */
export type ResolveAccess = (
  item: ContentItem,
  session: Session | null,
  loan: Loan | null,
  availability?: Availability | null
) => AccessResult

// ─────────────────────────────────────────────────────────────────────────────
// 9 · ERRORS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * wokay's error envelope, on every non-2xx. `code` is what ErrorState renders
 * copy from — a denial carries an enumerated reason, so we can say "your
 * library's subscription has expired" rather than "not available".
 *
 * ⚠ No sample for this shape yet.
 */
export interface ApiError {
  timestamp: string
  status: number
  code: ErrorCode
  message: string
  path: string
  traceId: string
}

// ─────────────────────────────────────────────────────────────────────────────
// 10 · THE ADAPTER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * MockAdapter implements this in Week 1; ApiAdapter must satisfy the identical
 * interface in Week 3 before it is wired up.
 *
 * ⚠ This is now compiler-enforced. `class MockAdapter implements DataAdapter`
 * means the two adapters cannot drift, which is what makes the Week 4 claim
 * "integration is a configuration change" true rather than hopeful. The runtime
 * conformance suite is still worth writing — it checks behaviour the types
 * cannot, such as a zero-result feed surfacing as browseInstead rather than
 * throwing — but the shape is the compiler's job now.
 *
 * Every catalogue method takes an href we were GIVEN, not an id we templated.
 * The signature is what stops URL-building creeping back in.
 */
export interface DataAdapter {
  /**
   * Server-side search and paging. NOT a client-side filter over a fixture —
   * results are paged and the corpus is not ours to hold.
   */
  getInstitutions(params?: {
    q?: string
    country?: string
    page?: number
    size?: number
  }): Promise<PagedList<Institution>>

  /** Detail. Carries `signIn.idpHint` and `catalogueUrl`. */
  getInstitution(id: string): Promise<Institution>

  /** From `institution.catalogueUrl`. One request draws the home screen. */
  getCatalogueRoot(catalogueUrl: string): Promise<CatalogueRoot>

  /**
   * `/opds/v1/public/catalogue`, no token.
   * ⚠ OPEN ACCESS ONLY — not the full catalogue. Design Spec §4.1's logged-out
   * scope is not deliverable. That is L-2, and it is a fact rather than a
   * request.
   */
  getPublicCatalogue(): Promise<CatalogueRoot>

  /**
   * A group, or a `next` href, or a search result page. One method, because to
   * the client they are all just hrefs returning a paginated feed.
   */
  getFeed(href: string): Promise<Feed<ContentItem>>

  /**
   * Expands the templated search link. SERVER-SIDE, mandatory: results are
   * entitlement-scoped and "a member must never see a result they cannot open".
   * Matching, tokenisation and ranking are wokay's. Searches metadata only —
   * title, authors, subjects, description — never the text inside books.
   */
  searchCatalogue(searchHref: string, query: string): Promise<Feed<ContentItem>>

  /** Book detail. The acquisition link here decides the buttons. */
  getPublication(href: string): Promise<ContentItem>

  /** My Library. Max 100 ids. */
  getItemsBatch(ids: string[]): Promise<BatchResult>
}

// ─────────────────────────────────────────────────────────────────────────────
// REGISTER — what is open
// ─────────────────────────────────────────────────────────────────────────────
// OPEN
//   Q-1b `@type` values for journal and article. wokay will supply. Two marked
//        guesses stand in; an unmapped value falls back rather than throws.
//        Affects which detail screen renders, which is Week 2 work.
//   Q-12 Can access tier still be used as a FILTER, with no tier field? Is
//        `?accessTier=` still valid, mapped to licenceModel server-side, or are
//        the chips content-type only? Screen 12 and FilterChip both depend on
//        it, and Moktik builds them Day 3. ASK TODAY.
//   Q-7  (t4targaryen) Who owns My Library / screen 08?