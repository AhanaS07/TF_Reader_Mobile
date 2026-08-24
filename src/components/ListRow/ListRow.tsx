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
  /**
   * The row exists but cannot be actioned — nothing behind it yet.
   *
   * SHOWN, NOT HIDDEN, and the same reasoning as `FilterChip`'s own `disabled`:
   * removing the row makes the list look complete when it is not, and the
   * reader never learns the setting is coming. A greyed row that announces
   * itself as disabled is the honest version, and it cannot pretend to perform
   * an action that has no destination.
   */
  disabled?: boolean;
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
  disabled = false,
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
      style={[styles.row, disabled && styles.rowDisabled]}
      onPress={handlePress}
      // `disabled`, not just a withheld `onPress`. Clearing the handler alone
      // leaves the row pressable and announced as an enabled button, which is
      // exactly the pretence this prop exists to stop — same call ContentCard
      // and CategoryCard already make.
      disabled={disabled}
      accessibilityRole={variant === 'toggle' ? 'switch' : 'button'}
      accessibilityLabel={title}
      accessibilityState={
        variant === 'toggle' ? { checked: toggleValue, disabled } : { disabled }
      }
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
          // The Switch is its own touch target inside the row, so the
          // Pressable's `disabled` does not reach it. Without this line a
          // disabled row still flips.
          disabled={disabled}
          trackColor={{ false: color.border, true: color.primary }}
          thumbColor={color.white}
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
    backgroundColor: color.white,
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
  // Permitted by CONVENTIONS §5 as a layout primitive — opacity is the exception
  // to "no bare numbers", which is why disabled needs no new grey token.
  rowDisabled: {
    opacity: 0.4,
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
