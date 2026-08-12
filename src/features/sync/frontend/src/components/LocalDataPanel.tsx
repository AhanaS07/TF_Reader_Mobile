import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { BookmarkRow, DownloadRow, HighlightRow, OutboxRow, ProgressRow } from '../db/types';
import { IdentityLine } from './StatusBar';

interface Props {
  progress: ProgressRow | null;
  bookmarks: BookmarkRow[];
  highlights: HighlightRow[];
  downloads: DownloadRow[];
  outbox: OutboxRow[];
  onGoToPage: (page: number) => void;
  onDeleteBookmark: (id: string) => void;
  onDeleteHighlight: (id: string) => void;
}

function locatorPage(json: string): number | null {
  try {
    const parsed = JSON.parse(json);
    return typeof parsed?.page === 'number' ? parsed.page : null;
  } catch {
    return null;
  }
}

function locatorOffsets(json: string): string {
  try {
    const parsed = JSON.parse(json);
    return typeof parsed?.offset === 'number' ? String(parsed.offset) : '—';
  } catch {
    return '—';
  }
}

/**
 * What is actually in local SQLite. Sections collapse so the whole picture fits
 * on a phone screen; each header shows its row count and how many are unsynced.
 */
export function LocalDataPanel({
  progress,
  bookmarks,
  highlights,
  downloads,
  outbox,
  onGoToPage,
  onDeleteBookmark,
  onDeleteHighlight,
}: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    downloads: true,
  });
  const toggle = (key: string) =>
    setCollapsed((current) => ({ ...current, [key]: !current[key] }));

  const unsynced = (rows: { synced: number }[]) => rows.filter((r) => r.synced === 0).length;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <IdentityLine />

      <Section
        id="progress"
        title="progress"
        count={progress ? 1 : 0}
        pending={progress && progress.synced === 0 ? 1 : 0}
        collapsed={collapsed.progress}
        onToggle={toggle}
      >
        {progress ? (
          <Row
            primary={`Page ${progress.offset}`}
            secondary={progress.updated_at.slice(11, 19)}
            synced={progress.synced}
            onPress={() => onGoToPage(progress.offset)}
          />
        ) : (
          <Empty text="No reading position yet." />
        )}
      </Section>

      <Section
        id="bookmarks"
        title="bookmarks"
        count={bookmarks.length}
        pending={unsynced(bookmarks)}
        collapsed={collapsed.bookmarks}
        onToggle={toggle}
      >
        {bookmarks.length === 0 && <Empty text="Press Bookmark to add one." />}
        {bookmarks.map((row) => {
          const page = locatorPage(row.locator);
          return (
            <Row
              key={row.id}
              primary={row.name ?? row.chapter_id ?? 'Bookmark'}
              secondary={`page ${page ?? '?'} · ${row.chapter_id ?? ''}`}
              synced={row.synced}
              onPress={page ? () => onGoToPage(page) : undefined}
              onDelete={() => onDeleteBookmark(row.id)}
            />
          );
        })}
      </Section>

      <Section
        id="highlights"
        title="highlights"
        count={highlights.length}
        pending={unsynced(highlights)}
        collapsed={collapsed.highlights}
        onToggle={toggle}
      >
        {highlights.length === 0 && <Empty text="Select text, then press Highlight." />}
        {highlights.map((row) => {
          const page = locatorPage(row.start_locator);
          return (
            <Row
              key={row.id}
              primary={`Page ${page ?? '?'} · ${row.color ?? 'yellow'}`}
              secondary={`offset ${locatorOffsets(row.start_locator)} → ${locatorOffsets(
                row.end_locator,
              )}`}
              synced={row.synced}
              onPress={page ? () => onGoToPage(page) : undefined}
              onDelete={() => onDeleteHighlight(row.id)}
            />
          );
        })}
      </Section>

      <Section
        id="downloads"
        title="downloads"
        count={downloads.length}
        pending={unsynced(downloads)}
        collapsed={collapsed.downloads}
        onToggle={toggle}
      >
        {downloads.length === 0 && <Empty text="Press Download to fetch the book." />}
        {downloads.map((row) => (
          <Row
            key={row.id}
            primary={`${row.format} · ${row.status}`}
            secondary={row.local_path ? `on device: ${row.local_path.slice(-38)}` : 'no local file'}
            synced={row.synced}
          />
        ))}
      </Section>

      <Section
        id="outbox"
        title="outbox"
        count={outbox.length}
        pending={outbox.length}
        collapsed={collapsed.outbox}
        onToggle={toggle}
      >
        {outbox.length === 0 && <Empty text="Empty — everything reached the server." />}
        {outbox.map((row) => (
          <Row
            key={row.id}
            primary={`${row.operation} ${row.entity_type}`}
            secondary={
              row.last_error ? `retry ${row.retry_count} · ${row.last_error}` : row.status
            }
            synced={0}
          />
        ))}
      </Section>

      <Text style={styles.footnote}>
        Highlight text is never stored — only start and end locators. local_path stays on
        the device and is stripped from every outbox payload.
      </Text>
    </ScrollView>
  );
}

