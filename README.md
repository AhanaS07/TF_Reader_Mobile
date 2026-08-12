# TF_Reader_Mobile

## Stack

**TypeScript** (`strict: true`), Expo managed, React Navigation
(`bottom-tabs` + `native-stack`), Zustand, AsyncStorage, Jest + React Native Testing Library.

> **Changed 11 Aug: TypeScript, not JavaScript.** The contract is now
> `src/model/types.ts` with real interfaces, and `MockAdapter implements DataAdapter` is
> compiler-checked. Anything in the planning documents that says "JavaScript, not
> TypeScript" is superseded by this line.

## Structure

```
src/
  theme/        design tokens — the only source of colour/size/spacing/radius
  model/        types.js (THE contract), validate.js, fixtures/
  adapters/     MockAdapter, ApiAdapter, conformance suite
  access/       resolveAccess — the ONLY place access logic may live
  components/   the shared library, one folder per component
  screens/      catalogue · search · institution · detail · library · profile
  search/       catalogue and institution pipelines + the shared shell
  store/        Zustand — in-memory state (session, selection, pending intent)
  storage/      AsyncStorage behind an interface we own — survives restart
  navigation/   RootNavigator, tabs
  hooks/        useNetworkStatus
  gallery/      the /gallery review route
  config/       env + build config — where Mock vs Api is selected
  utils/        pure helpers, no feature knowledge
assets/         fonts, images (root-level — Expo's app.json points here)
.ci/            deploy.sh (the provider seam), smoke.sh
docs/           team1's conventions + dependency board
```

Subfolders get created as the work lands. Folders are tracked by an empty `.gitkeep`.

**Three rules that hold the tree together:**

1. **Props in, callbacks out.** A component receives data and emits events. It does not
   fetch, read a store, navigate, or compute access. (Design Spec §5.1: _the UI must never
   calculate access rights_.)
2. **No raw values.** Every colour, size, spacing and radius comes from `src/theme`. A raw
   hex in `src/components/` fails review.
3. **A feature may not introduce a component.** If a feature needs something the library
   lacks, it is added _to the library_, reviewed by that component's original author — never
   inside a feature folder. The rule being protected is _one implementation, one location_.

## Setup

**P0-1 has landed — the toolchain is installed.** To get running:

```bash
npm ci
npm run typecheck && npm run lint && npm test   # all three should be green
```

### Use a development build, not Expo Go

This is the single most important setup fact in this file, and getting it wrong costs you a day.

**Expo Go cannot run this app.** It depends on native modules that are not compiled into the
Expo Go binary — secure storage, AES-GCM crypto, and Android's `FLAG_SECURE`. Expo Go appears to
work right up until the first import that needs one of them, then fails with a module-not-found
that reads like a bundler bug and isn't.

`expo-dev-client` is therefore a dependency from day one, and `app.json` lists it as a plugin.
Build the dev build **before** you start feature work:

```bash
npx expo prebuild            # generates android/ + ios/ from app.json
npm run android              # or: npm run ios   (needs Xcode)
```

`npm run android` / `npm run ios` map to `expo run:*`, which **builds and installs the dev
build**. They deliberately do not map to `expo start --android`, which would launch Expo Go and
fail as described above.

Building locally needs the platform toolchain — Android Studio + SDK for Android, Xcode for iOS.
If you don't have them (or need an iOS build without a Mac), use EAS cloud builds instead:
`npx eas-cli build --profile development --platform android`. That needs an `eas.json`, which
this repo does not have yet — see "Not yet set up" below.

After the dev build is installed, `npm start` connects to it instead of Expo Go. You only re-run
`prebuild`/`run:` when a native dependency or config plugin changes — not for JS changes.

**`android/` and `ios/` are gitignored on purpose.** We use CNG (Continuous Native Generation):
those directories are generated from `app.json`, so they are build output, not source. Two rules
follow — never hand-edit anything inside them (the next `prebuild` discards it), and a dependency
without an Expo config plugin needs a small local plugin written for it rather than a native
edit. Going "bare" and committing them is a team decision, not a per-person one.

Native modules added later install the same way and need a config-plugin entry in `app.json`
plus a fresh `prebuild`. Which ones are coming, and who owns them, is a per-team matter — see the
team docs below.

### Not yet set up

