// Owner: Reader (Ahana) for now — see the header note on BookListScreen.tsx for why this is still
// dev scaffolding rather than a real library screen, and CLAUDE.md's "Temporary scaffolding"
// section for what that means for deletion later.
//
// Replaces App.tsx's old state-swapped `bookId` picker with real routes: BookList is
// the initial screen, Reader and AudioPlayer are pushed on top of it and pop back to it for free via
// native-stack's own header back button. Nothing here owns book state any more — each screen reads
// what it needs from its own route params.

import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useAutoSync } from '@/features/sync/useAutoSync';
import type { BookId, ContentFormat } from '@/shared/contracts';
import { MockLibraryScreen } from '@/features/sync/mock/MockLibraryScreen';
import type { ReaderTarget } from '@/features/reader/readerBridge';

import { AudioPlayerRouteScreen } from './AudioPlayerRouteScreen';
import { BookInfoRouteScreen } from './BookInfoRouteScreen';
import { BookListScreen } from './BookListScreen';
import { ReaderRouteScreen } from './ReaderRouteScreen';

export type RootStackParamList = {
  BookList: undefined;
  // `format` travels as a param rather than being re-derived from `bookId` on the other side —
  // it's fixture metadata BookListScreen already knows statically (same reasoning as the old
  // DevFixture table in App.tsx), and ReaderRouteScreen needs it before ReaderScreen has resolved
  // anything, to gate DevPreferencesMenu's format-specific sections.
  //
  // `initialTarget` is optional and orthogonal to `progressStore`'s own resume mechanism —
  // ReaderRouteScreen prefers this when a caller supplies it (e.g. tapping a bookmark elsewhere in
  // the app) and falls back to the stored reading position otherwise. Most callers (BookListScreen)
  // never pass it.
  Reader: { bookId: BookId; format: ContentFormat; initialTarget?: ReaderTarget };
  // AUDIO PHASE 3. No `format` param — this route only ever hosts AUDIO, so there's nothing to
  // gate the way ReaderRouteScreen gates DevPreferencesMenu's sections. `title` is fixture
  // metadata BookListScreen already has statically, same reasoning `format` was passed for
  // Reader. BookListScreen decides AUDIO vs Reader at tap time — this route never receives an
  // EPUB/PDF bookId, and ReaderScreen never receives an AUDIO one.
  AudioPlayer: { bookId: BookId; title: string };
  // Accessibility's own screen (Day 3) — no `format` param, it re-derives one via
  // getPublicationAccessibility's own getFormat(bookId) call.
  BookInfo: { bookId: BookId };
  // TEMP, with src/features/sync/mock/ — remove this route when that whole folder goes.
  MockLibrary: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator(): React.JSX.Element {
  // Mounted here (the always-present app root) so the sync engine actually runs: it fires
  // syncEngine.run() on app open and on every offline->online reconnect, draining the SQLite
  // outbox to Mongo and pulling back. Without this call the whole sync layer was built but never
  // triggered. Edge-triggered on connectivity, NOT on edits — an edit made while already online
  // still waits for the next reconnect/app-open unless a per-edit push is added separately.
  useAutoSync();

  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="BookList">
        <Stack.Screen name="BookList" component={BookListScreen} options={{ title: 'TF Reader' }} />
        {/*
          title is set from inside the screen (ReaderRouteScreen's own useLayoutEffect) — it
          depends on the route's `format` param, which isn't known here.

          `gestureEnabled: false`: native-stack's default is an iOS edge-swipe-to-go-back gesture.
          THE MECHANISM THIS ORIGINALLY DEFENDED AGAINST IS GONE: it named a raw PanResponder
          ReaderScreen mounted over the whole book for its next/prev page-turn swipe, competing
          with native-stack's own gesture for the same touch stream. That PanResponder was removed
          when both reading gestures (long-press-to-select, directional-drag-to-turn-page) moved
          INSIDE the WebView (see ReaderScreen.tsx's own note near its `viewer`, and
          webview/src/touchGesture.ts) — there is no RN-side gesture responder over the book any
          more. Whether the WebView's OWN internal gesture recognizer still conflicts with the
          native-stack edge-swipe (a partial-then-cancelled swipe-back is a known trigger for
          flaky blur/focus ordering) is UNVERIFIED — flip this only with a device check covering
          that specifically, not on the strength of this comment. The symptom this was originally
          fixed for (BookList's Pressables going dead after visiting Reader, no error) has not been
          re-confirmed on a device either way. The header back button is untouched regardless and
          is the only way back now; that is a fine trade since it already worked.
        */}
        <Stack.Screen
          name="Reader"
          component={ReaderRouteScreen}
          options={{ gestureEnabled: false }}
        />
        {/* No gestureEnabled: false here — AudioPlayerScreen has no competing PanResponder-style
            swipe the way ReaderScreen does, so the default edge-swipe-back gesture is fine. */}
        <Stack.Screen name="AudioPlayer" component={AudioPlayerRouteScreen} />
        {/* headerShown: false + presentation: 'modal': this screen adds its own close control
            (MIN_TOUCH_TARGET-sized), rather than relying on native-stack's default header back
            button, which isn't chrome this screen owns. */}
        <Stack.Screen
          name="BookInfo"
          component={BookInfoRouteScreen}
          options={{ headerShown: false, presentation: 'modal' }}
        />
        {/* TEMP, with src/features/sync/mock/ — remove this route when that whole folder goes. */}
        <Stack.Screen
          name="MockLibrary"
          component={MockLibraryScreen}
          options={{ title: 'Sync Mock' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
