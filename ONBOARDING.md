# Onboarding — start here

You're joining **team1** on **T&F Reader**, a mobile app (React Native / Expo /
TypeScript) for reading institutional library content. Four teams of five build it
over eight weeks; **team1 owns CAP-2 (institution listing) and CAP-3 (institution
selection)** — "Discovery & Selection" — the screens for finding an institution,
choosing one, and browsing/searching/viewing its catalogue. Team1 also carries shared
foundation work under `src/shared/` (frozen cross-team contracts) and reviews
`src/features/` (owned by another team, t4targaryen — see below).

This file is meant to be enough on its own. Read it top to bottom once, then use it
as a reference. Where it references other docs, you don't need to read those first —
only if you want more detail on a specific area.

## Who owns what

Two other backend teams supply everything team1 renders:

- **wokay** — CAP-1 (onboarding & admin) + CAP-5 (OPDS catalogue). Every institution
  and catalogue feed team1 displays. They filter search results by entitlement;
  team1 only renders what comes back.
- **flambeau** — CAP-6 (auth: SAML/OIDC, JWT) + CAP-4 (licences & queue). Hands back
  a session from an institution sign-in; generates/checks/revokes licences; tells
  the app when a queued reader's turn comes.
- **t4targaryen** — CAP-7 (Reader & Offline). Owns `src/features/` (`reader`,
  `download`, `encryption`, `sync`, `personalization`, `search`, `accessibility`)
  and `src/shared/` is *their* frozen contract that team1 code also depends on.
  **`T4_Readme.md` at the repo root is their file, not team1's — don't edit it,**
  even if something in it looks stale (flag it to them instead; see "Known stale
  spots" below for one such case).

Team1 people: Prayas, Moktik, Keshav, Khushi, Akriti. Feature/component ownership
map is in `team1_README.md`.

There's also a separate `UC-backend` (Java/Spring, wokay's actual backend
implementation) and a `team1-docs` repo (the master plan, `index.html`) alongside
this one — neither is part of this repo, and per team convention **team1 does not
touch the backend**. If you're doing frontend work, you can ignore `UC-backend/`
entirely.

## The doc map — what to read, and what you won't see

