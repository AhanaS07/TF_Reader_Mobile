# CLAUDE.md — standing instructions for this repo

TF Reader mobile (Expo / React Native), team t4targaryen, CAP-7 Reader & Offline.
Read `README.md` (repo-wide) and `T4_Readme.md` (CAP-7 specifics) for context. This file is only
the rules that must survive across sessions.

## Reader ⇄ WebView bridge — read the doc before touching it

**`src/features/reader/WEBVIEW_BRIDGE.md` is the source of truth for the reader bridge.**

The WebView half (`src/features/reader/webview/reader.template.html`) is deliberately **not
typechecked**, so the contract between it and `readerBridge.ts` is hand-maintained. That doc
records the current surface, the conditions that end the arrangement, and which upcoming stage
trips them.

**Read it before** adding or changing any `ReaderMessage` type, any `READER_COMMANDS` entry, any
`window.TFReader` method, or anything in the template.

**Then update it.** When the bridge changes, in the same change:

1. Update **both** halves — `readerBridge.ts` and `reader.template.html`.
2. Add the case to `parseReaderMessage()`.
3. Run `npm run reader:build-html`. `assets/reader/reader.html` is a **generated but tracked**
   artifact — editing the template without regenerating leaves the two silently divergent.
4. Update the **Current surface** table in `WEBVIEW_BRIDGE.md`.
5. **Re-run the trigger test in that doc.** If a trigger now fires, converting the WebView JS to a
   typechecked build _is the task_ — not a follow-up ticket. Say so explicitly.

Short version of the trigger, so it isn't skipped: >8 message types, any case past ~3 fields, a
command needing a **reply**, or a **frozen `src/shared/contracts/` type crossing the bridge**.
The prefs-application stage is expected to trip it. Flag it rather than quietly hand-syncing.

## Generated and tracked artifacts

`assets/reader/reader.html` (from `reader.template.html`, via `npm run reader:build-html`),
`assets/reader/sample-plaintext.epub` (via `npm run reader:build-sample`), and
`assets/reader/sample-search-index.json` (via `npm run reader:build-sample-index`). Never hand-edit
any of them; regenerate and commit the result.

CI enforces this for `reader.html` only (the "Reader HTML is freshly generated" step: rebuild,
then `git diff --exit-code`). Forgetting the rebuild is a red build, not a silent stale ship.
`sample-plaintext.epub` is **not** covered — JSZip stamps each entry with the generation time, so
it is not byte-reproducible and the same check would fail every run. That one is still on you.

`sample-search-index.json` is not covered either, but for a different reason: it *is* byte-
reproducible (no timestamps), so a freshness check would work. It is left out to keep CI's scope
unchanged for a file that is temporary scaffolding — see the deletion table below. Regenerate it if
the sample EPUB changes, or its CFIs will point into a book that no longer matches.

## Frozen contracts

`src/shared/contracts/` is the Week-1 freeze — the interface between seven capabilities owned by
five people. `__typecheck__.ts` is the canary. **If the canary goes red, a freeze broke: find out
why, don't "fix" the canary.** It is in `.prettierignore` deliberately (`@ts-expect-error` is
line-positional). Import via the `index.ts` barrel, never deep paths.

Relaxing a frozen field to match a **published** external spec is not a freeze break — it is the
freeze doing its job, because the frozen type was wrong about the wire. Pin the new shape in
`__typecheck__.ts` in the same change. Removing or renaming an exported type **is** a break, and
that is a Contracts Gate conversation.

## The external API contracts — read your capability's notes before touching wire code

`src/shared/contracts/` is the *internal* freeze. The **external** contracts are team wokay's and
team flambeau's published OpenAPI specs, and this app diverges from them in ways that are tracked,
not accidental. Findings have stable IDs (`A1`, `B4`, `C7`) — quote the ID rather than restating the
problem.

