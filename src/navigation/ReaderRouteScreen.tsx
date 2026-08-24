// The Reader route: reads `{ bookId, format }` from navigation params and renders ReaderScreen,
// replacing App.tsx's old inline mount (`<ReaderScreen key={bookId} bookId={bookId} />`) plus its
// header-row DevPreferencesMenu. This screen owns no book-selection state of its own — native-stack
// gives it a fresh instance (and a working back button to BookList) per navigate() call, which is
// exactly what ReaderScreen's own "callers must key on bookId" contract asks for; here that key
// comes from being a distinct route push rather than a hand-written `key` prop.
//
// SESSION-PROGRESS WIRING LIVES HERE, NOT IN ReaderScreen. `sessionProgress.ts` is a navigation-
// session concern (resume across BookList <-> Reader within one app run), and ReaderScreen's own
// `initialTarget`/`onRelocated` props are deliberately ignorant of where a target comes from or
// where a position goes — see their doc comments in ReaderScreen.tsx.
//
// DevPreferencesMenu GOES THROUGH `toolbarExtra`, NOT a sibling overlay. Two earlier shapes each
// broke something: `headerRight` got clipped by react-native-screens' native header (no visible
// dropdown), and a same-tree absolutely-positioned overlay landed on top of — and ate touches for —
// ReaderScreen's own right-aligned toolbar (search/TTS), since both anchored to the same corner.
// Passing it INTO ReaderScreen's own toolbar row is what makes "share one row, preferences
// rightmost" a layout guarantee instead of two files' pixel math staying in sync by luck.

import { useCallback, useLayoutEffect, useMemo } from 'react';

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { StyleSheet, View } from 'react-native';

import type { ReaderPosition } from '@/features/reader/readerBridge';
import { ReaderScreen } from '@/features/reader/ReaderScreen';
import {
  getSessionPosition,
  setSessionPosition,
  targetFromPosition,
} from '@/features/reader/sessionProgress';

import { DevPreferencesMenu } from '../../DevPreferencesMenu';
import type { RootStackParamList } from './RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Reader'>;

export function ReaderRouteScreen({ route, navigation }: Props): React.JSX.Element {
  const { bookId, format } = route.params;

  // Title only. DevPreferencesMenu is NOT headerRight — see this file's header note for why.
  useLayoutEffect(() => {
    navigation.setOptions({ title: format });
  }, [navigation, format]);

  // Read once per bookId — see ReaderScreen's `initialTarget` doc for why a live update here would
  // be pointless (this component remounts, via ReaderScreen's own key, on every distinct route).
  const initialTarget = useMemo(() => targetFromPosition(getSessionPosition(bookId)), [bookId]);

  const handleRelocated = useCallback(
    (position: ReaderPosition) => {
      setSessionPosition(bookId, position);
    },
    [bookId],
  );

  return (
    <View style={styles.container}>
      <ReaderScreen
        key={bookId}
        bookId={bookId}
        initialTarget={initialTarget ?? undefined}
        onRelocated={handleRelocated}
        toolbarExtra={<DevPreferencesMenu format={format} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
});