This repo's root has more `.md` files than you'd expect. Some are gitignored
personal working notes (Prayas's, for continuity across chat sessions) — you won't
see them on a fresh clone unless they're shared with you directly:

| File | Tracked? | What it is |
|---|---|---|
| `README.md` | ✅ | Repo-wide: stack, setup, dev-build gotcha, branch model |
| `team1_README.md` | ✅ | team1-specific: structure, owner map, the contract |
| `T4_Readme.md` | ✅ | **t4targaryen's file** — CAP-7 structure/ownership. Don't edit it. |
| `docs/CONVENTIONS.md` | ✅ | Component-library rules — **superseded for code style**, see below |
| `docs/DEPENDENCIES.md` | ✅ | Access-spine dependency board, decisions log (13 Aug) |
| `docs/contracts/README.md` + `*.yaml` | ✅ | Pinned wokay/flambeau API contracts |
| `ONBOARDING.md` (this file) | ✅ | Full context for a new person, written 7 Sep 2026 |
| `CLAUDE.md` | ❌ gitignored | Coding-style overrides for AI-assisted work (see below) |
| `PROJECT_CONTEXT.md` | ❌ gitignored | Living snapshot of what/how/why, personal notes |
| `AUTH_CONTEXT.md` | ❌ gitignored | Deep-dive on the auth/token-refresh system specifically |
| `WEEK3_TASKS.md` | ❌ gitignored | Week 3 (24–28 Aug 2026) task breakdown — now historical |
| `TF_Reader_Design_Specification.md` | ❌ gitignored | The original signed design spec — **partially superseded**, see "Settled decisions" |

**One real style conflict to know about**: `docs/CONVENTIONS.md` is a tracked,
team-wide doc, but `CLAUDE.md` (gitignored, Prayas's local override) explicitly says
*"do not follow `docs/CONVENTIONS.md`... disregard its rules"* for AI-assisted work,
in favor of a simpler "write code that reads plainly" style (no nested ternaries, no
clever one-liners, boring names, short why-comments). If you're pairing with an AI
assistant on this codebase, that's the effective style; if you're not, `CONVENTIONS.md`
is still the team's written standard. This is a known, deliberate split — not
something to "fix" by editing either file.

## Stack, and the one setup gotcha that costs a day

**TypeScript, `strict: true`.** Expo managed workflow, React Navigation
(bottom-tabs + native-stack), Zustand for state, AsyncStorage + `expo-secure-store`
for persistence, Jest + React Native Testing Library for tests.

**Expo Go cannot run this app.** It depends on native modules not compiled into the
Expo Go binary — secure storage, AES-GCM crypto, Android's `FLAG_SECURE`. It looks
fine until the first import that needs one of those, then fails with a
module-not-found that reads like a bundler bug. You need a **development build**:

```bash
npm ci
npx expo prebuild        # generates android/ + ios/ from app.json — gitignored, build output
npm run android           # or npm run ios — builds AND installs the dev build
npm start                 # subsequent runs connect to the installed dev build
```

You only re-run `prebuild`/`run:*` when a native dependency or config plugin
changes, not for plain JS/TS changes. Never hand-edit anything under `android/` or
`ios/` — the next `prebuild` discards it (Continuous Native Generation).

```bash
npm run typecheck   # tsc --noEmit — a real gate, not an editor nicety
npm run lint         # eslint . --max-warnings=0 — warnings fail too
npm test             # jest --passWithNoTests
npm run test:ci      # jest --ci --coverage, gated by jest.coverageThreshold
npm run format       # prettier --write "**/*.{ts,tsx,js,jsx,json,md}"
```

Env vars (per-developer, gitignored `.env`): `EXPO_PUBLIC_CATALOGUE_BASE_URL`,
`EXPO_PUBLIC_CATALOGUE_SOURCE` (`mock` | `api`), `EXPO_PUBLIC_LICENCE_SOURCE`,
`EXPO_PUBLIC_SEARCH_PIPELINE`, `EXPO_PUBLIC_FLAMBEAU_BASE_URL`. `CATALOGUE_BASE_URL`
is **scheme+host+port only** — no `/api/v1` or `/opds/v1` suffix, each adapter
method appends its own namespace.

**Testing a real device/emulator against a real backend, and something looks
wrong?** `adb install -r` (a native rebuild) does **not** wipe app storage. Use
`adb shell pm clear <package.applicationId>` for a genuinely clean slate before
assuming a bug is server-side.

## Repo layout

```
src/
  theme/        design tokens (tokens.ts) — the ONLY source of colour/size/spacing/radius
  model/        types.ts (THE contract), validate.ts, opds/normalize.ts, fixtures/
  adapters/     MockAdapter, ApiAdapter, PartialApiAdapter, conformance suite
  access/       resolveAccess — the ONLY place access/entitlement logic may live
  auth/         SAML sign-in, token refresh, personal-account stub, AuthFailure
  licence/      ApiLicenceClient/MockLicenceClient behind LicenceSource — borrow/return/hold/offer
  components/   shared component library, one folder per component
  screens/      catalogue · search · institution · detail · library · profile · preferences
  search/       useCatalogueSearch, searchState reducer, fixture + API pipelines, voice search
  store/        Zustand — session, institution selection, library cache, offers, recent searches
  storage/      AsyncStorage/SecureStore behind an interface team1 owns
  navigation/   RootNavigator + the four tab stacks, types.ts (all route params)
  hooks/        useNetworkStatus, useServerClock, useFeedScrollMemory, usePaginatedApi
  gallery/      the /gallery dev-only component review route
  config/       env + build config — where Mock vs Api is selected, per capability
  features/     t4targaryen's — reader, download, encryption, sync, personalization,
                 search (theirs, distinct from src/search/), accessibility
  shared/       t4targaryen's frozen cross-team contracts (contracts/, types/)
```

**Three rules that hold the tree together** (from `team1_README.md`):

1. **Props in, callbacks out.** A component in `src/components/` never fetches, reads
   a store, navigates, or computes access — Design Spec §5.1: *"the UI must never
   calculate access rights."*
2. **No raw values.** Every colour/size/spacing/radius comes from `src/theme/tokens.ts`.
3. **A feature may not introduce a shared component.** If `src/features/` needs
   something `src/components/` lacks, it's added to the library — reviewed by that
   component's original author — never copied into a feature folder.

## Architecture tour

**OPDS normalizer** (`src/model/opds/normalize.ts`) — the one place wire format
becomes the domain model (`Catalogue`, `Shelf`, `Publication`, `NavLink`). Both
adapters go through it, guaranteeing they produce identical shapes.

**Two adapters, one interface** (`src/adapters/CatalogueSource.ts`) — `MockAdapter`
(parses real OPDS fixtures through the normalizer) and `ApiAdapter` (thin fetch
shell over the real backend, ETag-cached home catalogue per institution).
`PartialApiAdapter` routes some methods to the real `ApiAdapter` and others to
`MockAdapter` during the incremental cutover — check it to see which endpoints are
actually live right now versus still mocked. Both adapters pass a shared
conformance suite (`src/adapters/conformance.ts`) so they stay interchangeable —
swapping one for the other is a config change (`src/config/catalogue.ts`), not code.

**Fixture-vs-contract conformance** (`src/model/contracts/fixtureConformance.test.ts`,
if present, or the pattern it follows) parses `docs/contracts/*.yaml` at test time
and checks every mock fixture against the contract example it was copied from.
Asymmetric on purpose: a field the contract has and the fixture lacks is a hard
fail; a field the fixture has and the contract example lacks is allowlisted (we're
richer than one tenant's example).

**Access spine** (`src/access/resolveAccess.ts`) — pure function, no I/O, no clock
reads, safe to call once per list row. The **only** place access/entitlement logic
may exist; every screen calls it and renders only the `.tier`/`.actions` it returns,
never reading `licenceModel` or a loan/hold directly. Takes `item`, `institutionId`
(`string | null`), `session` (`Session | null`), and optional `loan`/`hold`.

**Auth / token refresh** (`src/auth/`) — `bootstrapAuth()` runs once at app boot
(wired in `App.tsx`); `ensureFreshToken()` runs on-demand right before an
authenticated call needs a token, refreshing via flambeau's `/auth/refresh` if
expired. Concurrent callers share one in-flight refresh (refresh tokens rotate on
every use, so two independent refreshes would have the second one refused).
Institutional sign-in is SAML, via `beginSamlSignIn()` → OS browser → deep-link
callback → code exchange → `GET /auth/me` for identity. Personal-account
(email/password) sign-in is a stub with no real backend endpoint yet — it doesn't
survive an app restart. **See `AUTH_CONTEXT.md`** (gitignored, ask Prayas if you
need the full history) for the complete file-by-file breakdown, including a 7 Sep
2026 fix to how refresh failures are handled — a network blip/timeout no longer
force-clears the session the way a genuinely refused refresh token does.

**Licence layer** (`src/licence/`) — `ApiLicenceClient`/`MockLicenceClient` behind
`LicenceSource`: borrow, return, accept-offer, cancel-hold. Refusals are keyed on
flambeau's own `code` field, never HTTP status.

**Search** (`src/search/`) — `useCatalogueSearch` wraps a `useReducer`
(`searchState.ts`) so composed filter changes always apply against true prior
state. `FixtureSearchPipeline`/`ApiSearchPipeline` behind a shared `pipeline.ts`
interface, config-selected like the catalogue adapters. Voice search
(`useVoiceSearch`) is a separate state machine feeding the same `onChangeQuery`/
`onSubmit` path — a transcript is just another way to produce a query string, not
a second search path.

**Stores** (`src/store/`, all Zustand):
- `sessionStore` — in-memory access token + identity (never persisted directly;
  the refresh token lives in `secureStorage` via Keychain/Keystore).
- `institutionStore` — persisted selected institution + a small offline cache of
  the institution list (versioned, with a `migrate` function — bump `version` and
  write a migration if the shape changes, don't silently serve stale data).
- `libraryStore` — session-only cache of loans/holds, refreshed after every
  borrow/return/hold/accept call, not on a timer.
- `offerStore` — the reader's current queue offer (if any), polled via
  `useOfferPolling`; `QueueNotificationHost` renders the banner globally.
- `recentSearchesStore`, `pendingIntentStore` (survives the app being
  backgrounded/killed during the SAML browser round-trip), `bookmarkStore`,
  `downloadStore` — smaller, single-purpose stores.

**Navigation** (`src/navigation/`) — one root stack (`Main` tabs + dev-only
`Gallery` modal) wrapping four bottom tabs: **Catalogue**, **Search**, **Library**,
**Profile**. Catalogue, Search, and Profile each have their own nested stack and
all three register `SignIn`/`InstitutionList`/`PersonalAccount`/`AccessGate`
independently — a flow that starts on one tab finishes on that same tab rather than
relocating the reader. `src/navigation/types.ts` is the single source of truth for
every route's params; keep it in sync with `RootNavigator.tsx` by hand.

**Theme** (`src/theme/tokens.ts`) — single source of colour/type/spacing/radius/
elevation. `resolveFont.ts` maps a `(family, weight)` pair to the actual loaded
Google Font name (Open Sans / Aleo, static per-weight fonts — `fontWeight` doesn't
work on them, the exact family name does).

**Gallery** (`src/gallery/`, `GalleryScreen`) — dev-only route rendering every
component/variant/state from static props, for design review. Never reachable from
production navigation (there's no guard on this today — a known open gap, see
below). Every shared component ships its own `ComponentName.gallery.tsx`.

## Contracts — the rules that actually matter

- **The published contract YAML is the source of truth**, over prose, chat, or an
  old sample. Pinned at `docs/contracts/wokay-api.yaml` and
  `docs/contracts/flambeau-api.yaml`. Fetch fresh from the URLs in
  `docs/contracts/README.md` if you need the latest — the `.html` Swagger pages
  render nothing without JS.
- **An `example:` block is one tenant's data, not the schema.** Never generalize a
  shape, count, or vocabulary from a single example. Mock fixtures are deliberately
  varied away from contract examples so tests catch over-fitting.
- **Presence is evidence, absence is a question.** A spec not mentioning a feature
  is never grounds to delete it — ask, and hold the UI disabled rather than removing
  it. A *direct* "this doesn't exist" from the other team (e.g. wokay confirming no
  subject-facets endpoint) carries more weight, but still isn't automatically
  "cut this" without a design/leadership call.
- **`src/shared/contracts/` is frozen and cross-team** (t4targaryen's, team1 depends
  on it). Adding an optional field is fine; renaming, removing, changing optionality,
  or widening/narrowing a union needs agreement first.
  `src/shared/contracts/__typecheck__.ts` is the canary — if it goes red, a freeze
  broke; find out why, don't weaken the canary to get green.
- **Two things in this tree are cross-team contracts even though they live in
  team1's code**: the `Institution` shape (shaped by wokay) and auth routing that
  hands `institutionId` into flambeau's sign-in flow. Add the other team's lead as
  reviewer when touching either.

## Settled decisions — don't re-litigate these

Recorded 13 Aug 2026, still in force. Where the originally-signed
`TF_Reader_Design_Specification.md` disagrees, these supersede it:

- **Action vocabulary**: `read`, `download`, `addToQueue`, `revokeLicence`,
  `subscribe`, `signIn`. `borrow` is gone as a button — it survives only as the OPDS
  wire rel on `AcquisitionRel`.
- **Elite is read-only.** `addToQueue` → `read` + `revokeLicence` once held. No
  offline copy, ever — Elite never offers Download.
- **Elite always queues**, even with a free seat. No `no_seats` state exists.
- **The tier arrives in the feed** (`licenceModel` on every acquisition link:
  `OPEN_ACCESS` | `SUBSCRIPTION` | `ELITE`) — never derive it locally. Don't confuse
  this with flambeau's separate `ENTITLED_*` enum.
- **`canPersist: false` hides Download**, whatever the tier.
- **`subscribe` is the B2C entry point**; the payment surface itself isn't ours.
- **Shelves are data, not code** (L-5, 16 Aug 2026). Render whatever `navigation`
  array arrives, in order. Never name a specific shelf in a type, branch, test
  assertion, or style. One shelf is a valid feed, not an empty state.

## Open questions — don't invent an answer, raise it instead

- Whether the post-sign-in catalogue is scoped by entitlement (contradicts a signed
  Design Spec section).
- Final SAML token-return path (flambeau) — still assume the OS-browser round trip
  (`pendingIntentStore` exists specifically to survive it) until formally confirmed
  otherwise.
- Subject-facets / Browse-by-Subject — wokay directly confirmed no endpoint exists;
  UI is held disabled pending a design/leadership call on keep-vs-drop.
- Accessibility baseline (required `accessibilityRole`/label, min touch target) and
  dark mode (tokens.ts has no scheme dimension yet) — both undecided.
- What keeps `GalleryScreen` out of a release build — it has no guard today.

## Branch & PR workflow

`main` (this fork) is team1's dev line — **not** production; production is
upstream's `main`, never touched directly. Feature branches PR into this fork's
`main`, named `feature/CAP-<n>-...` / `fix/CAP-<n>-...`. Rebase onto `main` daily
(never merge — linear history for the weekly upstream PR). Push every 2–3 days even
unfinished, prefixed `Draft:`. Thursdays the lead raises one PR `main → upstream:stage`
— skipped if `main` is red that morning.

Before every PR: rebased, tests pass, you've read your own diff
(`git diff main...HEAD`), run a security review, no secrets/real institution or
user data, screenshots for UI changes, PR title references `CAP-<n>`. One approval
from a non-author, squash merge.

## State of things as of 7 Sep 2026 — a recent bug sweep

A full read-only review (no backend, frontend only) turned up and fixed the
following. Listed here so you know what's recently changed and why, without having
to dig through commit history:

**Fixed:**
- `src/auth/tokenRefresh.ts` — refresh failure handling no longer wipes the session
  on a transient network/timeout error (only on an actual refusal); the rotated
  refresh token is now persisted before the cold-boot identity lookup, so a timeout
  there can't strand it. Full detail in `AUTH_CONTEXT.md`.
- `src/screens/SearchScreen.tsx` — no longer hardcodes a placeholder institution ID
  for search results, entitlement badges, or "browse instead" navigation; now reads
  the real signed-in session's institution (same bug class `CatalogueScreen` already
  had fixed once before — this screen had been missed).
- Stale "audio is never encrypted" doc comments fixed in
  `src/shared/contracts/content-provider.ts`, `src/model/types.ts`, and
  `src/model/opds/normalize.ts` — the backend team reversed that assumption on 3 Sep
  2026 (audio can now ship encrypted, same as PDF/EPUB); only open access is still
  guaranteed plaintext. Comments only, no runtime logic changed.
- `src/store/institutionStore.ts` — the v1→v2 migration now also clears
  `selectedInstitution` (not just the cached list), since it's built from the same
  stale `crestUrl` shape.
- `src/store/libraryStore.ts` — a failed `refresh()` now logs the error (still keeps
  showing last-known loans/holds, unchanged behavior otherwise).
- `src/features/queue/QueueNotificationHost.tsx` — accept/reject offer failures are
  now logged instead of silently swallowed.
- `src/components/BottomSheet/BottomSheet.tsx` — the slide-in `setTimeout` is now
  cleared on unmount/fast-toggle, preventing a `setState`-after-unmount warning.
- `src/theme/resolveFont.ts` — throws for an unregistered font weight instead of
  silently returning `undefined` (consistent with `catalogue.ts`/`licence.ts`/
  `search.ts`, which all throw loudly on misconfiguration).
- `src/navigation/RootNavigator.tsx` — removed a stray blank line.
- `src/hooks/usePaginatedApi.ts` — the offline branch no longer rewinds `page` to 0
  on a `loadMore` call, only on a fresh/`replace` fetch.

**Deliberately left alone:**
- All existing `console.log` tracing in `src/auth/` (including one call that logs
  raw tokens in `institutionSignIn.ts`) — left as-is on explicit instruction, not an
  oversight. Worth a follow-up if this codebase ever ships with real credentials at
  stake; today it's still fixture/test data.
- `T4_Readme.md`'s own stale "AUDIO is never encrypted" line — their file, flagged
  to them, not edited here.
- The backend (`UC-backend/`) had its own findings from the same sweep (an
  unauthenticated dev-token endpoint, and an IDOR/BOLA gap across the sync module)
  — **not team1's to fix**, raised separately.

**Not run as part of this sweep**: `npm run typecheck && npm run lint && npm test`.
Run them yourself before trusting any of the above beyond what's described.

## If you get stuck

1. Grep the actual code before trusting any planning document's claim about what's
   already built — this project has repeatedly generated task docs with stale
   premises ("fix X" for something already fixed weeks earlier).
2. Check `team1_README.md` for the owner map, then ask that person before changing
   their area — most things here (tokens, the contract, the component library) have
   a single owner by design, specifically to avoid merge conflicts and drift.
3. `docs/contracts/*.yaml` over any prose description of an endpoint, always.
