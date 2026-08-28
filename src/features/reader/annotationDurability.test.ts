// Owner: Reader (Ahana). PINS A DEFECT THAT IS NOT READER'S TO FIX.
//
// WHY THIS FILE IS IN reader/ AND NOT personalization/: it does not test Reader code. It tests the
// guarantee Reader's six highlight/bookmark call-sites depend on and cannot themselves provide —
// that saving an annotation persists it SOMEWHERE. ReaderScreen can catch a rejection and say so
// (it now does; see `alertAnnotationWriteFailed` there and the containment tests in
// ReaderScreen.test.tsx), but it has no way to recover the edit. So the loss is Reader's problem
// and the fix is Personalization's, and this is the file that keeps the two facts attached.
//
// THE DEFECT, as of 2026-08-28 (dev_T4 `facc57d`, "Scope annotations by book"):
//
//   `annotationsRouter.ts` routes on `NetInfo.isConnected` — whether the device has a network
//   interface, NOT whether the backend answers. On a simulator that is always true. Its online
//   branch then POSTs to Mongo and returns WITHOUT touching SQLite or the outbox, deliberately:
//   keeping a non-downloaded book's rows out of the offline store is the router's entire purpose.
//   `syncApi.ts` throws `ApiError(status 0)` when the host refuses the connection.
//
//   Put together: device online, backend down — the routine state of a dev simulator with nothing
//   running on :8080 — and the write lands in no store at all. Not Mongo (the POST threw), not
//   SQLite (the online branch skipped it), not the outbox (nothing was enqueued).
//
// Before that commit this could not happen. `highlightStore.addFromCfi` went to
// `syncableTable.saveLocal`, which persists with `synced: 0` AND enqueues the outbox in one
// transaction, so the edit always survived locally and the sync engine pushed it on reconnect.
// That is the guarantee that went missing, and `isTransient` (syncApi.ts) is the signal a fix
// would key off — it already exists and already means exactly the right thing.
//
// HOW TO READ THE CASES BELOW: the plain `it`s assert the CURRENT, BROKEN behaviour, so they
// document it precisely rather than describing it in prose. The `it.failing` ones assert the
// behaviour a fix must produce; they fail today, which is what `.failing` expects. WHEN
// PERSONALIZATION LANDS THE FALLBACK, the `.failing` cases go red — that is the signal to delete
// the `.failing` marker and the now-wrong `it`s beside them, and this header with them.
//
// The mocks mirror annotationsRouter.test.ts's exactly (NetInfo, `api`, both stores) so the two
// files describe one seam the same way. The router and both facades are REAL here — mocking them
// would make this test assert its own fixture.

import NetInfo from '@react-native-community/netinfo';

import { addCurrentEpubBookmark, loadBookmarks } from '@/features/personalization/readerBookmarks';
import {
  addEpubHighlight,
  loadReaderHighlights,
  removeHighlight,
} from '@/features/personalization/readerHighlights';
import { bookmarkStore } from '@/features/sync/stores/bookmarkStore';
import { highlightStore } from '@/features/sync/stores/highlightStore';
import { USER_ID } from '@/features/sync/syncConfig';
import { ApiError, api } from '@/features/sync/syncApi';

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { fetch: jest.fn() },
}));

/**
 * `ApiError` is the REAL class, not a stub, for the same reason ReaderScreen.test.tsx keeps
 * `UnsupportedFormatError` real: `isTransient` is a getter on it, and the fix these cases describe
 * turns on that getter. A stubbed error would let a fallback keyed to `isTransient` look correct
 * here while never firing on a device.
 */
jest.mock('@/features/sync/syncApi', () => {
  const actual =
    jest.requireActual<typeof import('@/features/sync/syncApi')>('@/features/sync/syncApi');
  return {
    ApiError: actual.ApiError,
    api: {
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      findById: jest.fn(),
      list: jest.fn(),
    },
  };
});

