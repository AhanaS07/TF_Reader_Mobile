# Encryption → Reader handoff (for Ahana)

Everything you need to call, in what order, with what arguments, getting back what — to swap
your reader's plaintext sample-EPUB baseline for real decrypted content. I read your branch
(`origin/T4_Ahana`, `ReaderScreen.tsx` / `ReaderWebView.tsx` / `readerAssets.ts` /
`readerBridge.ts`) to write this against your ACTUAL code, not a generic API doc — the patch
below is for your real files, not a hypothetical.

## TL;DR

Your own comment in `readerAssets.ts` already found the exact seam:

> *"THE DECRYPTED-CONTENT SEAM. THIS FUNCTION IS THE ONLY THING THAT CHANGES."*

That's correct. `getBookBase64()` is the only function that needs to change. Everything else —
`ReaderScreen`, `ReaderWebView`, `readerBridge`, the WebView template — stays exactly as it is.
One new thing gets added: a `closeBook()` call when the reader unmounts (see below — not in your
current code, needs to be).

## The API

```ts
import { getBook, closeBook } from '@/features/encryption/contentProvider';
```

### `getBook(bookId: string): Promise<Uint8Array>`

Give it a book ID, get back the **whole decrypted book**, in memory, as a `Uint8Array`. One call.
Everything underneath — keychain, RSA unwrap, AES-256-GCM decrypt, GCM tag verification, disk
persistence — is handled for you. You never touch any of that.

Safe to call more than once for the same `bookId` — it won't re-decrypt or throw, you get the
same buffer back (session-cached).

### `closeBook(bookId: string): Promise<void>`

