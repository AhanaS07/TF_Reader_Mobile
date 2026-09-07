// src/features/personalization/prefsStore.test.ts
//
// One concern: migration. A device that persisted prefs before the accessibility
// contract's Sep 2026 rewrite (flat dyslexiaFont/highContrast/reduceMotion/
// screenReaderHints booleans, no text/display/announce nesting) must not hand
// AccessibilityScreen a `values.accessibility` with no `text` key — that's the
// exact TypeError this migration exists to prevent (AccessibilityScreen.tsx reads
// `prefs.accessibility.text.dyslexiaFont`).
//
// @storage/storage is mocked (not AsyncStorage directly), same seam
// institutionStore.test.ts mocks, so each test controls what getItem returns
// without touching the global AsyncStorage mock.
import { waitFor } from '@testing-library/react-native';
import { DEFAULT_PREFS } from '@/shared/contracts/prefs';
import { usePrefsStore } from './prefsStore';

const mockGetItem = jest.fn<Promise<string | null>, [string]>();

jest.mock('@storage/storage', () => ({
  __esModule: true,
  default: {
    getItem: (...args: [string]) => mockGetItem(...args),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  },
}));

afterEach(() => {
  usePrefsStore.setState({
    values: { ...DEFAULT_PREFS },
    updatedAt: 0,
    _hasHydrated: false,
  });
  mockGetItem.mockReset();
});

describe('prefsStore — migration', () => {
  it('resets accessibility to DEFAULT_PREFS when the stored shape is the old flat one', async () => {
    const legacyStored = {
      state: {
        values: {
          ...DEFAULT_PREFS,
          // The pre-rewrite shape: flat booleans, no text/display/announce/tts.
          accessibility: {
            dyslexiaFont: true,
            highContrast: true,
            reduceMotion: true,
            screenReaderHints: true,
          },
        },
        updatedAt: 12345,
      },
      // No version field — matches real on-disk data from before this fix,
      // since the store never set a `version` option. This is exactly why
      // the shape check lives in `merge` (always runs) and not `migrate`
      // (only runs when an explicit differing version number is stored).
    };
    mockGetItem.mockResolvedValue(JSON.stringify(legacyStored));

    usePrefsStore.persist.rehydrate();

    await waitFor(() => expect(usePrefsStore.getState()._hasHydrated).toBe(true));
    expect(usePrefsStore.getState().values.accessibility).toEqual(DEFAULT_PREFS.accessibility);
    // Non-accessibility fields survive the migration untouched.
    expect(usePrefsStore.getState().values.font).toEqual(DEFAULT_PREFS.font);
    expect(usePrefsStore.getState().values.theme).toEqual(DEFAULT_PREFS.theme);
  });

  it('resets accessibility to DEFAULT_PREFS when the stored value is null, without discarding other fields', async () => {
    const corruptStored = {
      state: {
        values: {
          ...DEFAULT_PREFS,
          accessibility: null,
        },
        updatedAt: 54321,
      },
    };
    mockGetItem.mockResolvedValue(JSON.stringify(corruptStored));

    usePrefsStore.persist.rehydrate();

    await waitFor(() => expect(usePrefsStore.getState()._hasHydrated).toBe(true));
    expect(usePrefsStore.getState().values.accessibility).toEqual(DEFAULT_PREFS.accessibility);
    expect(usePrefsStore.getState().values.font).toEqual(DEFAULT_PREFS.font);
    expect(usePrefsStore.getState().values.theme).toEqual(DEFAULT_PREFS.theme);
  });

  it('leaves an already-correct nested accessibility shape untouched', async () => {
    const currentStored = {
      state: {
        values: {
          ...DEFAULT_PREFS,
          accessibility: {
            ...DEFAULT_PREFS.accessibility,
            text: { ...DEFAULT_PREFS.accessibility.text, dyslexiaFont: true },
          },
        },
        updatedAt: 99999,
      },
    };
    mockGetItem.mockResolvedValue(JSON.stringify(currentStored));

    usePrefsStore.persist.rehydrate();

    await waitFor(() => expect(usePrefsStore.getState()._hasHydrated).toBe(true));
    expect(usePrefsStore.getState().values.accessibility.text.dyslexiaFont).toBe(true);
  });
});
