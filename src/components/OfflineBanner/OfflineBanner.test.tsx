// src/components/OfflineBanner/OfflineBanner.test.tsx
// OfflineBanner has one job that is easy to break silently: it must sit OVER the
// content without displacing it and without swallowing touches. §4.2 requires the
// library and institution list to stay usable behind it, so the overlay
// assertions below are the specification, not styling trivia.
//
// It is also the one component that deliberately breaks CONVENTIONS §8 by owning
// its own absolute position. That exception is pinned here so a future refactor
// that "tidies" the positioning out fails loudly.
//
// OfflineBanner exposes no testID, so the root is read from the rendered tree —
// same approach as Skeleton.test.tsx and CategoryCard.test.tsx.
//
// `await render(...)` is required — see the note in ContentCard.test.tsx.
import { StyleSheet } from 'react-native';
import type { TextStyle, ViewStyle } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { OfflineBanner } from '@components/OfflineBanner';
import { color } from '@theme/tokens';

// The provisional fallback. Not specified by any source document — if the team
// agrees copy, this constant and the component's DEFAULT_MESSAGE move together.
const FALLBACK = "You're offline";

function rootNode() {
  const tree = screen.toJSON();
  if (!tree || Array.isArray(tree)) {
    throw new Error('expected exactly one root node');
  }
  return tree;
}

function rootStyle(): ViewStyle {
  return StyleSheet.flatten(rootNode().props.style) as ViewStyle;
}

function messageStyle(text: string): TextStyle {
  return StyleSheet.flatten(screen.getByText(text).props.style) as TextStyle;
}

describe('OfflineBanner visibility', () => {
  it('renders nothing when not visible', async () => {
    await render(<OfflineBanner visible={false} />);

    expect(screen.toJSON()).toBeNull();
  });

  it('renders the banner when visible', async () => {
    await render(<OfflineBanner visible />);

    expect(screen.getByText(FALLBACK)).toBeTruthy();
  });

  it('mounts when visibility flips from false to true', async () => {
    const { rerender } = await render(<OfflineBanner visible={false} />);
    expect(screen.toJSON()).toBeNull();

    await rerender(<OfflineBanner visible />);

    expect(screen.getByText(FALLBACK)).toBeTruthy();
  });

  // Coming back online must remove the banner outright, not leave a dark strip.
  it('unmounts when visibility flips from true to false', async () => {
    const { rerender } = await render(<OfflineBanner visible />);
    expect(screen.getByText(FALLBACK)).toBeTruthy();

    await rerender(<OfflineBanner visible={false} />);

    expect(screen.toJSON()).toBeNull();
    expect(screen.queryByText(FALLBACK)).toBeNull();
  });
});

describe('OfflineBanner message', () => {
  it('renders a custom message exactly as given', async () => {
    await render(<OfflineBanner visible message="No connection — showing saved titles" />);

    expect(screen.getByText('No connection — showing saved titles')).toBeTruthy();
  });

  it('falls back to the provisional copy when no message is given', async () => {
    await render(<OfflineBanner visible />);

    expect(screen.getByText(FALLBACK)).toBeTruthy();
  });

  it('shows the custom message instead of the fallback', async () => {
    await render(<OfflineBanner visible message="Offline" />);

    expect(screen.queryByText(FALLBACK)).toBeNull();
  });
});

describe('OfflineBanner overlays rather than displaces', () => {
  it('pins itself absolutely to the top edge', async () => {
    await render(<OfflineBanner visible />);

    const style = rootStyle();
    expect(style.position).toBe('absolute');
    expect(style.top).toBe(0);
    expect(style.left).toBe(0);
    expect(style.right).toBe(0);
  });

  // A fixed height would clip a two-line message; padding sizes the banner.
  it('sets no fixed height', async () => {
    await render(<OfflineBanner visible />);

    expect(rootStyle().height).toBeUndefined();
  });

  // Any outer margin would push the content it is supposed to cover.
  it('sets no outer margin', async () => {
    await render(<OfflineBanner visible />);

    const style = rootStyle();
    expect(style.marginBottom).toBeUndefined();
    expect(style.margin).toBeUndefined();
    expect(style.marginTop).toBeUndefined();
  });

  // flex would put it back into normal layout, which is the whole failure mode.
  it('does not participate in normal layout', async () => {
    await render(<OfflineBanner visible />);

    const style = rootStyle();
    expect(style.flex).toBeUndefined();
    expect(style.flexGrow).toBeUndefined();
  });
});

describe('OfflineBanner does not block the content behind it', () => {
  it('lets touches pass straight through', async () => {
    await render(<OfflineBanner visible />);

    expect(rootNode().props.pointerEvents).toBe('none');
  });

  // A dismiss control would need touches, which pointerEvents none forbids.
  it('exposes no button or other control', async () => {
    await render(<OfflineBanner visible message="Offline" />);

    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('OfflineBanner safe area', () => {
  it('applies the top inset the caller passes in', async () => {
    await render(<OfflineBanner visible topInset={44} />);

    expect(rootStyle().paddingTop).toBe(44);
  });

  it('defaults the top inset to zero', async () => {
    await render(<OfflineBanner visible />);

    expect(rootStyle().paddingTop).toBe(0);
  });
});

describe('OfflineBanner tokens', () => {
  it('uses the dark token for the background', async () => {
    await render(<OfflineBanner visible />);

    expect(rootStyle().backgroundColor).toBe(color.textPrimary);
  });

  it('uses the light token for the message', async () => {
    await render(<OfflineBanner visible />);

    expect(messageStyle(FALLBACK).color).toBe(color.white);
  });
});

describe('OfflineBanner regressions', () => {
  it('renders a long message as text rather than clipping it', async () => {
    const long =
      'You appear to be offline. Your library and institution list keep working, and anything already downloaded stays available.';
    await render(<OfflineBanner visible message={long} />);

    expect(screen.getByText(long)).toBeTruthy();
    expect(rootStyle().height).toBeUndefined();
  });

  // Every test above renders it bare — no provider, store, navigator or network
  // hook. This one says so explicitly, because that is what keeps it in the
  // gallery (CONVENTIONS §8).
  it('renders with no provider, store, navigator or network hook', async () => {
    await render(<OfflineBanner visible message="Offline" />);

    expect(screen.getByText('Offline')).toBeTruthy();
  });
});
