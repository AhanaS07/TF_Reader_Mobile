import {
  EMPTY_PUBLICATION_A11Y,
  type PublicationA11yMetadata,
} from './publicationA11y';
import { summarizePublicationAccessibility } from './publicationA11ySummary';

function metadata(overrides: Partial<PublicationA11yMetadata>): PublicationA11yMetadata {
  return { ...EMPTY_PUBLICATION_A11Y, ...overrides };
}

describe('summarizePublicationAccessibility', () => {
  it('reports the empty state when nothing was declared', () => {
    const summary = summarizePublicationAccessibility(EMPTY_PUBLICATION_A11Y);

    expect(summary.isEmpty).toBe(true);
    expect(summary.headline).toBe("No accessibility information was declared by this book's publisher.");
    expect(summary.accessModes).toEqual([]);
    expect(summary.accessibilityFeatures).toEqual([]);
    expect(summary.conformsTo).toEqual([]);
    expect(summary.publisherStatement).toBeUndefined();
  });

  it('reports the non-empty headline once anything at all is declared', () => {
    const summary = summarizePublicationAccessibility(metadata({ accessModes: ['textual'] }));

    expect(summary.isEmpty).toBe(false);
    expect(summary.headline).toBe("This book's publisher declared accessibility information.");
  });

  it('humanizes known and unknown accessMode/feature tokens alike', () => {
    const summary = summarizePublicationAccessibility(
      metadata({
        accessModes: ['textual'],
        accessibilityFeatures: ['alternativeText', 'structuralNavigation', 'MathML', 'someFutureToken'],
      }),
    );

    expect(summary.accessModes).toEqual(['Textual']);
    expect(summary.accessibilityFeatures).toEqual([
      'Alternative Text',
      'Structural Navigation',
      'Math ML',
      'Some Future Token',
    ]);
  });

  it('humanizes conformsTo claims without treating them as verified', () => {
    const summary = summarizePublicationAccessibility(
      metadata({ conformsTo: ['EPUB Accessibility 1.2 - WCAG 2.2 Level AA'] }),
    );

    expect(summary.conformsTo).toEqual(['EPUB Accessibility 1.2 - WCAG 2.2 Level AA']);
  });

  it('passes accessibilitySummary through verbatim as publisherStatement', () => {
    const summary = summarizePublicationAccessibility(
      metadata({ accessibilitySummary: 'This publication conforms to WCAG 2.2 Level AA.' }),
    );

    expect(summary.publisherStatement).toBe('This publication conforms to WCAG 2.2 Level AA.');
  });

  it('never leaks parse issues into the summary', () => {
    const summary = summarizePublicationAccessibility(
      metadata({ issues: [{ code: 'malformed-xml', value: 'missing or unreadable X' }] }),
    );

    expect(summary).not.toHaveProperty('issues');
  });

  describe('hazard states', () => {
    it('not-provided: hazards absent', () => {
      const summary = summarizePublicationAccessibility(metadata({ accessibilityHazards: [] }));

      expect(summary.hazards).toEqual({
        declaration: 'not-provided',
        label: 'Hazard information was not declared by the publisher.',
      });
    });

    it('unknown: publisher declared they do not know', () => {
      const summary = summarizePublicationAccessibility(
        metadata({ accessibilityHazards: ['unknown'] }),
      );

      expect(summary.hazards).toEqual({
        declaration: 'unknown',
        label: 'The publisher declared that hazard information is unknown.',
      });
    });

    it('none-declared: only negative assertions', () => {
      const summary = summarizePublicationAccessibility(
        metadata({ accessibilityHazards: ['noFlashingHazard', 'noSoundHazard'] }),
      );

      expect(summary.hazards).toEqual({
        declaration: 'none-declared',
        label: 'The publisher declared no hazards.',
      });
    });

    it('hazards-declared: lists the humanized positive hazards', () => {
      const summary = summarizePublicationAccessibility(
        metadata({ accessibilityHazards: ['flashing', 'sound'] }),
      );

      expect(summary.hazards).toEqual({
        declaration: 'hazards-declared',
        label: 'The publisher declared hazards: Flashing, Sound.',
      });
    });

    it('indeterminate: unrecognized hazard token', () => {
      const summary = summarizePublicationAccessibility(
        metadata({ accessibilityHazards: ['somethingUnrecognized'] }),
      );

      expect(summary.hazards).toEqual({
        declaration: 'indeterminate',
        label: 'The publisher declared hazard information we do not recognize.',
      });
    });
  });
});
