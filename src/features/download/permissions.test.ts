import { checkStoragePermission } from './permissions';

describe('checkStoragePermission', () => {
  it('resolves true — app-private storage needs no runtime OS permission on iOS or Android', async () => {
    await expect(checkStoragePermission()).resolves.toBe(true);
  });
});
