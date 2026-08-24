// The AudioPlayer route: reads `{ bookId, title }` from navigation params and renders
// AudioPlayerScreen — same split ReaderRouteScreen.tsx uses for the WebView reader (this file
// owns navigation concerns, AudioPlayerScreen.tsx owns none). Session-progress wiring lives HERE,
// not in AudioPlayerScreen, for the same reason ReaderRouteScreen.tsx's own header gives:
// audioSessionProgress.ts is a navigation-session concern (resume across BookList <-> AudioPlayer
// within one app run), and AudioPlayerScreen's own initialPosition/onPositionChange props are
// deliberately ignorant of where a position comes from or where it goes.

import { useCallback } from 'react';

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { StyleSheet, View } from 'react-native';

import { AudioPlayerScreen } from '@/features/reader/audio/AudioPlayerScreen';
import {
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

  return (
    <View style={styles.container}>
      <AudioPlayerScreen
        key={bookId}
        bookId={bookId}
        title={title}
        initialPosition={initialPosition}
        onPositionChange={handlePositionChange}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
});
