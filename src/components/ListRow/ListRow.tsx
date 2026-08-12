import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { color, space, type } from '@theme/tokens';

export type ListRowVariant = 'chevron' | 'toggle' | 'value' | 'destructive';

export interface ListRowProps {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  variant: ListRowVariant;
  toggleValue?: boolean;
  onToggleChange?: (value: boolean) => void;
  valueText?: string;
  onPress?: () => void;
}

export default function ListRow({
  title,
  subtitle,
  icon,
  variant,
  toggleValue = false,
  onToggleChange,
  valueText,
  onPress,
}: ListRowProps) {
  const isDestructive = variant === 'destructive';

  function handlePress() {
    if (variant === 'toggle') {
      onToggleChange?.(!toggleValue);
    } else {
      onPress?.();
    }
  }

  return (
    <Pressable
      style={styles.row}
      onPress={handlePress}
      accessibilityRole={variant === 'toggle' ? 'switch' : 'button'}
      accessibilityLabel={title}
      accessibilityState={variant === 'toggle' ? { checked: toggleValue } : undefined}
    >
      {icon !== undefined && (
        <View style={styles.leadingIcon}>{icon}</View>
      )}

      <View style={styles.content}>
        <Text style={[styles.title, isDestructive && styles.titleDestructive]}>
          {title}
        </Text>
        {subtitle !== undefined && (
          <Text style={styles.subtitle}>{subtitle}</Text>
        )}
      </View>

      {variant === 'chevron' && (
        <Ionicons name="chevron-forward" size={20} color={color.textSecondary} />
      )}
      {variant === 'toggle' && (
        <Switch
          value={toggleValue}
          onValueChange={onToggleChange}
          trackColor={{ false: color.border, true: color.primary }}
          thumbColor={color.surface}
        />
      )}
      {variant === 'value' && valueText !== undefined && (
        <Text style={styles.valueText}>{valueText}</Text>
      )}
    </Pressable>
  );
}

// Minimum touch target composed from the spacing scale — no bare number.
const ROW_HEIGHT = space.xl + space.md;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: ROW_HEIGHT,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    backgroundColor: color.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.border,
    gap: space.sm,
  },
  leadingIcon: {
    width: space.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    gap: space.xs,
  },
  title: {
    fontWeight: type.body.weight,
    fontSize: type.body.size,
    lineHeight: type.body.lineHeight,
    color: color.textPrimary,
  },
  titleDestructive: {
    color: color.error,
  },
  subtitle: {
    fontWeight: type.meta.weight,
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
    color: color.textSecondary,
  },
  valueText: {
    fontWeight: type.meta.weight,
    fontSize: type.meta.size,
    lineHeight: type.meta.lineHeight,
    color: color.textSecondary,
  },
});
