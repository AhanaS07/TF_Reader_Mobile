import { Paths } from 'expo-file-system';
import { checkAvailableStorage, MIN_FREE_BYTES } from './storageCheck';

function setAvailableDiskSpace(bytes: number): void {
  Object.defineProperty(Paths, 'availableDiskSpace', { get: () => bytes, configurable: true });
}

describe('checkAvailableStorage', () => {
  afterEach(() => {
    setAvailableDiskSpace(10 * 1024 * 1024 * 1024); // restore the mock's default
  });

  it('returns true when free space is at or above the default floor', () => {
    setAvailableDiskSpace(MIN_FREE_BYTES);
    expect(checkAvailableStorage()).toBe(true);
  });

  it('returns false when free space is below the default floor', () => {
    setAvailableDiskSpace(MIN_FREE_BYTES - 1);
    expect(checkAvailableStorage()).toBe(false);
  });

  it('respects a caller-supplied threshold override instead of the default', () => {
    setAvailableDiskSpace(500);
    expect(checkAvailableStorage(100)).toBe(true);
    expect(checkAvailableStorage(1000)).toBe(false);
  });
});
