/**
 * Scenario B, phase 1 - three edits made with the backend unreachable, then the
 * process ends. Phase 2 is a *separate* OS process over the same database file,
 * which is what force-quitting the app and reopening it actually looks like.
 */
import { rmSync } from 'node:fs';
import {
  check,
  equal,
  exitCode,
  goOffline,
  purgeServer,
  requireServer,
  section,
  summarize,
} from './harness.mjs';

const DB = process.env.VERIFY_DB_PATH;
for (const suffix of ['', '-wal', '-shm']) {
  rmSync(`${DB}${suffix}`, { force: true });
}

await requireServer();

const { USER_ID } = await import('../../src/config.ts');
const { getDatabase } = await import('../../src/db/database.ts');
const { bookmarkRepository } = await import('../../src/repositories/bookmarkRepository.ts');
const { highlightRepository } = await import('../../src/repositories/highlightRepository.ts');
const { outboxRepository } = await import('../../src/repositories/outboxRepository.ts');
const { progressRepository } = await import('../../src/repositories/progressRepository.ts');
const { syncManager } = await import('../../src/sync/syncManager.ts');

await purgeServer(USER_ID);
await getDatabase();

section('Phase 1 - backend unreachable');
goOffline();

await bookmarkRepository.addForPage(5);
await highlightRepository.addFromSelection({ page: 5, startOffset: 0, endOffset: 12 });
await progressRepository.savePosition(5);

equal('bookmark written with no network', (await bookmarkRepository.list()).length, 1);
equal('highlight written with no network', (await highlightRepository.list()).length, 1);
equal('reading position written with no network', (await progressRepository.current()).offset, 5);

const report = await syncManager.run();
check('sync reports an error instead of throwing', Boolean(report.error));
equal('nothing was pushed', report.pushed, 0);
equal('the outbox holds all three changes', (await outboxRepository.listPending()).length, 3);

summarize('PHASE 1');
process.exit(exitCode());
