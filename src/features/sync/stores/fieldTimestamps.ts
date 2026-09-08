/**
 * Per-field last-write timestamps for a field-merge syncable table (personalization,
 * accessibility) - JSON-encoded into one extra column (`field_updated_at`) rather than one
 * column per field, since the row already carries every field's VALUE; this only adds where
 * each one was last touched, which a single whole-row `updated_at` cannot express.
 */
export function parseFieldTimestamps(json: string | null | undefined): Record<string, string> {
  if (!json) return {};
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function stringifyFieldTimestamps(map: Record<string, string>): string {
  return JSON.stringify(map);
}

/**
 * Stamps every field actually present in `patch` with `now`, leaving every other field's
 * recorded time untouched.
 *
 * Only `fields` are eligible - meta columns (id, user_id, updated_at, is_deleted, synced,
 * server_updated_at, field_updated_at itself) are never part of the merge and must not get a
 * per-field timestamp of their own, or a plain metadata write would look like a content edit.
 */
export function stampChangedFields(
  previous: Record<string, string>,
  patch: Record<string, unknown>,
  fields: readonly string[],
  now: string,
): Record<string, string> {
  const next = { ...previous };
  for (const field of fields) {
    if (field in patch) next[field] = now;
  }
  return next;
}