function Section({
  id,
  title,
  count,
  pending,
  collapsed,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  count: number;
  pending: number;
  collapsed?: boolean;
  onToggle: (id: string) => void;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Pressable onPress={() => onToggle(id)} style={styles.sectionHeader} hitSlop={4}>
        <Text style={styles.caret}>{collapsed ? '▸' : '▾'}</Text>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionCount}>{count}</Text>
        {pending > 0 && (
          <View style={styles.pendingChip}>
            <Text style={styles.pendingChipText}>{pending} queued</Text>
          </View>
        )}
      </Pressable>
      {!collapsed && children}
    </View>
  );
}

function Empty({ text }: { text: string }) {
  return <Text style={styles.empty}>{text}</Text>;
}

function Row({
  primary,
  secondary,
  synced,
  onPress,
  onDelete,
}: {
  primary: string;
  secondary: string;
  synced: number;
  onPress?: () => void;
  onDelete?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && onPress ? styles.rowPressed : null]}
    >
      <View
        style={[styles.syncBar, synced === 1 ? styles.syncBarDone : styles.syncBarQueued]}
      />
      <View style={styles.rowMain}>
        <Text style={styles.rowPrimary} numberOfLines={1}>
          {primary}
        </Text>
        <Text style={styles.rowSecondary} numberOfLines={1}>
          {secondary}
        </Text>
      </View>
      {onDelete && (
        <Pressable onPress={onDelete} hitSlop={12} style={styles.delete}>
          <Text style={styles.deleteText}>✕</Text>
        </Pressable>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  content: { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 20 },

  section: { marginBottom: 10 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  caret: { fontSize: 10, color: '#9ca3af', width: 12 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#4b5563',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  sectionCount: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9ca3af',
    marginLeft: 6,
  },
  pendingChip: {
    marginLeft: 6,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 7,
    backgroundColor: '#fef3c7',
  },
  pendingChipText: { fontSize: 9, fontWeight: '700', color: '#92400e' },

  empty: { fontSize: 12, color: '#9ca3af', fontStyle: 'italic', paddingVertical: 2, paddingLeft: 12 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    paddingRight: 8,
    marginBottom: 4,
    overflow: 'hidden',
  },
  rowPressed: { backgroundColor: '#eef2ff' },
  syncBar: { width: 3, alignSelf: 'stretch' },
  syncBarDone: { backgroundColor: '#34d399' },
  syncBarQueued: { backgroundColor: '#fbbf24' },
  rowMain: { flex: 1, paddingVertical: 6, paddingHorizontal: 8 },
  rowPrimary: { fontSize: 13, fontWeight: '600', color: '#111827' },
  rowSecondary: { fontSize: 10, color: '#6b7280', marginTop: 1 },
  delete: { paddingHorizontal: 4, paddingVertical: 4 },
  deleteText: { fontSize: 13, color: '#9ca3af' },

  footnote: { fontSize: 10, color: '#9ca3af', lineHeight: 14, marginTop: 2 },
});
