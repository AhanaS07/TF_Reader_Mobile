// Owner: Accessibility (Hruthik).
//
// OPF package document  ──▶  PublicationA11yMetadata.
//
// THE STRUCTURAL INVARIANTS, which are the point of the signature (F12 §1):
//   • Takes a STRING and returns an OBJECT. No I/O, no zip, no network. The parser cannot
//     reach the internet because there is nothing in scope to reach it with — the
//     offline requirement is enforced by the signature, not by a rule someone has to
//     remember. [D13]
//   • No reference to AccessibilityPrefs and no prefs handle. The parser cannot mutate a
//     user preference because it has nothing to mutate. Publisher metadata describes the
//     file; it is not a request on the user's behalf. [D8]
//   • ONE exit path. It always returns a PublicationA11yMetadata and never throws. Every
//     reason it produced less than a caller might expect is in `issues`. [D7]
//
// A book with unreadable accessibility metadata is still a book. This must never be able
// to stop someone opening their library.

import {
  A11Y_METADATA_IRIS,
  POSITIVE_HAZARDS,
  type A11yParseIssue,
  type PublicationA11yMetadata,
  createEmptyPublicationA11y,
  isKnownAccessMode,
  isKnownAccessibilityFeature,
  isKnownAccessibilityHazard,
} from '@/features/accessibility/publicationA11y';
import { type XmlElement, findElement, readXml } from '@/features/accessibility/miniXml';

/**
 * EPUB 3.3 reserved prefixes. A file may use these WITHOUT declaring them, which is why
 * matching on the literal string `"schema:accessMode"` appears to work — right up to the
 * file that declares its own prefix, or writes the absolute IRI. [D2]
 */
const RESERVED_PREFIXES: Record<string, string> = {
  a11y: 'http://www.idpf.org/epub/vocab/package/a11y/#',
  dcterms: 'http://purl.org/dc/terms/',
  marc: 'http://id.loc.gov/vocabulary/',
  media: 'http://www.idpf.org/epub/vocab/overlays/#',
  onix: 'http://www.editeur.org/ONIX/book/codelists/current.html#',
  rendition: 'http://www.idpf.org/vocab/rendition/#',
  schema: 'http://schema.org/',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
};

/**
 * `prefix: IRI` pairs, whitespace-separated, possibly spanning lines.
 *
 * `(\S+)` is greedy so it swallows a whole IRI including its own `://` rather than
 * re-matching inside it.
 */
const PREFIX_DECLARATION = /([^\s:]+)\s*:\s*(\S+)/g;

/** Trailing-slash-insensitive schema.org canonicalisation, see `resolveProperty`. */
const SCHEMA_ORG_HTTPS = 'https://schema.org/';
const SCHEMA_ORG_HTTP = 'http://schema.org/';

export interface ParseOpfAccessibilityOptions {
  /**
   * BCP-47 language tag of the device UI, used ONLY to choose between multiple
   * `accessibilitySummary` declarations. Absent means skip straight to the
   * publication-language step of the selection order.
   */
  uiLanguage?: string;
}

/** One `accessibilitySummary` candidate, before language selection. */
interface SummaryCandidate {
  text: string;
  /** From `xml:lang`; undefined when untagged. */
  lang?: string;
}

/**
 * Parses the accessibility metadata declared in an OPF package document.
 *
 * Only reports what the publication declares. Absent metadata yields an empty array, never
 * an inferred value and never a synthesised "none" — see `PublicationA11yMetadata`. [D4/D11]
 */
