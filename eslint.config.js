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
// Type-aware linting is intentionally OFF (no parserOptions.projectService).
// It is slower and sprays errors on a tree that is mostly empty. The tradeoff:
// type-aware-only rules such as @typescript-eslint/no-floating-promises are
// unavailable until it is switched on.
const expoFlat = require('eslint-config-expo/flat');

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'eslint.config.js',
      // Node-only, gitignored projects — not part of the Expo/RN app tree, so
      // Buffer/__dirname/etc. are real globals there, not no-undef violations.
      'mock-backend/**',
      '__mocks__/**',
    ],
  },

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
];
