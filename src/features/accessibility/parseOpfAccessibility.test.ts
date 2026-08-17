// Owner: Accessibility (Hruthik).
//
// The Day-3 acceptance matrix, executed. Case numbers refer to
// `day wise/day3/Day_3_Test_EPUB_Cases.md`; the "Test n" labels to
// `day wise/day3/findings/F12_Parser_Acceptance_Matrix.md` §2.
//
// The matrix's own assertion rules, followed here on purpose:
//   1. Assert the FULL object where the point is "nothing else got populated". Most
//      regressions here are a field quietly filled in by inference, and a targeted
//      assertion cannot see that.
//   2. Assert `issues` too. The right values reached by the wrong path is still broken.
//   3. Assert the RESOLVER, not `.length`, wherever a user-visible statement about hazards
//      is involved.
//   4. Never assert on a sorted array. Order is document order and that is contract.

import {
  EMPTY_PUBLICATION_A11Y,
  KNOWN_ACCESSIBILITY_FEATURES,
  hasNoDeclaredA11yMetadata,
  partitionKnownValues,
  resolveHazardDeclaration,
} from '@/features/accessibility/publicationA11y';
import { parseOpfAccessibility } from '@/features/accessibility/parseOpfAccessibility';
import {
  FULLY_POPULATED_METADATA,
  packageDocument,
} from '@/features/accessibility/__fixtures__/opfFixtures';

/** Parses a `<metadata>` body. */
const parseMetadata = (body: string, packageAttributes = '') =>
  parseOpfAccessibility(packageDocument(body, packageAttributes));

describe('missing metadata — nothing is inferred (case 1 / Test 1)', () => {
  const result = parseMetadata('');

  it('returns empty arrays and an undefined summary', () => {
    expect(result).toEqual(EMPTY_PUBLICATION_A11Y);
    expect(result.accessibilitySummary).toBeUndefined();
  });

  it('does not invent access modes, features, or a hazard claim', () => {
    // The most important test in the matrix: the one an implementation can fail while
    // looking correct. "It's an EPUB, so it's textual" is the tempting inference, and it
    // makes a book that declared nothing indistinguishable from one that declared textual.
    expect(result.accessModes).not.toContain('textual');
    expect(result.accessModes).not.toContain('visual');
    expect(result.accessibilityFeatures).toEqual([]);
    expect(result.accessibilityHazards).not.toContain('none');
  });

  it('reports hazards as not-provided rather than none', () => {
    expect(resolveHazardDeclaration(result.accessibilityHazards)).toBe('not-provided');
    expect(hasNoDeclaredA11yMetadata(result)).toBe(true);
  });

  it('does not hand out the shared empty constant', () => {
    // A mutable shared default is the trap createDefaultAccessibilityPrefs exists for.
    expect(result).not.toBe(EMPTY_PUBLICATION_A11Y);
    expect(result.accessModes).not.toBe(EMPTY_PUBLICATION_A11Y.accessModes);
  });
});

describe('accessMode (cases 2, 7 / Tests 2, 7)', () => {
  it('collects every declaration instead of overwriting', () => {
    const result = parseMetadata(`    <meta property="schema:accessMode">textual</meta>
    <meta property="schema:accessMode">visual</meta>`);

    expect(result.accessModes).toEqual(['textual', 'visual']);
    expect(result.issues).toEqual([]);
  });

  it('does not synthesise accessModesSufficient from accessMode', () => {
    const result = parseMetadata('    <meta property="schema:accessMode">textual</meta>');

    expect(result.accessModes).toEqual(['textual']);
    expect(result.accessModesSufficient).toEqual([]);
  });

  it('dedupes a repeated value while keeping first-seen order (case 7)', () => {
    const result = parseMetadata(`    <meta property="schema:accessMode">textual</meta>
    <meta property="schema:accessMode">visual</meta>
    <meta property="schema:accessMode">textual</meta>`);

    expect(result.accessModes).toEqual(['textual', 'visual']);
  });

  it('keeps values differing only in case, both of them (case 24)', () => {
    const result = parseMetadata(`    <meta property="schema:accessMode">textual</meta>
    <meta property="schema:accessMode">Textual</meta>`);

    // Collapsing these would mean picking a winner with no principled basis. `Textual` is
    // outside the vocabulary as written, so it is also flagged — and still kept.
    expect(result.accessModes).toEqual(['textual', 'Textual']);
    expect(result.issues).toEqual([
      { code: 'unknown-value', property: 'schema:accessMode', value: 'Textual' },
    ]);
  });

  it('trims surrounding whitespace without recording an issue (case 25)', () => {
    const result = parseMetadata(`    <meta property="schema:accessMode">
      textual
    </meta>`);

    expect(result.accessModes).toEqual(['textual']);
    expect(result.issues).toEqual([]);
  });
});

