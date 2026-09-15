// Owner: Reader (Ahana).
//
// ONE constant, imported by every caller of `preventScreenCaptureAsync`/`allowScreenCaptureAsync`
// — this file exists to make that true rather than merely intended.
//
// WHY A SHARED KEY, NOT ONE PER SURFACE. `preventScreenCaptureAsync(key)` calls the native
// `preventScreenCapture()` once per NEW key (`expo-screen-capture`'s `ScreenCapture.ts`), and the
// native iOS side has no idempotency guard: `preventScreenshots()` unconditionally overwrites both
// `originalParent` and `protectionTextField` (`ScreenCaptureModule.swift`). A second call while the
// first is still active captures `originalParent` as the FIRST text field's own sublayer — so the
// later `allowScreenshots()` restores the app's window layer into an orphaned layer tree, and the
// first text field leaks unremovably. That is reachable here: `useFocusEffect` blur/focus ordering
// across a Reader -> Audio transition is not guaranteed to be blur-then-focus, so two surfaces
// briefly holding DISTINCT keys is enough to trigger it, and it can black-screen the app.
//
// One shared key is the safe configuration instead: the library's own JS-side `activeTags` `Set`
// dedupes a shared key to a single native call, which is what actually stops Reader and Audio from
// un-preventing each other (whichever surface calls `allowScreenCaptureAsync` while the other still
// holds the key leaves it active; only the LAST caller's `allow` clears it). See CLAUDE.md's
// "screenshot restriction" section (once written) and the Week-4 plan's B3 finding for the full
// account. This constant must land, and be the only one imported anywhere in this feature, BEFORE
// any caller touches `preventScreenCaptureAsync` — including the device spike itself.
export const READER_CAPTURE_KEY = 'reader-content';

type ScreenCaptureModule = typeof import('expo-screen-capture');

let cachedModule: ScreenCaptureModule | null | undefined = undefined;

function getScreenCapture(): ScreenCaptureModule | null {
  if (cachedModule !== undefined) {
    return cachedModule;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedModule = require('expo-screen-capture') as ScreenCaptureModule;
  } catch {
    // Thrown if the ExpoScreenCapture native module is not linked in the current binary
    // (e.g. running in Expo Go or in a development build before re-running expo run:ios/android).
    cachedModule = null;
  }
  return cachedModule;
}

/**
 * Returns synchronously whether the ExpoScreenCapture native module was successfully loaded.
 */
export function isScreenCaptureAvailable(): boolean {
  return getScreenCapture() !== null;
}

/**
 * Returns whether the Screen Capture API is available on the current device.
 */
export async function isScreenCaptureAvailableAsync(): Promise<boolean> {
  const mod = getScreenCapture();
  if (!mod) {
    return false;
  }
  try {
    return await mod.isAvailableAsync();
  } catch {
    return false;
  }
}

/**
 * Prevents screen capture using the shared READER_CAPTURE_KEY by default.
 * If the ExpoScreenCapture native module is not linked into the current binary,
 * logs a warning instead of throwing an unhandled runtime error.
 */
export async function preventScreenCaptureAsync(key: string = READER_CAPTURE_KEY): Promise<void> {
  const mod = getScreenCapture();
  if (!mod) {
    console.warn(
      `[captureProtection] Native module 'ExpoScreenCapture' is not available in this binary. ` +
        `Skipping preventScreenCaptureAsync("${key}"). Rebuild the app with 'npx expo run:ios' or 'npx expo run:android'.`
    );
    return;
  }
  await mod.preventScreenCaptureAsync(key);
}

/**
 * Re-allows screen capture using the shared READER_CAPTURE_KEY by default.
 * If the ExpoScreenCapture native module is not linked into the current binary,
 * logs a warning instead of throwing an unhandled runtime error.
 */
export async function allowScreenCaptureAsync(key: string = READER_CAPTURE_KEY): Promise<void> {
  const mod = getScreenCapture();
  if (!mod) {
    console.warn(
      `[captureProtection] Native module 'ExpoScreenCapture' is not available in this binary. ` +
        `Skipping allowScreenCaptureAsync("${key}"). Rebuild the app with 'npx expo run:ios' or 'npx expo run:android'.`
    );
    return;
  }
  await mod.allowScreenCaptureAsync(key);
}
