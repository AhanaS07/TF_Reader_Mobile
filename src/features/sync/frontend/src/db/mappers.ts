import type {
  AccessibilityRow,
  BookmarkRow,
  DownloadRow,
  EntityType,
  HighlightRow,
  PersonalizationRow,
  ProgressRow,
} from './types';
import { toBool, toInt } from './database';
import { BOOK_ID, PERSONALIZATION_REQUIRES_BOOK_ID } from '../config';

/**
 * Local rows are snake_case; the API is camelCase. These mappers are the only
 * place that knows about the difference.
 *
 * Two rules from the Day 1 design are enforced here:
 *   - `synced` never goes to the server (device-local state)
 *   - `local_path` never goes to the server (device-specific path)
 *
 * `toRow` also stamps `server_updated_at`, the base version used for conflict
 * detection: by definition it is the `updatedAt` of the record just received.
 */

type ServerRecord = Record<string, unknown>;

const parseJson = (value: string | null): unknown =>
  value == null ? null : JSON.parse(value);

const stringifyJson = (value: unknown): string => JSON.stringify(value ?? null);

// ------------------------------------------------------------------ progress

export const progressMapper = {
  toServer: (row: ProgressRow): ServerRecord => ({
    id: row.id,
    userId: row.user_id,
    bookId: row.book_id,
    offset: row.offset,
    updatedAt: row.updated_at,
    isDeleted: toBool(row.is_deleted),
  }),
  toRow: (record: any): ProgressRow => ({
    id: record.id,
    user_id: record.userId,
    book_id: record.bookId,
    offset: record.offset ?? 1,
    updated_at: record.updatedAt,
    is_deleted: toInt(!!record.isDeleted),
    synced: 1,
    server_updated_at: record.updatedAt,
  }),
};

// ----------------------------------------------------------------- bookmarks

export const bookmarkMapper = {
  toServer: (row: BookmarkRow): ServerRecord => ({
    id: row.id,
    userId: row.user_id,
    bookId: row.book_id,
    chapterId: row.chapter_id,
    locator: parseJson(row.locator),
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isDeleted: toBool(row.is_deleted),
  }),
  toRow: (record: any): BookmarkRow => ({
    id: record.id,
    user_id: record.userId,
    book_id: record.bookId,
    chapter_id: record.chapterId ?? null,
    locator: stringifyJson(record.locator),
    name: record.name ?? null,
    created_at: record.createdAt ?? record.updatedAt,
    updated_at: record.updatedAt,
    is_deleted: toInt(!!record.isDeleted),
    synced: 1,
    server_updated_at: record.updatedAt,
  }),
};

// ---------------------------------------------------------------- highlights

export const highlightMapper = {
  toServer: (row: HighlightRow): ServerRecord => ({
    id: row.id,
    userId: row.user_id,
    bookId: row.book_id,
    startLocator: parseJson(row.start_locator),
    endLocator: parseJson(row.end_locator),
    color: row.color,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isDeleted: toBool(row.is_deleted),
  }),
  toRow: (record: any): HighlightRow => ({
    id: record.id,
    user_id: record.userId,
    book_id: record.bookId,
    start_locator: stringifyJson(record.startLocator),
    end_locator: stringifyJson(record.endLocator),
    color: record.color ?? null,
    created_at: record.createdAt ?? record.updatedAt,
    updated_at: record.updatedAt,
    is_deleted: toInt(!!record.isDeleted),
    synced: 1,
    server_updated_at: record.updatedAt,
  }),
};

// ----------------------------------------------------------------- downloads

export const downloadMapper = {
  /** local_path is deliberately omitted - it must never reach the server. */
  toServer: (row: DownloadRow): ServerRecord => ({
    id: row.id,
    userId: row.user_id,
    bookId: row.book_id,
    format: row.format,
    status: row.status,
    isValid: toBool(row.is_valid),
    downloadedAt: row.downloaded_at,
    updatedAt: row.updated_at,
    isDeleted: toBool(row.is_deleted),
  }),
  /** Incoming server rows carry no local_path, so an existing one is preserved separately. */
  toRow: (record: any): DownloadRow => ({
    id: record.id,
    user_id: record.userId,
    book_id: record.bookId,
    format: record.format,
    local_path: null,
    status: record.status ?? null,
    is_valid: toInt(record.isValid !== false),
    downloaded_at: record.downloadedAt ?? null,
    updated_at: record.updatedAt,
    is_deleted: toInt(!!record.isDeleted),
    synced: 1,
    server_updated_at: record.updatedAt,
  }),
};

// ----------------------------------------------------------- personalization

