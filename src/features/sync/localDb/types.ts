/**
 * A position inside a book. Always a tagged object, never a bare string.
 *
 * Re-exported from the frozen contract rather than redeclared. The local copy that used to
 * live here had LOWERCASE discriminants (`'epub' | 'pdf'`), which annotations.ts reconciled to
 * UPPERCASE to match ContentFormat - "no more 'epub'/'EPUB' split". Because it was a parallel
 * declaration the compiler had nothing to compare, so the split survived here and silently
 * dropped every EPUB highlight at render time. Importing it is what makes __typecheck__.ts
 * able to see this feature at all.
 */
export type { Locator } from '@/shared/contracts';

/** Fields every syncable local row carries. */
export interface LocalSyncFields {
  updated_at: string;
  is_deleted: number;
  /** 0 = has local changes the server has not acknowledged, 1 = in sync. */
  synced: number;
  /**
   * The `updatedAt` the server's copy carried the last time we saw it, whether
   * that was a pull or the echo from our own push. Device-local and never sent.
   *
   * This is the base version for conflict detection: if the server's record
   * still holds this value, nothing has happened there since we last looked and
   * our edit is safe to write. `null` means the server has never acknowledged
   * this record to us. Repositories do not set it - `saveLocal` carries it
   * forward, since a local edit changes nothing about what the server holds.
   */
  server_updated_at?: string | null;
}

export interface ProgressRow extends LocalSyncFields {
  id: string;
  user_id: string;
  book_id: string;
  /**
   * For a PDF this is the current page number. Kept because the Day-1 freeze and the Mongo
   * document both carry it, and it is what a PDF actually needs.
   */
  offset: number;
  /**
   * JSON-encoded {@link Locator}, the authoritative position.
   *
   * A reflowable EPUB has no stable integer offset - the same character sits at a different
   * offset at a different font size or viewport - so `offset` alone cannot restore position and
   * Reader emits a CFI instead. This closes the OPEN item progress.ts addressed to Sync.
   * Null on rows written before this column existed; fall back to `offset` when it is.
   */
  locator: string | null;
}

export interface BookmarkRow extends LocalSyncFields {
  id: string;
  user_id: string;
  book_id: string;
  chapter_id: string | null;
  /** JSON-encoded {@link Locator}. */
  locator: string;
  name: string | null;
  created_at: string;
}

export interface HighlightRow extends LocalSyncFields {
  id: string;
  user_id: string;
  book_id: string;
  /** JSON-encoded {@link Locator}. */
  start_locator: string;
  end_locator: string;
  color: string | null;
  created_at: string;
}

export interface DownloadRow extends LocalSyncFields {
  id: string;
  user_id: string;
  book_id: string;
  format: string;
  /** Device-specific. Never sent to the server. */
  local_path: string | null;
  status: string | null;
  /** Download bookkeeping only - entitlement is enforced by Encryption, not here. */
  is_valid: number;
  downloaded_at: string | null;
}

/** User scoped, like accessibility: no book_id. */
export interface PersonalizationRow extends LocalSyncFields {
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
}

export interface AccessibilityRow extends LocalSyncFields {
  id: string;
  user_id: string;
  dyslexia_font: number;
  respect_os_font_scale: number;
  bold_text: number;
  reduce_motion: string;
  tts_enabled: number;
  tts_voice_id: string | null;
  tts_rate: number;
  tts_pitch: number;
  tts_highlight_mode: string;
  tts_auto_continue_chapter: number;
  tts_background_playback: number;
  font_scale_multiplier: number;
  readable_spacing: number;
  high_contrast: number;
  large_touch_targets: number;
  large_audio_controls: number;
  announce_page_changes: number;
  announce_chapter_changes: number;
  /**
   * Extra a11y labels for TalkBack / VoiceOver. The nineteenth contract field, and the one
   * this table used to be missing - so it could neither persist nor sync.
   */
  screen_reader_hints: number;
}

export type OutboxOperation = 'CREATE' | 'UPDATE' | 'DELETE';
/**
 * FAILED is retryable and waits for `next_retry_at`. DEAD has exhausted its
 * retries - the payload is rejected every time, so it is parked rather than
 * retried forever. A fresh edit to the same record supersedes a DEAD op.
 *
 * There is no PROCESSING: it was declared here but never written, and it would be actively
 * misleading if it were. The drain is a single in-process loop that removes each row only
 * after the server acknowledges it, so an op is either queued or gone - there is no window
 * where "in flight" is durable state. A row stuck in PROCESSING after a crash would need
 * recovery logic that does not exist, and would be skipped by `listPending` forever.
 */
export type OutboxStatus = 'PENDING' | 'FAILED' | 'DEAD';

/** Entity types the sync engine understands. Must match the backend registry. */
export type EntityType =
  | 'progress'
  | 'bookmarks'
  | 'highlights'
  | 'personalization'
  | 'accessibility'
  | 'downloads';

export interface OutboxRow {
  id: string;
  user_id: string;
  entity_type: EntityType;
  entity_id: string;
  operation: OutboxOperation;
  /** JSON string that will be sent to the server verbatim. */
  payload: string;
  created_at: string;
  updated_at: string;
  status: OutboxStatus;
  retry_count: number;
  last_error: string | null;
  next_retry_at: string | null;
}

export interface SyncMetadataRow {
  key: string;
  value: string | null;
  updated_at: string;
}
