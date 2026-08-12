/**
 * Shared scaffolding for the verification scripts: assertions, a switch that
 * takes the network away, and cleanup of the documents a run leaves behind.
 */
import { register } from 'node:module';

register('./loader.mjs', import.meta.url);

const results = [];
let failures = 0;

export function check(label, condition, detail) {
  const ok = Boolean(condition);
  if (!ok) failures += 1;
  results.push({ label, ok, detail });
  const mark = ok ? 'ok  ' : 'FAIL';
  console.log(`  ${mark} ${label}${!ok && detail !== undefined ? `  -> ${detail}` : ''}`);
  return ok;
}

export function equal(label, actual, expected) {
  return check(
    label,
    JSON.stringify(actual) === JSON.stringify(expected),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

export function section(title) {
  console.log(`\n${title}`);
}

export function summarize(title) {
  console.log(
    `\n${failures === 0 ? `${title} PASSED` : `${title} FAILED`}` +
      ` - ${results.length - failures}/${results.length} assertions`,
  );
  return failures === 0;
}

export function exitCode() {
  return failures === 0 ? 0 : 1;
}

// ------------------------------------------------------------- the network

const realFetch = globalThis.fetch;

/**
 * Airplane mode. Every request fails the way an unreachable host does, which is
 * what the Sync Manager has to survive - not a polite error object.
 */
export function goOffline() {
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed');
  };
}

export function goOnline() {
  globalThis.fetch = realFetch;
}

// --------------------------------------------------------------- the server

export const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:9000';

export async function serverList(entity, params) {
  const query = new URLSearchParams({ includeDeleted: 'true', ...params });
  const response = await realFetch(`${BASE}/api/v1/${entity}?${query}`);
  if (!response.ok) throw new Error(`${entity} list -> ${response.status}`);
  return response.json();
}

export async function serverGet(entity, id) {
  const response = await realFetch(`${BASE}/api/v1/${entity}/${id}`);
  return response.ok ? response.json() : null;
}

export async function serverPut(entity, id, body) {
  const response = await realFetch(`${BASE}/api/v1/${entity}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${entity} put -> ${response.status}`);
  return response.json();
}

/** Hard delete, so a run leaves the database exactly as it found it. */
export async function purgeServer(userId) {
  const entities = [
    'progress',
    'bookmarks',
    'highlights',
    'downloads',
    'personalization',
    'accessibility',
  ];
  for (const entity of entities) {
    const records = await serverList(entity, { userId });
    for (const record of records) {
      await realFetch(`${BASE}/api/v1/${entity}/${record.id}?hard=true`, {
        method: 'DELETE',
      });
    }
  }
}

export async function requireServer() {
  try {
    await serverList('progress', { userId: '__ping__' });
  } catch (error) {
    console.error(
      `\nBackend not reachable at ${BASE} - start it before running this.\n${error.message}`,
    );
    process.exit(2);
  }
}
