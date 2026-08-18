// src/shared/contracts/prefs-row.ts
// Prefs row adapter + read-time migration — CAP-7 Reader & Offline (Team t4targaryen)
//
// Owner: Personalization (Vaishnavi). Promoted here from features/personalization/ so
// there is ONE implementation both Personalization and Sync consume. Sync cannot import
// personalization/ (its lower-layer, no-cross-capability rule), so the shared home is the
// contract — the same reasoning behind resolveReduceMotion / resolveFontScale living here.
// This closes two duplications that had already drifted once (the highContrast base theme).
//
// RUNTIME members (not type-only) — see index.ts header:
//   toPersonalizationRow / fromPersonalizationRow, migrateSharedPrefs, HIGH_CONTRAST_BASE_THEME.
//
// These are "rules that are part of the contract itself — how a stored value becomes an
// applied value": the nested SharedPrefs <-> flat SQLite row mapping, and collapsing the
// deprecated theme variant onto the a11y flag.

import type { SharedPrefs, Theme, LayoutPrefs } from './prefs';

// ============================================================================
// Row adapter — nested SharedPrefs <-> flat `personalization` SQLite row.
// ============================================================================
//
// Reconciles three representation gaps between SharedPrefs and the columns:
//   • shape:   nested { typography:{...}, layout:{...}, zoom:{level} } <-> flat columns
//   • boolean: is_deleted / synced are INTEGER 0|1 in SQLite (no bool type)
//   • time:    updatedAt is epoch-ms (number) in TS; updated_at is TEXT in SQLite
//
// updated_at TEXT is written as ISO-8601 UTC. Accessibility is a SEPARATE table
// (Hruthik's), joined by Sync on read — this adapter handles the personalization slice only.

// The PERSONALIZATION slice of SharedPrefs — everything except accessibility.
export type PersonalizationPrefs = Omit<SharedPrefs, 'accessibility'>;

// Row shape of the `personalization` table (column names verbatim from the schema).
export interface PersonalizationRow {
  id: string;
  user_id: string;
  theme: string;
  font_family: string;
  custom_font_uri: string | null;
  typography_size: number;
  typography_line_height: number;
  typography_spacing: number;
  typography_margins: number;
  layout_flow: string;
  layout_spread: string;
  zoom: number;
  updated_at: string; // ISO-8601 UTC TEXT
  is_deleted: number; // 0 | 1
  synced: number; // 0 | 1
}

const boolToInt = (b: boolean): number => (b ? 1 : 0);
const intToBool = (i: number): boolean => i !== 0;

// updatedAt is the LWW key. A NaN here is the worst outcome: it silently LOSES
// every comparison (NaN > x and NaN < x are both false), so a corrupt timestamp
// would make a record quietly un-winnable rather than error. And new Date(NaN)
// .toISOString() throws a bare RangeError with no context. Both directions fail
// LOUDLY with the offending value instead.
const msToText = (ms: number): string => {
  if (!Number.isFinite(ms)) {
    throw new Error(`toPersonalizationRow: updatedAt is not finite epoch-ms (${ms}) — cannot write updated_at`);
  }
  return new Date(ms).toISOString();
};
const textToMs = (iso: string): number => {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    throw new Error(`fromPersonalizationRow: unparseable updated_at "${iso}" — Date.parse gave NaN (would silently lose every LWW comparison)`);
  }
  return ms;
};

// The DB stores theme/flow/spread as loose SQLite TEXT, so the read boundary is
// the ONLY place to catch a value that isn't in the contract's union — past here
// it is a typed `Theme`/`LayoutPrefs` field nothing re-checks. These Records are
// exhaustive by construction: add a member to the union and the literal stops
// type-checking until it is listed here.
//
// NOTE: 'highContrast' is intentionally still VALID — it is a (deprecated) member
// of the Theme union kept so old records parse. The theme→flag migration is a
// separate, read-time step on the merged record (migrateSharedPrefs below).
const VALID_THEMES: Record<Theme, true> = {
  light: true,
  dark: true,
  sepia: true,
  system: true,
  highContrast: true,
};
const VALID_FLOWS: Record<LayoutPrefs['flow'], true> = { paginated: true, 'scrolled-doc': true };
const VALID_SPREADS: Record<LayoutPrefs['spread'], true> = { single: true, double: true };

