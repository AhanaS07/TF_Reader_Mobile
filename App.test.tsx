// App.test.tsx — the toolchain smoke test.
//
// This is NOT a feature test. It exists to fail loudly if the P0-1 toolchain
// regresses, and it deliberately exercises the three things most likely to
// break silently:
//
//   1. jest-expo transforms .tsx at all (preset + babel wiring)
//   2. React Native components render under @testing-library/react-native
//   3. the `@/` alias resolves AT RUNTIME, not just in tsc
//
// (3) is the one worth the extra import. tsconfig `paths` and the babel
// module-resolver map are two halves of the same alias and nothing forces them
// to agree — the classic failure is code that typechecks green in the editor
// and then throws "Unable to resolve module" the moment it executes. Importing
// a real runtime value (ContentError is an enum, so it survives erasure) proves
// the babel half is wired. A `import type` here would prove nothing.
import { render, waitFor } from '@testing-library/react-native';

import { ContentError } from '@/shared/contracts';

import App from './App';

// CatalogueScreen (the app's default route) now calls useNetworkStatus for
// real, which talks to NetInfo — a library with no meaningful behaviour under
// Jest. Mocked here for the same reason ItemDetailScreen.test.tsx mocks it:
// this is a toolchain smoke test, not a network-state test.
jest.mock('@hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => true,
}));

// App now also mounts useAutoSync (sync), which reads NetInfo through useConnectivity.
// Real NetInfo has no JS-only implementation for Jest to fall back on - same mock
// as useConnectivity.test.ts.
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn(() => jest.fn()),
    fetch: jest.fn().mockResolvedValue({ isConnected: false }),
  },
}));

// RootNavigator statically imports every route, including ReaderRouteScreen -> ReaderScreen ->
// TtsControls/useTtsSession -> ttsEngine.ts's `import Tts from '@iternio/react-native-tts'` — a
// real native module. That import runs at REQUIRE time regardless of which route is actually on
// screen (native-stack lazily RENDERS screens, but the module graph is resolved eagerly). Same mock
// as useTtsSession.test.ts, so this toolchain smoke test doesn't have to transform the real native
// module.
jest.mock('@/features/accessibility/tts/ttsEngine', () => ({
  __esModule: true,
  default: {
    addListener: jest.fn(() => ({ remove: jest.fn() })),
    speak: jest.fn(() => Promise.resolve('utterance-1')),
    stop: jest.fn(() => Promise.resolve(true)),
    pause: jest.fn(() => Promise.resolve(true)),
    resume: jest.fn(() => Promise.resolve(true)),
    setDefaultRate: jest.fn(() => Promise.resolve(true)),
    setDefaultPitch: jest.fn(() => Promise.resolve(true)),
    setDefaultVoice: jest.fn(() => Promise.resolve(true)),
    setIgnoreSilentSwitch: jest.fn(() => Promise.resolve(true)),
    voices: jest.fn(() => Promise.resolve([])),
  },
}));

describe('toolchain', () => {
  // NOTE FOR EVERY COMPONENT TEST IN THIS REPO: `render` is ASYNC in
  // @testing-library/react-native v14 — it returns a Promise, not a
  // RenderResult. Forget the `await` and you get the baffling
  // "getByText is not a function", because you destructured a Promise.
  it('renders the app root', async () => {
    // App now mounts the full navigator. 'Nexus' is the boot splash's own
    // wordmark, present in the tree from first render regardless of animation
    // state — this is a toolchain smoke test, not a wait for the splash to
    // exit (that takes 3.5+ seconds; see BootSplash's MIN_VISIBLE_MS). waitFor
    // is kept anyway because bootstrapAuth() (an async secure-storage read)
    // still needs to settle before the very first render is stable.
    const { getAllByText } = await render(<App />);
    await waitFor(() => expect(getAllByText('Nexus').length).toBeGreaterThan(0));
  });

  it('resolves the @/ alias to a runtime value', () => {
    expect(ContentError.INTEGRITY_FAILED).toBeDefined();
  });
});
