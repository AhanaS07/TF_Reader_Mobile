// Owner: Accessibility (Hruthik).
//
// This is a manual on-device diagnostic tool (see the component's own header) — there is nothing
// for jest to exercise about WHETHER TalkBack can focus WebView content, since `react-native-webview`
// is mocked to a plain `View` under jest (`jest.setup.js`). The one thing worth pinning here is the
// same regression guard `ReaderWebView.test.tsx` pins for the real component: the container must
// never carry `accessibilityLabel`/`accessibilityActions`/`accessibilityRole`, or this tool would
// test the ALREADY-KNOWN leaf trap instead of the open question it exists to isolate.

import { render, screen } from '@testing-library/react-native';

import { WebViewA11yDiagnostic } from './WebViewA11yDiagnostic';

describe('WebViewA11yDiagnostic', () => {
  it('keeps the container free of accessibilityLabel/accessibilityActions/accessibilityRole', async () => {
    await render(<WebViewA11yDiagnostic />);

    const container = screen.getByTestId('a11y-diagnostic-container');
    expect(container.props.accessibilityLabel).toBeUndefined();
    expect(container.props.accessibilityActions).toBeUndefined();
    expect(container.props.accessibilityRole).toBeUndefined();
  });

  it('carries the named stop as a sibling, not on the container', async () => {
    await render(<WebViewA11yDiagnostic />);

    const stop = screen.getByTestId('a11y-diagnostic-stop');
    expect(stop.props.accessibilityRole).toBe('header');
    expect(stop.props.accessibilityLabel).toBe('Diagnostic content');
  });
});
