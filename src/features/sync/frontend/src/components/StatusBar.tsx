import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BOOK_ID, USER_ID } from '../config';

interface Props {
  online: boolean;
  pendingCount: number;
  page: number;
  pageCount: number;
  lastSync: string | null;
  tab: 'reader' | 'data';
  onSelectTab: (tab: 'reader' | 'data') => void;
}

/**
 * One compact header row: connection, queue depth, page, and the view switch.
 * Kept to a single line so the reader keeps as much height as possible.
 */
export function StatusBar({
  online,
  pendingCount,
  page,
  pageCount,
  lastSync,
  tab,
  onSelectTab,
}: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.left}>
        <View style={[styles.dot, online ? styles.dotOnline : styles.dotOffline]} />
        <Text style={styles.state}>{online ? 'On' : 'Off'}</Text>

        {pendingCount > 0 && (
          <View style={styles.queueChip}>
            <Text style={styles.queueText}>{pendingCount}</Text>
          </View>
        )}

        <Text style={styles.meta} numberOfLines={1}>
          {pageCount > 0 ? `p${page}/${pageCount}` : '—'}
          {lastSync ? ` · ${lastSync}` : ''}
        </Text>
      </View>

      <View style={styles.segment}>
        <Segment label="Read" active={tab === 'reader'} onPress={() => onSelectTab('reader')} />
        <Segment
          label={pendingCount > 0 ? `Data ${pendingCount}` : 'Data'}
          active={tab === 'data'}
          onPress={() => onSelectTab('data')}
        />
      </View>
    </View>
  );
}

function Segment({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={[styles.segmentButton, active && styles.segmentActive]}
    >
      <Text style={[styles.segmentText, active && styles.segmentTextActive]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** The fixed prototype ids, shown once in the data view instead of the header. */
export function IdentityLine() {
  return (
    <Text style={styles.ids} numberOfLines={1}>
      {USER_ID} · {BOOK_ID}
    </Text>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#111827',
  },
  left: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  dot: { width: 7, height: 7, borderRadius: 4, marginRight: 5 },
  dotOnline: { backgroundColor: '#34d399' },
  dotOffline: { backgroundColor: '#f87171' },
  state: { color: '#f9fafb', fontSize: 12, fontWeight: '700' },
  queueChip: {
    marginLeft: 6,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 8,
    backgroundColor: '#78350f',
  },
  queueText: { color: '#fbbf24', fontSize: 10, fontWeight: '700' },
  meta: { color: '#9ca3af', fontSize: 11, marginLeft: 8, flexShrink: 1 },

  segment: {
    flexDirection: 'row',
    backgroundColor: '#1f2937',
    borderRadius: 7,
    padding: 2,
    marginLeft: 8,
  },
  segmentButton: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 5 },
  segmentActive: { backgroundColor: '#2563eb' },
  segmentText: { color: '#9ca3af', fontSize: 11, fontWeight: '700' },
  segmentTextActive: { color: '#ffffff' },

  ids: { fontSize: 10, color: '#9ca3af', marginBottom: 8 },
});
