// Owner: Accessibility (Hruthik).
//
// Turns PublicationA11yMetadata into something a screen can actually show. publicationA11y.ts
// deliberately keeps token-to-label mapping out of scope — "Mapping to human-readable labels
// happens in the UI layer, not here" [D6, D9]. This is that layer.
//
// HUMANIZATION IS MECHANICAL, NOT A CURATED DICTIONARY. `KNOWN_ACCESSIBILITY_FEATURES` is an
// ~40-entry open vocabulary that publicationA11y.ts itself warns "will go stale" and needs
// reconciling against the W3C Accessibility Discovery Vocabularies "before the UI ships." A
// hand-authored label per token would inherit that staleness risk and drift out of sync with the
// vocabulary list. A mechanical camelCase → spaced-words transform works uniformly for known AND
// unknown tokens alike — satisfying D6 ("neither list is discarded") without needing
// `partitionKnownValues`'s known/unknown split at all — and it never goes stale. It can be
// swapped for a real label dictionary later without changing this function's shape.
//
// WHAT THIS DELIBERATELY DOES NOT DO:
//   - Never surfaces `issues` — those are diagnostics, "NEVER rendered to the reader"
//     (publicationA11y.ts).
//   - Never derives the hazard state from `.length` — always goes through
//     `resolveHazardDeclaration`, since an empty array means NOT PROVIDED, not "none" [D4].
//   - Never presents `conformsTo` as verified — it is a self-asserted claim [D10].
//   - Never produces or implies "screen reader compatible" — forbidden per
//     WEBVIEW_A11Y_FINDINGS.md §5; that claim depends on the (unrun) WebView spike, not on
//     declared publisher metadata.

import {
  type PublicationA11yMetadata,
  type HazardDeclaration,
  POSITIVE_HAZARDS,
  hasNoDeclaredA11yMetadata,
  resolveHazardDeclaration,
} from './publicationA11y';

export interface PublicationAccessibilitySummary {
  /** True when the publisher declared nothing at all — drives the empty state. */
  isEmpty: boolean;
  /** One-line headline. States what was declared, never a compliance/capability claim. */
  headline: string;
  /** Humanized accessMode tokens, deduped, document order. */
  accessModes: string[];
  /** Humanized accessibilityFeature tokens, deduped, document order. */
  accessibilityFeatures: string[];
  /** The hazard state plus its plain-text label — never derived from array length. */
  hazards: { declaration: HazardDeclaration; label: string };
  /** Publisher's self-asserted conformance claims, humanized — a claim, not a verified fact. */
  conformsTo: string[];
  /** The publisher's own accessibilitySummary prose, verbatim, plain text. Undefined if absent. */
  publisherStatement?: string;
}

export function summarizePublicationAccessibility(
  metadata: PublicationA11yMetadata,
): PublicationAccessibilitySummary {
  const isEmpty = hasNoDeclaredA11yMetadata(metadata);
  const declaration = resolveHazardDeclaration(metadata.accessibilityHazards);

  return {
    isEmpty,
    headline: isEmpty
      ? "No accessibility information was declared by this book's publisher."
      : "This book's publisher declared accessibility information.",
    accessModes: metadata.accessModes.map(humanizeToken),
    accessibilityFeatures: metadata.accessibilityFeatures.map(humanizeToken),
    hazards: { declaration, label: hazardLabel(declaration, metadata.accessibilityHazards) },
    conformsTo: metadata.conformsTo.map(humanizeToken),
    publisherStatement: metadata.accessibilitySummary,
  };
}

function hazardLabel(declaration: HazardDeclaration, hazards: string[]): string {
  switch (declaration) {
    case 'not-provided':
      return 'Hazard information was not declared by the publisher.';
    case 'unknown':
      return 'The publisher declared that hazard information is unknown.';
    case 'none-declared':
      return 'The publisher declared no hazards.';
    case 'hazards-declared': {
      const positive = POSITIVE_HAZARDS as readonly string[];
      const declared = hazards.filter((hazard) => positive.includes(hazard)).map(humanizeToken);
      return `The publisher declared hazards: ${declared.join(', ')}.`;
    }
    case 'indeterminate':
      return 'The publisher declared hazard information we do not recognize.';
  }
}

/**
 * Mechanical camelCase/PascalCase → "Spaced Words", first letter capitalized. Not a label
 * dictionary — see the file header for why.
 */
function humanizeToken(token: string): string {
  const spaced = token
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim();
  return spaced.length === 0 ? spaced : spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
