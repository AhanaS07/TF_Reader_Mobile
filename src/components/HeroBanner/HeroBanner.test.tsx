// src/components/HeroBanner/HeroBanner.test.tsx
// HeroBanner renders a stat pill, a headline, an optional subtitle, an
// action button and an "updated" note on a brand gradient. The action is
// both-or-neither, the same rule SectionHeader's own action slot follows —
// see the component header for why.
//
// `await render(...)` — IT IS ASYNC IN THIS TOOLKIT, AND SILENT IF YOU FORGET.
// @testing-library/react-native 14 returns a Promise from `render`. See
// ContentCard.test.tsx for the full explanation of what forgetting it does.
import { fireEvent, render, screen } from '@testing-library/react-native';

import { HeroBanner } from '@components/HeroBanner';

describe('HeroBanner content', () => {
  it('renders the title', async () => {
    await render(<HeroBanner title="Your Scholarly Collection" />);

    expect(screen.getByText('Your Scholarly Collection')).toBeTruthy();
  });

  it('renders the subtitle when given one', async () => {
    await render(
      <HeroBanner title="Your Scholarly Collection" subtitle="4 curated collections to explore" />,
    );

    expect(screen.getByText('4 curated collections to explore')).toBeTruthy();
  });

  // Absent means no second line at all, not an empty one — the same rule
  // ContentCard applies to `publisher`.
  it('omits the subtitle line entirely when none is given', async () => {
    await render(<HeroBanner title="Your Scholarly Collection" />);

    expect(screen.queryByTestId('hero-banner-subtitle')).toBeNull();
  });

  it('announces the title as a heading', async () => {
    await render(<HeroBanner title="Your Scholarly Collection" />);

    expect(screen.getByRole('header')).toBeTruthy();
  });
});

describe('HeroBanner stat pill', () => {
  it('renders the stat it is given', async () => {
    await render(
      <HeroBanner title="The Scholarly Archive" statLabel="Over 140,000 peer-reviewed titles" />,
    );

    expect(screen.getByText('Over 140,000 peer-reviewed titles')).toBeTruthy();
  });

  it('renders no stat pill when none is given', async () => {
    await render(<HeroBanner title="The Scholarly Archive" />);

    expect(screen.queryByTestId('hero-banner-stat')).toBeNull();
  });
});

describe('HeroBanner action button', () => {
  it('renders the action and reports a press through onPressAction', async () => {
    const onPressAction = jest.fn();
    await render(
      <HeroBanner
        title="Your Scholarly Collection"
        actionLabel="Explore All Titles"
        onPressAction={onPressAction}
      />,
    );

    fireEvent.press(screen.getByText('Explore All Titles'));
    expect(onPressAction).toHaveBeenCalledTimes(1);
  });

  // `actionLabel` with no `onPressAction` would render a button that looks
  // tappable and does nothing — SectionHeader's own action slot avoids the
  // same dishonesty, and so does this one.
  it('renders no action button when only actionLabel is given', async () => {
    await render(<HeroBanner title="Your Scholarly Collection" actionLabel="Explore All Titles" />);

    expect(screen.queryByTestId('hero-banner-action')).toBeNull();
  });

  it('renders no action button when neither is given', async () => {
    await render(<HeroBanner title="Your Scholarly Collection" />);

    expect(screen.queryByTestId('hero-banner-action')).toBeNull();
  });
});

describe('HeroBanner updated note', () => {
  it('renders the note it is given', async () => {
    await render(<HeroBanner title="Your Scholarly Collection" updatedLabel="Updated daily" />);

    expect(screen.getByText('Updated daily')).toBeTruthy();
  });

  it('renders no note when none is given', async () => {
    await render(<HeroBanner title="Your Scholarly Collection" />);

    expect(screen.queryByTestId('hero-banner-updated')).toBeNull();
  });
});

describe('HeroBanner loading state', () => {
  // §6: "Skeleton at the real content's dimensions so nothing jumps." The text
  // must be absent, not rendered transparent — a screen reader would read it.
  it('renders no title text while loading, and a skeleton instead', async () => {
    await render(<HeroBanner title="Your Scholarly Collection" state="loading" />);

    expect(screen.queryByText('Your Scholarly Collection')).toBeNull();
    expect(screen.getByTestId('hero-banner-skeleton')).toBeTruthy();
  });

  it('renders no subtitle text while loading, even when one is given', async () => {
    await render(
      <HeroBanner
        title="Your Scholarly Collection"
        subtitle="4 curated collections to explore"
        state="loading"
      />,
    );

    expect(screen.queryByText('4 curated collections to explore')).toBeNull();
  });

  it('renders no stat, action or updated note while loading, even when all are given', async () => {
    await render(
      <HeroBanner
        statLabel="Over 140,000 peer-reviewed titles"
        title="Your Scholarly Collection"
        actionLabel="Explore All Titles"
        onPressAction={() => {}}
        updatedLabel="Updated daily"
        state="loading"
      />,
    );

    expect(screen.queryByTestId('hero-banner-stat')).toBeNull();
    expect(screen.queryByTestId('hero-banner-action')).toBeNull();
    expect(screen.queryByTestId('hero-banner-updated')).toBeNull();
  });
});
