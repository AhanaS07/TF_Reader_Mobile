// Owner: Reader (Ahana & Team).
//
// MINI AUDIO PLAYER COMPONENT.
// A persistent bottom player bar allowing users to monitor active audiobook playback,
// toggle play/pause, skip tracks, and tap to expand into the full AudioPlayer screen.

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  skipToNextTrack,
  skipToPreviousTrack,
  toggleAudioPlayback,
} from './audioQueueCoordinator';
import { useAudioQueueStore, type AudioQueueItem } from './audioQueueStore';

export interface MiniAudioPlayerProps {
  onExpand?: (item: AudioQueueItem) => void;
}

function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

export function MiniAudioPlayer({ onExpand }: MiniAudioPlayerProps): React.JSX.Element | null {
  const insets = useSafeAreaInsets();
  const currentItem = useAudioQueueStore((s) => s.getCurrentItem());
  const isPlaying = useAudioQueueStore((s) => s.isPlaying);
  const playbackProgress = useAudioQueueStore((s) => s.playbackProgress);
  const hasNext = useAudioQueueStore((s) => s.hasNext());
  const hasPrevious = useAudioQueueStore((s) => s.hasPrevious());

  if (!currentItem) {
    return null;
  }

  const progressRatio =
    playbackProgress.durationSeconds > 0
      ? clamp(playbackProgress.positionSeconds / playbackProgress.durationSeconds, 0, 1)
      : 0;

  const canRewindOrPrevious = hasPrevious || playbackProgress.positionSeconds > 3.0;

  return (
    <View style={[styles.container, { paddingBottom: Math.max(insets.bottom, 6) }]}>
      {/* Progress Bar Header */}
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progressRatio * 100}%` }]} />
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open audio player: ${currentItem.title}`}
        onPress={() => onExpand?.(currentItem)}
        style={styles.contentRow}
      >
        <View style={styles.iconContainer}>
          <Text style={styles.iconText}>🎧</Text>
        </View>

        <View style={styles.metadataContainer}>
          <Text style={styles.titleText} numberOfLines={1} ellipsizeMode="tail">
            {currentItem.title}
          </Text>
          <Text style={styles.statusText}>
            {isPlaying ? 'Playing' : 'Paused'}
          </Text>
        </View>

        {/* Transport Controls */}
        <View style={styles.controlsRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous track"
            onPress={() => {
              void skipToPreviousTrack(playbackProgress.positionSeconds);
            }}
            disabled={!canRewindOrPrevious}
            hitSlop={8}
            style={[styles.controlButton, !canRewindOrPrevious && styles.controlButtonDisabled]}
          >
            <Text style={[styles.controlIcon, !canRewindOrPrevious && styles.controlIconDisabled]}>
              |‹‹
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
            onPress={() => {
              void toggleAudioPlayback();
            }}
            hitSlop={8}
            style={styles.playPauseButton}
          >
            <Text style={styles.playPauseIcon}>{isPlaying ? '⏸' : '▶'}</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next track"
            onPress={() => {
              void skipToNextTrack();
            }}
            disabled={!hasNext}
            hitSlop={8}
            style={[styles.controlButton, !hasNext && styles.controlButtonDisabled]}
          >
            <Text style={[styles.controlIcon, !hasNext && styles.controlIconDisabled]}>
              ››|
            </Text>
          </Pressable>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 8,
  },
  progressTrack: {
    height: 3,
    backgroundColor: '#e9ecef',
    width: '100%',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#111111',
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 64,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#f1f3f5',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  iconText: {
    fontSize: 20,
  },
  metadataContainer: {
    flex: 1,
    justifyContent: 'center',
    marginRight: 10,
  },
  titleText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111111',
  },
  statusText: {
    fontSize: 12,
    color: '#666666',
    marginTop: 2,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  controlButton: {
    padding: 6,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 32,
    minHeight: 32,
  },
  controlButtonDisabled: {
    opacity: 0.35,
  },
  controlIcon: {
    fontSize: 14,
    fontWeight: '800',
    color: '#111111',
  },
  controlIconDisabled: {
    color: '#888888',
  },
  playPauseButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playPauseIcon: {
    fontSize: 16,
    color: '#ffffff',
  },
});
