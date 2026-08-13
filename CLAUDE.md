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

`assets/reader/reader.html` (from `reader.template.html`, via `npm run reader:build-html`) and
`assets/reader/sample-plaintext.epub` (via `npm run reader:build-sample`). Never hand-edit either;
regenerate and commit the result.

## Frozen contracts

`src/shared/contracts/` is the Week-1 freeze — the interface between seven capabilities owned by
five people. `__typecheck__.ts` is the canary. **If the canary goes red, a freeze broke: find out
why, don't "fix" the canary.** It is in `.prettierignore` deliberately (`@ts-expect-error` is
line-positional). Import via the `index.ts` barrel, never deep paths.

## Ownership — flag before editing another team's files

| Area                                                    | Owner        |
| ------------------------------------------------------- | ------------ |
| `src/features/reader/`                                  | Ahana        |
| `src/features/download/`, `src/features/encryption/`    | Abhinav      |
| `src/features/sync/`                                    | Karthik      |
| `src/features/personalization/`, `src/features/search/` | Vaishnavi    |
| `src/features/accessibility/`                           | Hruthik      |
| `src/shared/`, `samples/`                               | Ahana (lead) |

Editing outside Reader needs the owner looped in. Prefer a test that documents the defect plus a
local workaround, and say clearly that the real fix needs sign-off.

**Known open item:** `contentStore.store()` does not invalidate the keychain-cached BEK, and
`resolveRawKey()` prefers that cache over unwrapping `wrappedBek` — so a re-download with a new
BEK fails `INTEGRITY_FAILED` permanently. Documented in `contentStore.edgecases.test.ts`
("stale-cached-BEK trap") and worked around by `destroy()`-before-`store()` in `devContentSeed.ts`.
The real fix is Abhinav's call.

## Temporary scaffolding

`src/features/reader/devContentSeed.ts` stands in for Download's real download pass. Delete it and
`assets/reader/sample-plaintext.epub`, and drop the `ensureSeeded()` call in `readerAssets.ts`,
when the real pass lands.

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