function asTheme(value: string): Theme {
  if (Object.prototype.hasOwnProperty.call(VALID_THEMES, value)) return value as Theme;
  throw new Error(`fromPersonalizationRow: "${value}" is not a valid theme`);
}
function asFlow(value: string): LayoutPrefs['flow'] {
  if (Object.prototype.hasOwnProperty.call(VALID_FLOWS, value)) return value as LayoutPrefs['flow'];
  throw new Error(`fromPersonalizationRow: "${value}" is not a valid layout flow`);
}
function asSpread(value: string): LayoutPrefs['spread'] {
  if (Object.prototype.hasOwnProperty.call(VALID_SPREADS, value)) return value as LayoutPrefs['spread'];
  throw new Error(`fromPersonalizationRow: "${value}" is not a valid layout spread`);
}

// SharedPrefs → SQLite row. Accessibility is intentionally dropped (separate table).
export function toPersonalizationRow(prefs: SharedPrefs): PersonalizationRow {
  return {
    id: prefs.id,
    user_id: prefs.userId,
    theme: prefs.theme,
    font_family: prefs.font.family,
    custom_font_uri: prefs.font.customFontUri ?? null,
    typography_size: prefs.typography.size,
    typography_line_height: prefs.typography.lineHeight,
    typography_spacing: prefs.typography.spacing,
    typography_margins: prefs.typography.margins,
    layout_flow: prefs.layout.flow,
    layout_spread: prefs.layout.spread,
    zoom: prefs.zoom.level,
    updated_at: msToText(prefs.updatedAt),
    is_deleted: boolToInt(prefs.isDeleted),
    synced: boolToInt(prefs.synced),
  };
}

// SQLite row → the personalization slice of SharedPrefs. Accessibility is filled
// in by Sync's merge from the accessibility table — not reconstructable here.
// theme/flow/spread come back as loose TEXT and are VALIDATED at this boundary.
export function fromPersonalizationRow(row: PersonalizationRow): PersonalizationPrefs {
  return {
    id: row.id,
    userId: row.user_id,
    theme: asTheme(row.theme),
    font: {
      family: row.font_family,
      ...(row.custom_font_uri != null ? { customFontUri: row.custom_font_uri } : {}),
    },
    typography: {
      size: row.typography_size,
      lineHeight: row.typography_line_height,
      spacing: row.typography_spacing,
      margins: row.typography_margins,
    },
    layout: {
      flow: asFlow(row.layout_flow),
      spread: asSpread(row.layout_spread),
    },
    zoom: { level: row.zoom },
    updatedAt: textToMs(row.updated_at),
    isDeleted: intToBool(row.is_deleted),
    synced: intToBool(row.synced),
  };
}

// ============================================================================
// Read-time migration — deprecated `theme: 'highContrast'` -> a11y flag.
// ============================================================================
//
// High contrast is now the independent flag accessibility.display.highContrast, not
// a Theme variant. The variant is kept in the union ONLY so old persisted records
// parse; this collapses it on read so no consumer honours a theme it has stopped
// supporting. Idempotent, does not mutate its input. Runs on the MERGED SharedPrefs
// (setting the a11y flag needs the accessibility slice the row adapter does not carry).

// The colour scheme a migrated high-contrast record collapses onto. Contrast is now
// independent of colour scheme (the flag), so this only picks what sits UNDER the
// boost. 'light' is the neutral base (classic high-contrast = dark-on-light); ratified
// 2026-08-17. A single named constant keeps this a one-line product change.
export const HIGH_CONTRAST_BASE_THEME: Theme = 'light';

/**
 * Normalize a merged SharedPrefs for consumption by Reader: migrate the deprecated
 * `theme: 'highContrast'` to `theme: HIGH_CONTRAST_BASE_THEME` +
 * `accessibility.display.highContrast: true`. Any other theme is returned untouched.
 * Idempotent. Does not mutate its input.
 */
export function migrateSharedPrefs(prefs: SharedPrefs): SharedPrefs {
  if (prefs.theme !== 'highContrast') return prefs;
  return {
    ...prefs,
    theme: HIGH_CONTRAST_BASE_THEME,
    accessibility: {
      ...prefs.accessibility,
      display: {
        ...prefs.accessibility.display,
        highContrast: true,
      },
    },
  };
}