| Read this | Before touching | Owner |
| --------------------------------------------------------- | ---------------------------------------- | --------- |
| `src/shared/contracts/CONTRACT_ALIGNMENT.md` | anything in `src/shared/contracts/` | Ahana |
| `src/features/download/API_CONTRACT_NOTES.md` | any HTTP call, `DownloadError`, the open path | Abhinav |
| `src/features/encryption/API_CONTRACT_NOTES.md` | licence/key logic, `deviceKeypair.ts` | Abhinav |
| `src/features/sync/API_CONTRACT_NOTES.md` | `syncApi.ts` URLs, `syncConfig.ts`, a new entity | Karthik |
| `src/features/search/API_CONTRACT_NOTES.md` | `queryIndex.ts`, anything catalogue-shaped | Vaishnavi |
| `src/features/personalization/API_CONTRACT_NOTES.md` | prefs shapes that sync | Vaishnavi |
| `src/features/accessibility/API_CONTRACT_NOTES.md` | prefs scope, the TTS seam | Hruthik |

`CONTRACT_ALIGNMENT.md` is the ledger — status of every finding, and who has to close it. The
per-capability files are the detail: what breaks, what to change, what is blocked on another team's
answer, and which things look wrong but are correct and must not be "fixed".
`src/shared/contracts/API_CONTRACT_REVIEW_CONTEXT.md` is the full evidence base (every quote and
mapping table); it is committed rather than linked because three tracked files used to cite a
`flambeau-contract-comparison.md` that has never existed on any branch. **If you add a contract
citation, cite a path that resolves.**

**When you close a finding, strike it in both the capability file and the ledger, in the same
change.** A ledger that lags the code is worse than no ledger.

Two items are blocking and are questions for other teams, not code: **`C6`** (neither contract says
how the app receives its token after the SAML browser round trip — blocks all auth) and **`C7`**
(the `keyFingerprint` digest recipe is a guess, and the check now fails closed, so a wrong guess
rejects every encrypted download).

## Ownership — flag before editing another team's files

| Area                                                    | Owner        |
| ------------------------------------------------------- | ------------ |
| `src/features/reader/`                                  | Ahana        |
| `src/features/download/`, `src/features/encryption/`    | Abhinav      |
| `src/features/sync/`                                    | Karthik      |
| `src/features/personalization/`, `src/features/search/` (in-book search only) | Vaishnavi    |
| `src/features/accessibility/`                           | Hruthik      |
| `src/shared/`, `samples/`                               | Ahana (lead) |

`src/features/search/` is **in-book full-text** search over a decrypted per-book index — it touches
neither external contract. **Catalogue/discovery search** (wokay's OPDS feeds, institution picker,
`items:batch`) is a *different* capability that shares the word "search" and is currently
**unowned** — finding `C3` in `CONTRACT_ALIGNMENT.md`. This row does not cover it; do not assume the
OPDS client falls to Vaishnavi because it says "search."

Editing outside Reader needs the owner looped in. Prefer a test that documents the defect plus a
local workaround, and say clearly that the real fix needs sign-off.

The same boundary applies to **tooling strictness**, not just code. Type-aware ESLint
(`no-floating-promises`, `no-misused-promises`, `await-thenable`) is enabled for
`src/features/reader/**` only — see the scoped block at the bottom of `eslint.config.js`. It is
scoped because turning it on repo-wide would hand every other capability a pile of lint failures
on Reader's schedule. **To opt your directory in, add it to that block's `files` list** — the rule
set and the `projectService` wiring are already there, so it is a one-line change. Do not enable
it for someone else's directory on their behalf.

### Known open items — both are Abhinav's call

This list used to have three. **The stale keychain-cached BEK is fixed:** `store()` now clears the
cached BEK when the incoming `wrappedBek` differs from the persisted one
(`invalidateStaleCachedKeyIfRotated`, `contentStore.ts:206`), and
`contentStore.edgecases.test.ts` pins the fix rather than the defect. `devContentSeed.ts`'s
`destroy()`-before-`store()` stays, but for the other things destroy() clears, not for this.

The two below are memory/lifecycle defects found from Reader's side. They are **not** the whole
list of open items in Download/Encryption — the contract-driven ones live in those directories'
`API_CONTRACT_NOTES.md` (see the table above).

