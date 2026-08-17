// Owner: Accessibility (Hruthik).
//
// Fixture builders for the OPF accessibility parser. Test-only — nothing in src/ imports
// this at runtime.
//
// WHY BUILDERS AND NOT CHECKED-IN .epub FILES. Same reasoning as
// src/features/reader/scripts/generateSampleEpub.ts: a generator diffs as text, a binary
// does not, and nothing here is copyrighted content. The parser's branching lives in the
// XML, so ~30 OPF strings would be ~30 unreviewable archives to test something a string
// tests better. The three cases that genuinely need an archive — container.xml resolution —
// build theirs in memory with jszip (already a devDependency).
//
// Fully offline by construction: every byte is written here.

/** Wraps a `<metadata>` body in a minimal but valid EPUB 3 package document. */
export function packageDocument(metadataBody: string, packageAttributes = ''): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid"${packageAttributes}>
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:tf-a11y-fixture</dc:identifier>
    <dc:title>A11y Fixture</dc:title>
    <dc:language>en</dc:language>
${metadataBody}
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
  </manifest>
  <spine/>
</package>
`;
}

/** container.xml pointing at an OPF wherever the caller put it. */
export function containerDocument(opfPath: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="${opfPath}" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;
}

/**
 * The fully-populated case — one declaration of every property we read, in both conformsTo
 * syntaxes. Reused by the unit and integration suites so they cannot drift.
 */
export const FULLY_POPULATED_METADATA = `    <meta property="schema:accessMode">textual</meta>
    <meta property="schema:accessMode">visual</meta>
    <meta property="schema:accessModeSufficient">textual</meta>
    <meta property="schema:accessModeSufficient">textual,visual</meta>
    <meta property="schema:accessibilityFeature">alternativeText</meta>
    <meta property="schema:accessibilityFeature">structuralNavigation</meta>
    <meta property="schema:accessibilityFeature">MathML</meta>
    <meta property="schema:accessibilityHazard">noFlashingHazard</meta>
    <meta property="schema:accessibilityHazard">noSoundHazard</meta>
    <meta property="schema:accessibilitySummary">
      This publication conforms to WCAG 2.2 Level AA.
    </meta>
    <meta property="dcterms:conformsTo">EPUB Accessibility 1.2 - WCAG 2.2 Level AA</meta>
    <link rel="dcterms:conformsTo" href="http://www.idpf.org/epub/a11y/accessibility-20170105.html#wcag-aa"/>`;
