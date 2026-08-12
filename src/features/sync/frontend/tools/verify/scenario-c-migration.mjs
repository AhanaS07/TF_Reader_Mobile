/**
 * Scenario C - upgrading a database that already has data in it.
 *
 * A phone that ran the previous build has six tables with no
 * `server_updated_at` column and, quite possibly, unsent rows in its outbox.
 * Opening the database must add the column without disturbing any of that, and
 * the queued work must still go out.
 */
import { rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  check,
  equal,
  exitCode,
  purgeServer,
  requireServer,
  section,
  serverGet,
  summarize,
} from './harness.mjs';

const DB = process.env.VERIFY_DB_PATH;
for (const suffix of ['', '-wal', '-shm']) {
  rmSync(`${DB}${suffix}`, { force: true });
}

await requireServer();

const { USER_ID, BOOK_ID } = await import('../../src/config.ts');
const { SCHEMA_SQL } = await import('../../src/db/schema.ts');

section('Scenario C - a database written by the previous build');

// The old schema is this one minus the column the upgrade introduces.
const oldSchema = SCHEMA_SQL.split('\n')
  .filter((line) => !line.includes('server_updated_at'))
  .join('\n')
  .replace(/,(\s*\n\s*\);)/g, '$1');

const seed = new DatabaseSync(DB);
seed.exec(oldSchema);

const BOOKMARK_ID = 'legacy-bookmark';
const STAMP = '2026-01-01T00:00:00.000Z';
seed
  .prepare(
    `INSERT INTO bookmarks
       (id, user_id, book_id, chapter_id, locator, name, created_at, updated_at, is_deleted, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
  )
  .run(
    BOOKMARK_ID,
    USER_ID,
    BOOK_ID,
    'page-3',
    JSON.stringify({ type: 'pdf', page: 3, offset: 0 }),
    'Written before the upgrade',
    STAMP,
    STAMP,
  );
seed
  .prepare(
    `INSERT INTO outbox
       (id, user_id, entity_type, entity_id, operation, payload, created_at, updated_at, status, retry_count)
     VALUES (?, ?, 'bookmarks', ?, 'CREATE', ?, ?, ?, 'PENDING', 0)`,
  )
  .run(
    'legacy-outbox',
    USER_ID,
    BOOKMARK_ID,
    JSON.stringify({
      id: BOOKMARK_ID,
      userId: USER_ID,
      bookId: BOOK_ID,
      chapterId: 'page-3',
      locator: { type: 'pdf', page: 3, offset: 0 },
      name: 'Written before the upgrade',
      createdAt: STAMP,
      updatedAt: STAMP,
      isDeleted: false,
    }),
    STAMP,
    STAMP,
  );

const columnsBefore = seed
  .prepare(`PRAGMA table_info(bookmarks)`)
  .all()
  .map((column) => column.name);
check('the seeded database has no server_updated_at', !columnsBefore.includes('server_updated_at'));
seed.close();

// Now open it the way the app does.
await purgeServer(USER_ID);
const { getDatabase } = await import('../../src/db/database.ts');
const { bookmarkRepository } = await import('../../src/repositories/bookmarkRepository.ts');
const { outboxRepository } = await import('../../src/repositories/outboxRepository.ts');
const { syncManager } = await import('../../src/sync/syncManager.ts');

const db = await getDatabase();

const columnsAfter = (await db.getAllAsync(`PRAGMA table_info(bookmarks)`)).map(
  (column) => column.name,
);
check('opening the database adds the column', columnsAfter.includes('server_updated_at'));

const migrated = await bookmarkRepository.findById(BOOKMARK_ID);
check('the existing row is still there', Boolean(migrated));
equal('with its name intact', migrated.name, 'Written before the upgrade');
equal('and its timestamp untouched', migrated.updated_at, STAMP);
equal('the base version starts out unknown', migrated.server_updated_at, null);
equal('the queued operation survived', (await outboxRepository.listPending()).length, 1);

const report = await syncManager.run();
console.log(`  report: ${JSON.stringify(report)}`);
equal('the pre-upgrade change is pushed, not mistaken for a conflict', report.pushed, 1);
equal('no conflicts', report.conflicts, 0);
check('the server received it', Boolean(await serverGet('bookmarks', BOOKMARK_ID)));

const settled = await bookmarkRepository.findById(BOOKMARK_ID);
equal('and the base version is now filled in', settled.server_updated_at, settled.updated_at);
equal('outbox drained', (await outboxRepository.listPending()).length, 0);

await purgeServer(USER_ID);
summarize('SCENARIO C');
process.exit(exitCode());
