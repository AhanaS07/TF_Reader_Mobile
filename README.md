# TF_Reader_Mobile

The React Native (TypeScript) client for TF Reader — the canonical cohort repo that every team forks before adding their own capability.

## Tech stack

React Native app ↔ Spring Boot backend (HTTPS + JWT) ↔ MongoDB.

The backend is a **modular monolith**: one module per capability. This app mirrors that split — one folder per capability under `src/features/`, talking to the backend through the shared API client.

This repo is a **skeleton only**. There is no feature code, no navigation wiring, and no RN/Expo runtime yet — those arrive after forking.

## Structure

```
app/                  app-level composition — wires the whole thing together
  navigation/         navigators, routes, deep links
  providers/          context/providers mounted at the root
  config/             environment + build-time config
src/
  shared/             the shared surface EVERY feature uses
    api/              HTTPS + JWT client (base URL, auth header, interceptors)
    types/            cross-feature TypeScript types
    ui/               reusable presentational components
    utils/            helpers with no feature knowledge
  features/           one folder per capability — added after forking
assets/               images, fonts, static files
```

**The rule:** `app/` and `src/shared/` are the shared surface. Every capability lives in its own folder under `src/features/<capability>/` and owns its screens, hooks, and state. Features do not import from one another — anything two features both need gets promoted into `src/shared/`.

A capability folder is created by whoever picks it up, in its own commit after forking. Nothing under `src/features/` is committed here beyond the `.gitkeep`.

## Branch model

- `develop` is the integration branch. Branch off it as `feat/<capability>-<name>`.
- Open PRs **into `develop`**, using the PR template.
- `main` only ever takes reviewed, CI-green merges from `develop`.
- Never force-push a shared branch.

## Setup TODOs

Deliberately left for the forking team:

- [ ] Add the React Native / Expo runtime (`npx create-expo-app` into place, or bare RN init) and its dependencies.
- [ ] Replace the placeholder `lint`, `typecheck`, and `test` scripts in `package.json` with real tooling (ESLint, `tsc --noEmit`, Jest / React Native Testing Library).
- [ ] Extend `tsconfig.json` with the RN/Expo base config and path aliases (e.g. `@shared/*`).
- [ ] Fill in `.github/CODEOWNERS` — it ships as a commented template.
- [ ] Build the HTTPS + JWT client in `src/shared/api/` and point `app/config/` at the backend base URL.

## CI

`.github/workflows/ci.yml` runs on push and PR to `main`/`develop`: install, then `lint` / `typecheck` / `test`. The scripts are tolerant placeholders so the empty skeleton stays green — swap them for real checks as the code lands.
