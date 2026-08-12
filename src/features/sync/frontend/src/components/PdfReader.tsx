import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { HighlightPaint } from '../repositories/highlightRepository';

export interface PdfSelection {
  page: number;
  startOffset: number;
  endOffset: number;
  /** Shown on the Highlight button. Never stored - see the Day 1 schema. */
  preview: string;
}

interface Props {
  viewerUri: string;
  baseDirectoryUri: string;
  pdfBase64: string;
  onReady: (pageCount: number) => void;
  onPageChange: (page: number) => void;
  onSelectionChange: (selection: PdfSelection | null) => void;
  onError: (message: string) => void;
}

export interface PdfReaderHandle {
  applyHighlights: (items: HighlightPaint[]) => void;
  goToPage: (page: number) => void;
  clearSelection: () => void;
}

/**
 * Thin wrapper around the pdf.js viewer running in a WebView.
 *
 * The PDF bytes are injected as base64 rather than fetched by the page: a
 * file:// document cannot XHR its neighbours on iOS, and injection behaves the
 * same on both platforms.
 */
export const PdfReader = forwardRef<PdfReaderHandle, Props>(function PdfReader(
  { viewerUri, baseDirectoryUri, pdfBase64, onReady, onPageChange, onSelectionChange, onError },
  ref,
) {
  const webViewRef = useRef<WebView>(null);

  useImperativeHandle(ref, () => ({
    applyHighlights(items) {
      webViewRef.current?.injectJavaScript(
        `window.applyHighlights && window.applyHighlights(${JSON.stringify(items)}); true;`,
      );
    },
    goToPage(page) {
      webViewRef.current?.injectJavaScript(
        `window.goToPage && window.goToPage(${page}); true;`,
      );
    },
    clearSelection() {
      webViewRef.current?.injectJavaScript(
        `window.getSelection && window.getSelection().removeAllRanges(); true;`,
      );
    },
  }));

  const handleMessage = (event: WebViewMessageEvent) => {
    let message: any;
    try {
      message = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }

    switch (message.type) {
      case 'ready':
        onReady(message.pageCount);
        break;
      case 'page':
        onPageChange(message.page);
        break;
      case 'selection':
        onSelectionChange(
          message.empty
            ? null
            : {
                page: message.page,
                startOffset: message.startOffset,
                endOffset: message.endOffset,
                preview: message.preview ?? '',
              },
        );
        break;
      case 'error':
        onError(message.message);
        break;
    }
  };

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        source={{ uri: viewerUri }}
        originWhitelist={['*']}
        // The viewer and the pdf.js runtime are both local files.
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        allowingReadAccessToURL={baseDirectoryUri}
        injectedJavaScriptBeforeContentLoaded={`window.__PDF_BASE64__ = ${JSON.stringify(
          pdfBase64,
        )}; true;`}
        onMessage={handleMessage}
        onError={({ nativeEvent }) => onError(nativeEvent.description ?? 'WebView error')}
        javaScriptEnabled
        domStorageEnabled
        style={styles.webview}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#eceff3' },
  webview: { flex: 1, backgroundColor: '#eceff3' },
});
