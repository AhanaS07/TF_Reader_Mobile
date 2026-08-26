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
//
// The old "temporary fixture picker" and "TTS Demo tab" describe blocks that used to live here
// covered App.tsx's own state-swapped picker, which RootNavigator has replaced — see
// src/navigation/BookListScreen.test.tsx for the equivalent coverage of the real routes.
import { render } from '@testing-library/react-native';

import { ContentError } from '@/shared/contracts';

import App from './App';

// App now mounts useAutoSync (sync), which reads NetInfo through useConnectivity.
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
// module. Still required after the TTS Demo route's removal — the reader itself pulls it in now.
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
    // NOT 'TF Reader': that text now lives only in native-stack's header CONFIG
    // (`RNSScreenStackHeaderConfig title="TF Reader"`), which RNTL cannot query as text — it is a
    // prop on a native config component, not a rendered <Text>. 'Audiobook (Encrypted)' is
    // BookListScreen's own row content, unique among its rows (see BookListScreen.test.tsx), so it
    // proves the navigator actually mounted and rendered its initial route. It replaced 'TTS Demo'
    // when that row and its route were deleted.
    const { getByText } = await render(<App />);
    expect(getByText('Audiobook (Encrypted)')).toBeTruthy();
  });

  it('resolves the @/ alias to a runtime value', () => {
    expect(ContentError.INTEGRITY_FAILED).toBeDefined();
  });
});
