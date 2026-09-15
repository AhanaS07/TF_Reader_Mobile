// Owner: Accessibility (Hruthik).
//
// Publication accessibility metadata — the OPF side of accessibility, and NOT the
// user side.
//
//     src/shared/contracts/accessibility.ts   user preferences — synced, per user, writable
//     this file                               book metadata    — derived from the file,
//                                                                per book, read-only, never synced
//
// There is no `updatedAt`, no `synced`, no `isDeleted` and no SyncRecordBase here on
// purpose. This object is derived from the EPUB file; if the file changes we re-derive it.
// Two devices can never disagree about it, so there is nothing for LWW to settle. Putting
// it in the prefs record would drop publisher-authored data inside a user-owned,
// user-writable, last-write-wins singleton. Do not.
//
// WHY THIS IS IN src/features/accessibility/ AND NOT src/shared/contracts/.
// The Day-3 design named `src/shared/contracts/publication-a11y.ts` as the target. That
// directory is the Week-1 freeze, owned by Ahana, with `__typecheck__.ts` as its canary —
// adding a file to it and exporting it from the barrel is a contract change, not a
// prototype. Nothing outside this feature imports this type yet, so the freeze does not
// need to move for the parser to exist. **Promoting it into the frozen contracts is a
// separate change needing the lead's sign-off**, and should happen when a second capability
// (Library storage, per Day-3 D8) actually needs to name the type.
//
// PROVENANCE (Day-3 research freeze, `day wise/day3/`):
//   * property semantics + traps   — Day_3_OPF_A11y_Metadata_Research.md §4
//   * normalization rules          — Day_3_Parse_Plan.md
//   * decisions D1-D13             — Day_3_Plan.md §6
//   * acceptance invariants        — findings/F12_Parser_Acceptance_Matrix.md
//
// SCOPE: types, vocabularies and pure resolvers. There is deliberately no XML in this
// file — parseOpfAccessibility.ts imports from here, not the other way round.

/* ────────────────────────────────────────────────────────────────
   SPECIFICATION BASELINE  [D1, revised — findings/F13_Specification_Baseline.md]
   ────────────────────────────────────────────────────────────────
   EPUB 3.3                — package document / <meta> syntax
   EPUB Accessibility 1.2  — accessibility metadata + conformance  ← baseline

   Accessibility 1.0 and 1.1 metadata MUST still parse. A reading system consumes files it
   did not author, and most of the installed corpus predates 1.2. The baseline governs which
   vocabulary we carry LABELS for and which conformance strings we badge — it does NOT
   narrow what we accept. Both conformsTo syntaxes are read: the 1.1/1.2 <meta> form and the
   1.0 <link rel> form.

   The value lists below are open by design. Unknown tokens are KEPT, not dropped [D6]. The
   1.2 spec states the conformance list expands as new WCAG versions are released, so this
   is compliance with a published requirement, not merely a hedge.
   ──────────────────────────────────────────────────────────────── */

/** Absolute IRIs to match `@property` / `@rel` against AFTER prefix resolution. [D2] */
export const A11Y_METADATA_IRIS = {
  accessMode: 'http://schema.org/accessMode',
  accessModeSufficient: 'http://schema.org/accessModeSufficient',
  accessibilityFeature: 'http://schema.org/accessibilityFeature',
  accessibilityHazard: 'http://schema.org/accessibilityHazard',
  accessibilitySummary: 'http://schema.org/accessibilitySummary',
  conformsTo: 'http://purl.org/dc/terms/conformsTo',
} as const;

/* ────────────────────────────────────────────────────────────────
   VOCABULARIES
   ────────────────────────────────────────────────────────────────
   Known-value lists, used ONLY to decide whether the UI has a human-readable label and
   whether to record an `unknown-value` diagnostic. They are NOT an allowlist and the parser
   must never filter against them. [D6]

   Reconcile against the W3C Accessibility Discovery Vocabularies before the UI ships —
   carried as V3 in Day_3_Plan.md §9. D6 makes a stale list survivable, not correct.
   ──────────────────────────────────────────────────────────────── */

