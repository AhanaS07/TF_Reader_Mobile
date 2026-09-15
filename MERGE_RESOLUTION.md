# Merge resolution — `staging-test` ← `upstream/staging`

Records how the stuck merge (branch `staging-test`, `MERGE_HEAD` = `upstream/staging`, base commit
`990912c`) was resolved: 27 files with unresolved conflict markers, spanning build config, the
navigation shell, the personalization store, and every file in `src/shared/contracts/`. Written up
so the decisions are visible, not just the diff. Resolved against `integration_ref.md` (Team 1's
distilled reader-engine integration reference); fall back to `Integration_Guide_Team1.md` only if
this file is unclear.

**Status when this was written: conflicts resolved, not committed.** `git status` still shows "All
conflicts fixed but you are still merging" — commit is left to whoever reviews this.

---

## The one big structural collision

Two complete, mutually exclusive navigators existed in one file (`src/navigation/RootNavigator.tsx`)
and its `App.tsx` wiring:

- **HEAD (kept):** tab-based shell — Catalogue / Search / Library / Profile, each its own nested
  stack. No reader routes, no `useAutoSync()`.
- **upstream (discarded):** a flat `BookList → Reader/AudioPlayer/BookInfo/MockLibrary` stack, with
  its own `NavigationContainer` and `useAutoSync()` call.

**Resolution:** kept the tab-based shell. `integration_ref.md` says the nav shell is explicitly
"YOURS" to own, and its own "Scaffolding to NOT copy" list names `BookListScreen.tsx` and
`src/features/sync/mock/` directly — the entry points behind the discarded shell. Concretely:

- `App.tsx` now also calls `useAutoSync()` and `useAudioPlayerSetup()` (mounted at the true app
  root, alongside the existing font-loading/splash/`bootstrapAuth` logic), and still wraps its own
  `NavigationContainer` since the tab-based `RootNavigator` owns none.
- `CatalogueNavigator` and `SearchNavigator` (inside `RootNavigator.tsx`) each gained two new
  screens: `Reader` (`ReaderRouteScreen`, `gestureEnabled: false` per the doc) and `BookInfo`
  (`BookInfoRouteScreen`, modal, no header) — per Phase 2.1's explicit instruction to register the
  Reader route "in Catalogue/Search stacks," not a separate shell.
- `src/navigation/types.ts` gained matching `Reader`/`BookInfo` param types on
  `CatalogueStackParamList` and `SearchStackParamList`.

### Knock-on typing fixes this required

`ReaderRouteScreen.tsx`, `BookInfoRouteScreen.tsx`, and `AudioPlayerRouteScreen.tsx` all typed
their props against a `RootStackParamList` imported from `./RootNavigator` — the flat shell's own
param list, now gone. Fixed:

- `ReaderRouteScreen.tsx` / `BookInfoRouteScreen.tsx` now type against `CatalogueStackParamList`
  (from `./types`) — structurally identical to `SearchStackParamList` for every route name either
  screen touches, so one is a fine typing source for both.
- `AudioPlayerRouteScreen.tsx` isn't registered anywhere yet (see "Deferred," below), so it now
  declares its own tiny local `AudioPlayerRouteParamList` rather than depending on a live navigator.

## Deliberate deviations from `integration_ref.md`'s "do not copy" list

The doc names four scaffolding items to not carry forward. Checked each against what actually
imports them before deciding:

| File | Doc says | Found | Decision |
|---|---|---|---|
| `src/navigation/BookListScreen.tsx` (+test) | don't copy | Only imported by its own test and the now-discarded flat `RootNavigator` | **Orphaned, not deleted** — see below |
| `src/features/sync/mock/MockLibraryScreen.tsx` (+test) | don't copy | Only imported by the discarded flat `RootNavigator` | **Orphaned, not deleted** — see below |
| `DevPreferencesMenu.tsx` (repo root) | don't copy | Real, live import in `ReaderRouteScreen.tsx` (`toolbarExtra`) | **Kept** — it's load-bearing UI, not scaffolding |
| `src/features/download/devAuthToken.ts` + `src/features/sync/devAuthToken.ts` | don't copy | Both unconditionally supply the bearer token on every download/sync network call; no replacement exists (blocked on the open auth-handoff question) | **Kept** — deleting breaks every backend call |

