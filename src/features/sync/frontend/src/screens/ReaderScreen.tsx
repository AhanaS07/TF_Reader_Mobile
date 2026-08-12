import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ASSET_BASE_URL } from '../config';
import { getDatabase } from '../db/database';
import { SYNC_KEYS } from '../db/schema';
import type {
  BookmarkRow,
  DownloadRow,
  HighlightRow,
  OutboxRow,
  ProgressRow,
} from '../db/types';

import { LocalDataPanel } from '../components/LocalDataPanel';
import { PdfReader, type PdfReaderHandle, type PdfSelection } from '../components/PdfReader';
import { StatusBar as SyncStatusBar } from '../components/StatusBar';
import { Toolbar, ToolbarButton } from '../components/Toolbar';

import {
  cachedAssets,
  downloadBookAssets,
  readPdfBase64,
  type CachedAssets,
} from '../pdf/assets';

import { bookmarkRepository } from '../repositories/bookmarkRepository';
import { downloadRepository } from '../repositories/downloadRepository';
import { highlightRepository, toPaintable } from '../repositories/highlightRepository';
import { outboxRepository } from '../repositories/outboxRepository';
import { progressRepository } from '../repositories/progressRepository';
import { syncMetadataRepository } from '../repositories/syncMetadataRepository';

import { syncManager } from '../sync/syncManager';
import { useConnectivity } from '../sync/useConnectivity';

type Tab = 'reader' | 'data';

/** How often to retry while the outbox still has something in it. */
const SYNC_RETRY_MS = 10_000;

/** Quiet period after an edit before it is pushed. Collapses a burst into one run. */
const FLUSH_DEBOUNCE_MS = 1_500;

