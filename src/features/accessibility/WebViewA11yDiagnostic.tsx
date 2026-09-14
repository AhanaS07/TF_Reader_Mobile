// Owner: Accessibility (Hruthik).
//
// MANUAL DIAGNOSTIC TOOL — not wired into any navigation route, and not meant to be. See
// `WEBVIEW_A11Y_SPIKE.md`'s "2026-09-14" item 2 entry for the question this answers and what either
// outcome means. To run it: temporarily render `<WebViewA11yDiagnostic />` in place of whatever
// `RootNavigator.tsx` (Ahana/shared, not this feature's file) currently mounts as the initial
// screen, run the same direct `AccessibilityNodeInfo.performAction(ACTION_ACCESSIBILITY_FOCUS)`
// instrumentation method `WEBVIEW_A11Y_SPIKE.md` §12.6/`TALKBACK_GESTURE_FIX_PROPOSAL.md`'s Phase 5
// already used, then revert the navigation change — do not commit this wired into navigation, since
// that would mean editing a shared file without sign-off.
//
// Isolates ONE variable from §12.6's still-open finding: is TalkBack's inability to durably
// accessibility-focus WebView content specific to epub.js's own setup, or does a bare same-origin
// iframe with a CSS multi-column, `overflow: hidden` layout — the same shape epub.js's chapter
// rendering uses, assigned via `iframe.srcdoc` the same way (`WEBVIEW_BRIDGE.md`'s own account of
// how epub.js renders chapters) — reproduce it on its own, with no epub.js, no reader bridge, and no
// app code involved at all.
//
// The container/sibling accessibility shape below deliberately MIRRORS `ReaderWebView.tsx`'s own
// (no `accessibilityLabel`/`accessibilityActions`/`accessibilityRole` on the container; a named-stop
// sibling instead) — getting this wrong would just reproduce the ALREADY-KNOWN leaf trap
// (`CLAUDE.md`'s reader-accessibility rules #1/#5) rather than testing the OPEN question.

import { View } from 'react-native';
import { WebView } from 'react-native-webview';

/**
 * Assigns the iframe's `srcdoc` via a `<script>` after load, exactly how epub.js does it, rather
 * than as a literal HTML attribute — avoids a wall of attribute-escaping noise and keeps this
 * faithful to the real mechanism being isolated.
 */
const FIXTURE_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  html, body { margin: 0; padding: 0; overflow: hidden; background: #ffffff; }
  #viewport { width: 400px; height: 600px; overflow: hidden; }
  iframe { border: 0; width: 400px; height: 600px; display: block; }
</style>
</head>
<body>
  <div id="viewport">
    <iframe id="chapter" title="Diagnostic chapter"></iframe>
  </div>
  <script>
    var chapterHtml =
      '<style>' +
      'html, body { margin: 0; padding: 0; overflow: hidden; }' +
      '#columns { column-width: 400px; column-gap: 0; height: 600px; }' +
      'h1, p { margin: 0 0 16px 0; padding: 0 24px; }' +
      '</style>' +
      '<div id="columns">' +
      '<h1>Diagnostic Chapter</h1>' +
      '<p>Paragraph one. This fixture has no epub.js and no reader bridge at all &mdash; it exists ' +
      'only to isolate whether a same-origin iframe with a CSS multi-column, overflow:hidden ' +
      'layout is enough by itself to reproduce TalkBack&rsquo;s accessibility-focus ' +
      'non-persistence.</p>' +
      '<p>Paragraph two, meant to land in the first on-screen column alongside paragraph one and ' +
      'the heading above.</p>' +
      '<p>Paragraph three should overflow into the next column and start off-screen, mirroring how ' +
      'the real book&rsquo;s paragraphs 4 to 12 reported degenerate zero-size bounds in the ' +
      'original spike.</p>' +
      '<p>Paragraph four, further off-screen still.</p>' +
      '<p>Paragraph five, further off-screen still.</p>';
    document.getElementById('chapter').srcdoc = chapterHtml;
  </script>
</body>
</html>`;

export function WebViewA11yDiagnostic(): React.JSX.Element {
  return (
    <View style={{ flex: 1 }} testID="a11y-diagnostic-container">
      {/* Named stop, not a label on the container below — see this file's header. */}
      <View
        testID="a11y-diagnostic-stop"
        pointerEvents="none"
        accessible
        accessibilityRole="header"
        accessibilityLabel="Diagnostic content"
        style={{ width: 1, height: 1 }}
      />
      <WebView
        testID="a11y-diagnostic-webview"
        originWhitelist={['about:*']}
        source={{ html: FIXTURE_HTML }}
        javaScriptEnabled
      />
    </View>
  );
}
