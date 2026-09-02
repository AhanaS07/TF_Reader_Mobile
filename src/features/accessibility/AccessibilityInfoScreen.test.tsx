// Owner: Accessibility (Hruthik).
//
// Covers AccessibilityInfoScreen's own contract: fetch -> summarize -> render, the loading and
// error states, and the close control. AccessibilitySummaryView itself renders for real (not
// mocked) since its own test file already covers its content branching in depth — this file only
// needs to know the fetched summary reaches it.

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { useAppearanceEnv } from '@/features/reader/useAppearanceEnv';

import { AccessibilityInfoScreen } from './AccessibilityInfoScreen';
import { getPublicationAccessibility } from './getPublicationAccessibility';
import { EMPTY_PUBLICATION_A11Y, type PublicationA11yMetadata } from './publicationA11y';

jest.mock('./getPublicationAccessibility', () => ({
  getPublicationAccessibility: jest.fn(),
}));

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

describe('AccessibilityInfoScreen', () => {
  it('shows a loading indicator before the fetch resolves', async () => {
    jest.mocked(getPublicationAccessibility).mockReturnValue(new Promise(() => {}));

    await render(<AccessibilityInfoScreen bookId="dev-sample-epub" onClose={jest.fn()} />);

    expect(screen.getByTestId('accessibility-info-loading')).toBeTruthy();
  });

  it('renders the fetched summary once resolved', async () => {
    jest
      .mocked(getPublicationAccessibility)
      .mockResolvedValue(metadata({ accessModes: ['textual'] }));

    await render(<AccessibilityInfoScreen bookId="dev-sample-epub" onClose={jest.fn()} />);

    await waitFor(() => {
      expect(
        screen.getByText("This book's publisher declared accessibility information."),
      ).toBeTruthy();
    });
    expect(screen.getByText('Textual')).toBeTruthy();
  });

  it('shows the empty-model headline for a PDF/AUDIO book without treating it as an error', async () => {
    jest.mocked(getPublicationAccessibility).mockResolvedValue(EMPTY_PUBLICATION_A11Y);

    await render(<AccessibilityInfoScreen bookId="dev-sample-pdf" onClose={jest.fn()} />);

    await waitFor(() => {
      expect(
        screen.getByText("No accessibility information was declared by this book's publisher."),
      ).toBeTruthy();
    });
    expect(screen.queryByText(/couldn't load/i)).toBeNull();
  });

  it('shows an error message if the fetch rejects', async () => {
    jest.mocked(getPublicationAccessibility).mockRejectedValue(new Error('boom'));

    await render(<AccessibilityInfoScreen bookId="dev-sample-epub" onClose={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/couldn't load accessibility information/i)).toBeTruthy();
    });
  });

  it('calls onClose when the close control is pressed, and hits the 44x44 touch-target floor', async () => {
    jest.mocked(getPublicationAccessibility).mockResolvedValue(EMPTY_PUBLICATION_A11Y);
    const onClose = jest.fn();

    await render(<AccessibilityInfoScreen bookId="dev-sample-epub" onClose={onClose} />);

    const closeButton = screen.getByLabelText('Close');
    const style = StyleSheet.flatten(closeButton.props.style);
    expect(style.minWidth).toBeGreaterThanOrEqual(44);
    expect(style.minHeight).toBeGreaterThanOrEqual(44);

    fireEvent.press(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
