# T4_Readme — t4targaryen · CAP-7 Reader & Offline

Scope note: this file covers **T4's work** — capabilities, structure, ownership, and the
constraints specific to reader/offline. The root `README.md` covers **repo-wide** concerns that
apply to anyone working in this tree: toolchain, setup, branch model, PR process. Read the root
one first; nothing here restates it.

## Capabilities

CAP-7 splits into seven feature folders under `src/features/`, one per capability:

`reader` · `download` · `encryption` · `sync` · `personalization` · `search` · `accessibility`

## Structure

- `src/shared/` — cross-feature contracts & types shared by every capability. `contracts/` holds
  interfaces, `types/` holds type definitions.
- `src/features/` — one folder per capability, listed above.
- `samples/` — encrypted test assets used by local runs and tests.

Folders are tracked with an empty `.gitkeep` until the work lands.

## Owner map

| Feature                  | Owner        |
| ------------------------ | ------------ |
| Reader                   | Ahana        |
| Download + Encryption    | Abhinav      |
| Sync                     | Karthik      |
| Personalization + Search | Vaishnavi    |
| Accessibility            | Hruthik      |
| shared / samples         | Ahana (lead) |

## Contracts and the freeze

`src/shared/` holds the Week-1 frozen contracts. They are the interface between seven capabilities
owned by five people, so a change to one is a change to everyone's assumptions.

`src/shared/contracts/__typecheck__.ts` is the canary. `satisfies` pins each frozen shape;
`@ts-expect-error` pins each shape we deliberately removed — if someone re-adds one, the directive
becomes unused and `tsc` fails. **If the canary goes red, a freeze broke. Find out why; don't
"fix" the canary.**

Two consequences worth knowing before you touch that file:

- **It is in `.prettierignore`, deliberately.** `@ts-expect-error` only suppresses the _next_
  line, so line position is semantic. A formatter reflowing a single-line object literal into a
  multi-line one pushes the offending property out from under the directive — the directive then
  reports as unused _and_ the error it was hiding escapes. Format it by hand or not at all.
- **`ContentError`, `ContentFailure` and `DEFAULT_PREFS` are real runtime values**, not types.
  Import them as values. `import type { ContentError }` compiles and gives you nothing at
  runtime — you can't `throw` it or `switch` on it. Everything else in the barrel erases.

### File conventions

Contracts are **kebab-case** (`content-provider.ts`, `sync-record.ts`, `content-licence.ts`) and
open with their own real path as the first line (`// src/shared/contracts/<file>.ts`). Every
contract must be re-exported from `index.ts` — the barrel is the single import surface, and a
file missing from it forces consumers into deep imports that break when the file moves.

`tier.ts`, `device-key.ts` and `content-licence.ts` were brought in line with this during P0-1
(renamed from camelCase, header paths corrected, added to the barrel). Their **contents** were
not changed.

`content-licence.ts` and `device-key.ts` are **DRAFT** — written against a mock backend. They are
in the barrel so imports go through one surface, but their field names are not frozen until the
real endpoints are published. They are also not yet pinned in `__typecheck__.ts`, so the canary
will not catch a breaking change to them — worth adding once the backend contract firms up.

## Why the dev build is not optional here

The root README explains how to build a development build. This is _why_ it matters for T4
specifically, and it is the constraint most likely to cost someone a day:

The reader stack depends on native modules that are **not compiled into the Expo Go binary** —
`react-native-keychain`, `react-native-aes-gcm-crypto`, and Android's `FLAG_SECURE`. Expo Go
appears to work right up until the first crypto or secure-storage import, then fails with a
module-not-found that reads like a bundler bug and isn't.

So `expo-dev-client` is a dependency from day one and is listed as a plugin in `app.json`. Build
the dev build **before** starting feature work, not when you hit the wall.

`react-native-keychain` and `react-native-aes-gcm-crypto` are dependencies (Abhinav's encryption
work). Both need config-plugin entries in `app.json` plus a fresh `npx expo prebuild`. If either
ships no Expo config plugin, the answer is a small local plugin — **not** a hand edit under
`android/` or `ios/`, which CNG discards on the next prebuild.

