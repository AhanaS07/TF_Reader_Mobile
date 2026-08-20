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
// THE PROPERTY: the picker must always offer whatever DEV_SAMPLE_BOOK_ID actually resolved to. If it
// does not, the screen opens a book no option matches, nothing renders as selected, and one tap
// lands on a 3 KB stand-in with no way back short of a relaunch. That silently invalidates a
// whole-book measurement and looks like nothing happened, which is why it is worth a test rather
// than a comment.
const BUNDLED = ['dev-sample-epub', 'dev-sample-pdf'];
const LARGE = ['dev-fixture-epub', 'dev-fixture-pdf'];

describe('the temporary fixture picker', () => {
  it('offers all four fixtures — both bundled stand-ins and both large books', () => {
    expect(devFixtureOptions('dev-sample-epub')).toEqual([
      { label: 'EPUB', bookId: 'dev-sample-epub', format: 'EPUB' },
      { label: 'PDF', bookId: 'dev-sample-pdf', format: 'PDF' },
      { label: 'Big EPUB', bookId: 'dev-fixture-epub', format: 'EPUB' },
      { label: 'Big PDF', bookId: 'dev-fixture-pdf', format: 'PDF' },
    ]);
  });

  // The large two are offered whether or not a file was pushed for them. That is the point of the
  // change: a tab that appears only once an env var is set cannot be told apart from a feature that
  // was never built, and these are the books features get rolled out against. An unpopulated tap
  // raises an error naming the variable to set — it does not silently fall back to a stand-in.
  it.each([...BUNDLED, ...LARGE])('offers %s regardless of which book is active', (active) => {
    for (const other of [...BUNDLED, ...LARGE]) {
      expect(devFixtureOptions(other).map((option) => option.bookId)).toContain(active);
    }
  });

  // The guarantee that survives whatever the id ladder resolves to, including ids this file does
  // not know about — the fallback row exists for exactly this.
  it.each([...BUNDLED, ...LARGE, 'dev-something-nobody-has-added-yet'])(
    'always offers the active book %s',
    (active) => {
      expect(devFixtureOptions(active).map((option) => option.bookId)).toContain(active);
    },
  );

  it('puts an unrecognised active book first, so it is the visibly selected one', () => {
    const options = devFixtureOptions('dev-something-nobody-has-added-yet');

    expect(options[0]).toEqual({
      label: 'Fixture',
      bookId: 'dev-something-nobody-has-added-yet',
      format: 'EPUB',
    });
    // The four stay reachable: switching to a stand-in is fine as a deliberate tap, and only a
    // problem when it is the only thing on offer.
    expect(options).toHaveLength(5);
  });

  it('never offers the same book twice, so a tap cannot be ambiguous', () => {
    for (const active of [...BUNDLED, ...LARGE, 'dev-unknown']) {
      const ids = devFixtureOptions(active).map((option) => option.bookId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
