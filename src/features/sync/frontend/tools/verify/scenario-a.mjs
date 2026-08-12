/**
 * Scenario A - offline edits reaching the Mongo backend.
 *
 * Exercises the real repositories, outbox and Sync Manager against the running
 * server. Nothing is reimplemented here; the harness only supplies SQLite and a
 * switch that takes the network away.
 */
import { rmSync } from 'node:fs';
import {
  BASE,
  check,
  equal,
  exitCode,
  goOffline,
  goOnline,
  purgeServer,
  requireServer,
  section,
  serverGet,
  serverList,
  serverPut,
  summarize,
} from './harness.mjs';

const DB = process.env.VERIFY_DB_PATH;
for (const suffix of ['', '-wal', '-shm']) {
  rmSync(`${DB}${suffix}`, { force: true });
}

await requireServer();

const { USER_ID, BOOK_ID } = await import('../../src/config.ts');
const { getDatabase } = await import('../../src/db/database.ts');
const { bookmarkRepository } = await import('../../src/repositories/bookmarkRepository.ts');
const { downloadRepository } = await import('../../src/repositories/downloadRepository.ts');
const { highlightRepository } = await import('../../src/repositories/highlightRepository.ts');
const { outboxRepository } = await import('../../src/repositories/outboxRepository.ts');
const { progressRepository } = await import('../../src/repositories/progressRepository.ts');
const { syncManager } = await import('../../src/sync/syncManager.ts');

await purgeServer(USER_ID);
const db = await getDatabase();

const LOCAL_PDF = 'file:///data/user/0/host.exp.exponent/files/reader/book-001.pdf';

// ------------------------------------------------------- 1. offline edits

section(`1. Six edits with the network off  (${USER_ID} / ${BOOK_ID} -> ${BASE})`);
goOffline();

await progressRepository.savePosition(3);
await progressRepository.savePosition(4);
const highlight = await highlightRepository.addFromSelection({
  page: 1,
  startOffset: 10,
  endOffset: 42,
});
const bookmark = await bookmarkRepository.addForPage(2);
await bookmarkRepository.addForPage(9); // a second one, left alone throughout
const download = await downloadRepository.recordCompleted(LOCAL_PDF, 'PDF');

let outbox = await outboxRepository.listPending();
equal('six edits queue five operations (two page turns coalesce)', outbox.length, 5);
equal(
  'progress queued exactly once',
  outbox.filter((op) => op.entity_type === 'progress').length,
  1,
);
equal('reading position saved offline', (await progressRepository.current()).offset, 4);
equal('local row is unsynced', (await progressRepository.current()).synced, 0);
equal('local_path kept on the device row', download.local_path, LOCAL_PDF);
check(
  'local_path absent from the outbox payload',
  !('localPath' in JSON.parse(outbox.find((op) => op.entity_type === 'downloads').payload)),
);
check(
  'highlight carries locators but no selected text',
  !JSON.parse(outbox.find((op) => op.entity_type === 'highlights').payload).selectedText,
);

const offlineSync = await syncManager.run();
check('a sync with no network reports an error instead of throwing', Boolean(offlineSync.error));
equal('nothing was pushed', offlineSync.pushed, 0);
equal('the queue is intact', (await outboxRepository.listPending()).length, 5);

// ---------------------------------------------------------- 2. reconnect

section('2. Reconnect and sync');
goOnline();

const first = await syncManager.run();
console.log(`  report: ${JSON.stringify(first)}`);
equal('all five operations pushed', first.pushed, 5);
equal('no failures', first.failed, 0);
equal('outbox drained', (await outboxRepository.listPending()).length, 0);

const progressRow = await progressRepository.current();
equal('progress marked synced', progressRow.synced, 1);
equal(
  'download row still marked synced',
  (await downloadRepository.currentForBook()).synced,
  1,
);
equal(
  'local_path survived the round trip',
  (await downloadRepository.currentForBook()).local_path,
  LOCAL_PDF,
);

// ------------------------------------------------------- 3. server state

section('3. What Mongo actually holds');

const serverProgress = await serverList('progress', { userId: USER_ID, bookId: BOOK_ID });
equal('one progress document', serverProgress.length, 1);
equal('server holds page 4', serverProgress[0].offset, 4);
equal('the device-minted id was honoured', serverProgress[0].id, progressRow.id);

const serverHighlight = await serverGet('highlights', highlight.id);
check('highlight stored under its device id', Boolean(serverHighlight));
equal('start locator round-tripped', serverHighlight.startLocator, {
  type: 'pdf',
  page: 1,
  offset: 10,
});
equal('end locator round-tripped', serverHighlight.endLocator, {
  type: 'pdf',
  page: 1,
  offset: 42,
});
check('no selected text on the server', serverHighlight.selectedText === undefined);

const serverDownload = await serverGet('downloads', download.id);
check('no localPath column on the server', !('localPath' in serverDownload));
equal('download status stored', serverDownload.status, 'COMPLETED');

equal(
  'bookmark stored with its locator',
  (await serverGet('bookmarks', bookmark.id)).locator,
  { type: 'pdf', page: 2, offset: 0 },
);