**1. `close()` leaves the ciphertext resident.** `contentStore.close()` zeroes `session.plaintext`,
`indexPlaintext` and `rawKey` and drops the session, but does **not** touch the module-level
`packageCache` — only `destroy()` does. So after `closeBook(bookId)` the whole **ciphertext** stays
in RAM: 20 MB for the test book, indefinitely, for a book the reader has finished with.

Reader has **no legitimate workaround**, and this is not a style opinion: `contentProvider.ts`
exposes only `closeBook` (→ `close`), reaching past the frozen one-call seam into `contentStore` is
exactly what that seam exists to prevent, and `destroy()` is terminal anyway (deletes ciphertext +
BEK, forcing a re-download). The one-line fix is `packageCache.delete(bookId)` inside `close()`, and
it is genuinely a trade-off rather than an oversight — it makes the next open a cold read, i.e. a
fresh 20 MB **synchronous** `bytesSync()` on the JS thread (`contentStore.ts:229`). That call is
Abhinav's to make.

**2. Peak memory tracks the NUMBER of full-size copies, not the cost of making them.** The headline
holds and is now proven twice over: **both** codec swaps have landed, time fell by ~30x, and the
peak did not move. Measured on a real 20 MB EPUB (iPhone 17 Pro simulator, dev build):

