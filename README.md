# TF_Reader_Mobile — team1

React Native (Expo) client for **T&F Reader**. team1 owns **CAP-2** (institution listing) and
**CAP-3** (institute selection) — "Discovery & Selection".

**This fork's `main` is team1's dev line, not production.** Production is `main` on the
upstream repo, which we never touch. There is no `develop` branch.

## Stack

JavaScript (not TypeScript — a team decision), Expo managed, React Navigation
(`bottom-tabs` + `native-stack`), Zustand, AsyncStorage, Jest + React Native Testing Library.

Since there is no compiler, three things replace it — all three are required, not optional:

| What a compiler gave us | Replacement |
|---|---|
| One shared shape across the team | JSDoc `@typedef` in `src/model/types.js` + `jsconfig.json` with `checkJs` (editor-level, zero build cost) |
| Catching a malformed fixture | `src/model/validate.js` — asserts fixtures on load, throws loudly in dev |
| Mock and real adapters staying interchangeable | An adapter conformance suite both must pass |

Plus `prop-types` on every component for runtime warnings in development.

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
   fetch, read a store, navigate, or compute access. (Design Spec §5.1: *the UI must never
   calculate access rights*.)
2. **No raw values.** Every colour, size, spacing and radius comes from `src/theme`. A raw
   hex in `src/components/` fails review.
3. **A feature may not introduce a component.** If a feature needs something the library
   lacks, it is added *to the library*, reviewed by that component's original author — never
   inside a feature folder. The rule being protected is *one implementation, one location*.

## Setup

The Expo runtime is not installed yet — that is P0-1, Day 1. Versions come from Expo's
resolver rather than being pinned by hand:

```bash
npx create-expo-app@latest . --template blank   # if not already scaffolded
npx expo install react-native-screens react-native-safe-area-context \
  @react-navigation/native @react-navigation/bottom-tabs @react-navigation/native-stack \
  zustand @react-native-async-storage/async-storage prop-types \
  expo-font @expo-google-fonts/inter @react-native-community/netinfo
npm i -D eslint prettier eslint-config-expo jest jest-expo @testing-library/react-native
```

Then `npm start`. CI's lint/test guards drop away automatically once the toolchain is in.

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

## Planning docs

The authoritative docs live in the separate `team1-docs` repo: `final_plan.docx` (Delivery
Plan v2), `TF_Reader_Week1_Foundation_Spec.md` (Week 1 per person, per day),
`TF_Reader_Design_Specification.md`, `GITHUB_WORKFLOW_AND_CICD.md`.

Where the Foundation Spec and **Section 05** of the delivery plan disagree, the Foundation
Spec is correct: Section 05 says Khushi owns the top ten components, three other sections
say a five-way split. Section 05 is the outlier and is stale.

## Unratified — do not build as if these are settled

| Item | Question | Build so that… |
|---|---|---|
| **L-2** | Is the post-sign-in catalogue scoped by entitlement? Contradicts Design Spec §4.1, a signed document. | scope is config, not branching logic |
| **L-3** | Final action vocabulary — `Buy` removed, `borrow` redefined, `subscribe` B2C-only | variants come off the `ActionId` union |
| **L-5** | Three feed tabs, or one merged list? | tabs are **data, not code** |
| **Q-D** | Will wokay supply `accessTier`? OPDS 2.0 has no equivalent. Longest lead time of anything we're asking for. | read it from our own fixture field meanwhile |

Also open: who is team1's lead, and whether team1 owns any backend module at all.
