// Owner: Download (Abhinav).
//
// Presentational only — takes a DownloadProgressState (useDownloadProgress.ts) as props rather
// than the hook itself, so it stays testable/reusable independent of how progress is sourced.
// Follows the Spinner + adjacent Text idiom already used elsewhere in Reader
// (ReaderScreen.tsx's `busy` overlay, SearchPanel.tsx's `busyRow`) — Spinner is the shared
// branded stand-in for ActivityIndicator (see src/components/Spinner), colours from
// `@theme/tokens`.

import { StyleSheet, Text, View } from 'react-native';

import Spinner from '@components/Spinner';
import { color, space } from '@theme/tokens';

import type { DownloadProgressState } from './useDownloadProgress';

export function DownloadProgressIndicator({
  status,
  bytesReceived,
  expectedLength,
  errorMessage,
}: DownloadProgressState): React.JSX.Element | null {
  switch (status) {
    case 'idle':
      return null;
    case 'downloading': {
      // `expectedLength !== null`, not truthy — a genuine (degenerate) zero-length asset must
      // still compute 0%, not fall back to the "total unknown yet" placeholder (and the `=== 0`
      // branch avoids a 0/0 NaN for exactly that case). Clamped to 100: a malformed server
      // response (more bytes than its own declared Content-Range total) must not show over 100%
      // here, even though that's Download's bug to fix, not this component's.
      const percent =
        expectedLength === 0
          ? 100
          : expectedLength !== null
            ? Math.min(100, Math.round((bytesReceived / expectedLength) * 100))
            : null;
      return (
        <View style={styles.row}>
          <Spinner />
          <Text style={styles.text}>
            {bytesReceived} / {expectedLength ?? '?'} bytes ({percent ?? '…'}%)
          </Text>
        </View>
      );
    }
    case 'completed':
      return (
        <View style={styles.row}>
          <Text style={styles.text}>Download complete</Text>
        </View>
      );
    case 'error':
      return (
        <View style={styles.row}>
          <Text style={styles.errorText}>{errorMessage ?? 'Download failed.'}</Text>
        </View>
      );
  }
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm },
  text: { fontSize: 13, color: color.textSecondary },
  errorText: { fontSize: 13, color: color.error },
});