// -------------------------------------------------- 4. the timestamp trap

section('4. A second sync is quiet');

const second = await syncManager.run();
console.log(`  report: ${JSON.stringify(second)}`);
equal('nothing left to push', second.pushed, 0);
check('every record came back on the pull', second.pulled >= 5, second.pulled);
equal(
  'and none of them was re-applied - the device already matches',
  second.applied,
  0,
);
equal(
  'local timestamp equals the one Mongo stored',
  (await progressRepository.current()).updated_at,
  (await serverGet('progress', progressRow.id)).updatedAt,
);

// -------------------------------------------------- 5. an offline delete

section('5. Delete a synced bookmark offline');
goOffline();

await bookmarkRepository.remove(bookmark.id);
equal('hidden locally at once', (await bookmarkRepository.list()).length, 1);
equal(
  'a DELETE is queued',
  (await outboxRepository.listPending())[0].operation,
  'DELETE',
);

goOnline();
const third = await syncManager.run();
console.log(`  report: ${JSON.stringify(third)}`);
equal('the delete pushed', third.pushed, 1);
equal(
  'the server holds a tombstone, not a hole',
  (await serverGet('bookmarks', bookmark.id)).isDeleted,
  true,
);
equal('and hides it from a normal read', (await serverBookmarksAlive()).length, 1);

// ------------------------------- 6. created and deleted in one offline run

section('6. Create and delete a bookmark without ever connecting');
goOffline();

const ghost = await bookmarkRepository.addForPage(11);
await bookmarkRepository.remove(ghost.id);
equal(
  'both edits coalesced into one DELETE',
  (await outboxRepository.listPending()).map((op) => op.operation),
  ['DELETE'],
);

goOnline();
const fourth = await syncManager.run();
console.log(`  report: ${JSON.stringify(fourth)}`);
equal('pushed as a single operation', fourth.pushed, 1);
const ghostOnServer = await serverGet('bookmarks', ghost.id);
check('the record exists on the server', Boolean(ghostOnServer));
equal('as a tombstone', ghostOnServer.isDeleted, true);
equal('outbox drained', (await outboxRepository.listPending()).length, 0);

// ------------------------------------------------ 7. the server wins a race

section('7. A stale local edit loses to a newer server record');

// Another device moved the reading position to page 30 and pushed it.
await serverPut('progress', progressRow.id, {
  userId: USER_ID,
  bookId: BOOK_ID,
  offset: 30,
  isDeleted: false,
});

// This device made its edit *before* that, but is only now reconnecting. Rewind
// the local stamp to say so - it is the one thing wall-clock time cannot fake.
await db.runAsync(`UPDATE progress SET updated_at = ? WHERE id = ?`, [
  '2020-01-01T00:00:00.000Z',
  progressRow.id,
]);
await progressRepository.saveLocal(
  { ...(await progressRepository.current()), offset: 5 },
  'UPDATE',
);
equal('the stale edit shows locally first', (await progressRepository.current()).offset, 5);

const fifth = await syncManager.run();
console.log(`  report: ${JSON.stringify(fifth)}`);
equal('reported as a conflict, not a push', fifth.conflicts, 1);
equal('the queue is cleared, not retried forever', (await outboxRepository.listPending()).length, 0);
equal('the server kept page 30', (await serverGet('progress', progressRow.id)).offset, 30);
equal('and the device adopted it', (await progressRepository.current()).offset, 30);

// -------------------------------- 8. a fresh edit after adopting server time

section('8. A new edit still wins after adopting the server clock');

await progressRepository.savePosition(31);
const sixth = await syncManager.run();
console.log(`  report: ${JSON.stringify(sixth)}`);
equal('the page turn was pushed, not discarded as stale', sixth.pushed, 1);
equal('the server moved to page 31', (await serverGet('progress', progressRow.id)).offset, 31);

// -------------------------------------------------------- 9. a second device

section('9. A record created elsewhere arrives on the next pull');

const remoteId = 'verify-remote-bookmark';
await fetch(`${BASE}/api/v1/bookmarks`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    id: remoteId,
    userId: USER_ID,
    bookId: BOOK_ID,
    locator: { type: 'pdf', page: 7, offset: 0 },
    name: 'From another device',
  }),
});

const seventh = await syncManager.run();
console.log(`  report: ${JSON.stringify(seventh)}`);
equal('exactly one new record applied', seventh.applied, 1);
const pulled = await bookmarkRepository.findById(remoteId);
check('it landed in local SQLite', Boolean(pulled));
equal('with its name', pulled.name, 'From another device');
equal('marked synced, so nothing is queued for it', pulled.synced, 1);
equal(
  'joining the one live local bookmark, with the tombstones still hidden',
  (await bookmarkRepository.list()).length,
  2,
);

await purgeServer(USER_ID);
summarize('SCENARIO A');
process.exit(exitCode());

async function serverBookmarksAlive() {
  const response = await fetch(
    `${BASE}/api/v1/bookmarks?userId=${USER_ID}&bookId=${BOOK_ID}`,
  );
  return response.json();
}
