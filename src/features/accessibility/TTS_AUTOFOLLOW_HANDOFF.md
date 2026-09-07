# TTS auto-follow (page-turn / auto-scroll) — handoff to Reader (Ahana)

**From:** Accessibility (Hruthik) · **Status:** implemented, 2026-09-07 · **Scope:** EPUB only

This was a handoff, not a change request against Reader's files, and the proposal below shipped as
designed. **Ahana went further than this doc asks for**: rather than sentence-level follow alone, the
shipped version also follows the WORD currently speaking, so a page turns exactly on the first word
of the next page rather than somewhere in the following sentence. That needed real-time word position,
which meant re-landing the `tts-progress` → `setSpokenWordRange` wiring in `useTtsSession.ts` (the
piece reverted 2026-09-07, `API_CONTRACT_NOTES.md` §6) — so the claim two lines below, that Reader's
own files would be the only ones touched, did not hold once word-precision was in scope. See
`TTS_PROVIDER.md` open item 2 for the final design and `ACCESSIBILITY_ARCHITECTURE_MAP.md`'s
`tts.highlightMode` row for the re-landing.

The rest of this document is left as originally written — the proposal it describes is what shipped
at the sentence level, and the reasoning below (why no new bridge command, why `display()`, why the
dedupe) still holds for that half.

## Problem

While TTS is reading, the spoken sentence's highlight can move past the edge of what's currently
displayed. In paginated flow the page never turns; in scrolled-doc flow the view never scrolls. The
reader is left looking at a highlight that no longer exists on screen, or no highlight at all if it
painted off the visible page.

**Repro:** open an EPUB, turn TTS on, let it read continuously across a page boundary — in both
paginated flow and scrolled-doc flow (including the screen-reader-forced scrolled-doc override,
`readerA11yLayout.ts`).

**Root cause.** `setSpokenRange`'s handler
(`src/features/reader/webview/src/epub.entry.ts:1658-1667`):

```ts
setSpokenRange: (cfi) => {
  try {
    if (!rendition) return;
    if (currentSpokenCfi !== null) highlightRemove(rendition, TTS_OWNER, currentSpokenCfi);
    currentSpokenCfi = cfi;
    if (cfi !== null) highlightAdd(rendition, TTS_OWNER, cfi, TTS_SPOKEN_VARIANT, ttsSpokenStyles());
  } catch {
    // Best-effort, per the interface's own contract — swallowed rather than reported.
  }
},
```

only paints/clears the highlight through `highlightSeam.add`/`remove`. It never checks whether `cfi`
is inside the currently visible viewport, and never calls anything that would move the page/scroll
position. `useTtsSession.ts:261` calls this once per spoken sentence
(`source.setSpokenRange(currentlySpeaking.cfi)`), so it's the only place today that learns where
speech currently is.

This isn't an oversight — it's a documented, explicitly undecided gap:

- `TTS_PROVIDER.md` open item 2: *"Does the reader scroll to follow the spoken range? Undecided.
  Today `setSpokenRange` paints and nothing else, so speech can run past the visible page... Reader's
  call."*
- `ReaderScreen.tsx`'s own comment on the "reading aloud" cue says the same thing in different words.

**Scope note.** PDF's `setSpokenRange` is a documented no-op today
(`src/features/reader/webview/src/pdf.entry.ts:1270`) — there is no spoken-range highlight to follow
on PDF yet, so this proposal doesn't apply there until PDF gets TTS highlight support.

## Proposed fix

Stays entirely inside the existing `setSpokenRange` handler. **No new bridge command or
`ReaderMessage`/`ReaderCommand` case needed** — the CFI already crosses the bridge on this call, and
`rendition.display()` is already available WebView-side (it's what `goTo` uses,
`epub.entry.ts:1462-1476`).

1. Get the currently rendered contents via `rendition.getContents()`.
2. **Same-section check first:** `cfiSpinePos(cfi)` (`epubCfiRange.ts:272-293`, already used for the
   search-match verification) against the current contents' `sectionIndex`. A different section is
   definitely off-screen — skip straight to step 4.
3. **On-screen check**, only if same section: `contents.range(cfi).getClientRects()` against the
   visible viewport bounds. This is the same geometry technique the touch hit-test already uses
   (`highlightIdAtPoint`, per `WEBVIEW_BRIDGE.md`'s account of `highlightGeometry.ts`) — not a new
   primitive, just a second caller of it.
4. **If off-screen** (either check fails): call `rendition.display(cfi)` — the same call `goTo`
   already makes. epub.js's manager already resolves this correctly for both flows: the default
   (column/paginated) manager turns the page, the continuous (scrolled-doc) manager scrolls. There's
   no separate "if scroll mode, scroll; if paginated, turn page" branch to write — `flow` is already
   resolved into which manager is active (`mapManager()`), and `display()` is manager-agnostic.
5. **Dedupe** so this doesn't fire redundantly: `setSpokenRange` already only runs once per spoken
   sentence, so the check naturally runs at that cadence. Just track the last CFI that triggered an
   auto-follow `display()` and skip re-displaying if this call's CFI is already the one on screen.

## Open questions as originally written — resolution below each

- ~~**Should auto-follow back off after the reader's own manual swipe/scroll?**~~ **Still genuinely
  open** — shipped without this. No "recently navigated" signal exists; the reader is pulled back to
  the spoken position on the next tick, same as sentence-level would have been. A deliberate scope
  cut, not an oversight resolved elsewhere.
- ~~**Word-level ranges.**~~ **Landed, and used for more than the visual wash.** `setSpokenWordRange`
  is not just painted from `useTtsSession.ts`'s `tts-progress` wiring — it now ALSO drives the
  word-precise half of auto-follow (`followSpokenRange`, called from both `setSpokenRange` and
  `setSpokenWordRange` in `epub.entry.ts`), gated the same way the paint always was:
  `highlightMode === 'word'`.

## Testing / verification checklist — done

- ~~Unit test the visibility check against a mocked `rendition`/`contents`~~ **Done differently**:
  the rect/viewport arithmetic (`anyRectOnScreen`) is extracted into `highlightGeometry.ts` and
  directly unit-tested there with plain objects, no DOM/mocking needed. The DOM-touching glue
  (`spokenRangeVisible`/`followSpokenRange` in `epub.entry.ts`) is pinned by source-text ordering
  assertions in `readerTemplate.test.ts` instead, matching how `epub.entry.ts`'s other DOM-driving
  logic is tested — that file is declared not-unit-tested for exactly this reason.
- On-device: paginated flow, scrolled-doc flow, and the screen-reader-forced scrolled-doc override —
  pending device verification (same status as word-level highlighting's own on-device pass,
  `TTS_PROVIDER.md`'s note on `selectionTheme.ts`'s opacity constants).
- `npm test && npm run typecheck && npm run lint` — green. `npm run reader:build-html` WAS needed —
  `anyRectOnScreen` is a new export on `highlightGeometry.ts`, a shared pure module, contradicting
  this doc's own guess above that it shouldn't be. Both generated HTML files were regenerated;
  `reader-pdf.html` came out byte-identical (the PDF entry never imports the new export).
- `TTS_PROVIDER.md` open item 2 struck; this doc and `ACCESSIBILITY_ARCHITECTURE_MAP.md`'s risk
  register updated in the same change.
