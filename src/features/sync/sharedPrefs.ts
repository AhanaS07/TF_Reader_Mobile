/**
 * The read/write bridge between the two local preference tables and the frozen `SharedPrefs`
 * contract.
 *
 * `personalizationRow.ts` says "Karthik merges the personalization + accessibility rows into
 * one object for Ahana on read". This is that merge, and it is the thing Reader's
 * prefs-application stage is waiting on: nothing else in the feature assembles a contract-
 * shaped prefs object, so consumers were left to join two snake_case tables themselves.
 *
 * Deliberately built from `@/shared/contracts` alone rather than by importing Personalization's
 * adapter. Sync must not reach into another capability module - the shared contract is the only
 * legitimate coupling between them, and going through it is what keeps the compiler able to
 * catch drift in both directions.
 *
 * Two representation gaps are closed here, in one place rather than at every call site:
 *   - time:    `updatedAt` is epoch-ms in the contract, ISO-8601 TEXT in SQLite.
 *   - booleans: SQLite has no boolean type, so every flag is stored 0|1.
 *
 * Storage is two rows, not one. Splitting a11y onto its own record is a deliberate divergence
 * from the shape accessibility.ts originally froze - see the AMENDED note there and the
 * resolution recorded against prefs.ts STILL-OPEN #1. The cost of the fold-in was that one
 * `updatedAt` covered both blocks, so whole-record LWW silently discarded an a11y edit made on
 * one device whenever a reader-pref edit happened on another. Two records means the two resolve
 * independently. The merged object below is what hides the split from Reader.
 */
import {
  DEFAULT_ACCESSIBILITY_PREFS,
  DEFAULT_PREFS,
  TTS_PITCH_MAX,
  TTS_PITCH_MIN,
  TTS_RATE_MAX,
  TTS_RATE_MIN,
  isValidReduceMotion,
  isValidTtsHighlightMode,
  isValidTtsPitch,
  isValidTtsRate,
  migrateReduceMotion,
} from '@/shared/contracts';
import type {
  AccessibilityPrefs,
  LayoutPrefs,
  SharedPrefs,
  Theme,
} from '@/shared/contracts';
import { nowIso, toBool, toInt } from './localDb/database';
import type { AccessibilityRow, PersonalizationRow } from './localDb/types';
import { accessibilityId, accessibilityStore } from './stores/accessibilityStore';
import { personalizationId, personalizationStore } from './stores/personalizationStore';
import { USER_ID } from './syncConfig';

const toMs = (iso: string): number => {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
};

const toIso = (ms: number): string => new Date(ms).toISOString();

/** The DB stores these as loose TEXT, so they are validated rather than trusted at the seam. */
const LAYOUT_FLOWS: LayoutPrefs['flow'][] = ['paginated', 'scrolled-doc'];
const LAYOUT_SPREADS: LayoutPrefs['spread'][] = ['single', 'double'];
const THEMES: Theme[] = ['light', 'dark', 'sepia', 'system', 'highContrast'];

const asOneOf = <T extends string>(value: string, allowed: T[], fallback: T): T =>
  (allowed as string[]).includes(value) ? (value as T) : fallback;

/** Clamps rather than rejects: a rate slightly out of range should still speak. */
const clampRate = (rate: number): number =>
  isValidTtsRate(rate) ? rate : Math.min(TTS_RATE_MAX, Math.max(TTS_RATE_MIN, rate || 1.0));

/** Clamps rather than rejects: a pitch slightly out of range should still speak. */
const clampPitch = (pitch: number): number =>
  isValidTtsPitch(pitch) ? pitch : Math.min(TTS_PITCH_MAX, Math.max(TTS_PITCH_MIN, pitch || 1.0));

/**
 * Rebuilds the accessibility block from its row.
 *
 * `reduce_motion` goes through `migrateReduceMotion` because rows written before the tri-state
 * change hold a 0|1 integer, and `isValidReduceMotion` guards the rest: the column is TEXT, so
 * nothing stops a bad value reaching it, and the resolver downstream expects one of three.
 */
