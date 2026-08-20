// A7 — how far the reader had scrolled each feed, kept outside the screens.
//
// Signing in or out swaps CatalogueScreen for PublicCatalogueScreen. They are
// different components, so React unmounts one and mounts the other and no
// scroll state inside either can survive it. The week 2 plan asks for the
// re-scope to happen "without dumping them back at the top", so the offset has
// to live somewhere neither screen owns.
//
// ONE OFFSET PER FEED, not a single shared number. The institution catalogue and
// the public catalogue are different lists of different lengths; restoring one
// feed's offset onto the other would land somewhere arbitrary. Signing out puts
// the reader back where they were in the PUBLIC feed, and signing in back where
// they were in their institution's — which is what "sign out and it goes back"
// describes.
//
// Session-only, deliberately not persisted: after a cold start there is no feed
// the reader was part-way down.
import { useCallback, useRef } from 'react';
import { ScrollView, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

const offsetByFeed = new Map<string, number>();

// The public feed has no institution id to key on.
export const PUBLIC_FEED = 'public';

export function rememberedFeedOffset(feedKey: string): number {
  return offsetByFeed.get(feedKey) ?? 0;
}

// Tests only — module state outlives a single test otherwise.
export function forgetFeedOffsets(): void {
  offsetByFeed.clear();
}

export function useFeedScrollMemory(feedKey: string) {
  const scrollRef = useRef<ScrollView>(null);
  // Restore is a one-shot. Without this the reader would be yanked back to the
  // remembered offset every time the list grew under them — "Load more" makes
  // the content taller, which fires onContentSizeChange again.
  const alreadyRestored = useRef(false);

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      offsetByFeed.set(feedKey, event.nativeEvent.contentOffset.y);
    },
    [feedKey],
  );

  // WHY NOT AN EFFECT: on the first render the feed is still loading and the
  // list is only as tall as its skeletons, so scrolling to a saved offset would
  // be clamped to the bottom of a short list and silently land in the wrong
  // place. onContentSizeChange fires again each time the rows arrive, so this
  // waits for the first height that can actually hold the offset.
  const onContentSizeChange = useCallback(
    (_width: number, height: number) => {
      if (alreadyRestored.current) return;

      const offset = rememberedFeedOffset(feedKey);
      if (offset === 0) {
        alreadyRestored.current = true;
        return;
      }
      if (height < offset) return;

      scrollRef.current?.scrollTo({ y: offset, animated: false });
      alreadyRestored.current = true;
    },
    [feedKey],
  );

  return { scrollRef, onScroll, onContentSizeChange };
}
