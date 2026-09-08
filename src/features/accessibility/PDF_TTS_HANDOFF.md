# PDF text-to-speech — handoff to Reader (Ahana)

**From:** Accessibility (Hruthik) · **Status:** proposal, not implemented · **Scope:** PDF only

This is a handoff, not a change request against Reader's files. Everything below lives in
`src/features/reader/**`, which is Ahana's lane — see `CLAUDE.md`'s ownership table. The one thing
on Accessibility's side of the seam — whether `useTtsSession.ts` needs to change too — has already
been answered empirically (see "What this side needs" below), not left as an open question here.

## Problem

TTS only works for EPUB today. `pdf.entry.ts`'s `requestTtsSentence`/`setSpokenRange`/
`setSpokenWordRange` are documented no-ops:

```ts
/**
 * Documented no-op. Reader never constructs a ReaderTextProvider for a PDF book — the TTS seam is
 * EPUB-only (readerTextProvider.ts's segmentation model is CFI-based) — so this should never
 * actually be invoked. ...
 */
requestTtsSentence: ({ requestId }) => {
  post({ type: 'ttsSentence', requestId, result: { status: 'unavailable' } });
},
```

They exist only because `TFReaderApi<'openPdf'>` requires every shared bridge command to have some
implementation in both shells. `ReaderScreen.tsx`'s provider construction is gated the same way:

```ts
const ttsProvider = useMemo<EpubReaderTextProvider | null>(() => {
  if (!ttsEnabled || format !== 'EPUB' || send === null) return null;
  return createEpubReaderTextProvider(bookId, send);
}, [bookId, format, send, ttsEnabled]);
```

`TTS_PROVIDER.md` never mentions PDF — this is new design territory, not a deferred item.

**This is buildable, but it's genuinely new engineering, not just wiring an existing path to a new
command.** PDF already has a real text layer — `pdf.entry.ts` calls `page.getTextContent()` inside
`renderPageSurface` for every visible page, feeding `pdfHighlightSeam.ts`/`pdfTextRange.ts`'s
box-painting for user highlights and search matches. But that text layer is a flat list of pdf.js
"text items" **with no separators between them and no paragraph/line model** — nothing like EPUB's
real DOM markup, which is what `epubTtsResolver.ts` walks to build sentences. Segmentation is the
hard part; the bridge and the box-painting machinery already exist and are reusable as-is.

## What this side needs (answered, not proposed)

**Nothing.** `useTtsSession.ts` and `ttsEngine.ts` never parse `TtsSentence.cfi` — it's read once
per sentence and passed straight back to the provider (`source.next(sentence.cfi)`,
`source.setSpokenRange(currentlySpeaking.cfi)`), never inspected for CFI structure. This is now
pinned by a test, not just asserted here: `useTtsSession.test.ts`'s `'a PDF-shaped provider
(non-CFI opaque anchor)'` describe block runs the same session scenarios (ordering, a
section/page-boundary stop, crossing an empty section, a `closed`/`navigated` interruption)
against `testSupport/fakePdfReaderTextProvider.ts` — a second fixture whose anchors are shaped
like `"pdf#page=2&sentence=0"`, not `"epubcfi(...)"`. All pass unchanged. So once Reader ships any
provider that satisfies the existing `ReaderTextProvider` interface, `ReaderScreen.tsx` can
construct it for `format === 'PDF'` and the session, controls, and prefs need no code change.

## Proposed architecture for Reader's side

Mirrors the EPUB seam wherever the shapes allow it:

- **Bridge anchor shape.** Extend `TtsSentence`'s anchor to a discriminated union instead of a
  bare `cfi: string`, following the precedent `ReaderSelection` already sets between `cfiRange`
  and `pageRange` (`readerBridge.ts`):
  ```ts
  type TtsAnchor =
    | { kind: 'epubCfi'; cfi: string }
    | { kind: 'pdfRange'; page: number; startOffset: number; endOffset: number };
  ```
  This is the one open design question worth Ahana's explicit sign-off, since it touches an
  existing, tested contract type. The alternative — a parallel `PdfTtsSentence` and a second
  `TtsFetchResult` variant — avoids touching `TtsSentence` at all, at the cost of two code paths
  through `ReaderScreen`/anywhere that branches on the result instead of one.

