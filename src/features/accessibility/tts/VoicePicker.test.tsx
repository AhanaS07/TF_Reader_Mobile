// Owner: Accessibility (Hruthik).
//
// This suite exists mainly to pin one non-obvious bug and its fix: `accessibilityViewIsModal`
// hides its SIBLINGS from VoiceOver, not just traps focus within the view it's set on
// (@testing-library/react-native's own accessibility computation mirrors this real iOS
// behaviour — see node_modules/@testing-library/react-native/dist/helpers/accessibility.js's
// `computeAriaModal` check against host siblings). The backdrop `Pressable` used to be a
// sibling of the sheet `View` that carried `accessibilityViewIsModal`, which made "Close voice
// picker" unreachable by VoiceOver despite rendering fine and passing any visual QA. The fix
// moves `accessibilityViewIsModal` up to wrap both the backdrop and the sheet, so nothing inside
// the picker is a sibling of the modal boundary. `AccessibilityInfo.setAccessibilityFocus` itself
// isn't exercised here: it needs a real native tag, and `findNodeHandle` always resolves to
// `null` under react-test-renderer — that half needs an on-device VoiceOver/TalkBack pass.

import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { useAppearanceEnv } from '@/features/reader/useAppearanceEnv';

import { FOCUS_RING_COLOR } from '../a11yConstants';
import { VoicePicker } from './VoicePicker';

// Mocked for the same reason ReaderScreen.test.tsx mocks it: `osFontScale` has no dedicated change
// event, so tests control it directly rather than depending on a real PixelRatio read.
jest.mock('@/features/reader/useAppearanceEnv', () => ({
  useAppearanceEnv: jest.fn(),
}));

beforeEach(() => {
  jest.mocked(useAppearanceEnv).mockReturnValue({
    osColorScheme: 'light',
    osFontScale: 1,
    osReduceMotionEnabled: false,
  });
});

describe('VoicePicker — touch targets, focus ring and font scale', () => {
  it('gives the header row and each voice row at least a 44pt-tall touch target', async () => {
    await render(
      <VoicePicker
        onClose={jest.fn()}
        onSelect={jest.fn()}
        selectedVoiceId={null}
        visible
        voices={[
          {
            id: 'v1',
            name: 'Voice One',
            language: 'en-US',
            quality: 1,
            latency: 0,
            networkConnectionRequired: false,
            notInstalled: false,
          },
        ]}
      />,
    );

    const headerStyle = StyleSheet.flatten(
      screen.getByLabelText('Platform default voice').props.style,
    );
    expect(headerStyle.minHeight).toBeGreaterThanOrEqual(44);

    const rowStyle = StyleSheet.flatten(screen.getByLabelText('Voice One, en-US').props.style);
    expect(rowStyle.minHeight).toBeGreaterThanOrEqual(44);
  });

  it('shows the focus ring while a row is focused and hides it on blur', async () => {
    await render(
      <VoicePicker
        onClose={jest.fn()}
        onSelect={jest.fn()}
        selectedVoiceId={null}
        visible
        voices={[]}
      />,
    );
    const headerRow = screen.getByLabelText('Platform default voice');

    expect(StyleSheet.flatten(headerRow.props.style).borderColor).toBe('transparent');

    await fireEvent(headerRow, 'focus');
    expect(StyleSheet.flatten(headerRow.props.style).borderColor).toBe(FOCUS_RING_COLOR);

    await fireEvent(headerRow, 'blur');
    expect(StyleSheet.flatten(headerRow.props.style).borderColor).toBe('transparent');
  });

  it('scales row text with the OS font scale', async () => {
    jest.mocked(useAppearanceEnv).mockReturnValue({
      osColorScheme: 'light',
      osFontScale: 2,
      osReduceMotionEnabled: false,
    });

    await render(
      <VoicePicker
        onClose={jest.fn()}
        onSelect={jest.fn()}
        selectedVoiceId={null}
        visible
        voices={[]}
      />,
    );

    expect(StyleSheet.flatten(screen.getByText('Voice').props.style).fontSize).toBe(36);
    expect(StyleSheet.flatten(screen.getByText('Platform default').props.style).fontSize).toBe(30);
  });
});

describe('VoicePicker accessibility tree', () => {
  it('keeps the backdrop close control reachable despite accessibilityViewIsModal on the sheet', async () => {
    await render(
      <VoicePicker
        onClose={jest.fn()}
        onSelect={jest.fn()}
        selectedVoiceId={null}
        visible
        voices={[]}
      />,
    );

    expect(screen.getByLabelText('Close voice picker')).toBeTruthy();
  });

  it('renders nothing queryable while not visible', async () => {
    await render(
      <VoicePicker
        onClose={jest.fn()}
        onSelect={jest.fn()}
        selectedVoiceId={null}
        visible={false}
        voices={[]}
      />,
    );

    expect(screen.queryByLabelText('Close voice picker')).toBeNull();
  });
});