describe('accessModeSufficient — sets, never flattened (cases 3, 12 / Test 3)', () => {
  it('keeps each element as one set', () => {
    const result = parseMetadata(`    <meta property="schema:accessMode">textual</meta>
    <meta property="schema:accessMode">visual</meta>
    <meta property="schema:accessModeSufficient">textual</meta>
    <meta property="schema:accessModeSufficient">textual,visual</meta>`);

    // Two sets, not four tokens. `[["textual"],["textual","visual"]]` says "text alone is
    // enough, and so is text+vision"; the flattened form cannot express either.
    expect(result.accessModesSufficient).toEqual([['textual'], ['textual', 'visual']]);
    expect(result.accessModes).toEqual(['textual', 'visual']);
  });

  it('trims tokens within a set and does not reorder them', () => {
    const result = parseMetadata(
      '    <meta property="schema:accessModeSufficient"> visual , textual </meta>',
    );

    expect(result.accessModesSufficient).toEqual([['visual', 'textual']]);
  });

  it('dedupes whole sets, not tokens across sets', () => {
    const result = parseMetadata(`    <meta property="schema:accessModeSufficient">textual,visual</meta>
    <meta property="schema:accessModeSufficient">textual</meta>
    <meta property="schema:accessModeSufficient">textual,visual</meta>`);

    expect(result.accessModesSufficient).toEqual([['textual', 'visual'], ['textual']]);
  });

  it('skips a set with no usable tokens and keeps the others (case 12)', () => {
    const result = parseMetadata(`    <meta property="schema:accessModeSufficient">,</meta>
    <meta property="schema:accessModeSufficient">textual</meta>`);

    expect(result.accessModesSufficient).toEqual([['textual']]);
    expect(result.issues).toEqual([
      {
        code: 'empty-sufficient-set',
        property: 'schema:accessModeSufficient',
        value: ',',
      },
    ]);
  });

  it('does not require a set to be a subset of the declared access modes', () => {
    const result = parseMetadata(`    <meta property="schema:accessMode">textual</meta>
    <meta property="schema:accessModeSufficient">auditory</meta>`);

    // A sufficient set accounts for adaptations, so it legitimately names modes the
    // content itself does not use. Validating one against the other would drop it.
    expect(result.accessModesSufficient).toEqual([['auditory']]);
  });
});

describe('accessibilityFeature (cases 4, 22, 30 / Tests 4, 11)', () => {
  it('collects every declaration in document order (Test 4)', () => {
    const result = parseMetadata(`    <meta property="schema:accessibilityFeature">alternativeText</meta>
    <meta property="schema:accessibilityFeature">structuralNavigation</meta>
    <meta property="schema:accessibilityFeature">MathML</meta>`);

    // 3 elements → 3 values. The bug this guards is `features[property] = value`, which
    // keeps only `MathML` and looks fine on a sparsely-annotated book.
    expect(result.accessibilityFeatures).toEqual([
      'alternativeText',
      'structuralNavigation',
      'MathML',
    ]);
    expect(result.issues).toEqual([]);
  });

  it('does not let the second element overwrite the first', () => {
    const result = parseMetadata(`    <meta property="schema:accessibilityFeature">alternativeText</meta>
    <meta property="schema:accessibilityFeature">structuralNavigation</meta>`);

    expect(result.accessibilityFeatures).toHaveLength(2);
    expect(result.accessibilityFeatures[0]).toBe('alternativeText');
  });

  it('dedupes an identical repeated value (case 30 / Test 11)', () => {
    const result = parseMetadata(`    <meta property="schema:accessibilityFeature">alternativeText</meta>
    <meta property="schema:accessibilityFeature">alternativeText</meta>`);

    expect(result.accessibilityFeatures).toEqual(['alternativeText']);
  });

  it('keeps a declared `none`, which is not the same as declaring nothing (case 22)', () => {
    const declaredNone = parseMetadata(
      '    <meta property="schema:accessibilityFeature">none</meta>',
    );
    const declaredNothing = parseMetadata('');

    expect(declaredNone.accessibilityFeatures).toEqual(['none']);
    expect(declaredNothing.accessibilityFeatures).toEqual([]);
    // The whole of D5 in one comparison. If these ever agree, the distinction was lost.
    expect(declaredNone.accessibilityFeatures).not.toEqual(declaredNothing.accessibilityFeatures);
    expect(hasNoDeclaredA11yMetadata(declaredNone)).toBe(false);
  });
});

