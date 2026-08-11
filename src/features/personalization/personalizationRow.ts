// /features/personalization/personalizationRow.ts
// Schema adapter — CAP-7 Reader & Offline (Team t4targaryen)
//
// Owner: Personalization (Vaishnavi). Bridges the nested SharedPrefs contract to
// the FLAT `personalization` row in Karthik's local SQLite schema. Karthik merges
// the personalization + accessibility rows into one object for Ahana on read;
// this adapter only handles the PERSONALIZATION slice (the accessibility table is
// Hruthik's, mapped separately).
//
// It reconciles the three representation gaps between SharedPrefs and the columns:
//   • shape:   nested { typography:{...}, layout:{...}, zoom:{level} } ↔ flat columns
//   • boolean: is_deleted / synced are INTEGER 0|1 in SQLite (no bool type)
//   • time:    updatedAt is epoch-ms (number) in TS; updated_at is TEXT in SQLite
//
// NOTE (open, not blocking): `updated_at` TEXT is written as ISO-8601 UTC here.
// Confirm with Karthik that the column stores ISO-8601 (not a stringified ms). And
// typography units (pt vs scale-factor) are still a rendering agreement with Ahana
// — orthogonal to this mapping; the column is REAL either way.

import type { SharedPrefs, Theme, LayoutPrefs } from '@/shared/contracts';

// The PERSONALIZATION slice of SharedPrefs — everything except accessibility,
// which lives in its own table/record (Hruthik).
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
const msToText = (ms: number): string => new Date(ms).toISOString();
const textToMs = (iso: string): number => Date.parse(iso);

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
// in by Karthik's merge from the accessibility table — not reconstructable here.
// The DB stores theme/flow/spread as loose TEXT, so we cast at this boundary.
export function fromPersonalizationRow(row: PersonalizationRow): PersonalizationPrefs {
  return {
    id: row.id,
    userId: row.user_id,
    theme: row.theme as Theme,
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
      flow: row.layout_flow as LayoutPrefs['flow'],
      spread: row.layout_spread as LayoutPrefs['spread'],
    },
    zoom: { level: row.zoom },
    updatedAt: textToMs(row.updated_at),
    isDeleted: intToBool(row.is_deleted),
    synced: intToBool(row.synced),
  };
}
