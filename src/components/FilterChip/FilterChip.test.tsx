// src/components/FilterChip/FilterChip.test.tsx
// `await render(...)` is required — see the note in ContentCard.test.tsx.
import { StyleSheet } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';

import { FilterChip } from '@components/FilterChip';
import { color } from '@theme/tokens';

function styleOf(testID: string) {
  return StyleSheet.flatten(screen.getByTestId(testID).props.style);
}

describe('FilterChip label', () => {
  it('renders the dimension name it is given', async () => {
    await render(<FilterChip label="Books" onPress={() => {}} />);

    expect(screen.getByText('Books')).toBeTruthy();
  });

  it('appends the count of active values while selected', async () => {
    await render(<FilterChip label="Subject" selected count={3} onPress={() => {}} />);

    expect(screen.getByText('Subject · 3')).toBeTruthy();
  });

  // Zero selected values and "not selected" are the same fact; the chip's own
  // styling already says it, so "· 0" would state it twice and contradict itself.
  it('omits a zero count', async () => {
    await render(<FilterChip label="Subject" selected count={0} onPress={() => {}} />);

    expect(screen.getByText('Subject')).toBeTruthy();
  });

  it('ignores a count while unselected', async () => {
    await render(<FilterChip label="Subject" count={3} onPress={() => {}} />);

    expect(screen.getByText('Subject')).toBeTruthy();
  });

  it('keeps a long dimension name to one line', async () => {
    await render(
      <FilterChip label="Environmental science and sustainable development" onPress={() => {}} />,
    );

    expect(screen.getByTestId('filter-chip-label').props.numberOfLines).toBe(1);
  });
});

describe('FilterChip appearance', () => {
  // The whole point of the SubjectChip/FilterChip split: a filter is neutral
  // until it is actually filtering something.
  it('is neutral at rest rather than brand-coloured', async () => {
    await render(<FilterChip label="Books" onPress={() => {}} />);

    expect(styleOf('filter-chip')).toMatchObject({ backgroundColor: color.surface });
    expect(styleOf('filter-chip-label')).toMatchObject({ color: color.textPrimary });
  });

  it('takes the brand colour once selected', async () => {
    await render(<FilterChip label="Books" selected onPress={() => {}} />);

    expect(styleOf('filter-chip')).toMatchObject({ backgroundColor: color.primary });
    expect(styleOf('filter-chip-label')).toMatchObject({ color: color.white });
  });
});

describe('FilterChip press behaviour', () => {
  it('reports a press through onPress', async () => {
    const onPress = jest.fn();
    await render(<FilterChip label="Books" onPress={onPress} />);

    fireEvent.press(screen.getByTestId('filter-chip'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('reports a press when already selected, so the dimension can toggle off', async () => {
    const onPress = jest.fn();
    await render(<FilterChip label="Books" selected onPress={onPress} />);

    fireEvent.press(screen.getByTestId('filter-chip'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('FilterChip remove affordance', () => {
  it('is absent while unselected — there is nothing to clear', async () => {
    await render(<FilterChip label="Books" onPress={() => {}} onRemove={() => {}} />);

    expect(screen.queryByTestId('filter-chip-remove')).toBeNull();
  });

  it('is absent when the caller offers nowhere to send it', async () => {
    await render(<FilterChip label="Books" selected onPress={() => {}} />);

    expect(screen.queryByTestId('filter-chip-remove')).toBeNull();
  });

  it('appears when selected and the caller handles it', async () => {
    await render(<FilterChip label="Books" selected onPress={() => {}} onRemove={() => {}} />);

    expect(screen.getByTestId('filter-chip-remove')).toBeTruthy();
  });

  it('reports the clear separately from the toggle', async () => {
    const onPress = jest.fn();
    const onRemove = jest.fn();
    await render(<FilterChip label="Books" selected onPress={onPress} onRemove={onRemove} />);

    fireEvent.press(screen.getByTestId('filter-chip-remove'));

    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});

describe('FilterChip accessibility', () => {
  // A colour change is invisible to a screen reader; the selected state is not.
  it('announces itself as selected rather than relying on colour', async () => {
    await render(<FilterChip label="Books" selected onPress={() => {}} />);

    expect(screen.getByRole('button', { name: 'Books' }).props.accessibilityState).toMatchObject({
      selected: true,
    });
  });

  it('announces itself as unselected at rest', async () => {
    await render(<FilterChip label="Books" onPress={() => {}} />);

    expect(screen.getByRole('button', { name: 'Books' }).props.accessibilityState).toMatchObject({
      selected: false,
    });
  });

  it('names the remove affordance for the dimension it clears', async () => {
    await render(<FilterChip label="Books" selected onPress={() => {}} onRemove={() => {}} />);

    expect(screen.getByRole('button', { name: 'Clear Books filter' })).toBeTruthy();
  });
});
