# TTS auto-follow (page-turn / auto-scroll) — handoff to Reader (Ahana)

**From:** Accessibility (Hruthik) · **Status:** proposal, not implemented · **Scope:** EPUB only

This is a handoff, not a change request against Reader's files. Everything below lives in
`src/features/reader/**`, which is Ahana's lane — see `CLAUDE.md`'s ownership table. Nothing here
touches the accessibility contract or the TTS session; `useTtsSession.ts` already does its part and
needs no change for this.

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

## Open questions — flagging for Ahana's call, not presuming an answer

- **Should auto-follow back off after the reader's own manual swipe/scroll?** If someone manually
  pages back to re-read something while TTS keeps talking, the next `setSpokenRange` call will find
  the spoken CFI off-screen and pull them forward again. No "recently user-navigated" signal exists
  today to suppress that; would need one if the desired behavior is "don't yank back mid-manual-browse."
- **Word-level ranges.** `setSpokenWordRange` is not implemented in `epub.entry.ts` yet
  (`ACCESSIBILITY_ARCHITECTURE_MAP.md`'s risk table, `tts.highlightMode` row). Recommend building
  auto-follow against sentence-level `setSpokenRange` now, and extending the same technique to
  word-level once that lands, rather than blocking on it.

## Testing / verification checklist for whoever implements this

- Unit test the visibility check against a mocked `rendition`/`contents`: asserts `display()` is
  called when the CFI is out-of-section or has off-screen rects, and NOT called when already visible.
- On-device: paginated flow, scrolled-doc flow, and the screen-reader-forced scrolled-doc override
  (`readerA11yLayout.ts`) — confirm auto-follow works under all three.
- `npm test && npm run typecheck && npm run lint`. `npm run reader:build-html` only if the change
  ends up touching a shared pure module (it shouldn't, per the design above — everything needed
  already lives in `epub.entry.ts` and `epubCfiRange.ts`).
- Update `TTS_PROVIDER.md` open item 2 (strike it) and `ACCESSIBILITY_ARCHITECTURE_MAP.md`'s risk
  register in the same change, per this repo's own doc-update convention.
