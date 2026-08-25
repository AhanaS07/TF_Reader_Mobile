// Both gateways must resolve/verify "the record" the same way - accessibilityId(userId) - so a
// caller can swap the offline (SQLite) and online (Mongo) implementations without them meaning
// different things by `userId`. This does not re-test field-level merge (syncableTable.test.ts /
// personalizationStore.fieldMerge.test.ts already cover that); these gateways add no merge logic
// of their own, only two explicit paths to storage that already exists.

import { getDatabase } from '@/features/sync/localDb/database';
import { accessibilityId } from '@/features/sync/stores/accessibilityStore';
import { ApiError, api } from '@/features/sync/syncApi';
import { USER_ID } from '@/features/sync/syncConfig';

import { mongoAccessibilityGateway, sqliteAccessibilityGateway } from './accessibilityGateway';

jest.mock('@/features/sync/syncApi', () => {
  const actual = jest.requireActual('@/features/sync/syncApi');
  return {
    __esModule: true,
    ApiError: actual.ApiError,
    api: {
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      findById: jest.fn(),
      list: jest.fn(),
      health: jest.fn(),
    },
  };
});

const mockApi = api as jest.Mocked<typeof api>;
const OTHER_USER = 'not-the-configured-user';
const SERVER_TIME = '2026-08-24T10:00:00.000Z';
const ok = <T>(data: T) => Promise.resolve({ data, serverTime: SERVER_TIME });

function serverRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: accessibilityId(USER_ID),
    userId: USER_ID,
    dyslexiaFont: false,
    respectOsFontScale: true,
    boldText: false,
    reduceMotion: 'system',
    ttsEnabled: false,
    ttsVoiceId: null,
    ttsRate: 1.0,
    ttsPitch: 1.0,
    ttsHighlightMode: 'sentence',
    ttsAutoContinueChapter: true,
    ttsBackgroundPlayback: false,
    fontScaleMultiplier: 1.0,
    readableSpacing: false,
    highContrast: false,
    largeTouchTargets: false,
    largeAudioControls: false,
    announcePageChanges: true,
    announceChapterChanges: true,
    screenReaderHints: false,
    updatedAt: '2026-08-24T09:00:00.000Z',
    isDeleted: false,
    fieldUpdatedAt: {},
    ...overrides,
  };
}

async function resetTable(): Promise<void> {
  const db = await getDatabase();
  await db.execAsync(`DELETE FROM accessibility; DELETE FROM outbox;`);
}

beforeEach(() => {
  jest.clearAllMocks();
  return resetTable();
});

describe('sqliteAccessibilityGateway', () => {
  it('read() resolves via accessibilityId(userId), not just whatever is on device', async () => {
    expect(await sqliteAccessibilityGateway.read(USER_ID)).toBeNull();

    await sqliteAccessibilityGateway.write(USER_ID, { tts_rate: 1.5 });

    const row = await sqliteAccessibilityGateway.read(USER_ID);
    expect(row?.id).toBe(accessibilityId(USER_ID));
    expect(row?.tts_rate).toBe(1.5);
  });

  it('write() persists a patch through accessibilityStore.update()', async () => {
    const row = await sqliteAccessibilityGateway.write(USER_ID, { tts_enabled: 1 });
    expect(row.tts_enabled).toBe(1);
    expect(row.user_id).toBe(USER_ID);
  });

  it('write() throws when the written row does not belong to the given userId', async () => {
    // accessibilityStore.update() always resolves the device's own row (USER_ID from
    // syncConfig) - a caller asking for a different userId must not silently succeed.
    await expect(sqliteAccessibilityGateway.write(OTHER_USER, { tts_enabled: 1 })).rejects.toThrow(
      /does not match requested userId/,
    );
  });

  it('remove() resolves the singleton id from userId before soft-deleting', async () => {
    await sqliteAccessibilityGateway.write(USER_ID, { tts_enabled: 1 });

    await sqliteAccessibilityGateway.remove(USER_ID);

    const row = await sqliteAccessibilityGateway.read(USER_ID);
    expect(row?.is_deleted).toBe(1);
  });
});

describe('mongoAccessibilityGateway', () => {
  it('read() calls findById with the same accessibilityId(userId) SQLite uses, and maps the wire shape back to a row', async () => {
    mockApi.findById.mockReturnValueOnce(ok(serverRecord({ ttsRate: 2.0 })));

    const row = await mongoAccessibilityGateway.read(USER_ID);

    expect(mockApi.findById).toHaveBeenCalledWith('accessibility', accessibilityId(USER_ID));
    expect(row?.tts_rate).toBe(2.0);
    expect(row?.id).toBe(accessibilityId(USER_ID));
  });

  it('read() returns null on a 404 rather than throwing', async () => {
    mockApi.findById.mockReturnValueOnce(Promise.reject(new ApiError('not found', 404)));

    expect(await mongoAccessibilityGateway.read(USER_ID)).toBeNull();
  });

  it('read() rethrows a non-404 ApiError', async () => {
    mockApi.findById.mockReturnValueOnce(Promise.reject(new ApiError('server exploded', 500)));

    await expect(mongoAccessibilityGateway.read(USER_ID)).rejects.toThrow('server exploded');
  });

  it('write() creates when no record exists yet', async () => {
    mockApi.findById.mockReturnValueOnce(Promise.reject(new ApiError('not found', 404)));
    mockApi.create.mockReturnValueOnce(ok(serverRecord({ ttsRate: 1.2 })));

    const row = await mongoAccessibilityGateway.write(USER_ID, { tts_rate: 1.2 });

    expect(mockApi.create).toHaveBeenCalledWith('accessibility', expect.objectContaining({ ttsRate: 1.2 }));
    expect(mockApi.update).not.toHaveBeenCalled();
    expect(row.tts_rate).toBe(1.2);
  });

  it('write() updates by id when a record already exists', async () => {
    mockApi.findById.mockReturnValueOnce(ok(serverRecord()));
    mockApi.update.mockReturnValueOnce(ok(serverRecord({ ttsRate: 1.8 })));

    const row = await mongoAccessibilityGateway.write(USER_ID, { tts_rate: 1.8 });

    expect(mockApi.update).toHaveBeenCalledWith(
      'accessibility',
      accessibilityId(USER_ID),
      expect.objectContaining({ ttsRate: 1.8 }),
    );
    expect(mockApi.create).not.toHaveBeenCalled();
    expect(row.tts_rate).toBe(1.8);
  });

  it('remove() calls DELETE against accessibilityId(userId)', async () => {
    mockApi.remove.mockReturnValueOnce(ok(serverRecord({ isDeleted: true })));

    await mongoAccessibilityGateway.remove(USER_ID);

    expect(mockApi.remove).toHaveBeenCalledWith('accessibility', accessibilityId(USER_ID));
  });
});
