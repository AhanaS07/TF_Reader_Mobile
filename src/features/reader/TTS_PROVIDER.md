# Reader → TTS seam (`ReaderTextProvider`)

**Owner:** Reader (Ahana) · **Consumer:** Accessibility (Hruthik) · **Status:** interface agreed,
implementation not started, fake in place
**Agreed:** 2026-08-16

The interface is `src/features/reader/tts/readerTextProvider.ts` and it is the whole of what
Accessibility codes against. This file records the decisions behind it, the ownership boundary, the
sequencing, and what has to be deleted when the real implementation lands.

For anything about the WebView bridge itself, `WEBVIEW_BRIDGE.md` is the source of truth. This file
does not restate it.

---

## The boundary

|                    |                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------ |
| Reader owns        | `src/features/reader/**`, the bridge, segmentation, CFIs, spine order, the highlight |
| Accessibility owns | the TTS session, the platform voice, prefs under `accessibility.tts.*`               |
| Crosses the seam   | `TtsSentence`, `TtsFetchResult`, `TtsInterruption`, and nothing else                 |

Accessibility does not send bridge commands, does not read `book.spine`, and does not construct or
parse a CFI. Reader does not read `AccessibilityPrefs` and does not decide when to speak.

**The one boolean that does cross, and how.** Reader decides whether and where the TTS controls
appear, which means it needs `accessibility.tts.enabled` — and the rule above says it cannot go and
read it. So Accessibility exports it as a primitive: `useTtsEnabled()` in
`features/accessibility/tts/useTtsEnabled.ts`. Reader calls that and never imports a prefs shape.
This is also the *only* gate on TTS being available: `useTtsSession`'s `play()` deliberately does
not re-check `enabled`, on the grounds that mounting the controls is already the decision.

`ReaderTextProvider` has **no `dispose`**. Lifetime belongs to whoever owns the book —
`ReaderScreen`, in the effect that calls `closeBook` — and a consumer that could tear the provider
down could tear it down while another consumer was using it. Teardown travels one way, through
`onInterrupted`.

## Decisions, and why

**One sentence at a time.** Never a chapter, never the book. `contentProvider.ts` already makes the
whole decrypted book resident once; a chapter handed to React Native for TTS would be a second copy
of licensed plaintext for no capability gain.

**Segmentation happens in the WebView.** It is the only place a DOM exists, and a CFI can only be
minted from a live range against a section's `cfiBase`.

**`text` and `cfi` are two projections of one DOM Range.** The provider builds the range, then emits
`range.toString()` and `new EpubCFI(range, cfiBase)`. There is no second code path producing the
string, so the spoken text and the highlighted range cannot drift. Everything else about the seam
follows from protecting that property — including the character cap, which must apply while the
range is still open. A caller that truncated the string after receiving it would highlight more than
it spoke.

**Spine order, not TOC order.** A navigation document omits sections, reorders them, and repeats
hrefs — `ReaderScreen.tsx`'s Contents list documents the 20 MB fixture repeating one `src` five
times. `spineIndex` is identity; `chapterHref` deliberately does not cross the seam.

**Empty and unreadable sections are invisible.** The provider skips them and returns the next real
sentence, so `spineIndex` is not contiguous between consecutive sentences. Non-linear spine items
(`linear="no"` — answer keys, ad pages) are stepped over by `next` for the same reason.

**Auto-continue needs no separate call.** `next` crosses spine items itself; `lastInSection` exists
so a caller with `autoContinueChapter` off knows where to stop. `getNextChapter` was proposed and
dropped.

**Resume reads the reader's live position, not `Progress`.** `current(null)` resolves wherever the
reader actually is. After a search hit or a Contents tap that is not the persisted record, and
`Progress.offset` is an integer whose own contract notes say it cannot anchor a reflowable EPUB. No
new preference was introduced.

**A position mid-sentence restarts that sentence.** Sub-sentence resume needs offsets neither
platform TTS engine reports reliably, and would leave the highlight over text that was never spoken.

**Highlighting is a separate call from fetching.** A session prefetches the next sentence while the
current one is still speaking, so painting at fetch time would run the highlight one sentence ahead
of the voice. Pause keeps the highlight, stop clears it, an error clears it, and Reader clears it
itself on user navigation.

**Four non-ok statuses, not seven.** End-of-chapter is `lastInSection` on an ok result, not a
status. An empty chapter is not a status either — it is skipped. Collapsing those two is what keeps
the union small enough to handle exhaustively.

**These methods never reject.** Type-aware lint is on for this directory, and a seam that can both
resolve a status and throw makes every call site carry two error paths for one question. An aborted
request resolves `unavailable`.

