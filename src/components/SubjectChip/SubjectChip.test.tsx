// src/components/SubjectChip/SubjectChip.test.tsx
// SubjectChip is the outlined teal pill in screen 01's "Browse by Subject" row
// and screen 09's subject list. The labels asserted below are the real subjects
// carried by the home-catalogue fixture's publications — Law, Technology,
// Environment, Public Policy, Statistics, Anthropology.
//
// The behaviours worth protecting are the three the Foundation Spec names as
// states: `default` and `selected` must be visually distinguishable (a chip that
// looks identical selected is useless in a filter row), and `disabled` must
// refuse the press rather than merely looking dimmed.
//
// `await render(...)` is required — see the note in ContentCard.test.tsx.
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { SubjectChip } from '@components/SubjectChip';
import { color, radius, type } from '@theme/tokens';

// Styles arrive as arrays once a component composes them, so flatten before
// asserting rather than indexing into a position that shifts.
function styleOf(testID: string) {
  return StyleSheet.flatten(screen.getByTestId(testID).props.style);
}

describe('SubjectChip content', () => {
  it('renders the subject label as given', async () => {
    await render(<SubjectChip label="Anthropology" onPress={() => {}} />);

    expect(screen.getByText('Anthropology')).toBeTruthy();
  });

  it('renders a multi-word subject off the feed verbatim', async () => {
    await render(<SubjectChip label="Public Policy" onPress={() => {}} />);

    expect(screen.getByText('Public Policy')).toBeTruthy();
  });

  it('keeps the label on one line', async () => {
    await render(<SubjectChip label="Public Policy" onPress={() => {}} />);

    // A pill that wraps stops being a pill; the row scrolls instead.
    expect(screen.getByTestId('subject-chip-label').props.numberOfLines).toBe(1);
  });
});

describe('SubjectChip press', () => {
  it('reports the press to the caller', async () => {
    const onPress = jest.fn();
    await render(<SubjectChip label="Law" onPress={onPress} />);

    fireEvent.press(screen.getByTestId('subject-chip'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('reports the press while selected, so the caller can deselect', async () => {
    const onPress = jest.fn();
    await render(<SubjectChip label="Law" selected onPress={onPress} />);

    fireEvent.press(screen.getByTestId('subject-chip'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('swallows the press when disabled', async () => {
    const onPress = jest.fn();
    await render(<SubjectChip label="Statistics" disabled onPress={onPress} />);

    fireEvent.press(screen.getByTestId('subject-chip'));

    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('SubjectChip accessibility', () => {
  it('announces itself as a button', async () => {
    await render(<SubjectChip label="Law" onPress={() => {}} />);

    expect(screen.getByTestId('subject-chip').props.accessibilityRole).toBe('button');
  });

  it('announces the selection, not just the colour change', async () => {
    await render(<SubjectChip label="Law" selected onPress={() => {}} />);

    expect(screen.getByTestId('subject-chip').props.accessibilityState).toMatchObject({
      selected: true,
    });
  });

  it('announces that it is unselected by default', async () => {
    await render(<SubjectChip label="Law" onPress={() => {}} />);

    expect(screen.getByTestId('subject-chip').props.accessibilityState).toMatchObject({
      selected: false,
    });
  });

  it('announces that it is disabled', async () => {
    await render(<SubjectChip label="Statistics" disabled onPress={() => {}} />);

    expect(screen.getByTestId('subject-chip').props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });
});

describe('SubjectChip tokens', () => {
  it('is a pill, not a rounded rectangle', async () => {
    await render(<SubjectChip label="Law" onPress={() => {}} />);

    expect(styleOf('subject-chip').borderRadius).toBe(radius.pill);
  });

  it('sets the label from the smallLabel type style', async () => {
    await render(<SubjectChip label="Law" onPress={() => {}} />);
    const label = styleOf('subject-chip-label');

    expect(label.fontSize).toBe(type.smallLabel.size);
    expect(label.lineHeight).toBe(type.smallLabel.lineHeight);
    expect(label.fontWeight).toBe(type.smallLabel.weight);
  });

  it('outlines in teal over no fill by default', async () => {
    await render(<SubjectChip label="Law" onPress={() => {}} />);
    const chip = styleOf('subject-chip');

    expect(chip.borderColor).toBe(color.primary);
    expect(chip.backgroundColor).toBe('transparent');
    expect(styleOf('subject-chip-label').color).toBe(color.primary);
  });

  it('fills with teal and flips the label when selected', async () => {
    await render(<SubjectChip label="Law" selected onPress={() => {}} />);
    const chip = styleOf('subject-chip');

    expect(chip.backgroundColor).toBe(color.primary);
    expect(chip.borderColor).toBe(color.primary);
    // Teal-on-teal would be unreadable.
    expect(styleOf('subject-chip-label').color).toBe(color.white);
  });

  it('drops the brand colour entirely when disabled', async () => {
    await render(<SubjectChip label="Statistics" disabled onPress={() => {}} />);
    const chip = styleOf('subject-chip');

    // A dimmed teal chip still reads as available; a grey one does not.
    expect(chip.borderColor).toBe(color.border);
    expect(styleOf('subject-chip-label').color).toBe(color.textSecondary);
  });

  it('keeps a disabled chip grey even when it is also selected', async () => {
    await render(<SubjectChip label="Statistics" selected disabled onPress={() => {}} />);

    // Disabled wins: a filled teal chip that cannot be pressed is the same
    // dishonesty as an inert action link.
    expect(styleOf('subject-chip').borderColor).toBe(color.border);
    expect(styleOf('subject-chip-label').color).toBe(color.textSecondary);
  });
});