jest.mock('@/features/sync/stores/highlightStore', () => ({
  ...jest.requireActual<typeof import('@/features/sync/stores/highlightStore')>(
    '@/features/sync/stores/highlightStore',
  ),
  highlightStore: {
    list: jest.fn().mockResolvedValue([]),
    addFromCfi: jest.fn().mockResolvedValue({}),
    addFromSelection: jest.fn().mockResolvedValue({}),
    remove: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('@/features/sync/stores/bookmarkStore', () => ({
  ...jest.requireActual<typeof import('@/features/sync/stores/bookmarkStore')>(
    '@/features/sync/stores/bookmarkStore',
  ),
  bookmarkStore: {
    list: jest.fn().mockResolvedValue([]),
    addForCfi: jest.fn().mockResolvedValue({}),
    addForPage: jest.fn().mockResolvedValue({}),
    remove: jest.fn().mockResolvedValue(undefined),
    rename: jest.fn().mockResolvedValue({}),
  },
}));

const netFetch = (NetInfo as unknown as { fetch: jest.Mock }).fetch;
const apiMock = api as unknown as Record<string, jest.Mock>;
const hlStore = highlightStore as unknown as Record<string, jest.Mock>;
const bmStore = bookmarkStore as unknown as Record<string, jest.Mock>;

const BOOK = 'book-under-test';
const START_CFI = 'epubcfi(/6/4[chap01]!/4/2/2/1:0)';
const END_CFI = 'epubcfi(/6/4[chap01]!/4/2/6/1:10)';

/** What `fetch` refusing a connection becomes by the time it reaches a facade. See syncApi.ts. */
const unreachable = () => new ApiError('/api/v1/highlights: Network request failed', 0);

beforeEach(() => {
  jest.clearAllMocks();
  // The state under test, and the DEFAULT state of a dev simulator: NetInfo reports a network
  // because the host Mac has one, and nothing is listening on :8080.
  netFetch.mockResolvedValue({ isConnected: true });
  for (const call of ['create', 'update', 'remove', 'findById', 'list']) {
    apiMock[call].mockRejectedValue(unreachable());
  }
});

describe('the signal a fix would key off already exists', () => {
  it('classifies an unreachable host as transient, and a rejected payload as not', () => {
    // Status 0 is the transport failure this whole file is about; 422 is the server saying no.
    // A fallback to the offline store is right for the first and wrong for the second, and
    // `ApiError` already tells them apart — no new plumbing is needed to fix this.
    expect(unreachable().isTransient).toBe(true);
    expect(new ApiError('422 on /highlights', 422).isTransient).toBe(false);
  });
});

describe('online but unreachable — highlights', () => {
  it('DEFECT: an add reaches no store at all, so the highlight is simply lost', async () => {
    await expect(addEpubHighlight(BOOK, START_CFI, END_CFI)).rejects.toBeInstanceOf(ApiError);

    // THIS is the data loss, and it is the assertion that matters most in this file. The POST
    // failed, and nothing fell back — so there is no local row, no outbox entry, and nothing for
    // the next sync to push. The user's highlight does not exist anywhere.
    expect(hlStore.addFromCfi).not.toHaveBeenCalled();
  });

  it('DEFECT: a load rejects instead of showing the local snapshot', async () => {
    await expect(loadReaderHighlights(BOOK)).rejects.toBeInstanceOf(ApiError);

    // Milder than the add — nothing is destroyed — but the book shows no highlights even for a
    // downloaded book whose rows are sitting in SQLite unread.
    expect(hlStore.list).not.toHaveBeenCalled();
  });

  it('DEFECT: a delete rejects, leaving the highlight the user asked to remove', async () => {
    await expect(removeHighlight(BOOK, 'h1')).rejects.toBeInstanceOf(ApiError);
    expect(hlStore.remove).not.toHaveBeenCalled();
  });

  it.failing(
    'a transient failure falls back to the offline store, so the add survives',
    async () => {
      // What a fix must produce: `isTransient` is true, so the router delegates to the store, which
      // persists with `synced: 0` and enqueues the outbox — exactly the pre-`facc57d` behaviour, and
      // exactly what makes Reader's call-site safe again. Fails today: the facade rejects.
      await expect(addEpubHighlight(BOOK, START_CFI, END_CFI)).resolves.toEqual(
        expect.objectContaining({ highlights: expect.anything() }),
      );
      expect(hlStore.addFromCfi).toHaveBeenCalledWith(START_CFI, END_CFI, undefined, BOOK, USER_ID);
    },
  );

  it.failing('a transient failure on load falls back to the local snapshot', async () => {
    await expect(loadReaderHighlights(BOOK)).resolves.toEqual(
      expect.objectContaining({ highlights: { epub: [], pdf: [] } }),
    );
    expect(hlStore.list).toHaveBeenCalled();
  });
});

describe('online but unreachable — bookmarks take the identical path', () => {
  // Not redundant with the highlights block: `facc57d` made the same swap in readerBookmarks.ts
  // (`bookmarkStore` + `pushNow()` -> `annotationsRouter`), so a fix applied to only one half would
  // leave this one broken. These fail together or pass together, deliberately.
  it('DEFECT: an add reaches no store at all', async () => {
    await expect(
      addCurrentEpubBookmark(BOOK, START_CFI, undefined, 'A label'),
    ).rejects.toBeInstanceOf(ApiError);
    expect(bmStore.addForCfi).not.toHaveBeenCalled();
  });

  it('DEFECT: a load rejects instead of showing the local snapshot', async () => {
    await expect(loadBookmarks(BOOK)).rejects.toBeInstanceOf(ApiError);
    expect(bmStore.list).not.toHaveBeenCalled();
  });

  it.failing(
    'a transient failure falls back to the offline store, so the add survives',
    async () => {
      await expect(
        addCurrentEpubBookmark(BOOK, START_CFI, undefined, 'A label'),
      ).resolves.toBeDefined();
      expect(bmStore.addForCfi).toHaveBeenCalled();
    },
  );
});

describe('the control: with no network at all, none of this happens', () => {
  // Proves the hole is specifically the online-but-unreachable state rather than anything about
  // the facades. NetInfo says offline, so the router never reaches `api`, the store takes the
  // write, and the outbox carries it — the behaviour every path had before `facc57d`.
  beforeEach(() => netFetch.mockResolvedValue({ isConnected: false }));

  it('an add is persisted locally and never touches the network', async () => {
    await expect(addEpubHighlight(BOOK, START_CFI, END_CFI)).resolves.toBeDefined();

    expect(hlStore.addFromCfi).toHaveBeenCalledWith(START_CFI, END_CFI, undefined, BOOK, USER_ID);
    expect(apiMock.create).not.toHaveBeenCalled();
  });

  it('a load reads the local snapshot', async () => {
    await expect(loadReaderHighlights(BOOK)).resolves.toEqual({
      highlights: { epub: [], pdf: [] },
      skippedIds: [],
    });
    expect(apiMock.list).not.toHaveBeenCalled();
  });
});
