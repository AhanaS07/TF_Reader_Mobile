# Proposal: distinguish `'revoked'` from `'closed'` in the TTS interruption reason

**Status: proposal only, not implemented. Needs Karthik's and Abhinav's sign-off before
`ReaderScreen.tsx` or `realReaderTextProvider.ts` is touched** — both files live in
`src/features/reader/`, Ahana's ownership per this repo's `CLAUDE.md` table. This document is the
extent of the change made from here.

Written from `src/features/accessibility/` (Hruthik's lane), prompted by `TTS_PROVIDER.md` open
item 1 and `API_CONTRACT_NOTES.md §9`'s design note on revocation mid-TTS-session.

## What already exists, and what's actually missing

**The safety property already holds — this is a labeling proposal, not a bug fix.** A live
revocation while a book is open already stops TTS correctly, through two independent, already-wired
paths converging on `ReaderScreen.tsx`'s `tearDownAndLock` (`ReaderScreen.tsx:1142-1160`):

- Sync's pushed `content.lock` bus event, `reason: 'revoked'` (`offline-lock.ts`), via
  `useContentLock`'s `onLock` callback (`ReaderScreen.tsx:1179`: `tearDownAndLock(newLock.code, newLock.message)`).
- `startAccessMonitor`'s polled re-verification, which calls
  `tearDownAndLock('ACCESS_REVOKED', ...)` directly (`ReaderScreen.tsx:1427`).

Both paths call `ttsProviderRef.current?.notifyClosed()` (`ReaderScreen.tsx:1149`), which internally
calls `terminate('closed')` (`realReaderTextProvider.ts:185`, `:91`). **`terminate('revoked')` is
reachable in the same function** (`realReaderTextProvider.ts:91`: `function terminate(reason:
'closed' | 'revoked')`) — the interface already models the distinction
(`readerTextProvider.ts`'s `TtsInterruption = 'closed' | 'revoked' | 'navigated'`) — but nothing
calls it with `'revoked'`, because `EpubReaderTextProvider` exposes only `notifyClosed()`, no
`notifyRevoked()`.

**Net effect today:** every teardown, revocation or otherwise, reports `onInterrupted('closed')` to
`useTtsSession.ts`, which already treats `'closed'`/`'revoked'` identically in its handler. So
nothing observable changes for the current codebase if this is never built — this is entirely about
whether a *future* consumer (e.g. a distinct announcement, or `API_CONTRACT_NOTES.md §9`'s
revocation-mid-session design once `B6`/`B7` land) can tell the two apart.

## Proposed change

1. **Add `notifyRevoked()` to `EpubReaderTextProvider`** (`realReaderTextProvider.ts`), mirroring
   `notifyClosed()` exactly:
   ```ts
   notifyClosed() {
     terminate('closed');
   },
   notifyRevoked() {
     terminate('revoked');
   },
   ```
   and add it to the exported interface (`realReaderTextProvider.ts:56`, alongside `notifyClosed(): void;`).

2. **`ReaderScreen.tsx`'s `tearDownAndLock` calls whichever matches the actual reason**, instead of
   always calling `notifyClosed()`:
   ```ts
   const tearDownAndLock = useCallback(
     (code: ReaderErrorCode, message: string): void => {
       // ...
       if (code === 'ACCESS_REVOKED') {
         ttsProviderRef.current?.notifyRevoked();
       } else {
         ttsProviderRef.current?.notifyClosed();
       }
       // ...
     },
     [bookId, raiseError, clearSearch],
   );
   ```
   `'ACCESS_REVOKED'` is already the exact `ReaderErrorCode` both revocation paths use
   (`readerBridge.ts:197`), so this needs no new constant or type — just branching on a value
   that's already there.

3. **`useTtsSession.ts` needs no change.** Its interruption handler already treats `'closed'`/
   `'revoked'` identically (`TTS_PROVIDER.md`'s own note) — this proposal doesn't ask that to
   change, only that the *label* reaching it be accurate. Whether to actually differentiate the
   handling (e.g. a distinct announcement via `ttsAnnouncements.ts`) is a separate, later decision —
   `API_CONTRACT_NOTES.md §9` sketches that as future work, not part of this proposal.

## Why this is worth doing now rather than waiting for `B6`/`B7`

The label costs nothing to add today (both call sites already know which reason applies; this is
a small, localized, mechanically-reviewable change) and removes a rediscovery step later: once
`B6`/`B7` (Download's change feed) ship and revocation-mid-session becomes something that can
actually happen rather than a theoretical case, whoever builds the distinct-messaging follow-up
won't also need to notice and fix this labeling gap first.

## Not in scope here

- Any change to what `useTtsSession.ts` *does* differently for `'revoked'` vs `'closed'` — that's
  `API_CONTRACT_NOTES.md §9`'s follow-up, gated on `B6`/`B7`, not this proposal.
- Any change to `offline-lock.ts`, `useContentLock.ts`, or the revocation-detection mechanism
  itself — all already correct and already wired; this only asks the existing, correct signal to be
  forwarded under its own name instead of collapsed into `'closed'`.

## Sign-off needed

Karthik (owns the `content.lock` bus signal this ultimately traces back to) and Abhinav (owns the
BEK-destruction side of `reason: 'revoked'`, and per `TTS_PROVIDER.md` open item 1, this was
explicitly left as "Karthik + Abhinav's call on whether the label is worth the distinction"). If
declined, no action needed — the safety property this doesn't change already holds either way.