export const personalizationMapper = {
  toServer: (row: PersonalizationRow): ServerRecord => ({
    id: row.id,
    userId: row.user_id,
    // Local personalization is user scoped, but PersonalizationRequest rejects a
    // body without bookId. Sent only to pass that validation; never read back.
    ...(PERSONALIZATION_REQUIRES_BOOK_ID ? { bookId: BOOK_ID } : {}),
    theme: row.theme,
    fontFamily: row.font_family,
    customFontUri: row.custom_font_uri,
    typographySize: row.typography_size,
    typographyLineHeight: row.typography_line_height,
    typographySpacing: row.typography_spacing,
    typographyMargins: row.typography_margins,
    layoutFlow: row.layout_flow,
    layoutSpread: row.layout_spread,
    zoom: row.zoom,
    updatedAt: row.updated_at,
    isDeleted: toBool(row.is_deleted),
  }),
  toRow: (record: any): PersonalizationRow => ({
    id: record.id,
    user_id: record.userId,
    theme: record.theme ?? 'system',
    font_family: record.fontFamily ?? 'system',
    custom_font_uri: record.customFontUri ?? null,
    typography_size: record.typographySize ?? 1.0,
    typography_line_height: record.typographyLineHeight ?? 1.0,
    typography_spacing: record.typographySpacing ?? 0.0,
    typography_margins: record.typographyMargins ?? 0.0,
    layout_flow: record.layoutFlow ?? 'paginated',
    layout_spread: record.layoutSpread ?? 'single',
    zoom: record.zoom ?? 1.0,
    updated_at: record.updatedAt,
    is_deleted: toInt(!!record.isDeleted),
    synced: 1,
    server_updated_at: record.updatedAt,
  }),
};

// ------------------------------------------------------------- accessibility

export const accessibilityMapper = {
  toServer: (row: AccessibilityRow): ServerRecord => ({
    id: row.id,
    userId: row.user_id,
    dyslexiaFont: toBool(row.dyslexia_font),
    respectOsFontScale: toBool(row.respect_os_font_scale),
    boldText: toBool(row.bold_text),
    reduceMotion: row.reduce_motion,
    ttsEnabled: toBool(row.tts_enabled),
    ttsVoiceId: row.tts_voice_id,
    ttsRate: row.tts_rate,
    ttsPitch: row.tts_pitch,
    ttsHighlightMode: row.tts_highlight_mode,
    ttsAutoContinueChapter: toBool(row.tts_auto_continue_chapter),
    ttsBackgroundPlayback: toBool(row.tts_background_playback),
    fontScaleMultiplier: row.font_scale_multiplier,
    readableSpacing: toBool(row.readable_spacing),
    highContrast: toBool(row.high_contrast),
    largeTouchTargets: toBool(row.large_touch_targets),
    largeAudioControls: toBool(row.large_audio_controls),
    announcePageChanges: toBool(row.announce_page_changes),
    announceChapterChanges: toBool(row.announce_chapter_changes),
    updatedAt: row.updated_at,
    isDeleted: toBool(row.is_deleted),
  }),
  toRow: (record: any): AccessibilityRow => ({
    id: record.id,
    user_id: record.userId,
    dyslexia_font: toInt(!!record.dyslexiaFont),
    respect_os_font_scale: toInt(record.respectOsFontScale !== false),
    bold_text: toInt(!!record.boldText),
    reduce_motion: record.reduceMotion ?? 'system',
    tts_enabled: toInt(!!record.ttsEnabled),
    tts_voice_id: record.ttsVoiceId ?? null,
    tts_rate: record.ttsRate ?? 1.0,
    tts_pitch: record.ttsPitch ?? 1.0,
    tts_highlight_mode: record.ttsHighlightMode ?? 'sentence',
    tts_auto_continue_chapter: toInt(record.ttsAutoContinueChapter !== false),
    tts_background_playback: toInt(!!record.ttsBackgroundPlayback),
    font_scale_multiplier: record.fontScaleMultiplier ?? 1.0,
    readable_spacing: toInt(!!record.readableSpacing),
    high_contrast: toInt(!!record.highContrast),
    large_touch_targets: toInt(!!record.largeTouchTargets),
    large_audio_controls: toInt(!!record.largeAudioControls),
    announce_page_changes: toInt(record.announcePageChanges !== false),
    announce_chapter_changes: toInt(record.announceChapterChanges !== false),
    updated_at: record.updatedAt,
    is_deleted: toInt(!!record.isDeleted),
    synced: 1,
    server_updated_at: record.updatedAt,
  }),
};

/** REST path segment for each entity type. */
export const ENTITY_PATHS: Record<EntityType, string> = {
  progress: 'progress',
  bookmarks: 'bookmarks',
  highlights: 'highlights',
  personalization: 'personalization',
  accessibility: 'accessibility',
  downloads: 'downloads',
};
