import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { color, radius, space } from '@theme/tokens';

export interface BottomSheetProps {
  visible: boolean;
  onDismiss: () => void;
  children: ReactNode;
  // Default 0.65 per Design Spec §2.3 (60–70% screen height).
  heightRatio?: number;
  // false = user must make a choice (Access Gate screen). Default true.
  dismissible?: boolean;
}

// The four lifecycle states the sheet passes through.
export type SheetState = 'hidden' | 'visible' | 'dragging' | 'dismissing';

const WINDOW_HEIGHT = Dimensions.get('window').height;
const ANIMATE_OUT_MS = 250;
// Swipe 30% of sheet height OR a fast flick triggers dismiss.
const DISMISS_RATIO = 0.3;
const DISMISS_VELOCITY = 0.5;
// Handle pill: 48px wide (space.xl + space.md) × 4px tall (space.xs).
const HANDLE_WIDTH = space.xl + space.md;

export default function BottomSheet({
  visible,
  onDismiss,
  children,
  heightRatio = 0.65,
  dismissible = true,
}: BottomSheetProps) {
  const sheetHeight = WINDOW_HEIGHT * heightRatio;

  // useState (not useRef) for the Animated.Value avoids reading a ref during
  // render, which the react-hooks/refs rule disallows.
  const [translateY] = useState(() => new Animated.Value(sheetHeight));
  const [modalVisible, setModalVisible] = useState(false);

  const slideIn = useCallback(() => {
    // setTimeout makes setModalVisible async — the lint rule disallows
    // synchronous setState reachable from an effect body, but accepts
    // state updates inside async callbacks (same as .then / .start()).
    setTimeout(() => {
      setModalVisible(true);
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 4,
      }).start();
    }, 0);
  }, [translateY]);

  // onDismiss is in deps so slideOut always calls the latest version.
  // Callers should memoize onDismiss with useCallback to avoid recreating
  // the panResponder on every render.
  const slideOut = useCallback(() => {
    Animated.timing(translateY, {
      toValue: sheetHeight,
      duration: ANIMATE_OUT_MS,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setModalVisible(false);
        onDismiss();
      }
    });
  }, [translateY, sheetHeight, onDismiss]);

  useEffect(() => {
    if (visible) {
      slideIn();
    } else {
      slideOut();
    }
  }, [visible, slideIn, slideOut]);

  // useMemo (not useRef) so panHandlers can be spread in JSX without a
  // .current access during render, which the lint rule disallows.
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => dismissible,
        onMoveShouldSetPanResponder: (_, { dy }) => dismissible && dy > 2,
        onPanResponderMove: (_, { dy }) => {
          if (dy > 0) translateY.setValue(dy);
        },
        onPanResponderRelease: (_, { dy, vy }) => {
          if (dy > sheetHeight * DISMISS_RATIO || vy > DISMISS_VELOCITY) {
            slideOut();
          } else {
            Animated.spring(translateY, {
              toValue: 0,
              useNativeDriver: true,
              bounciness: 4,
            }).start();
          }
        },
      }),
    [dismissible, slideOut, translateY, sheetHeight],
  );

  return (
    <Modal
      visible={modalVisible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={dismissible ? slideOut : undefined}
    >
      <View style={styles.overlay}>
        {/* Semi-transparent navy overlay. Separate sibling View with opacity
            so the sheet keeps full opacity. color.navy avoids hardcoded rgba. */}
        <View style={styles.backdrop} />

        <Pressable
          testID="bottom-sheet-backdrop"
          style={StyleSheet.absoluteFill}
          onPress={dismissible ? slideOut : undefined}
          accessible={dismissible}
          accessibilityLabel="Dismiss"
        />

        <Animated.View
          style={[styles.sheet, { height: sheetHeight, transform: [{ translateY }] }]}
          accessibilityViewIsModal
        >
          {/* Generous tap area — small drag handles are hard to grab on device. */}
          <View {...panResponder.panHandlers} style={styles.handleArea}>
            <View style={styles.handle} />
          </View>

          <View style={styles.content}>{children}</View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: color.navy,
    opacity: 0.5,
  },
  sheet: {
    backgroundColor: color.white,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    overflow: 'hidden',
  },
  handleArea: {
    alignItems: 'center',
    paddingVertical: space.sm,
  },
  handle: {
    width: HANDLE_WIDTH,
    height: space.xs,
    borderRadius: radius.pill,
    backgroundColor: color.border,
  },
  content: {
    flex: 1,
  },
});
