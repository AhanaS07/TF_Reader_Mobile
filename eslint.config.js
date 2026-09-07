// eslint.config.js — flat config (ESLint 9).
//
// Base is the official Expo config (`eslint-config-expo/flat`). It already
// bundles @typescript-eslint (parser + plugin), eslint-plugin-react,
// react-hooks, import and expo, so those are NOT separate top-level deps —
// adding them again would risk a duplicate-version mismatch.
//
// PINNED TO ESLINT 9 ON PURPOSE. eslint-config-expo@57 crashes on ESLint 10:
// its bundled eslint-plugin-react calls a removed API and dies with
// "contextOrFilename.getFilename is not a function". Do not bump to 10 until
// eslint-config-expo supports it.
//
// The Expo config's `files` patterns already cover .js/.jsx/.ts/.tsx, which is
// why the lint script has no --ext flag.
//
// Rule set is deliberately the Expo defaults — correctness-focused, no extra
// strictness layered on. src/shared/ (frozen Week-1 contracts) lints clean with
// ZERO relaxations; if a future rule would force an edit to a frozen contract,
// relax the rule here rather than editing the contract.
//
// Type-aware linting is OFF BY DEFAULT and ON for src/features/reader/ — see the
// scoped block at the bottom of this file for why it is scoped rather than global.
const expoFlat = require('eslint-config-expo/flat');

module.exports = [
  { ignores: ['node_modules/**', 'eslint.config.js'] },

  ...expoFlat,

  {
    settings: {
      // React is a real dependency now (P0-1 landed), so 'detect' reads the
      // installed version instead of the fabricated pin this used to carry.
      react: { version: 'detect' },

      // Required for the `@/*` alias (tsconfig paths) to resolve. Without this
      // AND a top-level eslint-import-resolver-typescript, eslint-plugin-import
      // falls back to loading the `typescript` compiler as a resolver and
      // reports "invalid interface loaded as resolver".
      'import/resolver': { typescript: { project: './tsconfig.json' } },
    },
  },

  // Jest globals. The Expo base config targets app code, so `describe`, `it`,
  // `expect` and `jest` are undeclared there and trip no-undef. Scoped to test
  // files and the setup file rather than declared globally, so a stray
  // `describe` in src/ is still caught as the mistake it is.
  {
    files: ['**/*.test.{js,jsx,ts,tsx}', '**/__tests__/**', 'jest.setup.js'],
    languageOptions: {
      globals: {
        afterAll: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        beforeEach: 'readonly',
        describe: 'readonly',
        expect: 'readonly',
        it: 'readonly',
        jest: 'readonly',
        test: 'readonly',
      },
    },
  },

  // mock-backend/ is a separate, throwaway Node/Express project (gitignored, never
  // pushed — see .gitignore and BuildPlan.md), not React Native/Expo app code.
  // __mocks__/ (Jest manual mocks for node_modules packages, e.g.
  // react-native-aes-gcm-crypto) also runs under Jest's Node test environment, not
  // the RN runtime — same category. Same pattern as the Jest-globals block above:
  // scoped Node CommonJS globals for these directories, rather than the Expo base
  // config's browser/RN globals, and rather than ignoring them outright — plain-JS
  // bugs (typos, unused vars) are still worth catching, just not under RN's global set.
  {
    files: ['mock-backend/**/*.js', '__mocks__/**/*.js'],
    languageOptions: {
      globals: {
        __dirname: 'readonly',
        __filename: 'readonly',
        Buffer: 'readonly',
        console: 'readonly',
        exports: 'writable',
        module: 'readonly',
        process: 'readonly',
        require: 'readonly',
      },
    },
  },

  // ─── TYPE-AWARE LINTING, SCOPED TO READER ───────────────────────────────────
  //
  // These rules need type information, which needs a TS program, which is why
  // they cannot be turned on by a rule entry alone: `projectService` below is
  // what makes them possible, and it is the slow part.
  //
  // SCOPED ON PURPOSE, and the scope is an ownership boundary, not a technical
  // one. Enabling this repo-wide would hand encryption, sync, personalization and
  // search a pile of no-floating-promises failures on Reader's schedule, in files
  // Reader does not own (see the ownership table in CLAUDE.md). Each team can opt
  // in by adding its own directory to `files` — that is the intended growth path,
  // and the reason this is one list rather than a global switch.
  //
  // WHY NOW: this was deferred until "real async code lands", and it has —
  // getBookBase64 -> getBook (whole-book decrypt), the closeBook teardown, and
  // handleReady's async open. Before that there was nothing for these rules to
  // find. The cost of NOT having them was already visible as prose: ReaderScreen
  // and ReaderWebView both carried comments explaining hand-written compensations
  // for the absent checker. Those comments are now updated, because the checker
  // is real.
  //
  // The rule set is deliberately narrow — async correctness only, NOT
  // recommendedTypeChecked. The point is catching a dropped promise (which
  // presents as a silently blank reader), not adopting a stricter house style for
  // one directory while the rest of the repo keeps another.
  {
    files: ['src/features/reader/**/*.ts', 'src/features/reader/**/*.tsx'],
    languageOptions: {
      parserOptions: {
        // projectService, not `project: './tsconfig.json'`: it resolves the
        // owning tsconfig per file and does not need a second, lint-only
        // tsconfig kept in sync with the real one.
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      // THE ONE THIS WAS TURNED ON FOR. A missed `await`/`void` on the decrypt or
      // bridge path does not throw — it resolves later into a component that has
      // moved on, and the user sees a permanently blank reader with no error.
      // That is the exact failure mode READY_TIMEOUT exists to make visible, and
      // this catches it a build earlier.
      '@typescript-eslint/no-floating-promises': 'error',

      // An async function passed where a void-returning one is expected — an
      // `onPress={async () => ...}` or an async effect cleanup. The rejection has
      // nowhere to go. React Native makes this easy to write by accident.
      '@typescript-eslint/no-misused-promises': 'error',

      // `await` on a non-thenable is always a mistake or a leftover from a
      // signature that stopped being async.
      '@typescript-eslint/await-thenable': 'error',
    },
  },
];
