/**
 * Local SQLite schema - the offline source of truth.
 *
 * This mirrors the Day 1 design exactly: six business tables plus two sync
 * infrastructure tables (outbox, sync_metadata). `synced`, `server_updated_at`
 * and `local_path` are device-local and never leave the device.
 */
export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS progress (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  book_id     TEXT NOT NULL,
  "offset"    INTEGER NOT NULL,
  -- JSON-encoded Locator. The authoritative position: a reflowable EPUB has no stable
  -- integer offset, so "offset" alone cannot restore it. Nullable for rows written before
  -- this column existed.
  locator     TEXT,
  updated_at  TEXT NOT NULL,
  is_deleted  INTEGER NOT NULL DEFAULT 0,
  synced      INTEGER NOT NULL DEFAULT 0,
  server_updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_progress_user_book ON progress (user_id, book_id);
CREATE INDEX IF NOT EXISTS idx_progress_synced    ON progress (synced);

CREATE TABLE IF NOT EXISTS bookmarks (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  book_id     TEXT NOT NULL,
  chapter_id  TEXT,
  locator     TEXT NOT NULL,
  name        TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  is_deleted  INTEGER NOT NULL DEFAULT 0,
  synced      INTEGER NOT NULL DEFAULT 0,
  server_updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_bookmarks_user_book ON bookmarks (user_id, book_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_synced    ON bookmarks (synced);

CREATE TABLE IF NOT EXISTS highlights (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  book_id        TEXT NOT NULL,
  start_locator  TEXT NOT NULL,
  end_locator    TEXT NOT NULL,
  color          TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  is_deleted     INTEGER NOT NULL DEFAULT 0,
  synced         INTEGER NOT NULL DEFAULT 0,
  server_updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_highlights_user_book ON highlights (user_id, book_id);
CREATE INDEX IF NOT EXISTS idx_highlights_synced    ON highlights (synced);

-- User scoped: no book_id. One preference set applies to every book.
CREATE TABLE IF NOT EXISTS personalization (
  id                      TEXT PRIMARY KEY,
  user_id                 TEXT NOT NULL,
  theme                   TEXT DEFAULT 'system',
  font_family             TEXT DEFAULT 'system',
  custom_font_uri         TEXT,
  -- POINTS, matching DEFAULT_PREFS in the frozen contract. These were scale factors
  -- (1.0 / 1.0 / 0.0), which the prefs adapter passed through untouched and Reader then
  -- applied as points - rendering 1pt text. Two readings were committed; this is the one
  -- the contract specifies.
  typography_size         REAL DEFAULT 16.0,
  typography_line_height  REAL DEFAULT 1.5,
  typography_spacing      REAL DEFAULT 0.0,
  typography_margins      REAL DEFAULT 16.0,
  layout_flow             TEXT DEFAULT 'paginated',
  layout_spread           TEXT DEFAULT 'single',
  zoom                    REAL DEFAULT 1.0,
  updated_at              TEXT NOT NULL,
  is_deleted              INTEGER NOT NULL DEFAULT 0,
  synced                  INTEGER NOT NULL DEFAULT 0,
  server_updated_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_personalization_user ON personalization (user_id);

CREATE TABLE IF NOT EXISTS accessibility (
  id                         TEXT PRIMARY KEY,
  user_id                    TEXT NOT NULL,
  dyslexia_font              INTEGER DEFAULT 0,
  respect_os_font_scale      INTEGER DEFAULT 1,
  bold_text                  INTEGER DEFAULT 0,
  reduce_motion              TEXT DEFAULT 'system',
  tts_enabled                INTEGER DEFAULT 0,
  tts_voice_id               TEXT,
  tts_rate                   REAL DEFAULT 1.0,
  tts_pitch                  REAL DEFAULT 1.0,
  tts_highlight_mode         TEXT DEFAULT 'sentence',
  tts_auto_continue_chapter  INTEGER DEFAULT 1,
  tts_background_playback    INTEGER DEFAULT 0,
  font_scale_multiplier      REAL DEFAULT 1.0,
  readable_spacing           INTEGER DEFAULT 0,
  high_contrast              INTEGER DEFAULT 0,
  large_touch_targets        INTEGER DEFAULT 0,
  large_audio_controls       INTEGER DEFAULT 0,
  announce_page_changes      INTEGER DEFAULT 1,
  announce_chapter_changes   INTEGER DEFAULT 1,
  -- The nineteenth contract field. Reaches native RN controls only, not the EPUB WebView.
  screen_reader_hints        INTEGER DEFAULT 0,
  updated_at                 TEXT NOT NULL,
  is_deleted                 INTEGER NOT NULL DEFAULT 0,
  synced                     INTEGER NOT NULL DEFAULT 0,
  server_updated_at          TEXT
);
CREATE INDEX IF NOT EXISTS idx_accessibility_user ON accessibility (user_id);

CREATE TABLE IF NOT EXISTS downloads (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  book_id        TEXT NOT NULL,
  format         TEXT NOT NULL,
  local_path     TEXT,
  status         TEXT,
  -- NOT the entitlement gate. Encryption owns licence enforcement, offline included, from
  -- SignedLicence.expiresAt inside the EncryptedPackage - see contentStore. This column only
  -- records that a download completed; a second, weaker source of entitlement truth sourced
  -- from a different backend collection is exactly what review rejected.
  is_valid       INTEGER DEFAULT 1,
  downloaded_at  TEXT,
  updated_at     TEXT NOT NULL,
  is_deleted     INTEGER NOT NULL DEFAULT 0,
  synced         INTEGER NOT NULL DEFAULT 0,
  server_updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_downloads_user_book ON downloads (user_id, book_id);

CREATE TABLE IF NOT EXISTS outbox (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  entity_type    TEXT NOT NULL,
  entity_id      TEXT NOT NULL,
  operation      TEXT NOT NULL,
  payload        TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  status         TEXT DEFAULT 'PENDING',
  retry_count    INTEGER DEFAULT 0,
  last_error     TEXT,
  next_retry_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_outbox_status     ON outbox (status);
CREATE INDEX IF NOT EXISTS idx_outbox_created_at ON outbox (created_at);

CREATE TABLE IF NOT EXISTS sync_metadata (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  updated_at  TEXT NOT NULL
);
`;

/** Keys used in sync_metadata. */
export const SYNC_KEYS = {
  /** Server timestamp of the last pull that was fully applied locally. */
  LAST_PULL_TOKEN: 'last_pull_token',
  LAST_PUSH_AT: 'last_push_at',
  /**
   * Opaque cursor into flambeau's loan change feed. Null until the feed has answered once.
   *
   * Stored rather than derived so a revocation is learned exactly once: the feed is
   * incremental, and re-reading from the beginning would re-announce revocations the device has
   * already acted on - which, since acting means destroying key material, is not harmless.
   */
  LAST_LOAN_CHANGES_CURSOR: 'last_loan_changes_cursor',
  /**
   * When the change feed last answered.
   *
   * This is what distinguishes "asked, and nothing is revoked" from "never asked" - the
   * `downloads.is_valid` column reads as valid in both cases, and a UI that cannot tell them
   * apart will claim an entitlement it has never confirmed.
   */
  LAST_ENTITLEMENT_CHECK_AT: 'last_entitlement_check_at',
} as const;
