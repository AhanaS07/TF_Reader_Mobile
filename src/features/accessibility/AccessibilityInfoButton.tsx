// Owner: Accessibility (Hruthik).
//
// The Reader toolbar's entry point into AccessibilityInfoScreen. Navigation-agnostic on purpose —
// `onPress` is the only prop, so this file has no idea a route named "BookInfo" exists. That's
// wired up where it's rendered (`ReaderRouteScreen.tsx`'s `toolbarExtra`), the same seam
// `DevPreferencesMenu` already goes through, so `ReaderScreen.tsx` itself needs no changes.
//
// Sized to MIN_TOUCH_TARGET rather than ReaderScreen's own hard-coded 44 — see a11yConstants.ts's
// header for why these stay two separate copies.

import { Pressable, StyleSheet, Text } from 'react-native';

import { MIN_TOUCH_TARGET } from './a11yConstants';

export interface AccessibilityInfoButtonProps {
  onPress: () => void;
}

export function AccessibilityInfoButton({
  onPress,
}: AccessibilityInfoButtonProps): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Accessibility information"
      onPress={onPress}
      style={styles.button}
    >
      <Text style={styles.icon}>♿</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minWidth: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  icon: { fontSize: 20 },
});
