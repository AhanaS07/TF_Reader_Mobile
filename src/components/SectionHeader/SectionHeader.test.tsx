// src/components/SectionHeader/SectionHeader.test.tsx
// SectionHeader opens each section of the catalogue, institution and search
// screens. The titles asserted below are the real ones: "Featured" and
// "Browse by Subject" from screen 01's design, "New this term" and
// "Free to read" from the home-catalogue fixture's two groups.
//
// The two behaviours worth protecting are the ones a future edit would quietly
// break: the action must survive a title long enough to wrap, and a half-given
// action (label with no handler) must not render at all.
//
// `await render(...)` is required — see the note in ContentCard.test.tsx.
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { SectionHeader } from '@components/SectionHeader';
import { color, type } from '@theme/tokens';

// Styles arrive as arrays once a component composes them, so flatten before
// asserting rather than indexing into a position that shifts.
function styleOf(testID: string) {
  return StyleSheet.flatten(screen.getByTestId(testID).props.style);
}

// A title long enough to wrap on any phone width — the case the Foundation
// Spec's done-when clause names.
const LONG_TITLE =
  'Environmental Policy, Air Pollution and Sustainable Development in Contemporary China';

describe('SectionHeader content', () => {
  it('renders the section title as given', async () => {
    await render(<SectionHeader title="Featured" />);

    expect(screen.getByText('Featured')).toBeTruthy();
  });

  it('renders a shelf title off the feed verbatim', async () => {
    await render(<SectionHeader title="New this term" />);

    expect(screen.getByText('New this term')).toBeTruthy();
  });

  it('announces the title as a heading', async () => {
    await render(<SectionHeader title="Browse by Subject" />);

    expect(screen.getByTestId('section-header-title').props.accessibilityRole).toBe('header');
  });
});

describe('SectionHeader action', () => {
  it('draws no action in the default variant', async () => {
    await render(<SectionHeader title="Featured" />);

    expect(screen.queryByTestId('section-header-action')).toBeNull();
  });

  it('draws no action when given a label but no handler', async () => {
    await render(<SectionHeader title="Featured" actionLabel="See all" />);

    // Teal text that looks tappable and does nothing is worse than no action.
    expect(screen.queryByTestId('section-header-action')).toBeNull();
    expect(screen.queryByText('See all')).toBeNull();
  });

  it('draws no action when given a handler but no label', async () => {
    await render(<SectionHeader title="Featured" onAction={() => {}} />);

    expect(screen.queryByTestId('section-header-action')).toBeNull();
  });

  it('draws the action when both label and handler arrive', async () => {
    await render(
      <SectionHeader title="All Institutions" actionLabel="See all" onAction={() => {}} />,
    );

    expect(screen.getByText('See all')).toBeTruthy();
  });

  it('reports the press to the caller', async () => {
    const onAction = jest.fn();
    await render(
      <SectionHeader title="All Institutions" actionLabel="See all" onAction={onAction} />,
    );

    fireEvent.press(screen.getByTestId('section-header-action'));

    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('names the section in the action label, not just the verb', async () => {
    await render(
      <SectionHeader title="Recently used" actionLabel="See all" onAction={() => {}} />,
    );

    // "See all" alone does not say which shelf it opens.
    expect(screen.getByTestId('section-header-action').props.accessibilityLabel).toBe(
      'See all Recently used',
    );
  });
});

describe('SectionHeader layout', () => {
  it('keeps the action rendered when the title is long enough to wrap', async () => {
    await render(<SectionHeader title={LONG_TITLE} actionLabel="See all" onAction={() => {}} />);

    expect(screen.getByText(LONG_TITLE)).toBeTruthy();
    expect(screen.getByText('See all')).toBeTruthy();
  });

  it('lets the title wrap rather than truncating it', async () => {
    await render(<SectionHeader title={LONG_TITLE} />);

    // numberOfLines would clip the title instead of wrapping it.
    expect(screen.getByTestId('section-header-title').props.numberOfLines).toBeUndefined();
  });

  it('gives the title the spare width so the action sits at the edge', async () => {
    await render(<SectionHeader title={LONG_TITLE} actionLabel="See all" onAction={() => {}} />);

    expect(styleOf('section-header-title').flex).toBe(1);
  });

  it('refuses to shrink the action, however long the title runs', async () => {
    await render(<SectionHeader title={LONG_TITLE} actionLabel="See all" onAction={() => {}} />);

    expect(styleOf('section-header-action').flexShrink).toBe(0);
  });
});

describe('SectionHeader tokens', () => {
  it('sets the title from the sectionHeader type style', async () => {
    await render(<SectionHeader title="Featured" />);
    const title = styleOf('section-header-title');

    expect(title.fontSize).toBe(type.sectionHeader.size);
    expect(title.lineHeight).toBe(type.sectionHeader.lineHeight);
    expect(title.fontWeight).toBe(type.sectionHeader.weight);
    expect(title.color).toBe(color.textPrimary);
  });

  it('tints the action with the brand colour', async () => {
    await render(<SectionHeader title="Featured" actionLabel="See all" onAction={() => {}} />);

    expect(StyleSheet.flatten(screen.getByText('See all').props.style).color).toBe(color.primary);
  });
});