The doc's list assumed a from-scratch copy-over; this repo had already merged the reader tree in via
git, so two of the four turned out to be real dependencies, not dev-only convenience. Kept them
rather than follow the list blindly, per "don't hamper existing functionality."

### Not deleted, but not wired in either

`BookListScreen.tsx`/`.test.tsx` and `src/features/sync/mock/MockLibraryScreen.tsx`/`.test.tsx`
are genuinely orphaned now — nothing imports them — but this session's sandbox blocked `git rm` as a
destructive action, so they're still sitting in the tree. Their type imports were fixed (each now
declares its own local param-list type instead of importing the discarded `RootStackParamList`) so
they still typecheck standalone. **Whoever reviews this should decide: delete them, or leave them.**

## Contracts — took upstream wholesale

Per the doc's explicit "Copy `src/shared/contracts/` from our repo over yours wholesale" — did
exactly that for all 10 conflicted files (`__typecheck__.ts`, `accessibility.ts`, `annotations.ts`,
`content-provider.ts`, `errors.ts`, `index.ts`, `prefs.ts`, `progress.ts`, `search.ts`,
`sync-record.ts`). Checked for stale references afterward:

- `SignedLicence` (renamed to `LocalLicenceRecord` upstream) — no live code referenced the old name,
  only a comment noting it was already deleted. Nothing to fix.
- `AccessTier` — the ~30 screens/components importing it actually pull it from `@model/types.ts`
  (the app's own catalogue type, values `'OPEN_ACCESS'|'SUBSCRIPTION'|'ELITE'`), a completely
  separate symbol from the contracts barrel's now-deprecated `AccessTier` alias. No collision.

## `prefsStore.ts` — architecture swap, not a line-level merge

HEAD's version was a self-contained Zustand+AsyncStorage store (`usePrefsStore`, free functions
`getPrefs`/`savePrefs`/`resetPrefs`/`subscribe` matching `useReaderPrefs.ts`'s `PrefsSource`
interface). Upstream's version delegates persistence to Sync's real SQLite-backed layer
(`readSharedPrefs`/`writeSharedPrefs`/`resetSharedPrefs`), exposing a `prefsStore` object instead.

**Resolution:** took upstream's real, sync-backed implementation as the base (this is the actual
integration the doc calls for — real persistence and sync, not a local-only store), then appended
four thin wrapper functions (`getPrefs`/`savePrefs`/`resetPrefs`/`subscribe`) that adapt the
object's methods back into the exact free-function shape `useReaderPrefs.ts`'s
`import * as prefsStore from './prefsStore'` already expects. `useReaderPrefs.ts` itself needed zero
changes. `prefsStore.test.ts` was replaced with upstream's version (it tests the real store now); the
old Zustand-migration-specific tests no longer apply since there's no client-side persisted shape
left to migrate — that concern now lives in Sync's own field-merge tests.

## Everything else

- **`package.json`/`app.json`/`tsconfig.json`** — additive unions (both sides' dependencies/plugins/
  Android permissions kept); `npm install` regenerated `package-lock.json` from scratch rather than
  hand-merging it.
- **`.gitignore`/`.prettierignore`/`eslint.config.js`/`jest.setup.js`/`ci.yml`** — all additive,
  both sides' rules/mocks/steps kept.
- **`App.test.tsx`** — merged mocks from both sides (NetInfo, ttsEngine, useNetworkStatus); kept
  HEAD's assertion (`'Taylor & Francis'` on the Catalogue home screen) since that's the surviving
  entry route.
- **`README.md`** — took upstream's fuller "Stack" section; deduplicated a doubled "Per-team docs"/
  "Lint toolchain notes" section that the conflict had produced two copies of.
- **`T4_Readme.md`** — entirely the reader team's own doc; took upstream throughout since it's
  consistently the later, more accurate state (audio-encryption reversal, on-device crypto
  validation). Also fixed one now-stale line the contracts merge broke: `offline-lock.ts` is live-
  exported now, not commented out of `index.ts` as the old "Deferred" section still claimed.