export function parseOpfAccessibility(
  opfXml: string,
  options: ParseOpfAccessibilityOptions = {},
): PublicationA11yMetadata {
  const result = createEmptyPublicationA11y();

  const document = readXml(opfXml);
  if (!document.ok) {
    result.issues.push({ code: 'malformed-xml', value: document.reason });
    return result;
  }

  // A well-formed XML file that is not a package document, or one with no <metadata>, is a
  // spec violation rather than "a book that declared nothing" — and reporting it as the
  // latter would make an unreadable OPF indistinguishable from an honest empty one, which
  // is the same conflation D4 exists to prevent.
  if (document.root.name !== 'package') {
    result.issues.push({ code: 'malformed-xml', value: `root element is <${document.root.name}>` });
    return result;
  }

  const metadata = findElement(document.root, 'metadata');
  if (!metadata) {
    result.issues.push({ code: 'malformed-xml', value: 'no <metadata> element' });
    return result;
  }

  const prefixes = buildPrefixMap(document.root.attributes.get('prefix'));
  const summaryCandidates: SummaryCandidate[] = [];

  for (const element of metadata.children) {
    // `@refines` scopes a statement to another element — an image's access mode, a
    // collection's. It is NOT a publication-level declaration, so folding it in would
    // report one figure's `visual` as the whole book's.
    if (element.attributes.has('refines')) continue;

    if (element.name === 'meta') {
      const rawProperty = element.attributes.get('property');
      // A <meta> with no @property is not malformed, merely not ours. Silent. (F12 10B)
      if (rawProperty === undefined) continue;
      readMetaElement(element, rawProperty, prefixes, result, summaryCandidates);
      continue;
    }

    if (element.name === 'link') {
      const rawRel = element.attributes.get('rel');
      if (rawRel === undefined) continue;
      readLinkElement(element.attributes.get('href'), rawRel, prefixes, result);
    }
  }

  result.accessibilitySummary = selectSummary(
    summaryCandidates,
    options.uiLanguage,
    findElement(metadata, 'language')?.text.trim(),
    result.issues,
  );

  flagContradictoryHazards(result);

  return result;
}

/* ────────────────────────────────────────────────────────────────
   PROPERTY RESOLUTION  [D2]
   ──────────────────────────────────────────────────────────────── */

function buildPrefixMap(declaration: string | undefined): Record<string, string> {
  const map = { ...RESERVED_PREFIXES };
  if (declaration === undefined) return map;

  // A malformed pair means THAT prefix is unmapped, not that the whole file is. So this
  // collects what it can and never reports failure.
  for (const [, prefix, iri] of declaration.matchAll(PREFIX_DECLARATION)) {
    map[prefix] = iri;
  }
  return map;
}

/**
 * `@property` / `@rel` → absolute IRI, or null when the prefix cannot be resolved.
 *
 * schema.org is canonicalised to its `http://` form: EPUB 3.3 reserves `schema:` as
 * `http://schema.org/`, but schema.org itself now publishes `https://`, so a file writing
 * the https IRI in full — or declaring `prefix="schema: https://schema.org/"` — means
 * exactly the same property. Treating those as different properties would drop the
 * metadata of a file that is arguably more correct than the reserved mapping.
 */
function resolveProperty(
  raw: string,
  prefixes: Record<string, string>,
): { iri: string } | { unresolvablePrefix: true } | null {
  const value = raw.trim();
  if (value === '') return null;

  if (value.includes('://')) return { iri: canonicalise(value) };

  const colon = value.indexOf(':');
  // No colon means the default (package metadata) vocabulary, which never contains one of
  // ours. Not an error — just not ours.
  if (colon === -1) return null;

  const prefix = value.slice(0, colon);
  const reference = value.slice(colon + 1);
  const iri = prefixes[prefix];
  if (iri === undefined) return { unresolvablePrefix: true };

  return { iri: canonicalise(iri + reference) };
}

function canonicalise(iri: string): string {
  return iri.startsWith(SCHEMA_ORG_HTTPS)
    ? SCHEMA_ORG_HTTP + iri.slice(SCHEMA_ORG_HTTPS.length)
    : iri;
}

/* ────────────────────────────────────────────────────────────────
   ELEMENT HANDLERS
   ──────────────────────────────────────────────────────────────── */

