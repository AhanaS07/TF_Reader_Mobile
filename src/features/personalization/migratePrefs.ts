// /features/personalization/migratePrefs.ts
// Read-time prefs migration — CAP-7 Reader & Offline (Team t4targaryen)
//
// Owner: Personalization (Vaishnavi). Implements prefs.ts STILL-OPEN #3 / the
// Theme `@deprecated 'highContrast'` note: high contrast is now the independent
// flag accessibility.display.highContrast, not a Theme variant. The variant is
// kept in the union ONLY so old persisted records still parse — this collapses
// it on read so Reader never has to honour a theme value it has stopped
// supporting.
//
// WHY read-time (not a one-off write migration): matches accessibility.ts's
// migrateReduceMotion — the stored record can keep the legacy value until it is
// next rewritten; every read normalizes it. The function is idempotent, so
// running it on an already-migrated record is a no-op.
//
// WHY it lives here and not in personalizationRow.ts: setting
// accessibility.display.highContrast needs the accessibility slice, which the
// row adapter deliberately does not carry (Hruthik's separate table, merged by
// Sync). So this runs on the MERGED SharedPrefs, downstream of that merge.
//
// WIRING (not mine to add — flag): this must run at the read boundary that
// hands a SharedPrefs to Reader — i.e. Sync's merge (features/sync/sharedPrefs.ts)
// or Reader itself as it loads prefs. Until a caller invokes it, a legacy
// 'highContrast' record still reaches Reader unmigrated.

import type { SharedPrefs, Theme } from '@/shared/contracts';

// The colour scheme a migrated high-contrast record collapses onto. Contrast is
// now independent of colour scheme (the flag), so this only picks what sits
// UNDER the contrast boost. The old variant never defined a precedence, so this
// is a product default, not a recovered value — 'light' chosen as the neutral
// base (classic high-contrast = dark-on-light). Ahana/product can revisit;
// keeping it a single named constant makes that a one-line change.
export const HIGH_CONTRAST_BASE_THEME: Theme = 'light';

/**
 * Normalize a merged SharedPrefs for consumption by Reader.
 *
 * Currently: migrates the deprecated `theme: 'highContrast'` to
 * `theme: HIGH_CONTRAST_BASE_THEME` + `accessibility.display.highContrast: true`.
 * Any other theme is returned untouched. Idempotent. Does not mutate its input.
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