/** schema:accessMode. Controlled vocabulary. */
export const KNOWN_ACCESS_MODES = [
  'textual',
  'visual',
  'auditory',
  'tactile',
  'colorDependent',
  'chartOnVisual',
  'diagramOnVisual',
  'mathOnVisual',
  'musicOnVisual',
  'chemOnVisual',
  'textOnVisual',
] as const;

/** schema:accessibilityFeature. OPEN vocabulary — this list will go stale. */
export const KNOWN_ACCESSIBILITY_FEATURES = [
  // text alternatives
  'alternativeText',
  'longDescription',
  'describedMath',
  'transcript',
  // navigation
  'structuralNavigation',
  'tableOfContents',
  'readingOrder',
  'index',
  'pageNavigation',
  'pageBreakMarkers',
  'printPageNumbers',
  'bookmarks',
  // math & chemistry
  'MathML',
  'MathML-chemistry',
  'ChemML',
  'latex',
  'latex-chemistry',
  // audio & synchronisation
  'synchronizedAudioText',
  'audioDescription',
  'ttsMarkup',
  'captions',
  'closedCaptions',
  'openCaptions',
  'signLanguage',
  // display
  'displayTransformability',
  'highContrastDisplay',
  'highContrastAudio',
  'largePrint',
  'braille',
  'tactileGraphic',
  'tactileObject',
  // markup
  'rubyAnnotations',
  'fullRubyAnnotations',
  'aria',
  'taggedPDF',
  // control
  'timingControl',
  'unlocked',
  'annotations',
  // negative assertion — "we ship none". NOT the same as saying nothing. [D5]
  'none',
] as const;

/**
 * schema:accessibilityHazard. Controlled vocabulary.
 *
 * Note the shape: every hazard has a matching negative assertion, plus two meta-values.
 * Five distinct states are expressible and the model must preserve all five — see
 * `resolveHazardDeclaration`.
 */
export const KNOWN_ACCESSIBILITY_HAZARDS = [
  'flashing',
  'noFlashingHazard',
  'motionSimulation',
  'noMotionSimulationHazard',
  'sound',
  'noSoundHazard',
  'none',
  'unknown',
] as const;

/** Hazard tokens that assert a hazard IS present. */
export const POSITIVE_HAZARDS = ['flashing', 'motionSimulation', 'sound'] as const;

/** Hazard tokens that assert a specific hazard is absent. */
export const NEGATIVE_HAZARDS = [
  'noFlashingHazard',
  'noMotionSimulationHazard',
  'noSoundHazard',
] as const;

/* ────────────────────────────────────────────────────────────────
   PARSE ISSUES
   ────────────────────────────────────────────────────────────────
   The parser never throws on bad metadata [D7]. It skips the offending element and records
   why here, so a fixture can assert on it and a support log can explain a half-empty
   Accessibility screen.

   Issues are diagnostics. They are NEVER rendered to the reader — "3 metadata issues" is
   noise to someone who wants to know whether the images have alt text.
   ──────────────────────────────────────────────────────────────── */

export type A11yParseIssueCode =
  /** A `<meta>` for one of our properties had an empty or whitespace-only value. */
  | 'empty-value'
  /** `accessMode` / `accessibilityFeature` / `accessibilityHazard` contained commas. */
  | 'comma-in-single-valued-property'
  /** An `accessModeSufficient` element produced no usable tokens. */
  | 'empty-sufficient-set'
  /** `@property` used a prefix with no reserved or declared mapping. */
  | 'unresolvable-prefix'
  /** More than one `accessibilitySummary` survived collection. */
  | 'duplicate-summary'
  /** Both `none` and a positive hazard were declared. Positives win. */
  | 'contradictory-hazards'
  /** A token outside the known vocabulary. Kept, not dropped. [D6] */
  | 'unknown-value'
  /** The package document could not be read as XML at all. */
  | 'malformed-xml';

