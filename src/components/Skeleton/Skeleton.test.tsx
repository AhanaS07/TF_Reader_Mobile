// src/components/Skeleton/Skeleton.test.tsx
// Skeleton is the loading primitive — one View, no text, no press target. So the
// only observable behaviour is the box it draws: the dimensions the caller asked
// for, and the corner treatment its variant implies.
//
// It is DELIBERATELY STATIC. Design Spec §2.3 bans spinners, and no document
// defines a shimmer duration, easing or direction, so `animated` is accepted for
// spec parity and does nothing. The test below pins that down, because a future
// shimmer must be a decision rather than a drift.
//
// `await render(...)` is required — see the note in ContentCard.test.tsx.
import { StyleSheet } from 'react-native';
import type { ViewStyle } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { Skeleton } from '@components/Skeleton';
import { color, radius } from '@theme/tokens';

// Skeleton exposes no testID and renders a single node, so read the root of the
// tree rather than querying for something that is not there.
function rootStyle(): ViewStyle {
  const tree = screen.toJSON();
  if (!tree || Array.isArray(tree)) {
    throw new Error('expected exactly one root node');
  }
  return StyleSheet.flatten(tree.props.style) as ViewStyle;
}

describe('Skeleton variants', () => {
  it('renders a block with the card radius', async () => {
    await render(<Skeleton variant="block" />);

    expect(rootStyle().borderRadius).toBe(radius.card);
  });

  // A text line reads as a line, not a rectangle: pill clamps to half the height.
  it('renders a text line with the pill radius', async () => {
    await render(<Skeleton variant="text" />);

    expect(rootStyle().borderRadius).toBe(radius.pill);
  });

  // Square plus pill radius is a circle — React Native clamps to half the size.
  it('renders a circle with the pill radius', async () => {
    await render(<Skeleton variant="circle" width={48} height={48} />);

    const style = rootStyle();
    expect(style.borderRadius).toBe(radius.pill);
    expect(style.width).toBe(48);
    expect(style.height).toBe(48);
  });

  it('uses the placeholder token for every variant', async () => {
    const { rerender } = await render(<Skeleton variant="block" />);
    expect(rootStyle().backgroundColor).toBe(color.border);

    await rerender(<Skeleton variant="text" />);
    expect(rootStyle().backgroundColor).toBe(color.border);

    await rerender(<Skeleton variant="circle" />);
    expect(rootStyle().backgroundColor).toBe(color.border);
  });
});

describe('Skeleton dimensions', () => {
  // §2.3 requires placeholders matching the final content exactly, so the caller
  // owns the numbers. Baking any in here would guarantee a layout jump.
  it('takes numeric width and height from the caller', async () => {
    await render(<Skeleton variant="block" width={200} height={80} />);

    const style = rootStyle();
    expect(style.width).toBe(200);
    expect(style.height).toBe(80);
  });

  // The text variant is sized by "width ratio", which is a percentage string.
  it('accepts a percentage width', async () => {
    await render(<Skeleton variant="text" width="80%" height={12} />);

    const style = rootStyle();
    expect(style.width).toBe('80%');
    expect(style.height).toBe(12);
  });

  it('sets no dimensions of its own when the caller gives none', async () => {
    await render(<Skeleton variant="block" />);

    const style = rootStyle();
    expect(style.width).toBeUndefined();
    expect(style.height).toBeUndefined();
  });

  // A component that set its own margin could not be reused in a row
  // (CONVENTIONS §8 — layout belongs to the caller).
  it('sets no outer margin or position', async () => {
    await render(<Skeleton variant="block" width={200} height={80} />);

    const style = rootStyle();
    expect(style.margin).toBeUndefined();
    expect(style.marginBottom).toBeUndefined();
    expect(style.position).toBeUndefined();
  });
});

describe('Skeleton animated prop', () => {
  // Accepted so a caller written against the specification compiles, but the
  // rendered output must be byte-identical either way.
  it('renders identically whether animated is omitted, true, or false', async () => {
    const { rerender } = await render(<Skeleton variant="block" width={100} height={20} />);
    const omitted = JSON.stringify(screen.toJSON());

    await rerender(<Skeleton variant="block" width={100} height={20} animated />);
    expect(JSON.stringify(screen.toJSON())).toBe(omitted);

    await rerender(<Skeleton variant="block" width={100} height={20} animated={false} />);
    expect(JSON.stringify(screen.toJSON())).toBe(omitted);
  });

  // No opacity or transform means nothing is being driven by an animation.
  it('introduces no animated style properties', async () => {
    await render(<Skeleton variant="block" width={100} height={20} animated />);

    const style = rootStyle();
    expect(style.opacity).toBeUndefined();
    expect(style.transform).toBeUndefined();
  });
});

describe('Skeleton is inert', () => {
  // A placeholder is not a control and has nothing to announce.
  it('is not a press target', async () => {
    await render(<Skeleton variant="block" width={200} height={80} />);

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders no children of any kind', async () => {
    await render(<Skeleton variant="text" width="80%" height={12} />);

    const tree = screen.toJSON();
    const children = tree && !Array.isArray(tree) ? tree.children : null;
    expect(children ?? []).toHaveLength(0);
  });
});