describe('accessibilityHazard (cases 5, 21 / Test 5)', () => {
  it('collects every declaration', () => {
    const result = parseMetadata(`    <meta property="schema:accessibilityHazard">flashing</meta>
    <meta property="schema:accessibilityHazard">motionSimulation</meta>
    <meta property="schema:accessibilityHazard">sound</meta>`);

    expect(result.accessibilityHazards).toEqual(['flashing', 'motionSimulation', 'sound']);
    expect(resolveHazardDeclaration(result.accessibilityHazards)).toBe('hazards-declared');
  });

  it('distinguishes declared-none from not-provided', () => {
    const none = parseMetadata('    <meta property="schema:accessibilityHazard">none</meta>');
    const unknown = parseMetadata('    <meta property="schema:accessibilityHazard">unknown</meta>');

    expect(resolveHazardDeclaration(none.accessibilityHazards)).toBe('none-declared');
    expect(resolveHazardDeclaration(unknown.accessibilityHazards)).toBe('unknown');
    expect(resolveHazardDeclaration([])).toBe('not-provided');
  });

  it('treats negative assertions only as none-declared', () => {
    const result = parseMetadata(`    <meta property="schema:accessibilityHazard">noFlashingHazard</meta>
    <meta property="schema:accessibilityHazard">noSoundHazard</meta>`);

    expect(result.accessibilityHazards).toEqual(['noFlashingHazard', 'noSoundHazard']);
    expect(resolveHazardDeclaration(result.accessibilityHazards)).toBe('none-declared');
  });

  it('lets a positive hazard win over a contradicting none (case 21)', () => {
    const result = parseMetadata(`    <meta property="schema:accessibilityHazard">none</meta>
    <meta property="schema:accessibilityHazard">flashing</meta>`);

    expect(result.accessibilityHazards).toEqual(['none', 'flashing']);
    // Safety-biased tie-break: of the two ways to get a contradictory file wrong, hiding a
    // real hazard is the one that hurts a reader.
    expect(resolveHazardDeclaration(result.accessibilityHazards)).toBe('hazards-declared');
    expect(result.issues).toContainEqual({ code: 'contradictory-hazards' });
  });
});

describe('accessibilitySummary (cases 6, 14 / Test 6)', () => {
  it('collapses whitespace from a pretty-printed summary', () => {
    const result = parseMetadata(`    <meta property="schema:accessibilitySummary">
      This publication provides alternative text
      for informational images.
    </meta>`);

    expect(result.accessibilitySummary).toBe(
      'This publication provides alternative text for informational images.',
    );
  });

  it('never stores an empty string (case 23)', () => {
    const result = parseMetadata(
      '    <meta property="schema:accessibilitySummary">   </meta>',
    );

    expect(result.accessibilitySummary).toBeUndefined();
    expect(result.issues).toEqual([
      { code: 'empty-value', property: 'schema:accessibilitySummary' },
    ]);
  });

  it('preserves publisher prose verbatim apart from whitespace', () => {
    const result = parseMetadata(
      '    <meta property="schema:accessibilitySummary">Alt text &amp; long descriptions throughout.</meta>',
    );

    // Never generated, never rewritten. Entity decoding is XML, not editorialising.
    expect(result.accessibilitySummary).toBe('Alt text & long descriptions throughout.');
  });

  it('picks one of several summaries and records the duplication (case 14)', () => {
    const body = `    <meta property="schema:accessibilitySummary" xml:lang="fr">Résumé français.</meta>
    <meta property="schema:accessibilitySummary" xml:lang="en-GB">British summary.</meta>
    <meta property="schema:accessibilitySummary">Untagged summary.</meta>`;

    const opf = packageDocument(body);

    expect(parseOpfAccessibility(opf, { uiLanguage: 'en-GB' }).accessibilitySummary).toBe(
      'British summary.',
    );
    expect(parseOpfAccessibility(opf, { uiLanguage: 'en-US' }).accessibilitySummary).toBe(
      'British summary.',
    );
    expect(parseOpfAccessibility(opf, { uiLanguage: 'de' }).accessibilitySummary).toBe(
      // No German candidate, so it falls through to <dc:language>en of the publication.
      'British summary.',
    );
    expect(parseOpfAccessibility(opf).issues).toContainEqual({ code: 'duplicate-summary' });
  });

  it('does not record duplicate-summary for a single declaration', () => {
    const result = parseMetadata(
      '    <meta property="schema:accessibilitySummary">One summary.</meta>',
    );

    expect(result.issues).toEqual([]);
  });
});