**Stale replies are dropped by a generation stamp, internally.** Every bridge request will carry a
`(bookId, generation)` pair; mismatched replies are discarded before they resolve. Accessibility
neither passes nor sees it — pushing that across the seam would be exporting Reader's problem.

## Sequencing

Steps 3 and 4–5 run in parallel. That is the point of the fake: Accessibility is not blocked on the
WebView conversion.

```
1. Agree the interface                      ✅ 2026-08-16
2. Ship types + FakeReaderTextProvider       ✅ 2026-08-16
3. Accessibility builds the TTS session      ← unblocked, against the fake
4. Reader: typechecked WebView conversion    ✅ 2026-08-18
5. Reader: sentence/highlight bridge + real provider   ← UNBLOCKED, not started
6. Swap fake → real; integration and device testing
```

**Step 4 is done** — prefs-application called the conversion in and it landed the same day, so the
WebView half is typechecked TypeScript that imports its types from `readerBridge.ts`
(`WEBVIEW_BRIDGE.md`). Step 5 is therefore unblocked.

**What the conversion did NOT do for this seam, so nobody plans around a saving that is not there.**
It removed the hand-sync risk; it did not build request/reply. `requestSentence` still needs a
**reply**, which is the first non-fire-and-forget call on this bridge: `buildCommandScript` only
injects a call, and nothing correlates a response back to its caller. That correlation — plus the
`(bookId, generation)` stamp described above — is real work, and it is Reader's. What is genuinely
cheaper now is that the reply's seven-field payload is a shared type rather than a shape to
hand-copy, and that a mismatch is a compile error.

## The fake, and deleting it

`fakeReaderTextProvider.ts` serves canned sentences with **synthetic CFIs that resolve against no
book**. It exercises the shape of the seam — ordering, section boundaries, the character cap,
cancellation, teardown — and nothing about rendering.

It exports from the same folder the real provider will live in, so the swap on the Accessibility
side is one import changing. That only holds while nothing depends on the test-only handles
(`sentences`, `spokenRanges`, `setPosition`, `navigate`, `interrupt`), which exist on
`FakeReaderTextProvider` and **not** on `ReaderTextProvider`. Production code typed as
`ReaderTextProvider` cannot reach them; that is the intended pressure.

Delete together, when step 5 lands:

| #   | Delete                                                                            |
| --- | --------------------------------------------------------------------------------- |
| 1   | `src/features/reader/tts/fakeReaderTextProvider.ts`                               |
| 2   | `src/features/reader/tts/fakeReaderTextProvider.test.ts`                          |
| 3   | every `createFakeReaderTextProvider` call site outside `src/features/reader/tts/` |
| 4   | this section                                                                      |

`readerTextProvider.ts` is **not** on that list — it is the permanent contract. Neither is
`TTS_PROVIDER.md`; strike the table above and leave the rest.

Before deleting, port `fakeReaderTextProvider.test.ts` rather than dropping it. Every case in it
pins a property of the seam, not a property of the fake, so it is the checklist the real provider
has to satisfy — most sharply the two that carry the data-minimisation guarantee: an in-flight
request must resolve `unavailable` when teardown arrives, and every call after teardown must too.

## Open items

1. **`onInterrupted('revoked')` has no source yet.** There is no `onAccessRevoked` anywhere in this
   repo. `offline-lock.ts` defines a `revoked` signal and `event-bus.ts` defines a carrier for it,
   but that file is marked "PROPOSAL — NOT FINALISED, NOT WIRED", is not exported from the barrel,
   and nothing imports it. The nearest real thing today is `verifyReadingAccess` rejecting in
   `readerAssets.ts`, which is per-open rather than live. The reason is wired when a source exists;
   consumers should build against the reason, not the source. **Karthik + Abhinav.**
2. **Does the reader scroll to follow the spoken range?** Undecided. Today `setSpokenRange` paints
   and nothing else, so speech can run past the visible page. The fake does not scroll either.
   Reader's call, but it changes what `current(null)` means after a long read, so it should be
   settled before step 6.
3. **`react-native-tts` is not in `package.json`.** It is a native module, so adding it forces a
   prebuild and a fresh dev build for everyone on T4 — an announcement, not a silent install.
4. **Highlight styling will collide with Personalization's.** Both want `rendition.annotations`.
   Different CSS class per owner, agreed before annotations lands. **Vaishnavi.**
5. **The platform TTS engine retains the utterance.** Out of process and outside anyone's control.
   A known limit for the security notes, not something the seam can close.