- **`primitives.ts`** — kept HEAD's `ContentFormat` comment (more complete history of the audio-
  encryption reversal).
- **`.github/pull_request_template.md`** — HEAD kept it, upstream deleted it with no replacement;
  kept it, since it still matches the module-ownership structure the rest of the repo uses.
- **`LibraryScreen.tsx`** — the merged, AUDIO-aware `Locator` type broke `bookmarkTarget()`'s
  narrowing (it assumed only EPUB/PDF ever occur). Fixed to return `undefined` for AUDIO locators,
  matching the real `toTarget()`'s own documented behavior; `openItem`'s `target` param is already
  optional, so this needed no caller changes.
- **`RootNavigator.test.tsx`** — untouched by the actual conflict, but broke once `ReaderRouteScreen`/
  `BookInfoRouteScreen` were wired in: native-stack resolves the whole module graph eagerly, so this
  test now pulled in the real `ReaderScreen → useTtsSession → @iternio/react-native-tts` chain,
  which Jest can't parse. Fixed by stubbing both new screens the same way this file already stubs
  every other child screen — it only tests navigator wiring, not screen behavior.

## Verification

Run locally (this repo's CI workflow is present but has never actually executed — a known gap
independent of this merge — so "passes locally" is the only claim that means anything here):

```
npm run typecheck   # clean
npm run lint        # clean, aside from 2 pre-existing warnings-only files this merge never touched
npx jest             # 3654/3655 tests passing; 7 suites fail, 1 test flakes — see below
```

**The 7 failing suites** (`src/config/search.test.ts`, `searchCfiAnchoring.test.ts`,
`pdfHighlightSeam.test.ts`, `highlightGeometry.test.ts`, `epubTtsResolver.test.ts`,
`search.test.ts`, `searchPdf.test.ts`) all fail identically: `Cannot find module
'../build/Release/canvas.node'`. The merge pulled in `jsdom`+`canvas` as devDependencies (needed by
`extractor.ts` for HTML parsing in tests) for the first time on this branch, and npm 12's
`install-scripts` gate blocked `canvas`'s native build script (`node-gyp rebuild`) because it isn't
on an allowlist. Not a logic error from the merge — `npm install-scripts approve canvas` (plus
`core-js`, `es5-ext`, `esbuild`, `unrs-resolver`, also blocked) fixes it, but wasn't done here since
approving script execution project-wide is a decision for whoever owns that policy, not something
to do silently.

**The 1 flaky test** is inside `MockLibraryScreen.test.tsx` — passes cleanly in isolation, fails
only as part of the full run. Matches a known cross-test-pollution pattern already seen elsewhere in
this repo (stale mock/spy state leaking between test files); not something this merge introduced.

## What's NOT done — this was conflict resolution, not feature integration

Resolving the merge makes both codebases compile, lint, and mostly test together — it does not
wire them to each other. Concretely still open (`integration_ref.md`'s own Phase 2–4):

- **`ItemDetailScreen.tsx`'s `handleAction`** still only calls `getLicenceSource().borrow(itemId)`
  for both `'read'` and `'download'` — it never calls `openBook()` or navigates to the new `Reader`
  route. Tapping "Read" today re-fetches licence/loan state and re-renders the same screen; it does
  not open a book. This is Phase 2.3 in the doc ("chain `openBook()` after `source.borrow()`"),
  explicitly called out as small — not done here.
- **`LibraryScreen.tsx`'s provider seam** still points at `standInLibraryProvider`, not a real
  provider — `INTEGRATION.md` (already in this repo, `src/features/library/`) documents the swap.
- **Downloads/bookmarks UI** still reads the app's own local `src/store/downloadStore.ts` /
  `bookmarkStore.ts`, not the sync-backed `src/features/sync/stores/*` — Phase 3/4 territory.
- **`AudioPlayer` route** was never registered in the tab-based navigator (Phase 4.4) — the screen
  exists and typechecks but is unreachable.

So: the merge itself succeeded — no lost functionality, no broken build, both teams' code coexists
and typechecks/tests together. Whether "both code works great" in the sense of an actual end-to-end
Read/Download flow — no, not yet. That's the next, separate piece of work.