| | 2026-08-13, before codec swaps | 2026-08-17, both landed | Verdict |
| --- | --- | --- | --- |
| App RSS peak | 609 MB | **631 MB — still unchanged** | 🔴 the real problem |
| WebContent RSS peak | 389 MB | 385 MB | 🟢 |
| `encode` (Reader's hop) | 1820 ms | 21 ms | ✅ fixed |
| `decrypt` (`getBook`) | 4882 ms | **104–118 ms** | ✅ fixed by Abhinav, `47bc4ce` |
| `getBookBase64` TOTAL | ~6.7 s | **149–310 ms** | ✅ |

Abhinav's `47bc4ce` swapped `aesGcm.ts` to `react-native-quick-base64` directly — better than this
file's earlier proposal to route `base64.ts` through it, because `base64.ts` stays the portable,
no-native-dependency fallback its own header promises. **Time is no longer the lever; nothing here
is waiting on a codec.**

What did NOT change is the point: opening a book still materialises the payload at full size
roughly **six** times, so a ~630 MB peak survives making every one of those copies ~30x faster. Only
*removing* copies moves the peak. That is now the sole remaining lever, and it is a design change
(streaming, or a bytes-in/bytes-out native API), not an optimisation.

Caveat that must travel with these numbers: **simulator, dev build, and the simulator has no
jetsam.** ~1.0 GB combined would be a likely foreground kill on a 2 GB device. Real-device
confirmation is still outstanding. Also still unmeasured: the post-`closeBook` drop, which needs
`RootNavigator` before anything can unmount `ReaderScreen`.

## Temporary scaffolding

`src/features/reader/devContentSeed.ts` stands in for Download's real download pass. Drop the
`ensureSeeded()` call in `readerAssets.ts` and delete the file when the real pass lands — Abhinav's
`src/features/download/downloadManager.ts` is that pass and has now landed, so this is closer than
it reads.

It has a **second** call site that is easy to miss: `App.tsx` imports `DEV_SAMPLE_BOOK_ID` from it
to feed `<ReaderScreen bookId={...} />`, because there is no navigator yet to supply a real one.
So deleting `devContentSeed.ts` is blocked on `RootNavigator` landing, and the temp wiring in
`App.tsx` (header, styles, direct mount) goes at the same time — one removal, not two.

**`assets/reader/sample-plaintext.epub` is NO LONGER Reader's to delete alongside it.** This file
used to say to remove both together. Since Vaishnavi's search extractor landed, that EPUB is a
**shared fixture**: `src/features/search/extractor.ts:43` hard-codes its path, and deleting it breaks
`search.test.ts`. So its removal now needs Search looped in, separately from and later than
`devContentSeed.ts`.

**The dev search index goes with `devContentSeed.ts` too — five items, not one.** Nothing ships a
search index for the seeded book, so `queryBookIndex` returns `[]` for every search and the search
UI cannot be exercised on a device. `devContentSeed.ts` therefore encrypts a generated index into
`EncryptedPackage.index` (same BEK, own nonce) so there is something real to find. Delete together:

| # | Delete |
| - | ------ |
| 1 | `src/features/reader/scripts/buildSampleSearchIndex.ts` |
| 2 | `assets/reader/sample-search-index.json` |
| 3 | the `reader:build-sample-index` script in `package.json` |
| 4 | the `index` attachment + `!FIXTURE_PATH` guard in `devContentSeed.ts` |
| 5 | `src/features/reader/devSearchIndex.test.ts` (guards 2 against 4) |
| 6 | this table |

`SearchPanel.tsx`, `useBookSearch.ts` and the search wiring in `ReaderScreen.tsx` are **not** on
that list — the UI is permanent and does not know the fixture exists. Removing all five must leave
it compiling and green, with on-device searches simply returning `[]` again. If deleting the
fixture breaks the UI or a test, the boundary has leaked and that is the bug.

`devContentSeed.ts` also reads `EXPO_PUBLIC_READER_FIXTURE_PATH` when set, to load a large EPUB
pushed into the app container instead of the bundled sample (measurement scaffolding — Metro cannot
`require()` an untracked 20 MB asset, and real content must never be committed). It goes with the
rest of the file. **Anything using it must delete the pushed plaintext EPUB from the container when
finished** — that path puts an unencrypted book on disk by construction, which is exactly what a
storage-leak sweep should flag.

### `fakeReaderTextProvider.ts` — stands in for the real TTS text provider

`src/features/reader/tts/fakeReaderTextProvider.ts` serves canned sentences with **synthetic CFIs
that resolve against no book**, so Accessibility (Hruthik) can build a TTS session before the real
provider exists. The real one is blocked behind the typechecked-WebView conversion; without the
fake, Accessibility either idles or hand-rolls a stub, and a hand-rolled stub is a guess at the
interface that makes integration a rewrite rather than a substitution.

**`src/features/reader/tts/readerTextProvider.ts` is NOT scaffolding.** It is the permanent,
agreed contract and it stays. Only the fake goes. Delete together:

| # | Delete |
| - | ------ |
| 1 | `src/features/reader/tts/fakeReaderTextProvider.ts` |
| 2 | `src/features/reader/tts/fakeReaderTextProvider.test.ts` |
| 3 | every `createFakeReaderTextProvider` call site outside `src/features/reader/tts/` |
| 4 | the fake's section in `src/features/reader/TTS_PROVIDER.md`, and this one |

Port `fakeReaderTextProvider.test.ts` rather than dropping it — every case pins a property of the
seam, not of the fake, so it is the checklist the real provider must satisfy. The test-only handles
live on `FakeReaderTextProvider` and deliberately **not** on `ReaderTextProvider`, so production
code typed against the interface cannot reach them; if deleting the fake breaks something outside
`tts/`, the boundary has leaked and that is the bug.

`src/features/reader/TTS_PROVIDER.md` is the source of truth for this seam — the decisions, the
ownership boundary, the sequencing, and the open items. Read it before changing
`readerTextProvider.ts`, and update it in the same change.

## Verifying a change

```
npm test          # jest
npm run typecheck # tsc --noEmit
npm run lint      # eslint --max-warnings=0
```

All three must pass. For reader changes that affect rendering, also run it on the simulator
(`npm run ios`) — `expo-dev-client` is required; Expo Go cannot load the crypto native modules.

## Comment style in this codebase

Comments explain **decisions and traps**, not what the code plainly does — why a whitelist includes
`about:*`, why teardown is its own effect, why `require()` appears in a `.ts` file. Match that.
Do not leave historical narrative ("this used to be…") once it stops being load-bearing, and do not
let prose describe a state the code has moved past.
