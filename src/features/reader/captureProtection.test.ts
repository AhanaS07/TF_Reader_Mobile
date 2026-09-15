import {
  READER_CAPTURE_KEY,
  allowScreenCaptureAsync,
  isScreenCaptureAvailable,
  isScreenCaptureAvailableAsync,
  preventScreenCaptureAsync,
} from './captureProtection';

describe('captureProtection', () => {
  it('exports the shared READER_CAPTURE_KEY constant', () => {
    expect(READER_CAPTURE_KEY).toBe('reader-content');
  });

  it('reports module availability correctly under Jest mock', async () => {
    expect(isScreenCaptureAvailable()).toBe(true);
    expect(await isScreenCaptureAvailableAsync()).toBe(true);
  });

  it('calls preventScreenCaptureAsync and allowScreenCaptureAsync without throwing', async () => {
    await expect(preventScreenCaptureAsync()).resolves.toBeUndefined();
    await expect(allowScreenCaptureAsync()).resolves.toBeUndefined();
  });

  it('accepts a custom key parameter', async () => {
    await expect(preventScreenCaptureAsync('custom-key')).resolves.toBeUndefined();
    await expect(allowScreenCaptureAsync('custom-key')).resolves.toBeUndefined();
  });
});