- **PDF segmentation module.** New `webview/src/pdfTtsResolver.ts` (the DOM-touching half),
  reusing `ttsSegmentation.ts` (the pure sentence-splitter) unchanged:
  - Source text per page from the same `PdfPageSurface.texts`/`lengths` structures
    `pdfHighlightSeam.ts` already builds — no new extraction path needed.
  - Reconstruct reading order/line breaks from each text item's transform (position, font size —
    already present in `getTextContent()`'s output), since items carry no separators today.
  - Anchor each sentence as `{page, startOffset, endOffset}` into that page's concatenated
    text-item string, painting through the *existing* `pdfTextRange.ts`'s `locateOffset`/
    `slicesForRange` + `pdfHighlightSeam.ts`'s box-painting — the same machinery user highlights
    already use, unchanged.
  - Cross-page continuation: `next()` advances to the next page's first sentence when a page's
    text is exhausted, mirroring EPUB's "next crosses spine items itself" rule — no new "next
    page" bridge concept required.

- **Host-side provider.** New `src/features/reader/tts/pdfReaderTextProvider.ts`, structurally a
  copy of `realReaderTextProvider.ts` (pending-request map + generation counter for stale-reply
  protection), differing only in the anchor shape it round-trips.

- **`ReaderScreen.tsx` gate.** Change the `format !== 'EPUB'` check to select between
  `createEpubReaderTextProvider` and `createPdfReaderTextProvider` by format, instead of always
  returning `null` for PDF.

## Explicit non-goals

- **Word-level highlighting.** Implement PDF's `setSpokenWordRange` as the same kind of
  documented no-op the rest of the PDF bridge is today, and hold off on real work there. Its
  status is currently contradictory even for EPUB: `TTS_PROVIDER.md` says it "landed"
  (2026-09-05), but `API_CONTRACT_NOTES.md`/`ACCESSIBILITY_ARCHITECTURE_MAP.md` say the RN-side
  wiring was reverted (`97a20c2`) over a failed typecheck and never re-added after Reader
  re-landed the WebView half (`559c47b`) — so nothing in the app calls it today, on either
  format. Worth a direct conversation between the two of us independent of PDF; PDF shouldn't
  build new work on a mechanism that's already dead for EPUB.
- **Scanned/OCR PDFs with no extractable text layer.** TTS is impossible for these — the same
  pre-existing limitation search/highlighting already has silently today. A known limitation,
  not a blocker.

## Sequencing

1. Sign off on the `TtsAnchor` union design.
2. Add the PDF anchor shape to `readerBridge.ts` + `parseReaderMessage()`; regenerate both
   tracked HTML artifacts; update `WEBVIEW_BRIDGE.md`'s surface table.
3. Build `pdfTtsResolver.ts` and its segmentation logic, unit-tested before wiring in.
4. Replace `pdf.entry.ts`'s three no-ops with real implementations, reusing
   `pdfHighlightSeam.ts`/`pdfTextRange.ts` for painting.
5. Build `pdfReaderTextProvider.ts` host-side.
6. Flip `ReaderScreen.tsx`'s gate; verify on simulator — unit tests can't see a blank page.
7. Regression-check the existing EPUB TTS tests are unaffected by the anchor-union change.

## Verification checklist for whoever implements this

- `npm test && npm run typecheck && npm run lint`.
- Simulator run opening a text-native PDF fixture (`assets/reader/sample-plaintext.pdf`) with TTS
  enabled: confirm sentences speak in order within a page and across a page boundary, and that the
  existing EPUB TTS flow is unchanged.
- `useTtsSession.test.ts`'s PDF-shaped-provider describe block should keep passing untouched —
  if it needs a code change to pass once a real provider exists, that's a sign the interface
  contract shifted and this doc's central claim needs revisiting.
