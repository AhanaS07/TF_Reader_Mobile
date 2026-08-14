# team1 — repo rules

Expo / React Native, TypeScript, `strict: true`. The mobile app **is** this repo's
root; there is no `mobile-app/` subfolder.

Component rules are not repeated here. They live in
[docs/CONVENTIONS.md](docs/CONVENTIONS.md), and every shared component is checked
against that file. Settled and open access decisions live in
[docs/DEPENDENCIES.md](docs/DEPENDENCIES.md). This file holds what neither covers.

## Commands

| Command | What it does |
|---|---|
| `npm run lint` | `eslint . --max-warnings=0` — a warning fails, not just an error |
| `npm run typecheck` | `tsc --noEmit`, including the frozen-contract canary |
| `npm run test:ci` | `jest --ci --passWithNoTests` |
| `npm run format` | Prettier over `ts,tsx,js,jsx,json,md` |
| `npm start` | `expo start` |

CI runs `typecheck` as its own job, then `lint` and `test:ci`. All three must be
green. `--passWithNoTests` is there because most feature folders are still empty;
it goes once every CAP has a spec.

## Layering

Data flows down as props, events come back as callbacks. Each layer may only
reach the ones below it.

| Layer | May import | Must never |
|---|---|---|
| `src/components/` | `@theme`, `@model` types | Fetch, navigate, read a store, import an adapter, decide access |
| `src/screens/` | components, stores, adapters, navigation | Define a component that belongs in `src/components/` |
| `src/features/` | components, its own logic | Introduce a shared component |
| `src/adapters/` | `@model`, `@config`, contracts | Reach into UI, or hardcode a URL or token |
| `src/shared/contracts/` | nothing in this repo | — |

A shared component lives in `src/components/` and nowhere else. If a screen
needs something the library lacks, add it to the library — reviewed by that
component's author — rather than copying a file to change one thing.

`src/access/` is empty today. `resolveAccess` is Week 2 work. Until it lands, do
not compute entitlement inline as a stopgap: pass the decision in as a prop.

## Path aliases

Set in `tsconfig.json`, resolved by both the editor and the bundler. Use them;
don't write `../../`.

```
@/*  @theme/*  @model/*  @adapters/*  @access/*  @components/*  @screens/*
@search/*  @store/*  @storage/*  @hooks/*  @navigation/*  @config/*  @utils/*
```

## src/shared/contracts is frozen

These shapes are shared with other teams. Adding an optional field is fine.
Renaming a field, removing one, changing optionality, or widening or narrowing a
union is a breaking change and needs agreement first.

`src/shared/contracts/__typecheck__.ts` is the canary — it goes red in CI when a
frozen shape moves. Never weaken or delete an assertion in it to get a build
green.

## Access decisions already settled

Recorded 13 August. Don't re-litigate these, and don't build from the signed
specification where it disagrees — it is superseded.

- **Action vocabulary** is `read`, `download`, `addToQueue`, `revokeLicence`,
  `subscribe`, `signIn`. `borrow` is gone as a button; it survives only as the
  OPDS wire rel on `AcquisitionRel`.
- **Elite is read-only.** `addToQueue`, then `read` + `revokeLicence` once a
  licence is held. No offline copy at any point, so Elite never offers Download.
- **Elite always queues**, even when a seat is free. The queue is the only way
  in. There is no `no_seats` state and no `availability` dependency.
- **There is no `accessTier` field** and there will not be one. Derive it in the
  adapter from `licenceModel`: `UNLIMITED` → Subscription, `CONCURRENT` → Elite,
  absent → Open Access.
- **`canPersist: false` hides Download** whatever the tier.
- **`subscribe` is the B2C entry point.** After subscribing, titles inside the
  reader's licence resolve to `read` + `download`. The payment surface is not
  ours.

## Not decided yet

Don't invent an answer to these, and don't enforce one in review. Raise them.

- Accessibility baseline — required `accessibilityRole` / `accessibilityLabel`,
  minimum touch target.
- Dark mode. `tokens.ts` has no scheme dimension, so adding one later touches
  every component.
- What keeps `GalleryScreen` out of a release build. It sits in `RootNavigator`
  today with no guard.

## The State Gallery

`src/screens/GalleryScreen.tsx` renders every component, variant and state from
static props. It is dev tooling. Nothing in production UI may navigate to it.
Each component ships its own `ComponentName.gallery.tsx` so the entry travels
with the component.