describe('unknown values are preserved (cases 8, 9, 33 / Tests 8, 9, 10D)', () => {
  it('keeps an unknown feature and flags it (case 8)', () => {
    const result = parseMetadata(
      '    <meta property="schema:accessibilityFeature">someFutureFeature</meta>',
    );

    expect(result.accessibilityFeatures).toEqual(['someFutureFeature']);
    expect(result.issues).toEqual([
      {
        code: 'unknown-value',
        property: 'schema:accessibilityFeature',
        value: 'someFutureFeature',
      },
    ]);
    // The UI decides what it can label. The parser does not decide what to keep.
    expect(partitionKnownValues(result.accessibilityFeatures, KNOWN_ACCESSIBILITY_FEATURES)).toEqual(
      { known: [], unknown: ['someFutureFeature'] },
    );
  });

  it('keeps an unknown hazard AND refuses to call it safe (case 9 / risk R2)', () => {
    const result = parseMetadata(
      '    <meta property="schema:accessibilityHazard">someFutureHazard</meta>',
    );

    expect(result.accessibilityHazards).toEqual(['someFutureHazard']);
    // Preserving the value is necessary but not sufficient. The hazard vocabulary is
    // closed, so an unrecognised token is neither positive nor negative — and resolving it
    // to `none-declared` would render an unknown token as reassurance.
    expect(resolveHazardDeclaration(result.accessibilityHazards)).toBe('indeterminate');
    expect(resolveHazardDeclaration(result.accessibilityHazards)).not.toBe('none-declared');
  });

  it('still reports hazards-declared when an unknown token sits beside a known one', () => {
    const result = parseMetadata(`    <meta property="schema:accessibilityHazard">someFutureHazard</meta>
    <meta property="schema:accessibilityHazard">flashing</meta>`);

    expect(resolveHazardDeclaration(result.accessibilityHazards)).toBe('hazards-declared');
  });

  it('keeps an unrecognised accessMode value (case 33 / Test 10D)', () => {
    const result = parseMetadata(
      '    <meta property="schema:accessMode">somethingThatIsNotRecognized</meta>',
    );

    expect(result.accessModes).toEqual(['somethingThatIsNotRecognized']);
  });

  it('keeps an unrecognised conformsTo claim without validating it', () => {
    const result = parseMetadata(
      '    <meta property="dcterms:conformsTo">Some Future Accessibility Standard 9.9</meta>',
    );

    // No vocabulary check at all — the 1.2 spec says the conformance list expands, so any
    // fixed set we validated against would go wrong on a schedule we do not control.
    expect(result.conformsTo).toEqual(['Some Future Accessibility Standard 9.9']);
    expect(result.issues).toEqual([]);
  });
});

describe('conformsTo (cases 15, 16 / §7)', () => {
  it('returns the 1.1/1.2 meta form verbatim (case 15)', () => {
    const result = parseMetadata(
      '    <meta property="dcterms:conformsTo">EPUB Accessibility 1.2 - WCAG 2.2 Level AA</meta>',
    );

    expect(result.conformsTo).toEqual(['EPUB Accessibility 1.2 - WCAG 2.2 Level AA']);
  });

  it('collects the 1.0 link form too (case 16 / risk R5)', () => {
    const result = parseMetadata(
      '    <link rel="dcterms:conformsTo" href="http://www.idpf.org/epub/a11y/accessibility-20170105.html#wcag-aa"/>',
    );

    // Skipping <link> is what makes an older, genuinely accessible book look unannotated.
    expect(result.conformsTo).toEqual([
      'http://www.idpf.org/epub/a11y/accessibility-20170105.html#wcag-aa',
    ]);
  });

  it('supports repeated declarations across both syntaxes', () => {
    const result = parseMetadata(`    <meta property="dcterms:conformsTo">EPUB Accessibility 1.2 - WCAG 2.2 Level AA</meta>
    <meta property="dcterms:conformsTo">EPUB Accessibility 1.1 - WCAG 2.1 Level AAA</meta>
    <link rel="dcterms:conformsTo" href="https://example.org/profile#wcag-a"/>`);

    expect(result.conformsTo).toEqual([
      'EPUB Accessibility 1.2 - WCAG 2.2 Level AA',
      'EPUB Accessibility 1.1 - WCAG 2.1 Level AAA',
      'https://example.org/profile#wcag-a',
    ]);
  });

  it('does not turn a conformance claim into any other field', () => {
    const result = parseMetadata(
      '    <meta property="dcterms:conformsTo">EPUB Accessibility 1.2 - WCAG 2.2 Level AA</meta>',
    );

    // conformsTo is publication conformance metadata, not a Reader capability flag. It must
    // not imply "TTS works" or "every image has a description".
    expect(result.accessibilityFeatures).toEqual([]);
    expect(result.accessModes).toEqual([]);
    expect(result.accessibilityHazards).toEqual([]);
    expect(result.accessibilitySummary).toBeUndefined();
  });
});