function readMetaElement(
  element: XmlElement,
  rawProperty: string,
  prefixes: Record<string, string>,
  result: PublicationA11yMetadata,
  summaryCandidates: SummaryCandidate[],
): void {
  const rawText = element.text;
  const resolved = resolveProperty(rawProperty, prefixes);
  if (resolved === null) return;
  if ('unresolvablePrefix' in resolved) {
    result.issues.push({ code: 'unresolvable-prefix', property: rawProperty });
    return;
  }

  const { iri } = resolved;

  // The summary is prose, so it is whitespace-COLLAPSED rather than merely trimmed — OPF
  // summaries are routinely pretty-printed across indented lines, and rendering that
  // verbatim produces ragged text. Everything else is a token and is only trimmed.
  if (iri === A11Y_METADATA_IRIS.accessibilitySummary) {
    const text = collapseWhitespace(rawText);
    if (text === '') {
      result.issues.push({ code: 'empty-value', property: rawProperty });
      return;
    }
    // `xml:lang` is read off THIS element only. XML says it inherits from ancestors, and a
    // file relying on <package xml:lang> for its summary would land in the untagged bucket
    // rather than be dropped — an acceptable prototype limitation, and the reason the
    // selection order in `selectSummary` ends in a total fallback rather than a filter.
    summaryCandidates.push({ text, lang: element.attributes.get('xml:lang')?.trim() || undefined });
    return;
  }

  const value = rawText.trim();
  if (value === '') {
    result.issues.push({ code: 'empty-value', property: rawProperty });
    return;
  }

  if (iri === A11Y_METADATA_IRIS.accessModeSufficient) {
    readSufficientSet(value, rawProperty, result);
    return;
  }

  if (iri === A11Y_METADATA_IRIS.conformsTo) {
    // Stored RAW. No parsing into a level enum — the 1.2 spec says the conformance list
    // expands as new WCAG versions are released, so any fixed set we validated against
    // would be wrong on a schedule we do not control. [D6/D10]
    addUnique(result.conformsTo, value);
    return;
  }

  const target = singleTokenTarget(iri, result);
  if (!target) return; // Not one of ours. Ignored silently. (F12 10C)

  for (const token of splitSingleTokenValue(value, rawProperty, result)) {
    addUnique(target.values, token);
    if (!target.isKnown(token)) {
      result.issues.push({ code: 'unknown-value', property: rawProperty, value: token });
    }
  }
}

/**
 * Routes one of the three single-token properties to its array plus its vocabulary.
 *
 * Returning the array itself — rather than assigning through a keyed object — is what makes
 * repeated `<meta>` elements APPEND. `features[property] = value` is the natural shape to
 * reach for when parsing XML attributes, and it silently keeps only the last value, which
 * would break most well-annotated books while leaving sparse ones looking fine. (F12 Test 7)
 */
function singleTokenTarget(
  iri: string,
  result: PublicationA11yMetadata,
): { values: string[]; isKnown: (value: string) => boolean } | null {
  switch (iri) {
    case A11Y_METADATA_IRIS.accessMode:
      return { values: result.accessModes, isKnown: isKnownAccessMode };
    case A11Y_METADATA_IRIS.accessibilityFeature:
      return { values: result.accessibilityFeatures, isKnown: isKnownAccessibilityFeature };
    case A11Y_METADATA_IRIS.accessibilityHazard:
      return { values: result.accessibilityHazards, isKnown: isKnownAccessibilityHazard };
    default:
      return null;
  }
}

/**
 * A comma in a single-token property is NON-CONFORMING — each value belongs in its own
 * `<meta>`. We split it anyway and record that we had to.
 *
 * Rejecting it would show the user a token called `textual,visual`, or nothing. The intent
 * of `schema:accessMode = textual,visual` is unambiguous, so recovering the data and
 * recording the deviation loses less than either alternative.
 */
function splitSingleTokenValue(
  value: string,
  rawProperty: string,
  result: PublicationA11yMetadata,
): string[] {
  if (!value.includes(',')) return [value];

  result.issues.push({ code: 'comma-in-single-valued-property', property: rawProperty, value });
  return value
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token !== '');
}

/**
 * Each `accessModeSufficient` element is ONE ordered set, and here commas are correct
 * rather than a deviation — that is the property's defined syntax.
 *
 * Deliberately NOT done here: validating tokens against the declared `accessModes` (a
 * sufficient set need not be a subset of them), synthesising sets from `accessModes` or
 * vice versa in either direction, and sorting within a set.
 */
