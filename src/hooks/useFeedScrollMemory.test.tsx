// A7 — the offset has to survive the screen being swapped out, so these tests
// scroll a throwaway feed, force it to remount, and check where it lands. That
// remount is the point: it is what signing in or out does to the real screens,
// and it is why the offset cannot live inside either of them.
//
// The remount is driven by changing the child's `key` through rerender, which
// is the closest model of the real swap: React tears the old feed down and
// mounts a new one inside a live tree, exactly as replacing CatalogueScreen
// with PublicCatalogueScreen does.
//
// TWO THINGS BIT HERE, both of which fail in a LATER test than the one at
// fault, so they are worth knowing about before editing this file:
//   - An unawaited fireEvent that reaches a handler leaves React mid-update and
//     the next render comes back as an empty tree. Every fireEvent below is
//     awaited.
//   - `restoreAllMocks` does not restore ScrollView.prototype.scrollTo, because
//     it is inherited rather than an own property. The next spyOn then returns
//     the SAME mock with the previous test's calls still on it. See afterEach.
import { ScrollView, Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import {
  PUBLIC_FEED,
  forgetFeedOffsets,
  rememberedFeedOffset,
  useFeedScrollMemory,
} from '@hooks/useFeedScrollMemory';

// Stands in for a feed screen: the same three wirings CatalogueScreen and
// PublicCatalogueScreen use, and nothing else.
function FakeFeed({ feedKey }: { feedKey: string }) {
  const { scrollRef, onScroll, onContentSizeChange } = useFeedScrollMemory(feedKey);

  return (
    <ScrollView
      testID="feed"
      ref={scrollRef}
      onScroll={onScroll}
      scrollEventThrottle={16}
      onContentSizeChange={onContentSizeChange}
    >
      <Text>a row</Text>
    </ScrollView>
  );
}

// `visit` is only there to change the child's key: same feed, mounted afresh.
function Harness({ feedKey, visit }: { feedKey: string; visit: number }) {
  return <FakeFeed key={`${feedKey}#${visit}`} feedKey={feedKey} />;
}

const INSTITUTION_FEED = 'inst_7f3';

type View = Awaited<ReturnType<typeof render>>;

async function scrollTo(view: View, y: number) {
  await fireEvent.scroll(view.getByTestId('feed'), {
    nativeEvent: { contentOffset: { y }, contentSize: { height: 2000, width: 400 } },
  });
}

// The feed reporting how tall it now is, which is what triggers a restore.
async function reportHeight(view: View, height: number) {
  await fireEvent(view.getByTestId('feed'), 'contentSizeChange', 400, height);
}

afterEach(() => {
  forgetFeedOffsets();
  // BOTH, and clearAllMocks is the one that matters. `scrollTo` is inherited
  // rather than an own property of ScrollView.prototype, so restoreAllMocks
  // does not put it back — the next spyOn then hands back the SAME mock with
  // the previous test's calls still on it, and a call-count assertion reads a
  // stale call as a fresh one.
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe('remembering an offset', () => {
  it('starts every feed at the top', () => {
    expect(rememberedFeedOffset(INSTITUTION_FEED)).toBe(0);
  });

  it('records how far the reader scrolled', async () => {
    const view = await render(<Harness feedKey={INSTITUTION_FEED} visit={1} />);

    await scrollTo(view, 420);

    expect(rememberedFeedOffset(INSTITUTION_FEED)).toBe(420);
  });

  it('survives the feed being torn down, which is what signing out does', async () => {
    const view = await render(<Harness feedKey={INSTITUTION_FEED} visit={1} />);
    await scrollTo(view, 420);

    view.unmount();

    expect(rememberedFeedOffset(INSTITUTION_FEED)).toBe(420);
  });

  // The whole reason it is keyed per feed: the two are different lists, so one
  // must never inherit the other's position.
  it('keeps each feed’s offset separate', async () => {
    const view = await render(<Harness feedKey={INSTITUTION_FEED} visit={1} />);
    await scrollTo(view, 420);

    // Signing out: the institution feed goes, the public feed arrives.
    await view.rerender(<Harness feedKey={PUBLIC_FEED} visit={1} />);
    await scrollTo(view, 90);

    expect(rememberedFeedOffset(INSTITUTION_FEED)).toBe(420);
    expect(rememberedFeedOffset(PUBLIC_FEED)).toBe(90);
  });
});

describe('restoring an offset', () => {
  it('scrolls a returning feed back to where the reader was', async () => {
    const scroll = jest.spyOn(ScrollView.prototype, 'scrollTo');
    const view = await render(<Harness feedKey={INSTITUTION_FEED} visit={1} />);
    await scrollTo(view, 420);

    // Signing back in: the same feed mounts again and its rows arrive.
    await view.rerender(<Harness feedKey={INSTITUTION_FEED} visit={2} />);
    await reportHeight(view, 2000);

    expect(scroll).toHaveBeenCalledWith({ y: 420, animated: false });
  });

  // A feed that was never scrolled must not be scrolled on arrival — that is the
  // opposite bug, moving a reader who was already at the top.
  it('leaves a feed alone when there is nothing to return to', async () => {
    const scroll = jest.spyOn(ScrollView.prototype, 'scrollTo');
    const view = await render(<Harness feedKey={INSTITUTION_FEED} visit={1} />);

    await reportHeight(view, 2000);

    expect(scroll).not.toHaveBeenCalled();
  });

  // The rows arrive after the fetch, so the first content size is the skeletons'
  // and is shorter than the offset. Restoring against that height would clamp to
  // the bottom of a short list and land nowhere near where the reader was.
  it('waits for content tall enough to hold the offset', async () => {
    const scroll = jest.spyOn(ScrollView.prototype, 'scrollTo');
    const view = await render(<Harness feedKey={INSTITUTION_FEED} visit={1} />);
    await scrollTo(view, 420);
    await view.rerender(<Harness feedKey={INSTITUTION_FEED} visit={2} />);

    await reportHeight(view, 120); // skeletons only
    expect(scroll).not.toHaveBeenCalled();

    await reportHeight(view, 2000); // real rows
    expect(scroll).toHaveBeenCalledWith({ y: 420, animated: false });
  });

  // "Load more" makes the list taller, firing onContentSizeChange again. A
  // second restore would drag the reader back up mid-scroll.
  it('restores once and then stays out of the way', async () => {
    const scroll = jest.spyOn(ScrollView.prototype, 'scrollTo');
    const view = await render(<Harness feedKey={INSTITUTION_FEED} visit={1} />);
    await scrollTo(view, 420);
    await view.rerender(<Harness feedKey={INSTITUTION_FEED} visit={2} />);

    await reportHeight(view, 2000);
    await reportHeight(view, 4000); // a later page appended

    expect(scroll).toHaveBeenCalledTimes(1);
  });
});
