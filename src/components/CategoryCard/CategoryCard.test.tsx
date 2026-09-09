// src/components/CategoryCard/CategoryCard.test.tsx
// CategoryCard fills the home screen's top category strip — one card per entry
// in `catalogue.navigation`, which for the current fixtures is eBooks,
// Audiobooks and Open access. Tapping one opens that shelf on its own screen.
//
// That slot originally held a featured-publication carousel with page dots. The
// carousel was dropped and these category entry points took its place, so the
// card carries a title and a count rather than a cover and an author — and
// nothing here tests paging, because a plain scroll strip does not page.
//
// `await render(...)` is required — see the note in ContentCard.test.tsx.
import { StyleSheet } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';

import { CategoryCard } from '@components/CategoryCard';
import { color } from '@theme/tokens';

// The accent arrives as `[baseStyle, { backgroundColor }]`, so flatten before
// asserting rather than reaching into an index that shifts when a style is added.
function styleOf(testID: string) {
  return StyleSheet.flatten(screen.getByTestId(testID).props.style);
}

describe('CategoryCard content', () => {
  it('renders the category title as given by the feed', async () => {
    await render(<CategoryCard title="eBooks" />);

    expect(screen.getByText('eBooks')).toBeTruthy();
  });

  it('renders the count of titles on the shelf', async () => {
    await render(<CategoryCard title="eBooks" count={128} />);

    expect(screen.getByText('128 titles')).toBeTruthy();
  });

  // One is not "1 titles". Pluralising a number it was handed is formatting,
  // which CONVENTIONS §3 allows.
  it('renders a single title without pluralising', async () => {
    await render(<CategoryCard title="Open access" count={1} />);

    expect(screen.getByText('1 title')).toBeTruthy();
  });

  // A shelf that genuinely holds nothing is not the same as a shelf whose total
  // the feed never reported, so zero must still render.
  it('renders a zero count rather than hiding it', async () => {
    await render(<CategoryCard title="Audiobooks" count={0} />);

    expect(screen.getByText('0 titles')).toBeTruthy();
  });

  // Home-catalogue navigation entries carry no totalItems, so this is the
  // common case today, not an edge case.
  it('omits the count line when the feed reported no total', async () => {
    await render(<CategoryCard title="Audiobooks" />);

    expect(screen.queryByTestId('category-card-count')).toBeNull();
  });

  it('keeps a long category title to a fixed number of lines', async () => {
    await render(<CategoryCard title="Open access and freely readable scholarly monographs" />);

    expect(screen.getByTestId('category-card-title').props.numberOfLines).toBeGreaterThan(0);
  });
});

describe('CategoryCard accent', () => {
  // The accent is a TOKEN NAME chosen by the caller, never derived from the
  // title. types.ts: "NAVIGATION IS DATA, NOT CODE ... no shelf is named in a
  // type or a branch anywhere" — a `variant: 'ebooks' | 'audiobooks'` union here
  // would hardcode shelf names that belong to one institution's administrator
  // (AGENTS.md L-5, settled 16 Aug 2026).
  //
  // The accent fills the whole card rather than a panel inside it, so the tint
  // lands on the card itself.
  it('tints the card with the accent token it is given', async () => {
    await render(<CategoryCard title="Audiobooks" accent="navy" />);

    expect(styleOf('category-card')).toMatchObject({ backgroundColor: color.navy });
  });

  it('falls back to the brand colour when given no accent', async () => {
    await render(<CategoryCard title="eBooks" />);

    expect(styleOf('category-card')).toMatchObject({ backgroundColor: color.primary });
  });

  // On a saturated card the title has to be the light token, or it disappears
  // into the tint.
  it('renders its text in the light token so it reads against the tint', async () => {
    await render(<CategoryCard title="eBooks" count={128} />);

    expect(styleOf('category-card-title')).toMatchObject({ color: color.white });
    expect(styleOf('category-card-count')).toMatchObject({ color: color.white });
  });
});

describe('CategoryCard press behaviour', () => {
  it('reports a press through onPress', async () => {
    const onPress = jest.fn();
    await render(<CategoryCard title="eBooks" onPress={onPress} />);

    fireEvent.press(screen.getByRole('button', { name: 'eBooks' }));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('is not announced as a button when it cannot be opened', async () => {
    await render(<CategoryCard title="eBooks" />);

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('does not report a press while loading', async () => {
    const onPress = jest.fn();
    await render(<CategoryCard title="eBooks" state="loading" onPress={onPress} />);

    fireEvent.press(screen.getByTestId('category-card'));

    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('CategoryCard loading state', () => {
  it('renders a skeleton and no title while loading', async () => {
    await render(<CategoryCard title="eBooks" count={128} state="loading" />);

    expect(screen.queryByText('eBooks')).toBeNull();
    expect(screen.queryByText('128 titles')).toBeNull();
    expect(screen.getByTestId('category-card-skeleton')).toBeTruthy();
  });
});