**Must be called when the reader view for that book closes/unmounts.** This zeroes the decrypted
buffer in RAM. Skipping it leaves plaintext sitting in memory for the rest of the app session —
this is not a style preference, it's the "wipe on close" rule the whole design is built around.
Idempotent (safe to call even if nothing's open), and closing doesn't delete anything from disk —
the book is still there, still available offline, just not decrypted into RAM right now.

That's the entire API surface. Two functions.

## The exact patch to `readerAssets.ts`

Your file today:

```ts
export async function getBookBase64(): Promise<string> {
  const uri = await localUriFor(SAMPLE_EPUB_MODULE, 'sample-plaintext.epub');
  return new File(uri).base64();
}
```

Becomes:

```ts
import { getBook } from '@/features/encryption/contentProvider';

export async function getBookBase64(bookId: string): Promise<string> {
  const bytes = await getBook(bookId);
  return bytesToBase64(bytes); // see "base64 encoder" note below — this function needs to exist
}
```

Two real changes, not one:
1. `getBookBase64` needs a `bookId` parameter now — it currently takes none (it always reads the
   one bundled sample). Where that `bookId` comes from is a plumbing decision on your side (route
   param once `RootNavigator` exists, a prop passed into `ReaderScreen` in the meantime, etc.) —
   not something this handoff can decide for you, since it depends on what's driving navigation
   in your baseline right now.
2. `Uint8Array` → base64 `string` conversion, because that's what your `ReaderCommand` bridge
   protocol expects (`sender({ type: 'open', base64 })`, decoded to an `ArrayBuffer` on the
   WebView side for `book.open(arrayBuffer, 'binary')`). `getBook` returns raw bytes, not base64
   — this conversion has to happen somewhere, and `readerAssets.ts` is the right place per its
   own "only thing that knows where bytes come from" design.

**Base64 encoder — a real open question, not decided for you:** there's already a tested,
portable (`Buffer`-free) `bytesToBase64` in `src/features/encryption/base64.ts`. But importing it
directly from Reader would be a cross-module reach into Encryption's internals, which conflicts
with the "no cross-module imports (go through shared/common)" rule in
`.github/pull_request_template.md`'s own checklist. Three options, genuinely your/Abhinav's call:
- Ask Abhinav to move `bytesToBase64`/`base64ToBytes` into a shared location (`src/shared/`) so
  both modules import it legitimately.
- Copy the ~15-line function into your own file (duplication, but zero cross-module coupling).
- Use `expo-file-system`'s `File` API somehow (write bytes to a temp file, read back as base64) —
  **don't do this one**, it would put decrypted plaintext on disk, which is exactly the thing the
  whole design exists to prevent.

## The exact patch to `ReaderScreen.tsx`

Your `handleReady` today:

```ts
const handleReady = useCallback(
  (sender: (command: ReaderCommand) => void): void => {
    setSend(() => sender);
    void (async () => {
      try {
        const base64 = await getBookBase64();
        sender({ type: 'open', base64 });
      } catch (cause) {
        raiseError('ASSET_LOAD_FAILED', `Could not read the bundled sample EPUB. ...`);
      }
    })();
  },
  [raiseError],
);
```

Needs `bookId` threaded through (however you decide to plumb it in — see above), and the error
handling needs to branch on `ContentFailure` instead of assuming every failure is a missing bundled
asset (see "Errors" below). Rough shape:

```ts
const handleReady = useCallback(
  (sender: (command: ReaderCommand) => void): void => {
    setSend(() => sender);
    void (async () => {
      try {
        const base64 = await getBookBase64(bookId); // bookId from wherever you decide to source it
        sender({ type: 'open', base64 });
      } catch (cause) {
        raiseError(mapContentFailureToErrorCode(cause), describeContentFailure(cause));
      }
    })();
  },
  [raiseError, bookId],
);
```

(`mapContentFailureToErrorCode`/`describeContentFailure` are illustrative names — you already own
`ReaderErrorCode`/`HOST_ERROR_CODES` in `readerBridge.ts`, so how you extend that union to cover
content-decryption failures is your design decision, not prescribed here. See "Errors" below for
what you'd be mapping FROM.)

**New: `closeBook` on unmount.** Nothing in your current `ReaderScreen.tsx` calls anything on
unmount. Add:

```ts
useEffect(() => {
  return () => {
    void closeBook(bookId);
  };
}, [bookId]);
```

Fire-and-forget is fine here — `closeBook` can't meaningfully fail in a way your UI needs to react
to (it's zeroing a buffer, not doing I/O that can be denied).

## The full flow, end to end

```
1. ReaderScreen mounts with a bookId (source: your decision, see above).
2. Existing: getReaderHtmlUri() resolves the bundled reader.html → ReaderWebView mounts.
3. Existing: WebView loads, epub.js/JSZip init, WebView posts { type: 'ready' }.
4. Existing: ReaderWebView's handleMessage sees 'ready', calls onReady(send) → your handleReady.
5. CHANGED: handleReady calls getBookBase64(bookId) instead of the bundled-sample version.
   → internally: getBook(bookId) → contentStore.openSession + decryptBook → real decrypt.
6. CHANGED: getBookBase64 base64-encodes the returned Uint8Array (see encoder note above).
7. Existing: handleReady sends { type: 'open', base64 } over the bridge.
8. Existing: WebView decodes base64 → ArrayBuffer → book.open(arrayBuffer, 'binary').
9. Existing: WebView posts 'rendered', then 'toc'; user reads, 'relocated' fires per page turn.
10. NEW: user navigates away / ReaderScreen unmounts → your new cleanup effect calls
    closeBook(bookId) → the decrypted buffer is zeroed in RAM.
```

Nothing about steps 2, 3, 4, 7, 8, 9 changes. The seam is exactly as narrow as your own comment
said it would be.

## Errors — what `getBook`/`closeBook` can actually throw

Both reject with a typed `ContentFailure`, never a bare string:

```ts
import { ContentError, ContentFailure } from '@/shared/contracts';

try {
  const base64 = await getBookBase64(bookId);
  sender({ type: 'open', base64 });
} catch (cause) {
  if (cause instanceof ContentFailure) {
    switch (cause.code) {
      case ContentError.INTEGRITY_FAILED:     // tampered/corrupted ciphertext — GCM tag failed
      case ContentError.LICENCE_EXPIRED:      // offline licence has expired
      case ContentError.LICENCE_INVALID:      // licence missing/malformed for an encrypted book
      case ContentError.KEYSTORE_UNAVAILABLE: // can't get the key (keychain locked, or no RSA
                                               // keypair registered on this device yet)
      case ContentError.DECRYPTION_FAILED:    // book was never downloaded/stored, session
                                               // confusion, or over the 25MB RAM budget
    }
  }
  // fall through: raise it through your own error-banner system (raiseError), the same way
  // ASSET_LOAD_FAILED / READY_TIMEOUT / etc. already work in readerBridge.ts.
}
```

**Fail-closed, no exceptions:** every one of these must produce an explicit, visible error state.
Never a blank screen, never a partial book, never a silent retry into some fallback. This is a
hard rule from the frozen contract (`errors.ts`), not a formatting preference — your existing
error-banner pattern (`ReaderError { code, message }`) is already built for exactly this, it just
needs `ContentError` codes added to whatever you decide extends `ReaderErrorCode`.

## What you get and what you explicitly don't

- You get: decrypted bytes, nothing else.
- You do **NOT** get `format` (EPUB/PDF/AUDIO) back from `getBook`. You already have to know the
  format to even reach this code (you're specifically building the EPUB path) — it's not repeated
  back to you.
- You do **NOT** get an offline-availability check through this seam.
  `ContentStore.isAvailableOffline(bookId)` exists but isn't exposed via `contentProvider.ts`
  today. Ask if you need it for a "download available offline" indicator — small change, just not
  made speculatively.

## Known gaps — read before you build UI logic on top of this

- **Licence signature (RS256) is NOT verified.** Only expiry is checked. A successful `getBook`
  call means "not expired," not "cryptographically verified." Don't build anything that assumes
  otherwise.
- **`deviceKeypair.ts`'s RSA key is software, not hardware-backed** (no Secure Enclave/StrongBox).
  Doesn't change what you build, just don't describe it as hardware-secured.
- **Update 2026-08-13: Download (Phase 3/4) is now built** — `downloadManager.downloadBook(bookId)`
  is real (permission → storage → 5-book limit → fetch licence → fetch asset → checksum → hand off
  to `contentStore.store()`), so `getBook` now has real production data behind it, not just test
  fixtures. Exactly as predicted below, `getBook`'s own signature didn't change. Two things worth
  knowing on your side:
  - There is still no navigator to hand `downloadBook`/`getBook` a real `bookId` from user
    action — `devContentSeed.ts` (`ensureSeeded()`) is a temporary dev-only stand-in that calls
    `contentStore.store()` directly with a bundled sample, and `App.tsx` currently imports
    `DEV_SAMPLE_BOOK_ID` from it to feed your `<ReaderScreen bookId={...} />` mount. Both go away
    together once `RootNavigator` lands — see `CLAUDE.md`'s "Temporary scaffolding" section.
  - Search indexes now have a real delivery path too (`content-licence.ts`'s new `index` field,
    fetched by `downloadManager.ts`) — `getIndex()` isn't only reachable through hand-built test
    fixtures anymore either.
- **A real gap surfaced reading the actual flambeau backend spec, relevant to you specifically:**
  the real backend re-checks access on *every book open* (~5 min grant, not just at download
  time) because a subscription/entitlement can lapse in between. Nothing in this codebase does
  that re-check anywhere yet — full detail in `flambeau-contract-comparison.md`. If/when that gets
  built, the natural call site is likely right where you call `getBook()` (before or wrapping it),
  so it'll probably become a conversation between us rather than a silent Encryption-side change —
  flagging now so it's not a surprise later, not asking you to build anything today.
- **RAM budget is a hard 25MB cap** (`MAX_DECRYPTED_BYTES`, exported from `contentStore.ts`). A
  book over that rejects `ContentFailure(DECRYPTION_FAILED)` — as of a 2026-08-12 fix, this is
  now checked BEFORE the file is even read into memory on a cold start, not just after. Flagged
  in `docs/build-status.md` as possibly unrealistic for real book/audio sizes long-term.
- **Your own base64-over-`injectJavaScript` transport note still applies and gets MORE relevant
  once this is wired in** — you already flagged in `readerAssets.ts` that this "does not scale"
  past a small fixture (fine for 3.6KB, not fine for a ~20MB real book). That's your call to
  revisit when it matters, not solved here.
- **Only confirmed on simulator/emulator** (both iOS and Android), never a physical device.
- **`close()` racing an in-flight `decryptBook()`** is a known, deliberately-unfixed edge case
  (see `bugs.md`) — extremely unlikely to matter for a single-book reader view, flagging for
  completeness, not because it's likely to bite you.

## Commands to verify the integration on your side

```bash
npm run typecheck                                    # must stay 0 errors
npm run lint                                          # must stay 0 errors/warnings (--max-warnings=0)
npm test -- contentProvider                           # the encryption side's own tests, if you want to see them pass
npm test                                              # full suite — should include your reader tests too
```

There's still no single command that runs "the reader against real encryption" end-to-end,
because there's no navigator yet to drive `downloadBook`/`getBook` from a real user action (see
the `devContentSeed.ts` note above) — `downloadManager.test.ts` proves the download half for real
under Jest, and `contentProvider.test.ts` proves the decrypt half, but nothing wires them together
outside a test today. Once your side calls `getBook` against a book that actually went through
`downloadBook` (even via `devContentSeed.ts` in the meantime), the way to prove it works for real
is the same pattern used for the crypto layer itself — see `docs/build-status.md`'s on-device
confirmations for the shape of that (temporarily wire a console-log check into a screen, run on a
real simulator/emulator, capture the result, revert).

## Where to look

- `src/features/encryption/contentProvider.ts` — the actual seam, ~40 lines, read it directly.
- `src/features/encryption/contentProvider.test.ts` / `.edgecases.test.ts` — round trips, error
  propagation, close-then-reopen behavior, all against real crypto (not fakes) under Jest.
- `bugs.md` — every bug found on the Encryption side so far, fixed and open, in case something
  you hit while integrating turns out to already be a known issue.
- `docs/build-status.md` — the living status doc with full on-device evidence and the complete
  list of what's real vs. stubbed vs. deferred.
