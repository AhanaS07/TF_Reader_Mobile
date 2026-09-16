// The book mark Loader shows instead of a plain spinner — ported straight
// from `stitch_tf_reader_design_system/code.html` (the floating, page-flipping
// book), ownership: the design system, not this screen.
//
// RENDERED VIA WEBVIEW, ON PURPOSE, NOT REBUILT AS REACT-NATIVE-SVG. The
// mockup animates the flipping pages by keyframing an SVG `<path d="...">`
// across eleven shapes per layer, three staggered layers deep — real path
// morphing, which neither core RN `Animated` nor a hand-rolled interpolator
// can reproduce without either a new native dependency (react-native-svg,
// requiring a rebuild) or a hand-written per-frame path-tween engine for a
// purely decorative graphic. A `WebView` given the mockup's own markup
// verbatim (`source={{ html }}`) renders the identical animation with no
// porting risk and no new native module — the one difference from the
// mockup is the page background, changed from opaque black to transparent so
// it sits on Loader's white surface instead of the mockup's own dark canvas.
//
// NOT ReaderWebView's territory: that component's extensive lockdown
// (navigation allow-list, disabled file access, menu items, the bridge
// protocol) exists because it renders untrusted, decrypted book content —
// see its own header. This WebView renders a fixed, bundled string with zero
// user input and zero sub-resource requests, so none of that applies; it is
// simple decoration, not a second book renderer.
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { color } from '@theme/tokens';

// Same three brand colours as `theme/tokens.ts` — `--tf-ultramarine`,
// `--tf-cornflower`, `--tf-indigo` in the mockup's own `:root` block are
// `color.primary`, `color.subscription` and `color.navy` respectively.
// Interpolated in here rather than duplicated as raw hex, so a token change
// carries through to this graphic too.
const ANIMATED_LOGO_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: transparent; }
    svg { width: 100%; height: 100%; display: block; }
  </style>
