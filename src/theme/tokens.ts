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

  // Light-tint background for the Subscription badge, paired with `navy`
  // foreground text/icon rather than white. Matched against a reference
  // design, not the T&F brand guide (no brand source names this exact
  // pairing) — the only two `color.*` values in this file with that
  // caveat; see `elite`'s own note just below for the other.
  subscriptionTint: '#D4E3FF',

  // PENDING, and reference-matched rather than brand-guide-sourced, same
  // caveat as `subscriptionTint` above. The T&F palette contains no purple,
  // and Cornflower is already spoken for by `subscription` — this solid blue
  // is what a reference design showed for the Elite badge; held here until
  // the team confirms an actual brand value — brand reference §6.5.
  elite: '#2852C7',

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
// Inter is not a T&F brand font and must not be used.
//
// PER THE ACTUAL BRAND GUIDE (their Typography page, not a reference design):
// Open Sans is primary and carries "most applications" — titles (Regular),
// body copy (Regular), emphasis (Bold), extra info like a date (Light).
// Aleo is explicitly secondary and "should be present... but used sparingly"
// — smaller/secondary titles or headings, supplementary info, and key stats
// (Aleo Light "works well" for those, by the guide's own example). An
// earlier pass read an unrelated reference design's "editorial" framing as
// license to route every style through Aleo instead — that inverted the
// guide's own primary/secondary split. Only `cardTitle` (a book title,
// genuinely secondary to the screen's own title) and `keyStat` (the hero's
// stat pill, the guide's own named example) still resolve through Aleo.
export const font = {
  primary: 'OpenSans',
  secondary: 'Aleo',
  fallback: 'System',
} as const;

// The eleven text styles. Map weight/size/fontFamily onto the RN Text style at the call site.
export const type = {
  // PENDING. The brand guide specifies Regular (400) for titles; this stays Bold
  // until the team confirms — brand reference §6.5.
  pageTitle: {
    weight: weight.bold,
    size: 24,
    lineHeight: 32,
    fontFamily: resolveFont('primary', weight.bold),
  },
  sectionHeader: {
    weight: weight.bold,
    size: 18,
    lineHeight: 24,
    fontFamily: resolveFont('primary', weight.bold),
  },
  body: {
    weight: weight.regular,
    size: 15,
    lineHeight: 22,
    fontFamily: resolveFont('primary', weight.regular),
  },
  meta: {
    weight: weight.light,
    size: 13,
    lineHeight: 18,
    fontFamily: resolveFont('primary', weight.light),
  },
  button: {
    weight: weight.bold,
    size: 15,
    lineHeight: 20,
    fontFamily: resolveFont('primary', weight.bold),
  },
  smallLabel: {
    weight: weight.regular,
    size: 12,
    lineHeight: 16,
    fontFamily: resolveFont('primary', weight.regular),
  },
  // The hero's own headline ("The Scholarly Archive") is this screen's main
  // title, not a secondary one — Open Sans, same as `pageTitle`, per the
  // guide's "Open Sans Regular is used for all titles". Bold stays for the
  // same PENDING reason `pageTitle` does.
  editorialTitle: {
    weight: weight.bold,
    size: 26,
    lineHeight: 32,
    fontFamily: resolveFont('primary', weight.bold),
  },
  // Aleo — a book's own title is secondary to the screen's own headline, the
  // exact case the guide names ("smaller/secondary titles or headings").
  // Size is a reference design's scale (its `headline-sm`), the one thing
  // still matched against that design rather than the guide, which publishes
  // no size of its own. `lineHeight` (22, not the size-matched 24) and the
  // negative `letterSpacing` callers apply alongside this token (see
  // ContentCard's and SectionHeader's own titles) are a later, deliberate
  // tightening pass — Aleo's own metrics read as loosely tracked next to
  // Open Sans at the same nominal spacing, and a book cover carousel with
  // that at full leading read as tall and airy rather than editorial.
  cardTitle: {
    weight: weight.bold,
    size: 18,
    lineHeight: 22,
    fontFamily: resolveFont('secondary', weight.bold),
  },
  // Open Sans Light — "for extra information, e.g. the year" is the guide's
  // own example, and a publisher name or an author credit is exactly that
  // category: supplementary, not a title. ContentCard's publisher/author
  // line; sized against a reference design (13/19) since the guide
  // publishes no size of its own.
  cardMeta: {
    weight: weight.light,
    size: 13,
    lineHeight: 19,
    fontFamily: resolveFont('primary', weight.light),
  },
  // Open Sans — the format chip and the overlay tag on a cover tile's image.
  // Not Aleo: a file-type tag is UI chrome, not editorial content, the same
  // reason `AccessTierBadge` (a separate, shared component) keeps
  // `smallLabel`. Sized against a reference design (10/14) since the guide
  // publishes no size of its own for a chip this small.
  cardLabel: {
    weight: weight.bold,
    size: 10,
    lineHeight: 14,
    fontFamily: resolveFont('primary', weight.bold),
  },
  // Aleo Light — the guide's own named example ("Aleo light key stat") for
  // exactly this: the hero's "Over 140,000 peer-reviewed titles" pill. The
  // one other place this file still reaches for Aleo, and by the guide's
  // own description rather than a reference design's.
  keyStat: {
    weight: weight.light,
    size: 12,
    lineHeight: 16,
    fontFamily: resolveFont('secondary', weight.light),
  },
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
  // The reference design's `rounded-xl` (12px) — a book-cover carousel tile's
  // own corner, between `card`'s list-row radius and `sheet`'s.
  tile: 12,
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
  // A deeper shadow than `card`, for surfaces meant to read as lifted off the
  // page rather than merely separated from it — the hero banner and a book
  // cover tile, not a plain list row. Same shadow colour as `card` so the two
  // read as one family at different depths, not two unrelated effects.
  raised: {
    ios: {
      shadowColor: '#002244', // Indigo
      shadowOpacity: 0.18,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 8 },
    },
    android: {
      elevation: 8,
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
