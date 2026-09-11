// OfflineBanner owns its own absolute position — an intentional exception to
// CONVENTIONS §8. Overlaying without displacing content is what this component
// is for, so leaving it to the caller would make the guarantee unenforceable.
//
// DESIGN REVIEW NOTE: tokens.ts has no dedicated offline colour. The design
// package defines --offline: #374151, which is not in the §2.1 palette and has no
// token, so color.textPrimary stands in. Raised rather than worked around (§5).
import { StyleSheet, Text, View } from 'react-native';

import { color, space, type } from '@theme/tokens';

// Provisional — no source document specifies the banner's default message.
const DEFAULT_MESSAGE = "You're offline";

export interface OfflineBannerProps {
  visible: boolean;
  message?: string;
  /**
   * Safe-area top inset in logical pixels.
   * The caller reads this from useSafeAreaInsets and passes it in.
   * Gallery entries pass nothing (defaults to 0).
   */
  topInset?: number;
}

export default function OfflineBanner({
  visible,
  message = DEFAULT_MESSAGE,
  topInset = 0,
}: OfflineBannerProps) {
  if (!visible) return null;

  // pointerEvents none is what keeps the content behind it usable, so the banner
  // carries no interactive control of its own.
  return (
    <View style={[styles.banner, { paddingTop: topInset }]} pointerEvents="none">
      <View style={styles.inner}>
        <Text style={styles.message}>{message}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: color.textPrimary,
  },
  // Padding sizes the banner; no fixed height, so long copy wraps instead of clipping.
  inner: {
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
  },
  message: {
    fontWeight: type.smallLabel.weight,
    fontFamily: type.smallLabel.fontFamily,
    fontSize: type.smallLabel.size,
    lineHeight: type.smallLabel.lineHeight,
    color: color.white,
    textAlign: 'center',
  },
});
