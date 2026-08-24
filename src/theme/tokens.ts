// Design tokens — the only source of colour, type, spacing, radius and elevation.
//
// Colour and type values come from the official Taylor & Francis brand guidelines,
// compiled in TF_READER_BRAND_REFERENCE.md (24 Aug 2026). The brand name is noted
// against each colour so a value can be traced back to the source. Where this file
// and the brand reference disagree, the brand reference wins.

import { resolveFont } from './resolveFont';

// Shape of one entry in the type scale.
export type TextStyle = { weight: string; size: number; lineHeight: number; fontFamily: string };

// The only three weights in the T&F brand: Light, Regular, Bold.
// 500 and 600 are NOT brand weights. The type scale below references this object
// rather than bare strings so a non-brand weight cannot be introduced by accident.
export const weight = {
  light: '300',
  regular: '400',
  bold: '700',
} as const;

// Brand, text, surface, border, request states and access tiers.
export const color = {
  primary: '#003CB2', // Ultramarine — primary buttons, active tabs, links
  navy: '#002244', // Indigo — top navigation, dark overlays

  // Two intermediate blues that fill out the ramp between Indigo and
  // Ultramarine and just past it. DECORATIVE ONLY — they carry no meaning, and
  // exist so the category strip can cycle more than two shades without reaching
  // for a status colour. Named relative to `primary`: blueDeep is darker,
  // blueBright lighter.
  //
  // Cornflower (#505AFF) would have been the natural fourth, but white text on
  // it measures 4.94:1 and the strip's count line renders at 0.85 opacity,
  // which lands ~4.20:1 — under AA. Both of these clear it: 12.56:1 and 6.70:1.
  blueDeep: '#002E7A',
  blueBright: '#1E50D2',
  textPrimary: '#283857', // Carbon — headings, body text
  textSecondary: '#3C4E69', // Slate — metadata, subtitles, disabled
  surface: '#EBF0FF', // Cornflower Neutral — cards, section backgrounds
  border: '#E9E9EC', // Cloud — inputs, card borders, dividers
  success: '#00786E', // Mint Dark — Open Access, completed downloads
  error: '#BF1B4F', // Coral Dark — access restricted, destructive
  wait: '#EEAF00', // Saffron — no seats, waitlist
  subscription: '#505AFF', // Cornflower — Subscription badges

  // PENDING. The T&F palette contains no purple, and Cornflower is already
  // spoken for by `subscription`. Held at the pre-brand value until the team
  // picks a replacement — brand reference §6.5.
  elite: '#7C3AED',

  // Foreground for text and icons sitting on a dark or saturated fill.
  //
  // `surface` was carrying this job as well as being a background colour, which
  // worked only because the old value (#F8F9FA) was near-white. It no longer is:
  // #EBF0FF on `subscription` measures ~4.35:1, under AA for a 12px label, where
  // white is ~4.95:1. SearchInput.tsx raised the missing white token before the
  // palette change made it load-bearing.
  //
  // NOT YET MIGRATED — roughly 25 foreground call sites still read `surface`.
  // See the follow-up list; until they move, AccessTierBadge is below AA.
  white: '#FFFFFF',
} as const;

// Font families for the loader to register. Components never set fontFamily.
// Inter is not a T&F brand font and must not be used. Open Sans is the primary
// face; Aleo is the secondary, for subheadings and key statistics.
//
// No type style names Aleo yet: TextStyle has no `family` field, and the brand
// guide publishes no size or line height for the Aleo roles. Both are needed
// before a subheading/keyStat style can be written.
export const font = {
  primary: 'OpenSans',
  secondary: 'Aleo',
  fallback: 'System',
} as const;

// The six text styles. Map weight/size/fontFamily onto the RN Text style at the call site.
export const type = {
  // PENDING. The brand guide specifies Regular (400) for titles; this stays Bold
  // until the team confirms — brand reference §6.5.
  pageTitle: { weight: weight.bold, size: 24, lineHeight: 32, fontFamily: resolveFont('primary', weight.bold) },
  sectionHeader: { weight: weight.bold, size: 18, lineHeight: 24, fontFamily: resolveFont('primary', weight.bold) },
  body: { weight: weight.regular, size: 15, lineHeight: 22, fontFamily: resolveFont('primary', weight.regular) },
  meta: { weight: weight.light, size: 13, lineHeight: 18, fontFamily: resolveFont('primary', weight.light) },
  button: { weight: weight.bold, size: 15, lineHeight: 20, fontFamily: resolveFont('primary', weight.bold) },
  smallLabel: { weight: weight.regular, size: 12, lineHeight: 16, fontFamily: resolveFont('primary', weight.regular) },
} as const satisfies Record<string, TextStyle>;

// Spacing scale for every gap, padding and inset. Not brand-specified.
export const space = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

// Corner radii. Not brand-specified.
export const radius = {
  card: 8,
  sheet: 16,
  pill: 999,
} as const;

// Card shadow, split by platform. Spread the branch for the platform you are styling.
export const elevation = {
  card: {
    ios: {
      shadowColor: '#002244', // Indigo
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
export type WeightToken = keyof typeof weight;

// All groups under one namespace.
export const tokens = {
  color,
  weight,
  font,
  type,
  space,
  radius,
  elevation,
} as const;

export default tokens;
