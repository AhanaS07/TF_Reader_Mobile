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

import { render, screen } from '@testing-library/react-native';

import { VoicePicker } from './VoicePicker';

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