export function toAccessibilityPrefs(row: AccessibilityRow | null): AccessibilityPrefs {
  if (!row) return structuredClone(DEFAULT_ACCESSIBILITY_PREFS);

  const storedMotion: unknown = row.reduce_motion;
  const reduceMotion = isValidReduceMotion(storedMotion)
    ? storedMotion
    : migrateReduceMotion(toBool(Number(storedMotion)));

  return {
    text: {
      dyslexiaFont: toBool(row.dyslexia_font),
      respectOsFontScale: toBool(row.respect_os_font_scale),
      fontScaleMultiplier: row.font_scale_multiplier,
      readableSpacing: toBool(row.readable_spacing),
    },
    display: {
      boldText: toBool(row.bold_text),
      highContrast: toBool(row.high_contrast),
      reduceMotion,
      largeTouchTargets: toBool(row.large_touch_targets),
      largeAudioControls: toBool(row.large_audio_controls),
    },
    tts: {
      enabled: toBool(row.tts_enabled),
      voiceId: row.tts_voice_id,
      rate: clampRate(row.tts_rate),
      pitch: clampPitch(row.tts_pitch),
      highlightMode: isValidTtsHighlightMode(row.tts_highlight_mode)
        ? row.tts_highlight_mode
        : DEFAULT_ACCESSIBILITY_PREFS.tts.highlightMode,
      autoContinueChapter: toBool(row.tts_auto_continue_chapter),
      backgroundPlayback: toBool(row.tts_background_playback),
    },
    announce: {
      pageChanges: toBool(row.announce_page_changes),
      chapterChanges: toBool(row.announce_chapter_changes),
    },
    screenReaderHints: toBool(row.screen_reader_hints),
  };
}

/**
 * Merges both tables into one contract-shaped record.
 *
 * A missing row falls back to the frozen defaults rather than failing, so a device that has
 * never written prefs still hands Reader something valid to apply. `updatedAt` is the later of
 * the two rows: the merged object is only as fresh as its freshest half, and Reader compares it
 * against nothing else.
 */
export async function readSharedPrefs(): Promise<SharedPrefs> {
  const [personalization, accessibility] = await Promise.all([
    personalizationStore.current(),
    accessibilityStore.current(),
  ]);

  return mergeSharedPrefs(personalization, accessibility);
}

export function mergeSharedPrefs(
  personalization: PersonalizationRow | null,
  accessibility: AccessibilityRow | null,
): SharedPrefs {
  const a11y = toAccessibilityPrefs(accessibility);

  if (!personalization) {
    return {
      id: personalizationId(USER_ID),
      userId: USER_ID,
      updatedAt: accessibility ? toMs(accessibility.updated_at) : 0,
      isDeleted: false,
      synced: accessibility ? toBool(accessibility.synced) : false,
      ...structuredClone(DEFAULT_PREFS),
      accessibility: a11y,
    };
  }

  // `theme: 'highContrast'` is deprecated in favour of the a11y flag, which is the single
  // source of truth for contrast. The contract asks for a read-time migration, and this merge
  // is the read - resolving it here means no consumer ever sees the deprecated variant.
  //
  // Base theme under the boost is 'light', NOT 'dark': classic high contrast is dark-on-light,
  // and this was ratified light (2026-08-17). It must match Personalization's canonical intent
  // in migratePrefs.ts (HIGH_CONTRAST_BASE_THEME = 'light'); the value is duplicated as a literal
  // rather than imported because this module deliberately does not reach into another capability
  // (see header). The real de-dup is promoting migrateSharedPrefs into @/shared/contracts so both
  // sides call one function through the legitimate coupling - flagged, needs Karthik + Ahana.
  const storedTheme = asOneOf(personalization.theme, THEMES, DEFAULT_PREFS.theme);
  const migratedHighContrast = storedTheme === 'highContrast';

  return {
    id: personalization.id,
    userId: personalization.user_id,
    updatedAt: Math.max(
      toMs(personalization.updated_at),
      accessibility ? toMs(accessibility.updated_at) : 0,
    ),
    isDeleted: toBool(personalization.is_deleted),
    synced:
      toBool(personalization.synced) && (accessibility ? toBool(accessibility.synced) : true),
    theme: migratedHighContrast ? 'light' : storedTheme,
    font: {
      family: personalization.font_family,
      ...(personalization.custom_font_uri
        ? { customFontUri: personalization.custom_font_uri }
        : {}),
    },
    typography: {
      size: personalization.typography_size,
      lineHeight: personalization.typography_line_height,
      spacing: personalization.typography_spacing,
      margins: personalization.typography_margins,
    },
    layout: {
      flow: asOneOf(personalization.layout_flow, LAYOUT_FLOWS, DEFAULT_PREFS.layout.flow),
      spread: asOneOf(
        personalization.layout_spread,
        LAYOUT_SPREADS,
        DEFAULT_PREFS.layout.spread,
      ),
    },
    zoom: { level: personalization.zoom },
    accessibility: migratedHighContrast
      ? { ...a11y, display: { ...a11y.display, highContrast: true } }
      : a11y,
  };
}