function readSufficientSet(
  value: string,
  rawProperty: string,
  result: PublicationA11yMetadata,
): void {
  const tokens = value
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token !== '');

  if (tokens.length === 0) {
    result.issues.push({ code: 'empty-sufficient-set', property: rawProperty, value });
    return;
  }

  // Dedupe whole SETS, by their joined value — never tokens across sets.
  const key = tokens.join(',');
  const alreadyPresent = result.accessModesSufficient.some((set) => set.join(',') === key);
  if (!alreadyPresent) result.accessModesSufficient.push(tokens);

  for (const token of tokens) {
    if (!isKnownAccessMode(token)) {
      result.issues.push({ code: 'unknown-value', property: rawProperty, value: token });
    }
  }
}

/**
 * The Accessibility 1.0 conformance form: `<link rel="dcterms:conformsTo" href="…"/>`.
 *
 * Collected into the same list as the 1.1/1.2 `<meta>` form. Skipping `<link>` is the
 * failure that makes older accessible books look unannotated (Day-3 risk R5). The `@href`
 * is stored verbatim — it is an IRI, not prose.
 */
function readLinkElement(
  href: string | undefined,
  rawRel: string,
  prefixes: Record<string, string>,
  result: PublicationA11yMetadata,
): void {
  const resolved = resolveProperty(rawRel, prefixes);
  if (resolved === null) return;
  if ('unresolvablePrefix' in resolved) {
    result.issues.push({ code: 'unresolvable-prefix', property: rawRel });
    return;
  }
  if (resolved.iri !== A11Y_METADATA_IRIS.conformsTo) return;

  const value = href?.trim() ?? '';
  if (value === '') {
    result.issues.push({ code: 'empty-value', property: rawRel });
    return;
  }
  addUnique(result.conformsTo, value);
}

/* ────────────────────────────────────────────────────────────────
   SUMMARY SELECTION
   ──────────────────────────────────────────────────────────────── */

/**
 * A file may carry several summaries, usually language variants, but the model holds one.
 *
 * Selection order, first match wins: exact UI-language match, primary-subtag match, the
 * publication's own `<dc:language>`, an untagged candidate, then document order.
 */
function selectSummary(
  candidates: SummaryCandidate[],
  uiLanguage: string | undefined,
  publicationLanguage: string | undefined,
  issues: A11yParseIssue[],
): string | undefined {
  if (candidates.length === 0) return undefined;
  if (candidates.length > 1) issues.push({ code: 'duplicate-summary' });

  const matching = (predicate: (candidate: SummaryCandidate) => boolean): string | undefined =>
    candidates.find(predicate)?.text;

  const sameTag = (a: string | undefined, b: string | undefined): boolean =>
    a !== undefined && b !== undefined && a.toLowerCase() === b.toLowerCase();

  const primary = (tag: string | undefined): string | undefined => tag?.split('-')[0];

  return (
    matching((candidate) => sameTag(candidate.lang, uiLanguage)) ??
    matching((candidate) => sameTag(primary(candidate.lang), primary(uiLanguage))) ??
    matching((candidate) => sameTag(primary(candidate.lang), primary(publicationLanguage))) ??
    matching((candidate) => candidate.lang === undefined) ??
    candidates[0].text
  );
}

/* ────────────────────────────────────────────────────────────────
   HELPERS
   ──────────────────────────────────────────────────────────────── */

/**
 * Dedupe is EXACT and case-sensitive, so `textual` and `Textual` in the same file both
 * survive. Collapsing them would mean picking a winner and there is no principled basis
 * for the choice — the parser reports what the file said.
 */
function addUnique(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value);
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * `none` alongside a positive hazard is a contradiction. Both tokens are kept — the
 * resolver is what applies the safety-biased tie-break — and the contradiction is recorded
 * so a support log can explain it.
 */
function flagContradictoryHazards(result: PublicationA11yMetadata): void {
  if (!result.accessibilityHazards.includes('none')) return;

  const positives = POSITIVE_HAZARDS as readonly string[];
  if (result.accessibilityHazards.some((hazard) => positives.includes(hazard))) {
    result.issues.push({ code: 'contradictory-hazards' });
  }
}