Everything the dev client needs is installed and verified — `npx expo-doctor` passes 20/20 and
`npx expo prebuild` generates a clean Android project with `expo-dev-client`, `expo-dev-launcher`
and `expo-dev-menu` all autolinked. Two things remain, and both need a decision rather than a
command:

- **No `eas.json`.** Without it there are no cloud builds, so every dev build must be compiled
  locally with the full platform toolchain installed. Worth adding if anyone on the team lacks
  Android Studio, or needs an iOS build without a Mac. `npx eas-cli init` creates it, but it
  binds the repo to an Expo account/project — a team decision, not a per-person one.
- **No app icon or splash.** `assets/` holds only a `.gitkeep`, so builds use Expo defaults.
  Cosmetic, but it will look broken on a device before it looks intentional.

### Versions

Everything is resolved by Expo's own resolver, not pinned by hand. `npx expo install --check`
reports drift and is worth running after any dependency change. Two consequences of SDK 57 worth
knowing:

- **TypeScript is 6.0.x**, not 5.x — SDK 57 expects it. TS 6 deprecates `baseUrl`, so
  `tsconfig.json` uses tsconfig-relative `paths` instead, and it no longer auto-includes
  `@types`, hence the explicit `"types": ["jest", "node"]`.
- **`render` from `@testing-library/react-native` v14 is async.** `await` it. Destructuring the
  Promise gives you `getByText is not a function`, which reads like a broken install.

## Branch model

`main` is team1's dev line. Feature branches PR **into this fork's `main`** — never upstream.

```
feature/CAP-2-institution-list     fix/CAP-3-selection-persist
feature/CAP-3-select-institution    chore/ci-cache
```

Daily: `git checkout main && git pull --ff-only origin main`, then rebase your branch onto
it. **Rebase, never merge** — history stays linear and the weekly upstream PR stays
reviewable. Push every 2–3 days even if unfinished; prefix the PR `Draft:` if it isn't ready.

Thursday the lead raises one PR `main → upstream:stage`. If our `main` is red Thursday
morning we don't raise it — a broken stage blocks 20 people.

### Before every PR

- [ ] Rebased on `main`; tests pass
- [ ] **Read your own diff** — `git diff main...HEAD`
- [ ] `/security-review` in Claude Code on the diff
- [ ] No secrets, no real institution or user data
- [ ] Screenshots for UI; PR title references `CAP-<n>`

1 approval from someone who isn't the author. Squash merge.

Two files are **cross-team contracts**, not just our code — add the other team's lead as a
reviewer when you touch them: the institution shape (shaped by **wokay**) and auth routing
(hands `institutionId` into **flambeau**'s sign-in flow).

## Per-team docs

This file covers what is repo-wide: toolchain, setup, branch model, PR process. Anything scoped
to a single team's capabilities — its feature folders, owner map and capability-specific
constraints — lives in that team's own file rather than here.

- **[`team1_README.md`](team1_README.md)** — team1, CAP-2 Institution Listing & CAP-3 Institute
  Selection. Covers everything under `src/` except `src/features/`, the owner map,
  `src/model/types.ts` as the single contract, and the cross-team contracts with wokay and
  flambeau.
- **[`T4_Readme.md`](T4_Readme.md)** — t4targaryen, CAP-7 Reader & Offline. Covers
  `src/shared/`, `src/features/`, `samples/`, the contract freeze and canary, and why the
  development build is mandatory for the reader stack.

## Lint toolchain notes

**Exact pins mean no automatic patches.** `eslint: 9.39.5` won't pick up 9.39.6.
The pinning is deliberate — but `^9.39.5` would be just as safe against the
ESLint 10 crash, since a caret never crosses a major. Easy loosening if the
rigidity annoys you.

**`react.version` is now `'detect'`** in `eslint.config.js`. It used to be a
fabricated `'19.0'` to silence a startup warning while React wasn't installed;
React 19.2 is a real dependency since P0-1, so the linter reads the installed
version rather than being told a made-up one.

**Jest globals are scoped, not global.** `describe`/`it`/`expect`/`jest` are
declared only for `*.test.*`, `__tests__/`, and `jest.setup.js`. A stray
`describe` in `src/` is still a `no-undef` error, which is the point.

**`jest.setup.js` mocks `react-native-safe-area-context` globally.** The real
provider measures layout before rendering children, and there is no layout under
Jest — so without the mock every screen test renders an empty tree and every
query fails against a tree containing only `<RNCSafeAreaProvider />`. The mock
ships with the library; we just register it.
