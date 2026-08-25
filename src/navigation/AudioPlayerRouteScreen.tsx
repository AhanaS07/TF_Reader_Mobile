// The AudioPlayer route: reads `{ bookId, title }` from navigation params and renders
// AudioPlayerScreen — same split ReaderRouteScreen.tsx uses for the WebView reader (this file
// owns navigation concerns, AudioPlayerScreen.tsx owns none). Progress wiring lives HERE, not in
// AudioPlayerScreen, for the same reason ReaderRouteScreen.tsx's own header gives: resuming a book
// is a routing concern (which position does THIS push start at), and AudioPlayerScreen's own
// initialPosition/onPositionChange/onPositionCommit props are deliberately ignorant of where a
// position comes from or where it goes.
//
// AUDIO PHASE 4: audioSessionProgress.ts is now DURABLE (survives relaunch) but still LOCAL and
// UNSYNCED — see that file's header for what cross-device resume additionally requires. Nothing
// about that changed this file's shape, which is the point of the seam.

import { useCallback } from 'react';

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { StyleSheet, View } from 'react-native';

import { AudioPlayerScreen } from '@/features/reader/audio/AudioPlayerScreen';
import {
  flushAudioSessionPosition,
  getAudioSessionPosition,
  setAudioSessionPosition,
} from '@/features/reader/audio/audioSessionProgress';

import type { RootStackParamList } from './RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'AudioPlayer'>;

export function AudioPlayerRouteScreen({ route }: Props): React.JSX.Element {
  const { bookId, title } = route.params;

  // Read once per bookId — this component remounts (via AudioPlayerScreen's own `key={bookId}`)
  // on every distinct route, same reasoning as ReaderRouteScreen's initialTarget.
  const initialPosition = getAudioSessionPosition(bookId);

  const handlePositionChange = useCallback(
    (positionSeconds: number) => {
      setAudioSessionPosition(bookId, positionSeconds);
    },
    [bookId],
  );

  // AUDIO PHASE 4. The store throttles its disk writes, so per-tick changes can sit unwritten;
  // this is the "write it through now" path for the edges AudioPlayerScreen flags as urgent.
  const handlePositionCommit = useCallback(
    (positionSeconds: number) => {
      setAudioSessionPosition(bookId, positionSeconds);
      flushAudioSessionPosition();
    },
    [bookId],
  );

  return (
    <View style={styles.container}>
      <AudioPlayerScreen
        key={bookId}
        bookId={bookId}
        title={title}
        initialPosition={initialPosition}
        onPositionChange={handlePositionChange}
        onPositionCommit={handlePositionCommit}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
});
