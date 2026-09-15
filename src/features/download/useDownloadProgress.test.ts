// Owner: Download (Abhinav).
//
// `downloadBook` is mocked — this hook's job is the state machine around its onProgress
// callback/resolution/rejection, not the download itself (that's downloadManager.test.ts's job).
// Every `act` is awaited, same reason as useTtsSession.test.ts: this RNTL version's `act()`
// always returns a thenable, and an un-awaited call reads stale state on the next assertion.

import { act, renderHook } from '@testing-library/react-native';

import { downloadBook } from './downloadManager';
import { DownloadError, DownloadFailure } from './errors';
import { useDownloadProgress } from './useDownloadProgress';

jest.mock('./downloadManager', () => ({
  downloadBook: jest.fn(),
}));

const downloadBookMock = downloadBook as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useDownloadProgress', () => {
  it('starts idle', async () => {
    const { result } = await renderHook(() => useDownloadProgress());
    expect(result.current.status).toBe('idle');
    expect(result.current.bytesReceived).toBe(0);
    expect(result.current.expectedLength).toBeNull();
    expect(result.current.errorMessage).toBeNull();
  });

  it('moves to downloading immediately, then tracks onProgress calls through to completion', async () => {
    let capturedOnProgress: ((bytesReceived: number, expectedLength: number) => void) | undefined;
    downloadBookMock.mockImplementation((_bookId, _format, options) => {
      capturedOnProgress = options?.onProgress;
      return new Promise<void>(() => undefined); // never resolves within this test
    });

    const { result } = await renderHook(() => useDownloadProgress());

    await act(() => result.current.start('book-1', 'EPUB'));
    expect(result.current.status).toBe('downloading');
    expect(downloadBookMock).toHaveBeenCalledWith('book-1', 'EPUB', { onProgress: expect.any(Function) });

    await act(() => capturedOnProgress?.(1024, 4096));
    expect(result.current.bytesReceived).toBe(1024);
    expect(result.current.expectedLength).toBe(4096);

    await act(() => capturedOnProgress?.(4096, 4096));
    expect(result.current.bytesReceived).toBe(4096);
  });

  it('reaches completed once downloadBook resolves', async () => {
    let resolveDownload: () => void = () => undefined;
    downloadBookMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveDownload = resolve;
        }),
    );

    const { result } = await renderHook(() => useDownloadProgress());
    await act(() => result.current.start('book-1'));

    await act(() => resolveDownload());
    expect(result.current.status).toBe('completed');
  });

  it('surfaces a DownloadFailure code as errorMessage and sets status to error', async () => {
    let rejectDownload: (cause: unknown) => void = () => undefined;
    downloadBookMock.mockImplementation(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectDownload = reject;
        }),
    );

    const { result } = await renderHook(() => useDownloadProgress());
    await act(() => result.current.start('book-1'));

    await act(() => rejectDownload(new DownloadFailure(DownloadError.ASSET_FETCH_FAILED, 'book-1')));

    expect(result.current.status).toBe('error');
    expect(result.current.errorMessage).toContain(DownloadError.ASSET_FETCH_FAILED);
  });

  it('a second start() supersedes the first — the first call landing late does not clobber state', async () => {
    let capturedFirstOnProgress: ((bytesReceived: number, expectedLength: number) => void) | undefined;
    let resolveFirst: () => void = () => undefined;
    let capturedSecondOnProgress: ((bytesReceived: number, expectedLength: number) => void) | undefined;

    downloadBookMock
      .mockImplementationOnce((_bookId, _format, options) => {
        capturedFirstOnProgress = options?.onProgress;
        return new Promise<void>((resolve) => {
          resolveFirst = resolve;
        });
      })
      .mockImplementationOnce((_bookId, _format, options) => {
        capturedSecondOnProgress = options?.onProgress;
        return new Promise<void>(() => undefined);
      });

    const { result } = await renderHook(() => useDownloadProgress());
    await act(() => result.current.start('book-1'));
    await act(() => result.current.start('book-2'));

    await act(() => capturedSecondOnProgress?.(10, 100));
    expect(result.current.bytesReceived).toBe(10);

    // The first call's progress/resolution landing after the second started must be ignored.
    await act(() => capturedFirstOnProgress?.(999, 999));
    await act(() => resolveFirst());
    expect(result.current.bytesReceived).toBe(10);
    expect(result.current.status).toBe('downloading');
  });

  it('does not update state after unmount', async () => {
    let capturedOnProgress: ((bytesReceived: number, expectedLength: number) => void) | undefined;
    downloadBookMock.mockImplementation((_bookId, _format, options) => {
      capturedOnProgress = options?.onProgress;
      return new Promise<void>(() => undefined);
    });

    const errorSpy = jest.spyOn(console, 'error');
    const { result, unmount } = await renderHook(() => useDownloadProgress());
    await act(() => result.current.start('book-1'));

    unmount();
    capturedOnProgress?.(10, 100);
    await Promise.resolve();

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
