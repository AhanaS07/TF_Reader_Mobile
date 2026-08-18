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

import App, { devFixtureOptions } from './App';

describe('toolchain', () => {
  // NOTE FOR EVERY COMPONENT TEST IN THIS REPO: `render` is ASYNC in
  // @testing-library/react-native v14 — it returns a Promise, not a
  // RenderResult. Forget the `await` and you get the baffling
  // "getByText is not a function", because you destructured a Promise.
  it('renders the app root', async () => {
    const { getByText } = await render(<App />);
    expect(getByText('TF Reader')).toBeTruthy();
  });

  it('resolves the @/ alias to a runtime value', () => {
    expect(ContentError.INTEGRITY_FAILED).toBeDefined();
  });
});

// ─── TEMP: REMOVE WITH THE FIXTURE PICKER IN App.tsx ────────────────────────
// Not a toolchain test, unlike the block above — this covers the temporary dev picker, and it goes
// when RootNavigator replaces it.
//
// THE PROPERTY: the picker must always offer whatever DEV_SAMPLE_BOOK_ID actually resolved to. With
// EXPO_PUBLIC_READER_FIXTURE_PATH set that is a fixture id matching neither bundled row, so the
// screen opens a book no option matches and one tap lands on a 3 KB stand-in with no way back short
// of a relaunch. That silently invalidates a whole-book measurement and looks like nothing happened,
// which is why it is worth a test rather than a comment.
describe('the temporary fixture picker', () => {
  it('offers exactly the two bundled fixtures when one of them is active', () => {
    expect(devFixtureOptions('dev-sample-epub')).toEqual([
      { label: 'EPUB', bookId: 'dev-sample-epub' },
      { label: 'PDF', bookId: 'dev-sample-pdf' },
    ]);
    expect(devFixtureOptions('dev-sample-pdf')).toHaveLength(2);
  });

  // Both fixture-path ids, because the PDF one is the whole reason the large-PDF measurement is
  // reachable at all — offering the EPUB one and not it would leave exactly that run exposed.
  it.each(['dev-fixture-epub', 'dev-fixture-pdf'])('also offers %s when it is active', (active) => {
    const options = devFixtureOptions(active);

    expect(options.map((option) => option.bookId)).toContain(active);
    // First, so it is the visibly selected one rather than a row below the fold.
    expect(options[0]).toEqual({ label: 'Fixture', bookId: active });
    // The bundled two stay reachable: switching to a stand-in is fine as a deliberate tap, and only
    // a problem when it is the only thing on offer.
    expect(options).toHaveLength(3);
  });

  it('never offers the same book twice, so a tap cannot be ambiguous', () => {
    for (const active of ['dev-sample-epub', 'dev-sample-pdf', 'dev-fixture-epub']) {
      const ids = devFixtureOptions(active).map((option) => option.bookId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
