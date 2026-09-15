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
| `npm run test:ci` | `jest --ci --coverage`, gated by `jest.coverageThreshold` in `package.json` |
| `npm run format` | Prettier over `ts,tsx,js,jsx,json,md` |
| `npm start` | `expo start` |

CI runs `typecheck` as its own job, then `lint` and `test:ci`. All three must be
green. Coverage thresholds are today's measured floor, not aspirational — raise
them when coverage genuinely improves, never lower them to make a red build pass.

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
- **The tier arrives in the feed — do not derive it.** Superseded 16 Aug 2026 by
  wokay's published contract. `licenceModel` is on every acquisition link
  including open access, and carries one of `OPEN_ACCESS`, `SUBSCRIPTION`,
  `ELITE`. Our old `CONCURRENT` / `UNLIMITED` vocabulary is gone; it never was
  wokay's. Do not confuse this with flambeau's `ENTITLED_*` enum, which is a
  separate live vocabulary they translate on their side. See `docs/contracts/`.
- **`canPersist: false` hides Download** whatever the tier.
- **`subscribe` is the B2C entry point.** After subscribing, titles inside the
  reader's licence resolve to `read` + `download`. The payment surface is not
  ours.

## Shelves are data — L-5, settled 16 August 2026

An administrator configures the shelves for their institution and names them, so
the count, the titles and the ids are all theirs, and two institutions see
different rows. The rule the codebase already follows is now the final rule
rather than a hedge.

- **Render whatever array arrives, in the order it arrives.** Never name a shelf
  in a type, a branch, a test assertion or a style.
- **Handle one and many.** `navigation` is `minItems: 1` and always carries an
  *All titles* entry, so a zero-row feed cannot occur — don't build an empty
  state for it. One row is a valid feed, not a failed load.
- **`groupId` is an opaque string.** `shelf_1`, `ebooks`, anything — all just
  keys. Don't sort the array, relabel an entry, or treat the first as special.
- **Shelves are not filters.** The filter chips come from frozen enums in
  wokay's contract; the category row comes from the feed. An administrator
  naming a shelf "eBooks" does not make it the `contentType=EPUB` filter, and
  neither may be built from the other.

Still open, and it does not block anything: wokay said in chat that an
administrator may add **any** number of shelves, but their contract caps
`groups` at `maxItems: 3` with `groupId` fixed to `shelf_1..3` and `all`, on an
operation marked `x-stability: FROZEN`. Both cannot be true. Fixtures stay
contract-legal; the "any number" claim is carried by tests instead
(`normalize.test.ts`, `CatalogueScreen.test.tsx`). Either answer costs us
nothing, because nothing names a shelf.

## Read the current week's plan before starting

`team1-docs/index.html`, section `#wk2plan`. Clone `team1-docs` alongside this
repo — it is not a submodule, so the path depends on your own layout.

It holds what this file cannot: who owns which task, what each one builds in
terms of a specific screen and section, which mockup elements are deliberately
held rather than cut, and why decisions went the way they did. Read it before
picking up a task, and before deciding a feature is dead.

**It outranks a code comment on questions of intent.** Comments describe what
the code does and why it was written that way at the time; the plan describes
what has since been decided.

**Absence from a contract is not an answer.** If a field a design needs is
missing, that is a question to raise, not grounds to delete the UI. Presence is
evidence; absence is a question.

## The backend contracts

Republished 15 August 2026 and pinned in `docs/contracts/`. They supersede the
Week 1 sample feeds. Fetch the `.yaml` if you need a fresh copy — the `.html`
siblings are Swagger shells that render nothing without JS.

- wokay — `https://abhishek-tf.github.io/tf_reader_backend_temp/api-docs/wokay-api.yaml`
- flambeau — `https://deepu1004.github.io/flambeau-api-contracts/flambeau-api.yaml`

One example in a contract is one tenant's data, not the schema. Read the schema
for what a field may contain; read the example only for shape.

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