export interface A11yParseIssue {
  code: A11yParseIssueCode;
  /** The property this came from, as the raw `@property` / `@rel` string in the file. */
  property?: string;
  /** The offending value, verbatim and untruncated-by-us. */
  value?: string;
}

/* ────────────────────────────────────────────────────────────────
   THE MODEL
   ──────────────────────────────────────────────────────────────── */

/**
 * Normalized accessibility metadata for ONE publication.
 *
 * Every array is `[]` when the property was absent from the OPF. Empty means NOT PROVIDED —
 * it never means "none". [D4] The only fields that can express a declared "none" are
 * `accessibilityHazards` and `accessibilityFeatures`, via the `none` token. Use
 * `resolveHazardDeclaration` rather than checking `.length` when the answer is going in
 * front of a user.
 *
 * Values are stored VERBATIM after trimming — original case, unknown tokens included.
 * Mapping to human-readable labels happens in the UI layer, not here. [D6, D9]
 */
export interface PublicationA11yMetadata {
  /** schema:accessMode. Union of all declarations, deduped, document order. */
  accessModes: string[];

  /**
   * schema:accessModeSufficient.
   *
   * A list of SETS, not a list of values. Each inner array is one complete combination
   * that is sufficient on its own. Flattening this destroys the property's entire
   * meaning — `[["textual"]]` ("text alone is enough") and `[["textual","visual"]]`
   * ("you need both") flatten to the same thing and are not recoverable afterwards.
   */
  accessModesSufficient: string[][];

  /** schema:accessibilityFeature. Open vocabulary; unknown tokens are retained. */
  accessibilityFeatures: string[];

  /** schema:accessibilityHazard. Read via `resolveHazardDeclaration`, not `.length`. */
  accessibilityHazards: string[];

  /**
   * schema:accessibilitySummary, whitespace-collapsed.
   *
   * Untrusted publisher prose. Render as TEXT — never as markup, never through a WebView.
   * `undefined` when absent; an empty string is never stored.
   */
  accessibilitySummary?: string;

  /**
   * dcterms:conformsTo, raw claim strings.
   *
   * Collected from BOTH the 1.1/1.2 `<meta property>` form and the 1.0 `<link rel>` form.
   * Self-asserted unless a certifier is also declared, which we do not read. Do not present
   * as verified, and do not treat as a Reader capability flag. [D10]
   */
  conformsTo: string[];

  /** Diagnostics. Never rendered to the reader. */
  issues: A11yParseIssue[];
}

/** Nothing was found, or there was nothing to find. Also the parser's failure result. */
export const EMPTY_PUBLICATION_A11Y: PublicationA11yMetadata = {
  accessModes: [],
  accessModesSufficient: [],
  accessibilityFeatures: [],
  accessibilityHazards: [],
  conformsTo: [],
  issues: [],
};

/**
 * Fresh, fully detached empty record. Use this, not the shared constant — the same trap
 * `createDefaultAccessibilityPrefs` exists for in accessibility.ts.
 */
export function createEmptyPublicationA11y(): PublicationA11yMetadata {
  return {
    accessModes: [],
    accessModesSufficient: [],
    accessibilityFeatures: [],
    accessibilityHazards: [],
    conformsTo: [],
    issues: [],
  };
}

/* ────────────────────────────────────────────────────────────────
   RESOLVERS
   ────────────────────────────────────────────────────────────────
   Rules that are part of the contract itself — how a stored value becomes a displayed one.
   They live beside the model so the two stay with the same owner, exactly as
   `resolveReduceMotion` does in accessibility.ts.
   ──────────────────────────────────────────────────────────────── */

