/**
 * Scenario B, phase 2 - a fresh process over the database phase 1 left behind,
 * with the backend back up. Also covers the case the CRUD endpoints make
 * awkward: a push whose response is lost after the server has already written.
 */
import {
  check,
  equal,
  exitCode,
  goOnline,
  purgeServer,
  requireServer,
  section,
  serverGet,
  serverList,
  summarize,
} from './harness.mjs';

await requireServer();

const { USER_ID, BOOK_ID } = await import('../../src/config.ts');
const { getDatabase } = await import('../../src/db/database.ts');
const { bookmarkRepository } = await import('../../src/repositories/bookmarkRepository.ts');
const { highlightRepository } = await import('../../src/repositories/highlightRepository.ts');
const { outboxRepository } = await import('../../src/repositories/outboxRepository.ts');
const { progressRepository } = await import('../../src/repositories/progressRepository.ts');
const { syncManager } = await import('../../src/sync/syncManager.ts');

await getDatabase();

// ------------------------------------------------- the restart survived

section('Phase 2 - fresh process, backend back up');

equal('bookmark survived the restart', (await bookmarkRepository.list()).length, 1);
equal('highlight survived the restart', (await highlightRepository.list()).length, 1);
equal('reading position survived the restart', (await progressRepository.current()).offset, 5);
equal('outbox survived the restart', (await outboxRepository.listPending()).length, 3);

const report = await syncManager.run();
console.log(`  report: ${JSON.stringify(report)}`);
check('sync succeeded on reconnect', !report.error, report.error);
equal('all three queued changes pushed', report.pushed, 3);
equal('outbox drained', (await outboxRepository.listPending()).length, 0);
equal('bookmark now marked synced', (await bookmarkRepository.list())[0].synced, 1);
equal(
  'and the server has it',
  (await serverList('bookmarks', { userId: USER_ID, bookId: BOOK_ID })).length,
  1,
);

// ------------------------------------------- a push whose answer never came

section('A create that lands but whose response is lost');

const orphan = await bookmarkRepository.addForPage(12);

// The server commits the POST, then the connection dies before the answer gets
// back. The device cannot tell this apart from a request that never arrived.
const realFetch = globalThis.fetch;
let dropped = false;
globalThis.fetch = async (input, init) => {
  const response = await realFetch(input, init);
  if (!dropped && init?.method === 'POST') {
    dropped = true;
    throw new TypeError('fetch failed');
  }
  return response;
};

const interrupted = await syncManager.run();
check('the run reports the failure', Boolean(interrupted.error));
equal('and nothing is counted as pushed', interrupted.pushed, 0);
equal(
  'the operation is still queued',
  (await outboxRepository.listPending()).length,
  1,
);
check('even though the server did write it', Boolean(await serverGet('bookmarks', orphan.id)));

goOnline();
const retry = await syncManager.run();
console.log(`  report: ${JSON.stringify(retry)}`);
equal('the retry succeeds', retry.pushed, 1);
equal('no failures', retry.failed, 0);
equal(
  'and there is exactly one document, not two',
  (await serverList('bookmarks', { userId: USER_ID, bookId: BOOK_ID })).filter(
    (row) => row.id === orphan.id,
  ).length,
  1,
);
equal('outbox drained', (await outboxRepository.listPending()).length, 0);
equal('the row is marked synced', (await bookmarkRepository.findById(orphan.id)).synced, 1);

await purgeServer(USER_ID);
summarize('PHASE 2');
process.exit(exitCode());