### OPEN RISK: `react-native-aes-gcm-crypto` and the New Architecture

**`expo-doctor` is configured to skip this package.** The exclusion lives in `package.json`
under `expo.doctor.reactNativeDirectoryCheck.exclude`. `package.json` cannot hold comments, so
this section is the record of why — do not remove the exclusion without reading this, and do not
treat the resulting 20/20 as meaning the risk is gone.

What the check was reporting: _"Untested on New Architecture: react-native-aes-gcm-crypto"_.

Why that matters. The package was **last published 2022-07-20** — years before New Architecture
stabilised, and it has had no release since. SDK 57 no longer accepts `newArchEnabled` in
`app.json` at all, which indicates New Arch is not opt-out any more. So this is an unmaintained
native module that has never been validated against the only architecture we can ship on.

**UPDATE (2026-08-11): validated, not just theoretical anymore.** `aesGcm.ts`'s `encrypt`/`decrypt`
were swapped from Node's `crypto` to the real `react-native-aes-gcm-crypto` native calls, then
actually built and run on an iOS Simulator (`expo run:ios`, iPhone 17 Pro): native build
succeeded (0 errors), and a live runtime test logged `RUNTIME_TEST: aesGcm roundTripOk= true` —
a real encrypt→decrypt round trip through the compiled native module, not a mock. Same test also
confirmed `react-native-keychain` (`keychain roundTripOk= true`), catching and fixing a real bug
along the way (`keyStorage.ts`'s `Buffer` usage doesn't exist in the RN runtime — see `base64.ts`).

**Still not fully closed**: only tested on iOS Simulator, not a physical device or Android, and
only with a tiny (12-byte) payload — the bridge/memory cost question for a whole-book-sized
payload (noted below) is untested. Re-evaluating the two alternatives below is no longer
required to unblock work, but may still be worth doing for the large-payload/Android questions:

- **`@noble/ciphers`** — audited, pure JS, actively maintained. No native module, so the New Arch
  question does not arise. Verified during P0-1: it decrypts bytes produced by the current Node
  `crypto` path in the exact `nonce | ciphertext | tag` layout from `cipherLayout.ts`, and
  correctly rejects a single corrupted byte. Existing encrypted samples stay readable. Tradeoff:
  slower than native on large files.
- **`react-native-quick-crypto`** — native JSI, actively maintained, supports New Arch, and
  implements the Node `crypto` API, so `aesGcm.ts` would barely change. Still a native module, so
  it needs a config plugin and a prebuild.

Owner: **Abhinav** (Download + Encryption). Decision made: staying on `react-native-aes-gcm-crypto`
given the confirmed on-device result above; the alternatives remain documented here as the
fallback if the untested Android/large-payload/physical-device cases turn up a real problem.

## Type-level rules this team relies on

- **Plaintext never touches disk.** Decrypted content is `Bytes` (`Uint8Array`), never a path or
  a stream. The type is the enforcement — keep it that way. `epub.js` wants an `ArrayBuffer` for
  `book.open(...)`; get it from `bytes.buffer`.
- **`ContentFormat` is `'PDF' | 'EPUB' | 'AUDIO'`, taken verbatim from wokay.** `AUDIO` is never
  encrypted and never has a search index — `BookSearchIndex['format']` excludes it, and the
  canary pins that.
- **`Timestamp` is epoch milliseconds (client wall-time).** Wire/JSON timestamps from the grant
  and licence are ISO-8601 UTC _strings_ and stay `string`. Don't conflate them.

## Testing notes for CAP-7 work

Beyond the repo-wide notes in the root README:

- Encrypted fixtures live in `samples/`. Never commit real content — encrypted or not.
- `AUDIO` paths need no decryption and no index; assert that rather than assuming it.

## Deferred

`offline-lock.ts` is finalised jointly by **Sync** (Karthik) and **Encryption** (Abhinav). Its
export is commented out of `src/shared/contracts/index.ts`; restore that line when the file lands.
The `content.lock` / `content.unlock` signals live there.