describe('property resolution by IRI, not by literal string (cases 17-19 / risk R1)', () => {
  it('resolves a custom declared prefix (case 17 / D3-F1)', () => {
    const result = parseMetadata(
      '    <meta property="sch:accessibilityFeature">alternativeText</meta>',
      ' prefix="sch: http://schema.org/"',
    );

    // The case a literal `"schema:accessibilityFeature"` comparison silently returns nothing
    // for. It parses most files correctly, which is what makes it dangerous.
    expect(result.accessibilityFeatures).toEqual(['alternativeText']);
  });

  it('resolves an absolute IRI property (case 18)', () => {
    const result = parseMetadata(
      '    <meta property="http://schema.org/accessMode">textual</meta>',
    );

    expect(result.accessModes).toEqual(['textual']);
  });

  it('resolves the https form of schema.org', () => {
    const result = parseMetadata(
      '    <meta property="https://schema.org/accessMode">textual</meta>',
    );

    // EPUB reserves `schema:` as http://, schema.org now publishes https://. Same property;
    // treating them as different would drop metadata from the more correct file.
    expect(result.accessModes).toEqual(['textual']);
  });

  it('skips an unmapped prefix and keeps its siblings (case 19)', () => {
    const result = parseMetadata(`    <meta property="zz:accessMode">textual</meta>
    <meta property="schema:accessMode">visual</meta>`);

    expect(result.accessModes).toEqual(['visual']);
    expect(result.issues).toEqual([
      { code: 'unresolvable-prefix', property: 'zz:accessMode' },
    ]);
  });

  it('lets a declared mapping win over a reserved one', () => {
    const result = parseMetadata(
      '    <meta property="schema:accessMode">textual</meta>',
      ' prefix="schema: http://example.org/not-schema/"',
    );

    expect(result.accessModes).toEqual([]);
    expect(result.issues).toEqual([]);
  });

  it('reads multiple prefix pairs spanning lines', () => {
    const result = parseMetadata(
      '    <meta property="s:accessMode">textual</meta>\n    <meta property="d:conformsTo">Claim</meta>',
      ' prefix="s: http://schema.org/\n            d: http://purl.org/dc/terms/"',
    );

    expect(result.accessModes).toEqual(['textual']);
    expect(result.conformsTo).toEqual(['Claim']);
  });
});

describe('elements that are not ours are ignored, not treated as errors', () => {
  it('ignores a meta with no @property silently (case 31 / Test 10B)', () => {
    const result = parseMetadata('    <meta>alternativeText</meta>');

    expect(result).toEqual(EMPTY_PUBLICATION_A11Y);
  });

  it('ignores an unknown property silently (case 32 / Test 10C)', () => {
    const result = parseMetadata(`    <meta property="schema:somethingElse">randomValue</meta>
    <meta property="schema:accessMode">textual</meta>`);

    expect(result.accessModes).toEqual(['textual']);
    // Not an issue. <metadata> is full of properties that are not ours.
    expect(result.issues).toEqual([]);
  });

  it('ignores dcterms:modified and rendition properties', () => {
    const result = parseMetadata(`    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
    <meta property="rendition:layout">reflowable</meta>`);

    expect(result).toEqual(EMPTY_PUBLICATION_A11Y);
  });

  it('ignores a refines-scoped declaration (case 20)', () => {
    const result = parseMetadata(`    <meta refines="#img1" property="schema:accessMode">visual</meta>
    <meta property="schema:accessMode">textual</meta>`);

    // One figure's access mode is not the publication's. Folding it in would report a
    // single image's `visual` as a property of the whole book.
    expect(result.accessModes).toEqual(['textual']);
  });

  it('ignores a link whose rel is not conformsTo', () => {
    const result = parseMetadata(
      '    <link rel="cc:license" href="https://example.org/licence"/>',
    );

    expect(result.conformsTo).toEqual([]);
  });
});