export function ReaderScreen() {
  const online = useConnectivity();
  const insets = useSafeAreaInsets();
  const readerRef = useRef<PdfReaderHandle>(null);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [booting, setBooting] = useState(true);
  const [assets, setAssets] = useState<CachedAssets | null>(null);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadStep, setDownloadStep] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [tab, setTab] = useState<Tab>('reader');

  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [selection, setSelection] = useState<PdfSelection | null>(null);

  const [progress, setProgress] = useState<ProgressRow | null>(null);
  const [bookmarks, setBookmarks] = useState<BookmarkRow[]>([]);
  const [highlights, setHighlights] = useState<HighlightRow[]>([]);
  const [downloads, setDownloads] = useState<DownloadRow[]>([]);
  const [outbox, setOutbox] = useState<OutboxRow[]>([]);
  const [lastSync, setLastSync] = useState<string | null>(null);

  /** Re-reads everything from local SQLite. Never touches the network. */
  const refreshLocalState = useCallback(async () => {
    const [progressRow, bookmarkRows, highlightRows, downloadRows, outboxRows, token] =
      await Promise.all([
        progressRepository.current(),
        bookmarkRepository.list(),
        highlightRepository.list(),
        downloadRepository.list(),
        outboxRepository.listAll(),
        syncMetadataRepository.get(SYNC_KEYS.LAST_PULL_TOKEN),
      ]);

    setProgress(progressRow);
    setBookmarks(bookmarkRows);
    setHighlights(highlightRows);
    setDownloads(downloadRows);
    setOutbox(outboxRows);
    setLastSync(token ? token.slice(11, 19) : null);
    return highlightRows;
  }, []);

  const pendingCount = outbox.filter(
    (row) => row.status === 'PENDING' || row.status === 'FAILED',
  ).length;

  const runSync = useCallback(
    async (silent = false) => {
      if (syncManager.isRunning()) return;
      setSyncing(true);
      try {
        const report = await syncManager.run();
        await refreshLocalState();
        if (!silent) {
          if (report.error) {
            Alert.alert(
              'Sync incomplete',
              `${report.error}\n\nNothing was lost - the outbox still holds every unsent change.`,
            );
          } else {
            Alert.alert(
              'Sync complete',
              `Pushed ${report.pushed}\nServer already newer: ${report.conflicts}\nFailed: ${report.failed}\nPulled ${report.pulled}, applied ${report.applied}`,
            );
          }
        }
      } finally {
        setSyncing(false);
      }
    },
    [refreshLocalState],
  );

  /**
   * Deliver a change that was just made, without making the user ask.
   *
   * Debounced rather than immediate, because a page turn is an edit: flipping
   * through ten pages would otherwise mean ten syncs, and a sync is a push plus
   * six collection reads. Restarting the timer on each edit collapses a burst
   * into one run, and the outbox coalesces those ten page turns into a single
   * progress operation anyway.
   *
   * Never awaited. The edit is already committed to SQLite and already on
   * screen; delivery is background work. Offline it does nothing at all.
   */
  const flush = useCallback(() => {
    if (!online) return;
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => {
      flushTimer.current = null;
      void runSync(true);
    }, FLUSH_DEBOUNCE_MS);
  }, [online, runSync]);

  useEffect(
    () => () => {
      if (flushTimer.current) clearTimeout(flushTimer.current);
    },
    [],
  );

  // ------------------------------------------------------------- bootstrap

  useEffect(() => {
    (async () => {
      // Opening the database creates the schema on first launch.
      await getDatabase();
      const rows = await refreshLocalState();

      const cached = cachedAssets();
      if (cached) {
        setAssets(cached);
        setPdfBase64(await readPdfBase64());
      }

      const savedProgress = await progressRepository.current();
      if (savedProgress) setPage(savedProgress.offset);

      setBooting(false);
      void rows;
    })().catch((error) => {
      setBooting(false);
      Alert.alert('Startup failed', String(error?.message ?? error));
    });
  }, [refreshLocalState]);

  // Repaint highlights whenever the set changes or the document finishes loading.
  useEffect(() => {
    readerRef.current?.applyHighlights(toPaintable(highlights));
  }, [highlights, pageCount]);

  // Auto-sync when connectivity returns, and when the app comes back to the
  // foreground. Offline, both are no-ops - the outbox just keeps growing.
  useEffect(() => {
    if (online) void runSync(true);
  }, [online, runSync]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && online) void runSync(true);
    });
    return () => subscription.remove();
  }, [online, runSync]);

  // The backstop. Connectivity events and foreground events are the fast paths,
  // but neither covers the ordinary case of the app already being open and
  // online when the server comes back, and neither survives a missed NetInfo
  // event. So while anything is queued, keep trying.
  //
  // This is what makes the Sync button optional rather than load-bearing.
  useEffect(() => {
    if (!online || pendingCount === 0) return;
    const timer = setInterval(() => void runSync(true), SYNC_RETRY_MS);
    return () => clearInterval(timer);
  }, [online, pendingCount, runSync]);

  // ---------------------------------------------------------------- actions

  const handleDownload = useCallback(async () => {
    setDownloading(true);
    setDownloadStep('Starting');
    try {
      // 1. Fetch the file and the viewer runtime onto the device.
      const result = await downloadBookAssets(setDownloadStep);
      setAssets(result);
      setPdfBase64(await readPdfBase64());

      // 2. Record it in the local downloads table (this also queues an outbox op).
      setDownloadStep('Saving locally');
      await downloadRepository.recordCompleted(result.pdfUri, 'PDF');

      // 3. Hand it to the Sync Manager rather than writing to the backend here,
      //    so the download takes exactly the same path as every other change.
      //    A failure needs no handling: the outbox entry from step 2 survives
      //    and the next sync delivers it.
      setDownloadStep('Syncing');
      await syncManager.run();

      await refreshLocalState();
    } catch (error: any) {
      Alert.alert(
        'Download failed',
        `${error?.message ?? error}\n\n` +
          `The book and the pdf.js runtime come from ${ASSET_BASE_URL}, which is a ` +
          `different server from the sync API. Check that it is running, or point ` +
          `EXPO_PUBLIC_ASSET_URL somewhere else.\n\n` +
          `Any book already on this device is untouched.`,
      );
    } finally {
      setDownloading(false);
      setDownloadStep('');
    }
  }, [refreshLocalState]);

  const handleHighlight = useCallback(async () => {
    if (!selection) return;
    await highlightRepository.addFromSelection({
      page: selection.page,
      startOffset: selection.startOffset,
      endOffset: selection.endOffset,
    });
    setSelection(null);
    readerRef.current?.clearSelection();
    await refreshLocalState();
    flush();
  }, [selection, refreshLocalState, flush]);

  const handleBookmark = useCallback(async () => {
    await bookmarkRepository.addForPage(page);
    await refreshLocalState();
    flush();
  }, [page, refreshLocalState, flush]);

  const handlePageChange = useCallback(
    async (nextPage: number) => {
      setPage(nextPage);
      // Reading position is persisted on every page change, offline included.
      await progressRepository.savePosition(nextPage);
      await refreshLocalState();
      flush();
    },
    [refreshLocalState, flush],
  );

  const handleGoToPage = useCallback((target: number) => {
    setTab('reader');
    setTimeout(() => readerRef.current?.goToPage(target), 120);
  }, []);

  // ------------------------------------------------------------------ render

  if (booting) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#2563eb" />
        <Text style={styles.bootText}>Opening the offline database…</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <SyncStatusBar
        online={online}
        pendingCount={pendingCount}
        page={page}
        pageCount={pageCount}
        lastSync={lastSync}
        tab={tab}
        onSelectTab={setTab}
      />

      <View style={styles.body}>
        {tab === 'reader' ? (
          assets && pdfBase64 ? (
            <PdfReader
              ref={readerRef}
              viewerUri={assets.viewerUri}
              baseDirectoryUri={assets.baseDirectoryUri}
              pdfBase64={pdfBase64}
              onReady={setPageCount}
              onPageChange={handlePageChange}
              onSelectionChange={setSelection}
              onError={(message) => Alert.alert('Viewer error', message)}
            />
          ) : (
            <View style={styles.centered}>
              <Text style={styles.emptyTitle}>No book on this device yet</Text>
              <Text style={styles.emptyBody}>
                Press Download while online. The PDF is saved to the device, a row is added
                to the local SQLite downloads table, and the backend create endpoint is
                called.{'\n\n'}
                Everything after that works with the network off.
              </Text>
              {downloading && <Text style={styles.step}>{downloadStep}…</Text>}
            </View>
          )
        ) : (
          <LocalDataPanel
            progress={progress}
            bookmarks={bookmarks}
            highlights={highlights}
            downloads={downloads}
            outbox={outbox}
            onGoToPage={handleGoToPage}
            onDeleteBookmark={async (id) => {
              await bookmarkRepository.remove(id);
              await refreshLocalState();
            }}
            onDeleteHighlight={async (id) => {
              await highlightRepository.remove(id);
              await refreshLocalState();
            }}
          />
        )}
      </View>

      {selection && (
        <View style={styles.selectionBar}>
          <Text style={styles.selectionText} numberOfLines={1}>
            p{selection.page} · “{selection.preview}”
          </Text>
        </View>
      )}

      <View style={{ paddingBottom: insets.bottom }}>
        <Toolbar>
          <ToolbarButton
            label={assets ? 'Refresh' : 'Download'}
            onPress={handleDownload}
            busy={downloading}
            tone="primary"
          />
          <ToolbarButton
            label="Highlight"
            onPress={handleHighlight}
            disabled={!selection}
            tone="accent"
          />
          <ToolbarButton label="Bookmark" onPress={handleBookmark} disabled={!assets} />
          <ToolbarButton label="Sync" onPress={() => runSync(false)} busy={syncing} />
        </Toolbar>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
  body: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    backgroundColor: '#ffffff',
  },
  bootText: { marginTop: 12, color: '#6b7280', fontSize: 14 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 8 },
  emptyBody: { fontSize: 13, color: '#6b7280', lineHeight: 19, textAlign: 'center' },
  step: { marginTop: 14, color: '#2563eb', fontSize: 13, fontWeight: '600' },
  selectionBar: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#ecfdf5',
    borderTopWidth: 1,
    borderTopColor: '#a7f3d0',
  },
  selectionText: { fontSize: 11, color: '#065f46' },
});