/**
 * The answer to "does this book declare accessibility hazards?".
 *
 * `not-provided` is the state a naive `hazards.length === 0` check silently turns into
 * "no hazards", which is the app inventing a safety claim on the publisher's behalf.
 */
export type HazardDeclaration =
  /** The OPF said nothing. We know nothing. */
  | 'not-provided'
  /** The publisher declared `unknown` — they looked and cannot say. */
  | 'unknown'
  /** The publisher declared `none`, or negative assertions only. */
  | 'none-declared'
  /** At least one hazard is declared present. */
  | 'hazards-declared'
  /**
   * Hazard information was declared using tokens outside the vocabulary we know.
   *
   * This state closes Day-3 risk R2. The hazard vocabulary is CLOSED, so an unrecognised
   * token is neither positive nor negative — and without this state it fell through to
   * `none-declared`, i.e. the app reading an unknown token as reassurance. Renders as
   * "the publisher declared hazard information we do not recognise", which is the only
   * one of the three options in Day_3_Test_EPUB_Cases.md §6 that makes no claim we
   * cannot support.
   */
  | 'indeterminate';

/**
 * Collapses the hazard token list into the state the UI branches on.
 *
 * Precedence is deliberate and safety-biased: a positive hazard wins over a contradicting
 * `none`, and an unrecognised token wins over a declared `none`. A file asserting both is
 * malformed, and of the two possible mistakes, hiding a real hazard is the one that hurts
 * someone.
 */
export function resolveHazardDeclaration(hazards: string[]): HazardDeclaration {
  if (hazards.length === 0) return 'not-provided';

  const positives = POSITIVE_HAZARDS as readonly string[];
  if (hazards.some((hazard) => positives.includes(hazard))) return 'hazards-declared';

  if (hazards.some((hazard) => !isKnownAccessibilityHazard(hazard))) return 'indeterminate';

  if (hazards.includes('unknown')) return 'unknown';
  return 'none-declared';
}

/**
 * True when the publication declared nothing at all that we read.
 *
 * Drives the Accessibility screen's empty state. `issues` is ignored on purpose — a file
 * whose only accessibility content was malformed has still told the reader nothing useful.
 */
export function hasNoDeclaredA11yMetadata(metadata: PublicationA11yMetadata): boolean {
  return (
    metadata.accessModes.length === 0 &&
    metadata.accessModesSufficient.length === 0 &&
    metadata.accessibilityFeatures.length === 0 &&
    metadata.accessibilityHazards.length === 0 &&
    metadata.conformsTo.length === 0 &&
    metadata.accessibilitySummary === undefined
  );
}

/**
 * Splits tokens into ones we can label and ones we cannot.
 *
 * The UI renders `known` with friendly labels and `unknown` verbatim under an "also
 * declared" heading. Neither list is discarded. [D6]
 */
export function partitionKnownValues(
  values: string[],
  vocabulary: readonly string[],
): { known: string[]; unknown: string[] } {
  const known: string[] = [];
  const unknown: string[] = [];

  for (const value of values) {
    // Case-insensitive lookup so `Textual` still finds a label, but the ORIGINAL casing is
    // what we keep — reporting what the file said is the whole job.
    const isKnown = vocabulary.some((entry) => entry.toLowerCase() === value.toLowerCase());
    (isKnown ? known : unknown).push(value);
  }

  return { known, unknown };
}

/* ────────────────────────────────────────────────────────────────
   GUARDS
   ──────────────────────────────────────────────────────────────── */

export function isKnownAccessMode(value: string): boolean {
  return (KNOWN_ACCESS_MODES as readonly string[]).includes(value);
}

export function isKnownAccessibilityFeature(value: string): boolean {
  return (KNOWN_ACCESSIBILITY_FEATURES as readonly string[]).includes(value);
}

export function isKnownAccessibilityHazard(value: string): boolean {
  return (KNOWN_ACCESSIBILITY_HAZARDS as readonly string[]).includes(value);
}
