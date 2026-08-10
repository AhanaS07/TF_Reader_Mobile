// Design tokens — the only source of colour, type, spacing, radius and elevation.
// Values come from the Week 1 Foundation Specification. Frozen: a stray write throws in dev
// instead of silently re-theming every screen.

/** @typedef {{ fontWeight: string, fontSize: number, lineHeight: number }} TextStyle */

export const colors = Object.freeze({
  primary: '#00A19D',
  navy: '#1A3A5C',
  textPrimary: '#1A1A2E',
  textSecondary: '#6B7280',
  surface: '#F8F9FA',
  border: '#E5E7EB',
  // request states — never used for a tier
  success: '#10B981',
  error: '#EF4444',
  wait: '#F59E0B',
  // access tiers — never used for a state
  subscription: '#2563EB',
  elite: '#7C3AED',
});

// Read by the font loader only. Components never set fontFamily themselves.
export const fontFamily = Object.freeze({
  family: 'Inter',
  fallback: 'System',
});

/**
 * Weights are strings, which is what React Native's StyleSheet expects.
 * Spread whole (`...typography.body`) — a size paired with your own lineHeight is a raw value.
 * @type {Readonly<Record<string, TextStyle>>}
 */
export const typography = Object.freeze({
  pageTitle: Object.freeze({ fontWeight: '700', fontSize: 24, lineHeight: 32 }),
  sectionHeader: Object.freeze({ fontWeight: '600', fontSize: 18, lineHeight: 24 }),
  body: Object.freeze({ fontWeight: '400', fontSize: 15, lineHeight: 22 }),
  meta: Object.freeze({ fontWeight: '400', fontSize: 13, lineHeight: 18 }),
  button: Object.freeze({ fontWeight: '600', fontSize: 15, lineHeight: 20 }),
  smallLabel: Object.freeze({ fontWeight: '500', fontSize: 12, lineHeight: 16 }),
});

// Every gap, pad and inset is one of these five steps.
export const spacing = Object.freeze({
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
});

// Named by what they belong to, so a spec change lands in one place.
export const radius = Object.freeze({
  card: 8,
  sheet: 16,
  pill: 999, // clamps to half the height of whatever it wraps
});

// iOS reads shadow*, Android reads elevation. Spread whole or the card lifts on one platform only.
export const elevation = Object.freeze({
  card: Object.freeze({
    shadowColor: colors.textPrimary, // keeps the shadow in the palette
    shadowOffset: Object.freeze({ width: 0, height: 2 }),
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  }),
});

// Same objects as the named exports, grouped for callers that prefer one import.
export const tokens = Object.freeze({
  colors,
  fontFamily,
  typography,
  spacing,
  radius,
  elevation,
});

export default tokens;
