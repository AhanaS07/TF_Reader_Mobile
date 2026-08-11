// Design tokens — the only source of colour, type, spacing, radius and elevation.

// Shape of one entry in the type scale.
export type TextStyle = { weight: string; size: number; lineHeight: number };

// Brand, text, surface, border, request states and access tiers.
export const color = {
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
} as const;

// Font family for the loader to register. Components never set fontFamily.
export const font = {
  family: 'Inter',
  fallback: 'System',
} as const;

// The six text styles. Map weight/size onto fontWeight/fontSize at the call site.
export const type = {
  pageTitle: { weight: '700', size: 24, lineHeight: 32 },
  sectionHeader: { weight: '600', size: 18, lineHeight: 24 },
  body: { weight: '400', size: 15, lineHeight: 22 },
  meta: { weight: '400', size: 13, lineHeight: 18 },
  button: { weight: '600', size: 15, lineHeight: 20 },
  smallLabel: { weight: '500', size: 12, lineHeight: 16 },
} as const satisfies Record<string, TextStyle>;

// Spacing scale for every gap, padding and inset.
export const space = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

// Corner radii.
export const radius = {
  card: 8,
  sheet: 16,
  pill: 999,
} as const;

// Card shadow, split by platform. Spread the branch for the platform you are styling.
export const elevation = {
  card: {
    ios: {
      shadowColor: '#1A1A2E',
      shadowOpacity: 0.06,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
    },
    android: {
      elevation: 2,
    },
  },
} as const;

// Valid token names, for typing component props.
export type ColorToken = keyof typeof color;
export type TypeToken = keyof typeof type;
export type SpaceToken = keyof typeof space;
export type RadiusToken = keyof typeof radius;

// All groups under one namespace.
export const tokens = {
  color,
  font,
  type,
  space,
  radius,
  elevation,
} as const;

export default tokens;
