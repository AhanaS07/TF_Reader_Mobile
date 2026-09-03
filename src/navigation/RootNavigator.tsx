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

          `gestureEnabled: false`: native-stack's default is an iOS edge-swipe-to-go-back gesture,
          and ReaderScreen mounts its OWN full-bleed swipe handler over the same area (a raw
          PanResponder, for its next/prev page-turn swipe — see ReaderScreen.tsx's `panResponder`).
          The two compete for the same touch stream. Symptom reported on device: after going back
          from Reader, BookList's own Pressables stopped responding to any tap, with no error — and
          only after visiting Reader, never from the other routes (none has a competing gesture).
          This is
          the standard fix for that class of bug (a screen with its own horizontal PanResponder
          swipe needs `gestureEnabled: false`, or the OS's edge-swipe-back gesture intermittently
          wins the same touch and leaves RN's responder state stuck) — it has not been re-confirmed
          against the reported symptom on a device since. The header back button is untouched by
          this and is the only way back now; that is a fine trade since it already worked.
        */}
        <Stack.Screen
          name="Reader"
          component={ReaderRouteScreen}
          options={{ gestureEnabled: false }}
        />
        {/* No gestureEnabled: false here — AudioPlayerScreen has no competing PanResponder-style
            swipe the way ReaderScreen does, so the default edge-swipe-back gesture is fine. */}
        <Stack.Screen name="AudioPlayer" component={AudioPlayerRouteScreen} />
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
