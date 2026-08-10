// Design tokens — the only source of colour, type, spacing, radius and elevation.

/** @typedef {{ fontWeight: string, fontSize: number, lineHeight: number }} TextStyle */

// Brand, text, surface, border, request states and access tiers.
export const colors = Object.freeze({
  primary: '#00A19D',
  navy: '#1A3A5C',
  textPrimary: '#1A1A2E',
  textSecondary: '#6B7280',
  surface: '#F8F9FA',
  border: '#E5E7EB',
  success: '#10B981',
  error: '#EF4444',
  wait: '#F59E0B',
  subscription: '#2563EB',
  elite: '#7C3AED',
});

// Font family for the loader to register. Components never set fontFamily.
export const fontFamily = Object.freeze({
  family: 'Inter',
  fallback: 'System',
});

/**
 * The six text styles. Spread whole.
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

// Spacing scale for every gap, padding and inset.
export const spacing = Object.freeze({
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
});

// Corner radii.
export const radius = Object.freeze({
  card: 8,
  sheet: 16,
  pill: 999,
});

// Card shadow, covering both iOS and Android. Spread whole.
export const elevation = Object.freeze({
  card: Object.freeze({
    shadowColor: colors.textPrimary,
    shadowOffset: Object.freeze({ width: 0, height: 2 }),
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  }),
});

// All groups under one namespace.
export const tokens = Object.freeze({
  colors,
  fontFamily,
  typography,
  spacing,
  radius,
  elevation,
});

export default tokens;
