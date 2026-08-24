import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ErrorCode } from '@model/types';
import { color, radius, space, type } from '@theme/tokens';

export type ErrorStateVariant = 'network' | 'not_found' | 'access_restricted' | 'not_ready';

export interface ErrorStateProps {
  variant: ErrorStateVariant;
  /** Already-human copy. A string, never an Error, so a stack trace cannot leak. */
  message: string;
  /** wokay's enumerated reason. The code to copy map lives beside the resolver, not here. */
  code?: ErrorCode;
  /** Rendered for network and not_ready, where retrying can succeed. */
  onRetry?: () => void;
  /** Rendered for access_restricted. */
  onLearnMore?: () => void;
}

export default function ErrorState({
  variant,
  message,
  onRetry,
  onLearnMore,
}: ErrorStateProps) {
  const retryable = variant === 'network' || variant === 'not_ready';

  return (
    <View style={styles.container}>
      <Text style={styles.message}>{message}</Text>

      {retryable && (
        <Pressable
          onPress={onRetry}
          style={styles.action}
          accessibilityRole="button"
          accessibilityLabel="Retry"
        >
          <Text style={styles.actionLabel}>Retry</Text>
        </Pressable>
      )}

      {variant === 'access_restricted' && (
        <Pressable
          onPress={onLearnMore}
          style={styles.action}
          accessibilityRole="button"
          accessibilityLabel="Learn more"
        >
          <Text style={styles.actionLabel}>Learn more</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
    gap: space.md,
  },
  message: {
    fontWeight: type.body.weight,
    fontFamily: type.body.fontFamily,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: color.textSecondary,
    textAlign: 'center',
  },
  action: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.primary,
  },
  actionLabel: {
    fontWeight: type.button.weight,
    fontFamily: type.button.fontFamily,
    fontSize: type.button.size,
    lineHeight: type.button.lineHeight,
    color: color.primary,
  },
});