</head>
<body>
<svg viewBox="0 0 200 200" width="100%" height="100%" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
  <defs>
    <style>
      .book-container { transform-origin: 100px 145px; animation: bookHover 4s ease-in-out infinite; }
      @keyframes bookHover { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(-3px); } }
      .spine-arc { stroke: ${color.primary}; stroke-width: 2.5; stroke-linecap: round; fill: none; }
      .cover-outline { stroke: ${color.primary}; stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; fill: none; }
      .inner-layer { stroke: ${color.primary}; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; opacity: 0.45; fill: none; }
      .page-lines-left, .page-lines-right { stroke: ${color.primary}; stroke-width: 1.5; stroke-linecap: round; opacity: 0.3; }
      .page-flip { fill: none; stroke-linecap: round; stroke-linejoin: round; }
      .flip-1 { stroke: ${color.subscription}; stroke-width: 2; animation: flipCycle 2.4s cubic-bezier(0.4, 0, 0.2, 1) infinite; }
      .flip-2 { stroke: ${color.primary}; stroke-width: 1.8; animation: flipCycle 2.4s cubic-bezier(0.4, 0, 0.2, 1) infinite; animation-delay: -0.8s; }
      .flip-3 { stroke: ${color.subscription}; stroke-width: 1.6; animation: flipCycle 2.4s cubic-bezier(0.4, 0, 0.2, 1) infinite; animation-delay: -1.6s; }
      @keyframes flipCycle {
        0% { d: path("M 100 135 C 120 135 145 137 165 140 L 165 68 C 145 65 120 63 100 63 Z"); opacity: 0; }
        8% { d: path("M 100 135 C 120 135 145 137 165 140 L 165 68 C 145 65 120 63 100 63 Z"); opacity: 0.9; }
        20% { d: path("M 100 135 C 116 132 137 123 153 111 L 153 49 C 138 54 116 59 100 63 Z"); opacity: 1; }
        32% { d: path("M 100 135 C 111 127 124 113 134 98 L 134 35 C 124 43 111 54 100 63 Z"); opacity: 1; }
        42% { d: path("M 100 135 C 106 121 112 103 115 84 L 115 29 C 111 41 105 54 100 63 Z"); opacity: 0.95; }
        50% { d: path("M 100 135 C 103 116 105 94 105 74 L 105 29 C 103 42 101 55 100 63 Z"); opacity: 0.9; }
        58% { d: path("M 100 135 C 97 116 95 94 95 74 L 95 29 C 97 42 99 55 100 63 Z"); opacity: 0.95; }
        68% { d: path("M 100 135 C 89 127 76 113 66 98 L 66 35 C 76 43 89 54 100 63 Z"); opacity: 1; }
        80% { d: path("M 100 135 C 84 132 63 123 47 111 L 47 49 C 62 54 84 59 100 63 Z"); opacity: 1; }
        92% { d: path("M 100 135 C 80 135 55 137 35 140 L 35 68 C 55 65 80 63 100 63 Z"); opacity: 0.9; }
        100% { d: path("M 100 135 C 80 135 55 137 35 140 L 35 68 C 55 65 80 63 100 63 Z"); opacity: 0; }
      }
      @media (prefers-reduced-motion: reduce) {
        .book-container, .flip-1, .flip-2, .flip-3 { animation: none !important; }
      }
    </style>
  </defs>
  <g class="book-container">
    <path class="spine-arc" d="M 100 63 L 100 142" />
    <path class="spine-arc" d="M 94 142 C 97 144 103 144 106 142" />
    <path class="cover-outline" d="M 100 138 C 80 138 52 140 30 145 L 30 73 C 52 68 80 66 100 66" />
    <path class="inner-layer" d="M 100 136 C 81 136 55 138 33 143 L 33 71 C 55 66 81 64 100 64" />
    <path class="cover-outline" d="M 100 134 C 82 134 58 136 36 141 L 36 69 C 58 64 82 62 100 62" />
    <line class="page-lines-left" x1="48" x2="86" y1="84" y2="80" />
    <line class="page-lines-left" x1="48" x2="86" y1="96" y2="92" />
    <line class="page-lines-left" x1="48" x2="82" y1="108" y2="104" />
    <line class="page-lines-left" x1="48" x2="70" y1="120" y2="116" />
    <path class="cover-outline" d="M 100 138 C 120 138 148 140 170 145 L 170 73 C 148 68 120 66 100 66" />
    <path class="inner-layer" d="M 100 136 C 119 136 145 138 167 143 L 167 71 C 145 66 119 64 100 64" />
    <path class="cover-outline" d="M 100 134 C 118 134 142 136 164 141 L 164 69 C 142 64 118 62 100 62" />
    <line class="page-lines-right" x1="114" x2="152" y1="80" y2="84" />
    <line class="page-lines-right" x1="114" x2="152" y1="92" y2="96" />
    <line class="page-lines-right" x1="118" x2="152" y1="104" y2="108" />
    <line class="page-lines-right" x1="130" x2="152" y1="116" y2="120" />
    <path class="page-flip flip-1" d="M 100 135 C 120 135 145 137 165 140 L 165 68 C 145 65 120 63 100 63 Z" />
    <path class="page-flip flip-2" d="M 100 135 C 120 135 145 137 165 140 L 165 68 C 145 65 120 63 100 63 Z" />
    <path class="page-flip flip-3" d="M 100 135 C 120 135 145 137 165 140 L 165 68 C 145 65 120 63 100 63 Z" />
  </g>
</svg>
</body>
</html>`;

export interface AnimatedLogoProps {
  /** Square side length in dp. */
  size?: number;
  testID?: string;
}

const DEFAULT_SIZE = 128;

export default function AnimatedLogo({ size = DEFAULT_SIZE, testID }: AnimatedLogoProps) {
  return (
    // Purely decorative — Loader's own container already carries the
    // `accessibilityRole="progressbar"`/label pair that announces the wait,
    // so this must stay out of the traversal rather than add a second,
    // unlabelled stop. Same two-prop pattern `ReaderWebView.tsx` already uses
    // to hide a subtree from assistive tech (its own header calls out the
    // swipe catcher, the privacy cover, the TOC fades as prior art).
    <View
      testID={testID}
      style={{ width: size, height: size }}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <WebView
        source={{ html: ANIMATED_LOGO_HTML }}
        originWhitelist={['about:*']}
        style={styles.webview}
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        setSupportMultipleWindows={false}
        javaScriptCanOpenWindowsAutomatically={false}
        // No JS needed — the animation is pure CSS. Off by default is the
        // safer posture for a WebView with nothing that requires it.
        javaScriptEnabled={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  webview: { flex: 1, backgroundColor: 'transparent' },
});
