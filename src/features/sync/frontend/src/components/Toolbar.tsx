import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

interface ButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  tone?: 'primary' | 'accent' | 'plain';
}

export function ToolbarButton({ label, onPress, disabled, busy, tone = 'plain' }: ButtonProps) {
  const toneStyle =
    tone === 'primary' ? styles.primary : tone === 'accent' ? styles.accent : styles.plain;
  const textStyle = tone === 'plain' ? styles.plainText : styles.strongText;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.button,
        toneStyle,
        (disabled || busy) && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={tone === 'plain' ? '#111827' : '#ffffff'} />
      ) : (
        <Text style={[styles.label, textStyle]} numberOfLines={1} adjustsFontSizeToFit>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

/**
 * A fixed four-up row rather than a horizontal scroller, so every action is
 * reachable without scrolling on a narrow phone.
 */
export function Toolbar({ children }: { children: React.ReactNode }) {
  return <View style={styles.bar}>{children}</View>;
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 6,
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 6,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  button: {
    flex: 1,
    minHeight: 38,
    paddingHorizontal: 4,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: { backgroundColor: '#2563eb' },
  accent: { backgroundColor: '#059669' },
  plain: { backgroundColor: '#f3f4f6', borderWidth: 1, borderColor: '#d1d5db' },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.75 },
  label: { fontSize: 13, fontWeight: '700' },
  plainText: { color: '#111827' },
  strongText: { color: '#ffffff' },
});
