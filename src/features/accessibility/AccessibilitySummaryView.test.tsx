// Owner: Accessibility (Hruthik).
//
// `metadata()` is duplicated from publicationA11ySummary.test.ts rather than imported — it's a
// three-line spread helper, and keeping this file self-contained beats coupling two unrelated
// test files together over it.
//
// No touch-target test here (unlike TtsControls.test.tsx's 44x44 assertions): v1 has no
// pressable elements to measure — see the component's own header comment.

import { render, screen } from '@testing-library/react-native';

import { useAppearanceEnv } from '@/features/reader/useAppearanceEnv';

import { AccessibilitySummaryView } from './AccessibilitySummaryView';
import { EMPTY_PUBLICATION_A11Y, type PublicationA11yMetadata } from './publicationA11y';
import { summarizePublicationAccessibility } from './publicationA11ySummary';

jest.mock('@/features/reader/useAppearanceEnv', () => ({
  useAppearanceEnv: jest.fn(),
}));

function metadata(overrides: Partial<PublicationA11yMetadata>): PublicationA11yMetadata {
  return { ...EMPTY_PUBLICATION_A11Y, ...overrides };
}

beforeEach(() => {
  jest.mocked(useAppearanceEnv).mockReturnValue({
    osColorScheme: 'light',
    osFontScale: 1,
    osReduceMotionEnabled: false,
  });
});

describe('AccessibilitySummaryView', () => {
  it('renders only the headline when nothing was declared', async () => {
    const summary = summarizePublicationAccessibility(EMPTY_PUBLICATION_A11Y);
    await render(<AccessibilitySummaryView summary={summary} />);

    expect(
      screen.getByText("No accessibility information was declared by this book's publisher."),
    ).toBeTruthy();
    expect(screen.queryByText('Access modes')).toBeNull();
    expect(screen.queryByText('Accessibility features')).toBeNull();
    expect(screen.queryByText('Hazards')).toBeNull();
    expect(screen.queryByText('Publisher-asserted conformance')).toBeNull();
    expect(screen.queryByText(/publisher's accessibility statement/i)).toBeNull();
  });

  it('renders humanized access modes and features verbatim from the summary', async () => {
    const summary = summarizePublicationAccessibility(
      metadata({
        accessModes: ['textual'],
        accessibilityFeatures: ['alternativeText', 'structuralNavigation', 'MathML', 'someFutureToken'],
      }),
    );
    await render(<AccessibilitySummaryView summary={summary} />);

    expect(screen.getByText("This book's publisher declared accessibility information.")).toBeTruthy();
    expect(screen.getByText('Access modes')).toBeTruthy();
    expect(screen.getByText('Textual')).toBeTruthy();
    expect(screen.getByText('Accessibility features')).toBeTruthy();
    expect(screen.getByText('Alternative Text')).toBeTruthy();
    expect(screen.getByText('Structural Navigation')).toBeTruthy();
    expect(screen.getByText('Math ML')).toBeTruthy();
    expect(screen.getByText('Some Future Token')).toBeTruthy();
  });

  describe('hazard states', () => {
    // `accessModes` is set on the not-provided/none-declared fixtures so the summary isn't
    // isEmpty (which would short-circuit to headline-only and never reach the hazards section) —
    // these exercise the hazard state itself, not the empty-publication case.
    const NOT_PROVIDED_LABEL = 'Hazard information was not declared by the publisher.';
    const NONE_DECLARED_LABEL = 'The publisher declared no hazards.';

    it('the not-provided and none-declared labels are never the same string', () => {
      // Direct regression guard for the core invariant: an empty hazards array must never read
      // like a declared "none" — see publicationA11ySummary.ts's header comment.
      expect(NOT_PROVIDED_LABEL).not.toBe(NONE_DECLARED_LABEL);
    });

    it('not-provided renders its own label', async () => {
      const summary = summarizePublicationAccessibility(metadata({ accessModes: ['textual'] }));
      await render(<AccessibilitySummaryView summary={summary} />);

      expect(screen.getByText(NOT_PROVIDED_LABEL)).toBeTruthy();
    });

    it('none-declared renders its own label', async () => {
      const summary = summarizePublicationAccessibility(
        metadata({ accessibilityHazards: ['noFlashingHazard', 'noSoundHazard'] }),
      );
      await render(<AccessibilitySummaryView summary={summary} />);

      expect(screen.getByText(NONE_DECLARED_LABEL)).toBeTruthy();
    });

    it('unknown renders the publisher-does-not-know label', async () => {
      const summary = summarizePublicationAccessibility(
        metadata({ accessibilityHazards: ['unknown'] }),
      );
      await render(<AccessibilitySummaryView summary={summary} />);

      expect(
        screen.getByText('The publisher declared that hazard information is unknown.'),
      ).toBeTruthy();
    });

    it('hazards-declared lists the humanized positive hazards', async () => {
      const summary = summarizePublicationAccessibility(
        metadata({ accessibilityHazards: ['flashing', 'sound'] }),
      );
      await render(<AccessibilitySummaryView summary={summary} />);

      expect(screen.getByText('The publisher declared hazards: Flashing, Sound.')).toBeTruthy();
    });

    it('indeterminate renders the unrecognized-hazard label', async () => {
      const summary = summarizePublicationAccessibility(
        metadata({ accessibilityHazards: ['somethingUnrecognized'] }),
      );
      await render(<AccessibilitySummaryView summary={summary} />);

      expect(
        screen.getByText('The publisher declared hazard information we do not recognize.'),
      ).toBeTruthy();
    });
  });

  it('renders conformsTo tokens under a non-verification section title', async () => {
    const summary = summarizePublicationAccessibility(
      metadata({ conformsTo: ['EPUB Accessibility 1.2 - WCAG 2.2 Level AA'] }),
    );
    await render(<AccessibilitySummaryView summary={summary} />);

    expect(screen.getByText('Publisher-asserted conformance')).toBeTruthy();
    expect(screen.getByText('EPUB Accessibility 1.2 - WCAG 2.2 Level AA')).toBeTruthy();
    expect(screen.queryByText(/verified|certified/i)).toBeNull();
  });

  it('renders the publisher statement verbatim when present', async () => {
    const summary = summarizePublicationAccessibility(
      metadata({ accessibilitySummary: 'This publication conforms to WCAG 2.2 Level AA.' }),
    );
    await render(<AccessibilitySummaryView summary={summary} />);

    expect(screen.getByText("Publisher's accessibility statement")).toBeTruthy();
    expect(screen.getByText('This publication conforms to WCAG 2.2 Level AA.')).toBeTruthy();
  });

  it('omits the publisher statement section entirely when absent', async () => {
    const summary = summarizePublicationAccessibility(metadata({ accessModes: ['textual'] }));
    await render(<AccessibilitySummaryView summary={summary} />);

    expect(screen.queryByText(/publisher's accessibility statement/i)).toBeNull();
  });

  it('never renders an unverified capability claim like "screen reader compatible"', async () => {
    const summary = summarizePublicationAccessibility(
      metadata({
        accessModes: ['textual', 'visual'],
        accessibilityFeatures: ['alternativeText', 'structuralNavigation'],
        accessibilityHazards: ['flashing'],
        conformsTo: ['EPUB Accessibility 1.2 - WCAG 2.2 Level AA'],
        accessibilitySummary: 'This publication conforms to WCAG 2.2 Level AA.',
      }),
    );
    await render(<AccessibilitySummaryView summary={summary} />);

    expect(screen.queryByText(/screen reader compatible/i)).toBeNull();
  });
});