/**
 * Splits a contract prefs object back across the two tables.
 *
 * Both halves go through the normal `update` path, so each gets its own outbox entry and each
 * is pushed and resolved independently - which is the whole point of keeping them as two
 * records. Written sequentially rather than in parallel: they share one SQLite connection, and
 * `withWriteLock` serialises them anyway.
 */
export async function writeSharedPrefs(
  prefs: Omit<SharedPrefs, 'id' | 'userId' | 'updatedAt' | 'isDeleted' | 'synced'>,
): Promise<void> {
  const updatedAt = nowIso();

  await personalizationStore.update({
    id: personalizationId(USER_ID),
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
    updated_at: updatedAt,
  });

  const a11y = prefs.accessibility;
  await accessibilityStore.update({
    id: accessibilityId(USER_ID),
    dyslexia_font: toInt(a11y.text.dyslexiaFont),
    respect_os_font_scale: toInt(a11y.text.respectOsFontScale),
    font_scale_multiplier: a11y.text.fontScaleMultiplier,
    readable_spacing: toInt(a11y.text.readableSpacing),
    bold_text: toInt(a11y.display.boldText),
    high_contrast: toInt(a11y.display.highContrast),
    reduce_motion: a11y.display.reduceMotion,
    large_touch_targets: toInt(a11y.display.largeTouchTargets),
    large_audio_controls: toInt(a11y.display.largeAudioControls),
    tts_enabled: toInt(a11y.tts.enabled),
    tts_voice_id: a11y.tts.voiceId,
    tts_rate: a11y.tts.rate,
    tts_pitch: a11y.tts.pitch,
    tts_highlight_mode: a11y.tts.highlightMode,
    tts_auto_continue_chapter: toInt(a11y.tts.autoContinueChapter),
    tts_background_playback: toInt(a11y.tts.backgroundPlayback),
    announce_page_changes: toInt(a11y.announce.pageChanges),
    announce_chapter_changes: toInt(a11y.announce.chapterChanges),
    screen_reader_hints: toInt(a11y.screenReaderHints),
    updated_at: updatedAt,
  });
}

/** Reset to the frozen defaults. Deep-copies, per the warning on DEFAULT_ACCESSIBILITY_PREFS. */
export function resetSharedPrefs(): Promise<void> {
  return writeSharedPrefs(structuredClone(DEFAULT_PREFS));
}

/** Exposed for the adapter note in personalizationRow.ts: the column stores ISO-8601 UTC. */
export const timestampCodec = { toMs, toIso };