describe('malformed input degrades, never throws (case 10 / Test 10)', () => {
  it('returns an empty model with malformed-xml for an unclosed element', () => {
    const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata>
    <meta property="schema:accessibilityFeature">alternativeText
  </metadata>
</package>`;

    const result = parseOpfAccessibility(opf);

    expect(result.accessibilityFeatures).toEqual([]);
    expect(result.issues.map((issue) => issue.code)).toEqual(['malformed-xml']);
  });

  it('reports a stray ampersand rather than passing it through', () => {
    const result = parseMetadata(
      '    <meta property="schema:accessibilitySummary">Alt text & long descriptions.</meta>',
    );

    expect(result.issues.map((issue) => issue.code)).toEqual(['malformed-xml']);
    expect(result.accessibilitySummary).toBeUndefined();
  });

  it('does not throw on any of the shapes a broken file takes', () => {
    const broken = [
      '',
      '   ',
      'not xml at all',
      '<package>',
      '<package><metadata><meta property="schema:accessMode">a</metadata></package>',
      '<package prefix="broken"><metadata/></package>',
      '<!-- only a comment -->',
      '<package><metadata><meta property=schema:accessMode>textual</meta></metadata></package>',
      '<package><metadata><meta property="a" property="b">x</meta></metadata></package>',
      '<html><body>wrong document entirely</body></html>',
    ];

    for (const source of broken) {
      expect(() => parseOpfAccessibility(source)).not.toThrow();
      expect(parseOpfAccessibility(source).accessModes).toEqual([]);
    }
  });

  it('keeps valid siblings when one element is malformed at the value level', () => {
    const result = parseMetadata(`    <meta property="schema:accessibilityFeature"></meta>
    <meta property="schema:accessibilityFeature">alternativeText</meta>
    <meta property="zz:accessibilityFeature">structuralNavigation</meta>
    <meta property="schema:accessibilityFeature">someFutureFeature</meta>`);

    // One bad element must not cost the user every other field in the file.
    expect(result.accessibilityFeatures).toEqual(['alternativeText', 'someFutureFeature']);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      'empty-value',
      'unresolvable-prefix',
      'unknown-value',
    ]);
  });

  it('splits a non-conforming comma-delimited value and records it (case 13)', () => {
    const result = parseMetadata('    <meta property="schema:accessMode">textual,visual</meta>');

    expect(result.accessModes).toEqual(['textual', 'visual']);
    expect(result.issues).toEqual([
      {
        code: 'comma-in-single-valued-property',
        property: 'schema:accessMode',
        value: 'textual,visual',
      },
    ]);
  });
});

describe('structural guarantees', () => {
  it('parses the fully populated fixture exactly (case 11)', () => {
    const result = parseMetadata(FULLY_POPULATED_METADATA);

    expect(result).toEqual({
      accessModes: ['textual', 'visual'],
      accessModesSufficient: [['textual'], ['textual', 'visual']],
      accessibilityFeatures: ['alternativeText', 'structuralNavigation', 'MathML'],
      accessibilityHazards: ['noFlashingHazard', 'noSoundHazard'],
      accessibilitySummary: 'This publication conforms to WCAG 2.2 Level AA.',
      conformsTo: [
        'EPUB Accessibility 1.2 - WCAG 2.2 Level AA',
        'http://www.idpf.org/epub/a11y/accessibility-20170105.html#wcag-aa',
      ],
      issues: [],
    });
    expect(resolveHazardDeclaration(result.accessibilityHazards)).toBe('none-declared');
  });

  it('handles a large metadata block without pathological slowdown (case 26)', () => {
    const body = Array.from(
      { length: 200 },
      (_, i) => `    <meta property="schema:accessibilityFeature">feature${i % 50}</meta>`,
    ).join('\n');

    const result = parseMetadata(body);

    expect(result.accessibilityFeatures).toHaveLength(50);
  });

  it('is pure — the same input twice gives equal, non-shared results', () => {
    const opf = packageDocument(FULLY_POPULATED_METADATA);
    const first = parseOpfAccessibility(opf);
    const second = parseOpfAccessibility(opf);

    expect(first).toEqual(second);
    expect(first.accessModes).not.toBe(second.accessModes);

    first.accessModes.push('mutated');
    expect(second.accessModes).not.toContain('mutated');
  });
});
