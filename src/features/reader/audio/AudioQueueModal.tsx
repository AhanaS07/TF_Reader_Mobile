// Owner: Reader (Ahana & Team).
//
// AUDIO QUEUE MODAL.
// Bottom-sheet style modal for managing the audiobook playlist:
// - View now playing and upcoming tracks
// - Jump directly to any track
// - Reorder tracks up/down
// - Remove individual tracks from queue
// - Toggle repeat mode (off -> all -> one)
// - Clear entire queue

import { useCallback } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { color, radius, space } from '@theme/tokens';

import { clearAudioQueue, removeQueueItem } from './audioQueueCoordinator';
import { useAudioQueueStore, type AudioQueueItem, type RepeatMode } from './audioQueueStore';

export interface AudioQueueModalProps {
  visible: boolean;
  onClose: () => void;
  onSelectTrack?: (index: number) => void;
}

function repeatModeLabel(mode: RepeatMode): string {
  switch (mode) {
    case 'all':
      return 'Repeat: All';
    case 'one':
      return 'Repeat: Track';
    case 'off':
    default:
      return 'Repeat: Off';
  }
}

export function AudioQueueModal({
  visible,
  onClose,
  onSelectTrack,
}: AudioQueueModalProps): React.JSX.Element {
  const items = useAudioQueueStore((s) => s.items);
  const currentIndex = useAudioQueueStore((s) => s.currentIndex);
  const repeatMode = useAudioQueueStore((s) => s.repeatMode);
  const reorder = useAudioQueueStore((s) => s.reorder);
  const toggleRepeatMode = useAudioQueueStore((s) => s.toggleRepeatMode);

  const handleSelectTrack = useCallback(
    (index: number) => {
      onSelectTrack?.(index);
      onClose();
    },
    [onSelectTrack, onClose],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: AudioQueueItem; index: number }) => {
      const isCurrent = index === currentIndex;

      return (
        <View
          style={[styles.itemRow, isCurrent && styles.itemRowActive]}
          accessibilityRole="none"
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${isCurrent ? 'Now playing: ' : 'Play '}${item.title}`}
            onPress={() => handleSelectTrack(index)}
            style={styles.itemTrackInfo}
          >
            <Text style={[styles.itemIndex, isCurrent && styles.itemIndexActive]}>
              {index + 1}
            </Text>
            <View style={styles.itemTextContainer}>
              <Text
                numberOfLines={1}
                style={[styles.itemTitle, isCurrent && styles.itemTitleActive]}
              >
                {item.title}
              </Text>
              {isCurrent ? (
                <Text style={styles.nowPlayingBadge}>Now Playing</Text>
              ) : item.artist ? (
                <Text numberOfLines={1} style={styles.itemArtist}>
                  {item.artist}
                </Text>
              ) : null}
            </View>
          </Pressable>

          <View style={styles.itemActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Move ${item.title} up`}
              disabled={index === 0}
              onPress={() => reorder(index, index - 1)}
              style={[styles.actionButton, index === 0 && styles.actionButtonDisabled]}
            >
              <Text style={[styles.actionIcon, index === 0 && styles.actionIconDisabled]}>
                ▲
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Move ${item.title} down`}
              disabled={index === items.length - 1}
              onPress={() => reorder(index, index + 1)}
              style={[
                styles.actionButton,
                index === items.length - 1 && styles.actionButtonDisabled,
              ]}
            >
              <Text
                style={[
                  styles.actionIcon,
                  index === items.length - 1 && styles.actionIconDisabled,
                ]}
              >
                ▼
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${item.title} from queue`}
              onPress={() => {
                void removeQueueItem(index);
              }}
              style={styles.actionButton}
            >
              <Text style={styles.removeIcon}>✕</Text>
            </Pressable>
          </View>
        </View>
      );
    },
    [currentIndex, items.length, handleSelectTrack, reorder],
  );

  return (
    <Modal
      animationType="slide"
      transparent
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.header}>
            <View>
              <Text style={styles.headerTitle}>Queue</Text>
              <Text style={styles.headerSubtitle}>
                {items.length} {items.length === 1 ? 'track' : 'tracks'}
              </Text>
            </View>

            <View style={styles.headerRight}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={repeatModeLabel(repeatMode)}
                onPress={toggleRepeatMode}
                style={[
                  styles.repeatButton,
                  repeatMode !== 'off' && styles.repeatButtonActive,
                ]}
              >
                <Text
                  style={[
                    styles.repeatButtonLabel,
                    repeatMode !== 'off' && styles.repeatButtonLabelActive,
                  ]}
                >
                  {repeatModeLabel(repeatMode)}
                </Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close queue"
                onPress={onClose}
                style={styles.closeButton}
              >
                <Text style={styles.closeIcon}>✕</Text>
              </Pressable>
            </View>
          </View>

          {items.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>Queue is empty</Text>
            </View>
          ) : (
            <FlatList
              data={items}
              keyExtractor={(item, index) => `${item.bookId}-${index}`}
              renderItem={renderItem}
              contentContainerStyle={styles.listContent}
            />
          )}

          <View style={styles.footer}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear queue"
              disabled={items.length === 0}
              onPress={clearAudioQueue}
              style={[
                styles.clearButton,
                items.length === 0 && styles.clearButtonDisabled,
              ]}
            >
              <Text
                style={[
                  styles.clearButtonLabel,
                  items.length === 0 && styles.clearButtonLabelDisabled,
                ]}
              >
                Clear Queue
              </Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    // Indigo (`color.navy`), the brand's own "dark overlays" colour.
    backgroundColor: 'rgba(0, 34, 68, 0.45)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: color.white,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    maxHeight: '80%',
    minHeight: '40%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: space.md,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.border,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: color.textPrimary,
  },
  headerSubtitle: {
    fontSize: 13,
    color: color.textSecondary,
    marginTop: 2,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  repeatButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: radius.sheet,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  // `color.primary` — the brand's own "active tabs" colour, same call this file's
  // rateButtonActive-equivalent makes for AudioPlayerScreen's playback-speed picker.
  repeatButtonActive: {
    borderColor: color.primary,
    backgroundColor: color.subscriptionTint,
  },
  repeatButtonLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: color.textSecondary,
  },
  repeatButtonLabelActive: {
    color: color.primary,
  },
  closeButton: {
    padding: space.sm,
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeIcon: {
    fontSize: 18,
    color: color.textPrimary,
    fontWeight: '700',
  },
  listContent: {
    paddingVertical: space.sm,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.border,
  },
  // The brand palette has no light tint for `color.success` (Mint) the way it does for
  // subscription/error, so "now playing" reuses the same brand-blue "active" accent as
  // `repeatButtonActive` above, rather than inventing an untracked green hex
  // (CONVENTIONS §5).
  itemRowActive: {
    backgroundColor: color.subscriptionTint,
  },
  itemTrackInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: space.sm,
  },
  itemIndex: {
    fontSize: 14,
    fontWeight: '700',
    color: color.textSecondary,
    width: 24,
  },
  itemIndexActive: {
    color: color.primary,
    fontWeight: '700',
  },
  itemTextContainer: {
    flex: 1,
  },
  itemTitle: {
    fontSize: 15,
    // 500 is not a brand weight (only 300/400/700 exist) — 400 is the closest.
    fontWeight: '400',
    color: color.textPrimary,
  },
  itemTitleActive: {
    color: color.primary,
    fontWeight: '700',
  },
  itemArtist: {
    fontSize: 13,
    color: color.textSecondary,
    marginTop: 2,
  },
  nowPlayingBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: color.primary,
    textTransform: 'uppercase',
    marginTop: 2,
  },
  itemActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  actionButton: {
    padding: 6,
    minWidth: 36,
    minHeight: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionButtonDisabled: {
    opacity: 0.3,
  },
  actionIcon: {
    fontSize: 12,
    color: color.textSecondary,
  },
  actionIconDisabled: {
    color: color.border,
  },
  removeIcon: {
    fontSize: 16,
    color: color.error,
    fontWeight: '700',
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: color.textSecondary,
  },
  footer: {
    padding: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.border,
  },
  clearButton: {
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: radius.card,
    backgroundColor: color.errorTint,
  },
  clearButtonDisabled: {
    backgroundColor: color.surface,
  },
  clearButtonLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: color.error,
  },
  clearButtonLabelDisabled: {
    color: color.textSecondary,
  },
});
