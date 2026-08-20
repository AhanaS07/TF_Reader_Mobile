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
import { render } from '@testing-library/react-native';

import { ContentError } from '@/shared/contracts';

import App from './App';

// CatalogueScreen (the app's default route) now calls useNetworkStatus for
// real, which talks to NetInfo — a library with no meaningful behaviour under
// Jest. Mocked here for the same reason ItemDetailScreen.test.tsx mocks it:
// this is a toolchain smoke test, not a network-state test.
jest.mock('@hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => true,
}));

describe('toolchain', () => {
  // NOTE FOR EVERY COMPONENT TEST IN THIS REPO: `render` is ASYNC in
  // @testing-library/react-native v14 — it returns a Promise, not a
  // RenderResult. Forget the `await` and you get the baffling
  // "getByText is not a function", because you destructured a Promise.
  it('renders the app root', async () => {
    // App now mounts the full navigator. 'Taylor & Francis' is the title
    // rendered by TopAppBar on the Catalogue home screen — unique in the tree.
    const { getByText } = await render(<App />);
    expect(getByText('Taylor & Francis')).toBeTruthy();
  });

  it('resolves the @/ alias to a runtime value', () => {
    expect(ContentError.INTEGRITY_FAILED).toBeDefined();
  });
});
