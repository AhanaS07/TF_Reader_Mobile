import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { ComponentProps } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { color, space, radius, type } from '@theme/tokens';

// ─── Types ───────────────────────────────────────────────────────────────────

type IoniconName = ComponentProps<typeof Ionicons>['name'];

export interface TabItem {
  /** Must match the React Navigation screen name for this tab. */
  key: string;
  label: string;
  iconActive: IoniconName;
  iconInactive: IoniconName;
  /** Show a small indicator dot (e.g. unread Library items). */
  badge?: boolean;
}

interface BottomTabBarProps {
  tabs: TabItem[];
  /** key of the currently focused tab. */
  activeKey: string;
  onTabPress: (key: string) => void;
  /**
   * Safe-area bottom inset in logical pixels.
   * The navigator wrapper reads this from insets.bottom and passes it in.
   * Gallery entries pass nothing (defaults to 0).
   */
  bottomInset?: number;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function BottomTabBar({
  tabs,
  activeKey,
  onTabPress,
  bottomInset = 0,
}: BottomTabBarProps) {
  return (
    <View style={[styles.bar, { paddingBottom: bottomInset }]}>
      {tabs.map((tab) => {
        const active = tab.key === activeKey;
        const iconColor = active ? color.primary : color.textSecondary;
        const iconName = active ? tab.iconActive : tab.iconInactive;

        return (
          <TouchableOpacity
            key={tab.key}
            style={styles.tab}
            onPress={() => onTabPress(tab.key)}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: active }}
          >
            <View style={styles.iconWrapper}>
              <Ionicons name={iconName} size={24} color={iconColor} />
              {tab.badge && <View style={styles.badge} />}
            </View>
            <Text style={[styles.label, { color: iconColor }]}>{tab.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: color.white,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.border,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: space.sm,
    paddingBottom: space.xs,
  },
  iconWrapper: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -2,    // sub-xs layout offset; no spacing token at this granularity
    right: -6,  // sub-xs layout offset
    width: space.sm,
    height: space.sm,
    borderRadius: radius.pill,
    backgroundColor: color.error,
  },
  label: {
    fontWeight: type.smallLabel.weight,
    fontSize: type.smallLabel.size,
    lineHeight: type.smallLabel.lineHeight,
    marginTop: space.xs / 2, // =2 — fine-grained icon-to-label gap
  },
});
