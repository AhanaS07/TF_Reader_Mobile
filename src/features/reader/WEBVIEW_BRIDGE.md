# Reader ⇄ WebView bridge — one contract, two consumers

**Owner:** Reader (Ahana) · **Status:** **converted 2026-08-18.** The WebView half is typechecked
TypeScript that imports its types from `readerBridge.ts`. The hand-sync contract this file existed to
manage, and the trigger list it existed to enforce, are both **over** — kept below as the record of
how the decision was made, not as a forecast.

**What this file is for now:** the decisions that are still load-bearing about *what crosses the
boundary*, the prefs-application design that the conversion was for, and the short history of why the
debt was taken and when it was called in.

---

## The two halves

| Half                | File                                                    | Typechecked?        |
| ------------------- | ------------------------------------------------------- | ------------------- |
| Host (React Native) | `src/features/reader/readerBridge.ts`                   | yes — `tsc`, strict |
| WebView — shared    | `webview/src/bridge.ts`                                 | **yes**             |
| WebView — EPUB      | `webview/src/epub.entry.ts`                             | **yes**             |
| WebView — PDF       | `webview/src/pdf.entry.ts`                              | **yes**             |
| WebView — pure      | `webview/src/{readerMetrics,epubOutline,pdfOutline}.ts` | **yes**             |

`buildReaderHtml.ts` compiles each entry with **esbuild** (one IIFE per format), inlines it alongside
JSZip + epub.js or pdf.js + its worker, and emits two tracked artifacts:
`assets/reader/reader-epub.html` and `reader-pdf.html`. Regenerate both with
`npm run reader:build-html`. CI rebuilds and `git diff --exit-code`s them, so forgetting is a red build
rather than a stale ship.

The templates are now **HTML and CSS only** — the DOM each entry queries, plus the PDF shell's inert
`text/plain` worker block. That is the one thing a `.ts` file cannot carry, and it is why
`readerTemplate.test.ts` still asserts those selectors exist.

### What the conversion bought, concretely

Each of these was a test that read the WebView half as text. All are now types:

| Was a regex over `.html`                        | Is now                                                                              |
| ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| posted message types match `ReaderMessage`      | `post(message: ReaderMessage)`                                                      |
| raised codes are declared                       | `fail(code: WebViewErrorCode, …)`                                                    |
| host-only codes never raised inside the WebView | the same parameter type excludes them                                               |
| every command has a `window.TFReader` method    | `TFReaderApi<Open>`, a mapped type over `ReaderCommand`                              |
| each shell defines only its own `open*`         | `TFReaderApi<'openEpub'>` vs `TFReaderApi<'openPdf'>`                                |
| — *(nothing could check this)*                  | `CommandArgsMatchPayloads` — a method's **arguments** against its command's payload |

That last row is the one worth noticing. The old guard compared *names*, so a command growing a field
while its method kept the old signature passed silently. Adding a field is now a compile error that
names the command.

**Two things the conversion did NOT change, and both are deliberate:**

1. **`parseReaderMessage()` stays.** Compile-time types do not survive the JSON round trip through
   `postMessage`, and the host still receives a string built from a book's own navigation document —
   untrusted input. Types are not a substitute for the parser. A refactor that "simplifies" it into a
   cast is the change this bridge most needs to refuse.
2. **Scope.** esbuild's `format: 'iife'` keeps everything in the entry module-local except what it
   explicitly assigns to `window`. That preserves *structurally* what the old "inject the fragment raw,
   inside the IIFE" rule preserved by convention — and it matters because this document holds decrypted
   book content.

### What it also found

Both were real defects invisible while the code was untypechecked, and both are the argument for having
done it:

- **epub.js's shipped type for `addStylesheetCss` is wrong.** `contents.d.ts:33` declares
  `Promise<boolean>`; the implementation returns a plain boolean synchronously (`contents.js:769-775`).
  Trusting it made type-aware lint demand a `void` on a non-promise. Narrowed once, in
  `epub.entry.ts`, with the reason recorded there.
- **`OutlineNode.url` is `string | null`, not `string | undefined`.** pdf.js sets it to null for a page
  destination. The runtime check (`!item.url`) was always right; the *type* was wrong, and the
  compile-time assertion that `PDFDocumentProxy` satisfies `OutlineDocument` rejected it.

### Verified on device, both formats

2026-08-18, iPhone 17 Pro simulator, dev build, after the conversion — a rewrite of the entire WebView
half cannot be signed off by unit tests:

| Format | Book           | `open -> rendered` | `open -> toc`      | Errors |
| ------ | -------------- | ------------------ | ------------------ | ------ |
| PDF    | 14.66 MB, 50pp | 277 ms             | 282 ms (`items=0`)  | none   |
| EPUB   | 19.98 MB       | 365 ms             | 365 ms (`items=22`) | none   |

Both are ~11–13% above the pre-conversion figures (249 ms and 322 ms). Small in absolute terms and
plausibly run-to-run variance on a dev build served over Metro, but the direction was consistent across
both formats, so it is recorded rather than rounded away. If it matters, the candidates are esbuild
downlevelling `async`/`await` for `target: safari15` and the `.then`-chain-to-`await` rewrite. Nothing
about behaviour changed.

---

## Current surface

**WebView → host** (`ReaderMessage`)

| Type        | Payload fields                              |
| ----------- | ------------------------------------------- |
| `ready`     | —                                           |
| `rendered`  | —                                           |
| `relocated` | `position` (`ReaderPosition`), `atStart`, `atEnd`, `section` (`ReaderSection \| null`), `internalReposition?` (`boolean`) |
| `toc`       | `items[]` (`{label, target, depth}`)        |
| `error`     | `code`, `message`                           |
| `ttsSentence` | `requestId`, `result` (`TtsFetchResult`)  |
| `selection` | `selection` (`ReaderSelection \| null`) — sent ONLY in reply to `requestCurrentSelection` |
| `highlightPressed` | `id` — sent ONLY in reply to `confirmDeleteHighlight`               |
| `highlightTouchActive` | `active` (`boolean`)                                        |
| `searchMatchPainted` | `painted` (`boolean`) — sent ONLY for a `paintSearchMatch` that asked for a paint, never for a clear |

`ReaderPosition` is **discriminated by ADDRESSING SCHEME**, not by format: `{kind:'cfi', cfi}` or
`{kind:'page', page, pageCount}`. The two formats have no common notion of position — a CFI addresses
a spine offset and has no PDF meaning; a page number has no reflowable meaning — so carrying both flat
would mean one of them is always `null` and the reader has to know which. That is the same "one field,
two meanings" arrangement `toc.items[].href` still has, and this is the first place it was undone.
(Read `kind` as "the position is a CFI", not "the book is an EPUB" — see decision 3 below.)

`ReaderSection` (`{index, href}`) rides the same message but is **not part of the position**, and the
split is the point: a position is where to RESUME, a section is what to CALL where you are. They move
on different events — every page turn moves the position, only a chapter boundary moves the section —
and only one of them is worth announcing. Folding it into `ReaderPosition` would also push it into
`progressStore.savePosition()`, which has no use for a chapter name.
`index` is the 0-based SPINE index; `href` is the spine item's own, and is what a chapter CHANGE is
detected on (a `goTo` inside the current chapter reports the same href, and a spine that repeats an
href would look like a change on index alone). PDF always sends `null` — it has no spine.

**`section` is validated on the OPPOSITE rule to `position`.** An unparseable position **drops the
whole message**; an unparseable section is **defaulted to `null`** and the relocation is kept. A
position nobody can understand makes the message meaningless and a confidently wrong page number is
worse than none — but a garbled section costs one word on one announcement, while the relocation
itself still has to reach the page indicator, TTS and session progress. Refusing it there would trade
a missing chapter name for a reader stuck on the previous page.

`parseReaderMessage` validates a PDF position as two positive integers with `page <= pageCount`, and
**drops the whole message** if it cannot (rather than substituting a default, as the TOC hardeners do).
The relation is the part worth having: each field can be individually valid and jointly impossible, and
"page 7 of 3" is exactly what a rendering bug produces. A stale-but-true indicator beats a confidently
wrong one.

**Host → WebView** (`READER_COMMANDS` ↔ `window.TFReader` method names)

| Command          | Args                          | Reply? | Defined in |
| ---------------- | ----------------------------- | ------ | ---------- |
| `openEpub`       | `base64`                      | no     | EPUB entry |
| `openPdf`        | `base64`                      | no     | PDF entry  |
| `next`           | —                              | no     | both       |
| `prev`           | —                              | no     | both       |
| `goTo`           | `target` (`ReaderTarget`)      | no     | both       |
| `applyAppearance`| `appearance` (`ReaderAppearance`) | no | both       |
| `requestTtsSentence` | `request` (`TtsSentenceRequest`) | **yes** (`ttsSentence`) | EPUB entry (real), PDF entry (documented no-op) |
| `setSpokenRange` | `cfi` (`string \| null`)      | no     | EPUB entry (real), PDF entry (documented no-op) |
| `setSpokenWordRange` | `range` (`SpokenWordRange \| null`) | no | EPUB entry (real), PDF entry (documented no-op) |
| `paintHighlights`| `highlights` (`EpubHighlightPaint[] \| PdfHighlightPaint[]`) | no | both (real) |
| `requestCurrentSelection` | — | **yes** (`selection`) | both |
| `confirmDeleteHighlight` | — | **yes** (`highlightPressed`), only if there was something to delete | both |
| `paintSearchMatch` | `match` (`ReaderSearchMatch`) | **yes** (`searchMatchPainted`), only for a paint | both (real) |
| `setTtsSpeaking` | `speaking` (`boolean`) | no | EPUB entry (real — gates manual swipe/scroll gestures via `touch-action`), PDF entry (documented no-op) |

### The search match — `paintSearchMatch` / `searchMatchPainted`

Search's sibling of the highlight set: Search (Vaishnavi) resolves host-side into a bridge-local
payload (`../search/readerSearchMatch.ts` — `searchMatchFor`, `NO_SEARCH_MATCH`), Reader carries it
across and paints it. `HIGHLIGHT_LAYERS.md` §3 is the visual channel (`search`, an OUTLINE, composing
over the user's fill); this is what is bridge-specific.

**The payload is PARTITIONED, not discriminated, and that is a different move from every other
format-free payload here.** `ReaderSearchMatch` is `{ epub: … | null, pdf: … | null }` with exactly
one side non-null, and **both sides null is the clear**. `openEpub`/`openPdf` route by command NAME
and `paintHighlights` sends a union the shell narrows on arrival; this one carries both sides at once
and each shell reads its own. All three answer the same rule — a frozen `ContentFormat` literal never
crosses — and this one is the shape it takes when the host has no reason to choose: a
`SearchHit.locator` is tagged `type: 'EPUB' | 'PDF'`, `toReaderSearchMatch` strips that host-side, and
the partition IS the routing.

**Do not "tidy" the two nullable sides into one tagged object.** It reads better and puts a frozen
enum on the wire. `readerBridge.test.ts`'s ContentFormat check and `readerSearchMatch.test.ts`'s own
serialisation check both fail if you do.

**No clear command, and no add/remove pair.** `NO_SEARCH_MATCH` is one canonical payload, and
`searchMatchFor` returns it for `activeIndex === -1` and for an index past the end of `hits` — which
covers dismissing the match bar, closing the panel, and a new `submit()`, since all three reset the
index. `ReaderScreen` therefore sends from ONE effect over search state, exactly as `paintHighlights`
sends from one effect over the highlight set.

**THE PAINT IS USUALLY DEFERRED, IN BOTH SHELLS, AND THAT IS WHY THE REPLY IS NOT SENT FROM THE
COMMAND HANDLER.** The host sends this immediately after `goTo`, and both shells need something that
does not exist yet: the EPUB shell needs the target chapter's document loaded, the PDF shell needs
the target page rasterised. So the command handler normally answers `pending` — silence — and the
real outcome is reported later, from `hooks.content`/`relocated` (EPUB) and `renderPageSurface`
(PDF). Both de-dupe on what was last said, because those sites also run on every page turn, zoom and
spread flip.

Reading "not yet" as "could not" is the failure this shape prevents: it would put a notice on screen
for every match, and nothing would retract it.

**The EPUB shell VERIFIES a range in its own chapter before filing it**, and that is a hard
requirement rather than caution. A range whose end offset runs past its text node throws
`IndexSizeError` out of `EpubCFI.toRange` — and `Annotations.inject` re-attaches every stored
annotation for a section from `hooks.render` **with no try/catch**, so an unverified one that got
filed throws inside the render chain every time the reader opens that chapter, surfacing as
`WEBVIEW_UNHANDLED_REJECTION` and the error banner. A match that cannot be drawn must cost a quiet
notice, never a broken chapter.

The verification has to find the chapter by SPINE POSITION (`epubCfiRange.ts`'s `cfiSpinePos`,
compared against `contents.sectionIndex`), not by resolving and seeing: `EpubCFI.toRange` ignores the
spine component, so a CFI from another chapter resolves against the wrong document rather than
failing. Measured on the sample book — 399 of 400 foreign CFIs came back as real ranges.

**And not by comparing `contents.cfiBase` either, which is how this shipped and why the feature
painted nothing on a device.** The search index spells a chapter's base `/6/2[ch1]` and epub.js
spells it `/6/2` — `spine.js:59` builds the assertion from the `<itemref>`'s `id` ATTRIBUTE, not its
`idref`, and normal EPUBs (this repo's sample included) have no `id` there. The comparison answered
"different chapter" forever and the paint was gated off in silence. `cfiSpinePos` is immune to that
and to the second divergence behind it (the two producers also count spine steps differently); it is
the comparison epub.js itself makes in `Annotations.add`. `searchCfiAnchoring.test.ts` runs both
producers for real and pins the agreement.

**`searchMatchPainted` is a NOTICE, not an ack.** The command is fire-and-forget; nothing waits on
the reply. It exists because the failure is otherwise invisible — the `goTo` that precedes every
paint has already succeeded, so a match that never painted looks exactly like one that painted off
screen. It is deliberately NOT a `fail()`: that drives the reader's error banner and the in-page
fallback, which is the right response to a corrupt book and a wildly disproportionate one to a CFI
that would not expand. The host shows a quiet line above the match bar instead.

The PDF shell answers `painted: false` for its **page-level cue** as well as for a true miss: the cue
draws something (an outline round the whole page) but not what was asked for, and the notice is what
explains why the mark is round the page rather than the word.

**Sent only for a payload that asked for a paint.** A clear cannot fail, and reporting one would make
the host retract a notice it has already dropped.

### The spoken word — `setSpokenWordRange`

The refinement of `setSpokenRange`: that one says which SENTENCE is being read, this one says which
WORD inside it. Sent on every `tts-progress` event while `tts.highlightMode === 'word'`; `null`
clears. Accessibility (Hruthik) is the only caller, through `ReaderTextProvider`.

**One nullable payload OBJECT, not three fields, and the constraint is `bridge.ts`'s own proof.**
Every command here carries exactly one non-`type` field, because `ExpectedArgs` /
`CommandArgsMatchPayloads` derive a method's argument tuple from its payload's fields: a three-field
command collapses to a 1-tuple of a union there and cannot match a 3-tuple. It also keeps this in the
uniform `JSON.stringify(command.x)` chain in `buildCommandScript` rather than needing a bespoke
branch, and makes "clear" mean `null` instead of `(null, 0, 0)`.

**`start`/`end` index the SPOKEN STRING, not the DOM.** They are the offsets the platform engine
reports against `TtsSentence.text`, which is whitespace-collapsed, trimmed, and may span several text
nodes. Turning them back into a paintable range is arithmetic the WebView does against the live
document (`webview/src/ttsWordOffsets.ts`, pure and unit-tested; `epubTtsResolver.ts`'s
`resolveSpokenWordCfi` for the DOM half). **String arithmetic on the sentence CFI cannot do it** —
offset N in the collapsed text is not offset N in any node — and would fail silently, as a plausible
box over the wrong word.

**No reply, deliberately.** Whether the word could be painted is not reported, because failing is
ORDINARY rather than exceptional: the reader pages away mid-utterance, the section is not rendered,
the sentence is one word already covered by the sentence wash. A reply would be a channel for
something no caller can act on. What the shell guarantees instead is that **a range it cannot resolve
clears the previous word rather than leaving it painted** — a stale word wash while the voice has
moved on is a lie, where no word wash is merely less information. The sentence highlight stays up
throughout, so what a failure costs is the refinement, never the "you are here".

**`setSpokenRange` clears it.** The word is a sub-range of one sentence, so the sentence moving
invalidates it; the caller does not have to clear it first, and a caller that does anyway is
harmless. This is what covers the reader turning word mode off mid-utterance, which produces no
further word commands at all.

### The highlight set — `paintHighlights`, `requestCurrentSelection`/`selection`, `confirmDeleteHighlight`/`highlightPressed`

Landed together; they are one feature and none is useful alone. Design and ownership are in
`../personalization/READER_HIGHLIGHTS_WIRING.md` (Personalization writes, Reader applies) and
`HIGHLIGHT_LAYERS.md` (the collision convention). What is bridge-specific:

**Both highlight actions are native `menuItems` entries now, not RN popups.** iOS's native
selection callout is drawn by UIKit above the entire app, including every RN view, so an RN popup
for either action can be triggered correctly and still be visually unreachable. Both moved to
`react-native-webview`'s `menuItems`/`onCustomMenuSelection` (backed by Apple's public
`UIEditMenuInteraction`/`UIMenuController`) for the same reason: a long press on already-highlighted
text also makes WebKit select the word underneath, so the native menu can sit over an RN "Delete"
popup and disable it too, not just over the "Highlight" case.

**A SELECTION THAT MEETS AN EXISTING HIGHLIGHT OFFERS DELETE, AND REFUSES CREATE.** Signed off
2026-08-28. Any overlap at all counts; merely abutting one does not, or highlighting the sentence
after the one you already did would be impossible. `requestCurrentSelection` answers `null` and
`confirmDeleteHighlight` answers with the overlapped id.

**Which item shows is a toggle (`highlightTouchActive`); whether tapping it does anything is a
separate, post-hoc check — only the second is load-bearing.** `ReaderWebView.tsx` swaps `menuItems`
between `CREATE_MENU_ITEMS`/`DELETE_MENU_ITEMS` off a `highlightTouchActive` message.
`requestCurrentSelection` and `confirmDeleteHighlight` both re-decide at tap time and refuse if it
doesn't apply, so a toggle that shows the "wrong" item for a gesture only ever costs a display
mistake — tapping it safely no-ops rather than acting on the wrong highlight.

**The decision is the SELECTION's overlap first, the pressed point only as a fallback** —
`activeHighlightId()` in `epub.entry.ts`. Deciding from `touchstart` alone was a real bug, not just
an imprecision: `pressedHighlightId` records where the finger first *landed*, which equals what the
reader selected only when the press neither moved nor was adjusted. Dragging a selection from plain
text into a highlight left it null, so the menu offered "Highlight" and taking it painted a second
annotation over the first — visibly darker, and only half-deletable once the two ids collided in
epub.js's own map. The EPUB shell therefore posts `highlightTouchActive` twice per gesture: once
from `touchstart` (a point test, all that is knowable before anything is selected) and again from
epub.js's `selected` event, which debounces `selectionchange` by 250ms and so lands while the finger
is usually still down — i.e. before `touchend`, which is when WebKit builds the menu.

Two failure modes so far, both fixed:
1. **Pre-empting which item showed was unreliable.** An earlier version updated `menuItems` before
   WebKit built its menu — but that build comes from an independent `UILongPressGestureRecognizer`
   (`RNCWebViewImpl.m`, 0.4s `minimumPressDuration`), racing our own touchstart round trip with no
   ordering guarantee, and sometimes losing. Fixed by pairing the toggle with the post-hoc check
   above rather than relying on the toggle alone.
2. **Clearing `highlightTouchActive` on `touchend` crashed the app.** The native menu builds around
   `touchend`, and `RNCWebViewImpl.m`'s `tappedMenuItem:` re-reads `menuItems` fresh at TAP time with
   no bounds check. Clearing on `touchend` flipped `menuItems` back to `[highlight]` right as
   "Delete Highlight" appeared, so tapping it filtered to an empty array and indexing `[0]` threw.
   Fixed by clearing only on the *next* `touchstart`, matching `pressedHighlightId`'s own lifetime.

**EPUB's original press detection (`highlightAdd`'s `onTap`, riding marks-pane's own touch-proxy
wiring) never fired reliably** — it needs marks-pane to translate coordinates between the chapter
iframe (where touches fire) and the outer document (where painted marks live), and that translation
was not reliable enough to use. Replaced with a same-document hit test, `highlightIdAtPoint` in
`epub.entry.ts`.

**That hit test is GEOMETRIC, like the PDF shell's, and its first version was not.** It briefly
converted the touch to a text position (`caretRangeFromPoint`) and asked `Range.isPointInRange` — but
a caret SNAPS to the nearest text position, so a press in a line's trailing whitespace claimed a
highlight that was not under the finger, and a press inside a highlighted word whose caret snapped to
the neighbouring character missed one that was; `caretRangeFromPoint` can also hand back an *element*
container, where `isPointInRange` degrades to a tree-order comparison unrelated to where the reader
touched. It now measures `contents.range(cfiRange).getClientRects()` — the same rects marks-pane
paints, already in the chapter document's client coordinates — and calls the same pure `highlightAt`
the PDF shell does (`webview/src/highlightGeometry.ts`, shared by both since 2026-08-28).

Those boxes are **cached per layout** and dropped on relocate, resize, chapter load and repaint.
Resolving a CFI walks the chapter tree, `touchstart` fires for every touch including each one of a
page-turn swipe, and doing that work N-highlights-deep inside the touch handler is what made a
well-highlighted EPUB feel worse than a PDF, whose hit test is arithmetic over an array measured
once. A stale box deletes the wrong highlight, so when in doubt the cache is dropped: rebuilding
costs one tree walk, being wrong costs the reader their note.

**Deleting has no separate RN confirmation step, and that's not a safety regression.** Choosing
"Delete Highlight" from a menu the reader explicitly opened by pressing the highlight already is the
confirmation; `highlightPressed` means "the reader confirmed this," and the host deletes on arrival.

**Known limitation: the native menu doesn't reliably reappear after dragging a selection handle.**
`startLongPress:`'s `UILongPressGestureRecognizer` cancels instead of ending once a drag exceeds
UIKit's default 10pt `allowableMovement`, so the menu isn't re-shown at drag end. A quick tap on the
extended selection doesn't help either (it can't hold the 0.4s `minimumPressDuration`) — only a
fresh, stationary long-press brings the menu back. This is `react-native-webview`'s gesture
recognizer, not fixable from this side of the bridge; patching it (`patch-package`) is the only
lever and hasn't been attempted.

- **`paintHighlights` carries the WHOLE set every time, never a patch.** Every `readerHighlights.ts`
  call-site returns the fresh, full, authoritative set, so the host has nothing else to send. Each
  shell diffs it against what it has painted (`webview/src/highlightPaint.ts`), paints new ids and
  un-paints ids that fell out — so **a delete is an absence**, and there is deliberately no
  `unpaintHighlight` command. Adding one would be a second way for a shell's paint to disagree with
  storage.
- **The payload is format-free, and this is the sharpest test that rule has had.** `HighlightPaint`
  (Sync's stored shape) really does discriminate on `format: 'EPUB' | 'PDF'` — frozen `ContentFormat`
  literals — so forwarding it as-is would put a frozen enum value on the wire. `toReaderHighlights`
  splits it host-side into two per-shell shapes carrying no `format` field, and the host picks the
  array from the same typechecked `switch (format)` that picked `openEpub`/`openPdf`. Pinned by
  `readerBridge.test.ts`'s "never puts a ContentFormat value into a command payload", which now
  builds both arms of this command.
- **Both shells share the command, so both receive the UNION** and narrow it on arrival. Not
  discriminated by format (that is the whole point) — narrowed on the FIELDS each shape has, exactly
  as `goTo` narrows `ReaderTarget` on `kind`. A wrong-shape entry is refused with
  `NAVIGATION_FAILED` rather than dropped: it is structurally unreachable, and "no highlights" is
  precisely what that bug would otherwise look like.
- **`selection: null` is a valid `requestCurrentSelection` reply, not a parse failure** — the
  selection could have cleared between the tap and the reply, and that is an unremarkable answer,
  not an error. Discriminated on `kind` (`cfiRange` / `pageRange`), the same rule `ReaderTarget` and
  `ReaderPosition` follow.
- **`highlightPressed` carries only the id.** Not a range: re-deriving a stored highlight from the
  pixels under a finger is a fuzzy match, and deleting the wrong one is unrecoverable. The shell
  knows the id because it painted it. No anchor either — there is no RN popup left for one to
  position; the pixels-on-the-bridge exception this file used to describe (`ReaderAnchor`) no
  longer exists, because nothing on this bridge positions anything any more.
- **Both gestures that drive this are recognised WebView-side**, including page-turn swipe, which
  used to be an RN overlay. That overlay was the topmost hit-test target for every touch in the
  viewer, so the document could never receive a `touchstart` — fine for swipes, fatal for selection.
  `webview/src/touchGesture.ts` holds the thresholds and the fuller account.
- **The PDF shell grew a text layer for this.** A rasterised page has no text to select and nothing
  to anchor to, so `pdf.entry.ts` now renders pdf.js's standard text layer over every visible page
  (`webview/src/pdfHighlightSeam.ts`, `pdfTextRange.ts`). It is spread-aware by construction —
  everything is keyed on a page number — and `.pdf-text-layer` / `.pdf-highlight-layer` CSS lives in
  the template, because a `.ts` file cannot carry it.
- **`::selection` is themed in both shells** (`webview/src/selectionTheme.ts`). WebKit's default fill
  is opaque and covers the words it is selecting; on this flow the selection IS the feedback that the
  long press worked, so it has to be a translucent tint. EPUB gets it through `baselineCss`; PDF
  through a `--tf-selection` custom property `applyAppearance` sets, because the rule that reads it
  lives in the template.

**`requestTtsSentence`/`ttsSentence` is the FIRST reply-bearing pair on this bridge** — landed for
TTS_PROVIDER.md's step 5. One command, not two (`current`/`next` share a `mode` discriminant inside
`TtsSentenceRequest`), for the same "one command, one resolve seam" reason `applyAppearance` is one
payload rather than five setters. Correlation is by `requestId` alone, generated per-request by the
host; the `(bookId, generation)` stamp `readerTextProvider.ts`'s doc comments describe never crosses
the wire — it is host-side bookkeeping in `tts/realReaderTextProvider.ts`; each open book gets its own
provider instance with its own private `requestId` space, so nothing needs to disambiguate across
books on the wire. A reply for a `requestId` the host no longer recognises (already resolved by abort,
or discarded by teardown) is silently dropped.

**PDF answers both with a documented no-op**, the same way it already silently ignores typography in
`applyAppearance`: Reader never constructs a `ReaderTextProvider` for a PDF book (the segmentation
model is CFI-based, EPUB-only), so these should never actually be invoked there — they exist only
because `TFReaderApi<'openPdf'>` requires every shared command to have an implementation in both
shells. `requestTtsSentence` answers `{status:'unavailable'}` rather than staying silent, so a caller
that somehow reaches it gets a real status instead of a hang.

`applyAppearance` is implemented — the design in "The prefs-application design, as signed off" below
is now code, not a forecast. Sent before `openEpub`/`openPdf` (order enforced host-side, in
`ReaderScreen.tsx`'s `handleReady`); EPUB applies theme/typography/flow/spread through the same
`addStylesheetCss` path as the baseline. PDF applies `bg`, `zoom`, `flow` (continuous scroll) and —
as of double-page — `spread`: a payload with `flow: 'scrolled-doc'` switches the PDF shell from its
single-canvas renderer into a virtualised, scrollable multi-page one (`enterScrollMode`/
`leaveScrollMode` in `pdf.entry.ts`); everything else (theme/typography) is still silently ignored,
since pdf.js rasterises pages and there is no text CSS layer to override. EPUB now also injects an
`@font-face` from `customFontUri` (the bundled-font bytes `ReaderScreen.tsx`'s
`buildAppearanceWithFont` loads via `loadFontFaceSrc`) when it and `fontFamily` both sanitise
non-empty — `sanitizeFontDataUri`/`sanitizeFontFamily` in `readerMetrics.ts` gate what reaches the
stylesheet. PDF continues to ignore `customFontUri` for the same rasterisation reason as the rest of
typography.

**PDF's `spread` handling, added for double-page display.** epub.js gates its own two-up rendering on
`minSpreadWidth` (default 800 CSS px — see the note further down) so `spread: 'double'` is inert on a
phone and renders two pages on a tablet-sized viewport. pdf.js has no such concept at all — it
rasterises one page into one canvas — so this shell builds the equivalent from scratch, matched to
the same 800px threshold for consistency: `PDF_SPREAD_MIN_WIDTH`, `shouldRenderSpread` and
`spreadPages` in `pdfOutline.ts` (pure, unit-tested), consumed by `renderCurrent` in `pdf.entry.ts`
(the renamed, spread-aware `renderPage`). Pairing is COVER-ALONE: page 1 stands alone, then pages
pair as (2,3), (4,5), (6,7)... — matching both a physical book's layout and the visual result
epub.js already gives. `next`/`prev` step by the whole pair (`nextSpreadStart`/`prevSpreadStart`,
also in `pdfOutline.ts`); a `goTo` or resize/rotation re-resolves the correct pair via `spreadPages`
regardless of which page inside it was targeted. **Scope: single-page (paginated) mode only** —
continuous scroll ignores `spread` entirely and stays one column, since pairing virtualized scroll
wrappers is a materially bigger change this did not need. The second canvas (`#pdf-canvas-2` in
`reader-pdf.template.html`) is hidden whenever the current spread has only one page, and its backing
store is released (`width`/`height` set to 0) rather than left resident.

**This table is now documentation rather than an input to a decision.** Keep it accurate for the next
reader, but nothing is gated on its counts any more.

### The `CONTENT_LOCKED` host error code

Added to `HOST_ERROR_CODES` (`readerBridge.ts`) 2026-09-03, for the offline-lock gating hook — see
CLAUDE.md's "Offline-lock gating hook" section for the full design. Like `ACCESS_REVOKED`, it is
**host-only and never raised by the WebView**: `useContentLock.ts` subscribes to Sync's
`content.lock` bus signal directly and reports it through the same `error` message shape every
other host-side failure uses, so the WebView side needed no change at all — confirmed by
`npm run reader:build-html && git diff --exit-code` producing no diff, which is expected: only
`WEBVIEW_ERROR_CODES` members survive into the compiled shells (see the tree-shaking note in
CLAUDE.md), and `HOST_ERROR_CODES` additions never do.

Three codes now cover three different ways an already-open book stops being readable, and they are
not interchangeable:

| Code | What happened | Source |
| --- | --- | --- |
| `CONTENT_LOAD_FAILED` | The book never opened at all | the initial decrypt/licence path |
| `ACCESS_REVOKED` | A POLL (`startAccessMonitor`, every 5 min) found an explicit denial | Download |
| `CONTENT_LOCKED` | A PUSH (`content.lock` on the shared event bus) fired while this book was open | Sync, relayed by `useContentLock.ts` |

`ACCESS_REVOKED` and `CONTENT_LOCKED` now go through the same reaction in `ReaderScreen.tsx`
(`tearDownAndLock`) — same defect discovered by two different mechanisms, one fix.

## Three decisions about what crosses the boundary

The first two survive the conversion unchanged, because each is about the *payload* rather than about how
it is typed. The third is the one the conversion let us improve, and it has now been done.

### 1. Two open commands, not `open(base64, format)`

`ContentFormat` is frozen (`shared/types/primitives.ts`). It never crosses: the host reads it in
typechecked TS and picks **between two command names**, each entry defining exactly one.
Post-conversion that is enforced by `TFReaderApi<'openEpub'>` vs `TFReaderApi<'openPdf'>` rather than by
a per-file grep, and `readerBridge.test.ts` still asserts no `ContentFormat` literal appears in any
generated command script.

Do not "simplify" this into one command with a format argument.

### 2. `goTo.target` stays a bare string

Search stores a `Locator`; the host unwraps it into a `ReaderTarget` before sending (`targetOf()` in
`useBookSearch.ts`).
Before the conversion the argument was that a frozen contract must not be hand-copied into
untypechecked JS. That specific risk is gone — but the reason stands and has changed shape: a
discriminated union on this channel still arrives as JSON, so `parseReaderMessage` would have to
validate every variant. `ReaderScreen.test.tsx`'s CFI seek test is what keeps it honest — note the CFI now travels inside
`{kind:'href'}` rather than as a bare argument, which changed nothing about the reasoning: the payload
is still primitives, and still not `Locator`.

### 3. Targets and positions are discriminated by ADDRESSING SCHEME, not by format

`ReaderTocItem.target` and `relocated.position` both carry a discriminated union rather than a string
whose meaning depends on which shell is loaded:

```
ReaderTarget   = { kind: 'href'; href: string } | { kind: 'page'; page: number }
ReaderPosition = { kind: 'cfi'; cfi: string | null } | { kind: 'page'; page: number; pageCount: number }
```

**This replaced a real overload, un-done 2026-08-18.** `toc.items[].href` was one `string` meaning a
spine href for EPUB and a 1-based page number for PDF. That was chosen deliberately, back when a fourth
field on the `toc` message meant paying for the typechecked-WebView conversion — a real cost for a
Contents panel. Once the conversion landed, the cheaper option stopped being cheaper.

**Why `kind` and not `format`, which is the interesting part.** The first draft discriminated on
`format: 'EPUB' | 'PDF'`, and `readerBridge.test.ts`'s "never puts a `ContentFormat` value into a
command payload" caught it — the string `"PDF"` was on the wire. Relaxing that guard would have been
the wrong fix. The right one is that a target is not discriminated by a book's format at all: it is
discriminated by how it addresses the book. Three things fall out:

- `ContentFormat` stays entirely off the bridge, so the guard passes honestly rather than by exemption.
- `ContentFormat` has a third member (`AUDIO`) with no addressing scheme here. A `format` discriminant
  invited "where is the AUDIO case?"; a `kind` discriminant does not.
- Adding a fourth `ContentFormat` cannot silently change these unions' meaning, because they are now
  unrelated by construction rather than by coincidence of spelling.

**The EPUB `href` still accepts two forms, and that one is NOT an overload to remove.** It is a spine
href (TOC row) or an EPUB CFI (Search hit), and epub.js discriminates them itself — `spine.get()` tests
`isCfiString()` before its href lookup, so `rendition.display()` routes both through one call. One
field, two forms, resolved by the library rather than by us.

**What each half validates, and why it is split that way:**

| Check | Where | Why there |
| ----- | ----- | --------- |
| the shape is a known `kind` | host, `asTarget` | it arrives as JSON from a book's navigation document |
| `page` is a positive integer | host, `asTarget` | cheap, and a bad row is dropped rather than rendered dead |
| `page <= pageCount` | shell, `pageFromTarget` | only the shell knows the document's page count |
| the scheme matches the renderer | shell, both entries | should be impossible — one shell per book — but the value is book-derived, so it is checked |

That last row is what un-overloading bought beyond tidiness: an `href` reaching the PDF shell is now a
category error with its own message, where before it was a string that failed `parseInt` and reported
the same thing as an out-of-range page. A row whose target is unusable is also **dropped at parse
time** now, instead of becoming a Contents row that could only ever raise `NAVIGATION_FAILED` when
tapped.

**One shell per book remains load-bearing** — it is why each entry can refuse the other scheme outright
— so the two-entry split is still about correctness and not only about artifact size.

## Why the debt was taken, and how it ended

Kept short, and kept at all because a decision with a written expiry date that nobody records the ending
of is how the next person re-litigates it.

The WebView half was untypechecked from the start, deliberately: at 5 message types and 4
fire-and-forget one-argument commands, a build step bought a compiler check over a surface you could
verify by eye in thirty seconds, and cost a toolchain stage every one of five people had to understand.
The bet was that the surface would stay small, and that a written trigger list would stop "small"
becoming a story we told ourselves.

The list was five conditions: the union passing ~8 cases or any payload passing ~3 fields; a command
needing a reply; a frozen contract crossing as a payload; the transport ceasing to be
base64-over-`injectJavaScript`; or the WebView holding state RN also models. It was re-run at every
stage, and the record is worth two conclusions:

- **Two stages that looked certain to fire it did not, and measurement is why.** Day 4 (the 20 MB
  whole-book transport) was asserted *in comments, twice* not to scale; it measured at ~330 ms, about 5%
  of a warm open, so the transport stayed and only the codec changed behind an unchanged
  `open(base64)`. PDF support — a second renderer, a second template, a second artifact — cleared all
  five, because format is routed by command *name*.
- **One field was left out on purpose to avoid firing it**, and that was honest rather than a dodge:
  reporting the PDF page in `relocated`. Nothing consumed a reading position, so the field bought
  nothing and cost the conversion.

What ended it was **prefs-application**: one `applyAppearance(ReaderAppearance)` carrying twelve flat
primitive fields. Trigger 3 was designed out by resolving host-side; trigger 1 fired on the field count
regardless. Requested and signed off 2026-08-18, converted the same day, before the command was
written — which is what the verdict had always said to do, and the reason converting was a morning
rather than a week.

**The `relocated` page field was added the same day, 2026-08-18.** It was pre-committed here as
"adding it IS the conversion", so this is the pre-commitment being honoured rather than re-argued: the
conversion happened first, then the field became an ordinary change — a discriminated `ReaderPosition`,
a validator, and a page indicator in `ReaderScreen`.

**It is surfaced, not persisted — by this bridge.** `progressStore.savePage()` / `savePosition()`
exist on Sync's side and this is the value they need; Reader's half here is reporting the position,
not storing it. Persistence, write-throttling, and what wins on a cross-device conflict have since
been decided and landed in `ReaderRouteScreen.tsx`/`AudioPlayerRouteScreen.tsx` (Reader's own
navigation layer, not this bridge) — see CLAUDE.md's "Reading-position resume" section for the full
account, not this paragraph.

**`internalReposition` was added 2026-09-08, and it exists because `relocated` stopped meaning one
thing.** `ReaderScreen.tsx`'s handler used to forward every `relocated` to
`ttsProviderRef.current?.notifyRelocated()` unconditionally, on the reasoning that epub.js only ever
fires `relocated` for a genuine navigation — `setSpokenRange`'s handler painted an annotation and
did nothing else. TTS auto-follow's `rendition.display()`/`scrollBy()` calls, a font-size reflow's
reanchor, and a paginated<->scrolled flow rebuild's redisplay all now live INSIDE that same
`epub.entry.ts` machinery and all fire a genuine `relocated` too — none of them are the reader going
anywhere new, all three redisplay a position the reader was already conceptually at. Before this
field existed, `notifyRelocated()` treated every one of them as "the reader navigated away," which
cleared the TTS session's highlight and invalidated its prefetched next sentence — the on-device
symptom was TTS silently stopping the moment the sentence that triggered the first auto-follow jump
finished speaking. `epub.entry.ts` sets it via one module-level flag
(`nextRelocationIsInternal`) checked immediately before each of those four call sites and consumed
(read then reset) by the `relocated` handler when it builds the outgoing message — see that flag's
own doc comment for the exact four sites and the accepted narrow mis-attribution race with a
host-driven navigation landing in the same instant. `ReaderRouteScreen.tsx`'s progress-tracking is
unaffected either way — it reads every `relocated` regardless of this field, since persisted
progress is deliberately "wherever the view/voice currently is," cause-agnostic. Optional, not
required: `pdf.entry.ts` never sets it (none of the four triggers exist there), and every existing
test literal constructing a `relocated` message without it stays meaningful as an ordinary,
non-internal relocation.

## The prefs-application design, as signed off

Requested by Personalization on 2026-08-18 and signed off the same day. Personalization's half is built
and committed (`features/personalization/readerAppearance.ts`, `READER_PREFS_APPLICATION.md`); Reader's
half is the apply, and the conversion it was blocked behind is done.

**The surface: one fire-and-forget command.**

```
applyAppearance(appearance)   // host -> WebView, no reply
```

`ReaderAppearance` is a flat, primitive-only, **bridge-local** shape — not a `src/shared/contracts/`
type. The host resolves `SharedPrefs` into it in typechecked TS (`toReaderAppearance`). **Not**
`applyPrefs(SharedPrefs)`, and **not** five granular setters — prefs are applied together, so N setters
is N surfaces and N chances at a partial apply, for no gain.

Post-conversion, note what changed about the *reason* for flattening. It is no longer that a frozen
contract must be kept out of untypechecked JS — the WebView is a `tsc` consumer now, and importing a
frozen contract there is the mechanism rather than the risk. It is that everything on this channel
arrives as JSON and has to be validated on receipt, and a flat primitive payload is the shape that is
cheapest to validate. Same design, different justification; do not let the old wording justify a
`SharedPrefs` payload now that the old objection has lapsed.

> **`applyAppearance` DOES MORE THAN RE-STYLE, as of 2026-08-30.** It used to re-style and,
> for `bg` alone, re-tint. It now also re-measures every painted annotation and puts the reader back
> at `lastCfi` whenever the layout moved — because epub.js re-measures a highlight only inside
> `View.reframe()`, which a stylesheet change never reaches, so a text-size change left every
> highlight stranded on the words it used to cover. **The command surface is unchanged** — no new
> message, no new command, nothing host-side — so this is a note about what the handler does, not
> about the contract. `HIGHLIGHT_LAYERS.md` §3a is the rule; `epubLayoutSignature.ts` decides which
> payloads qualify, and it will not compile if a new `ReaderAppearance` field goes unclassified.

### Four things the design has to add, found while signing it off

1. **`applyAppearance` must be defined in BOTH entries.** `buildCommandScript` guards on
   `typeof window.TFReader.applyAppearance === 'function'`, so a PDF open would otherwise answer
   `NOT_READY` for a command that simply is not there. The PDF half applies `bg`, `zoom` and `flow`
   (continuous scroll) and still ignores typography — pdf.js rasterises pages, so there is no text CSS
   layer for a font/theme change to reach. **This is now enforced rather than remembered**: adding it to
   `CommandArgs` makes both `TFReaderApi<'openEpub'>` and `TFReaderApi<'openPdf'>` require it, so a
   missing half fails to compile.
2. **It must be sent BEFORE `openEpub`/`openPdf`, not alongside.** `flow` and `spread` are `renderTo()`
   options and `renderTo` runs *inside* `openEpub`, so a payload arriving after it renders in the wrong
   flow and needs a second re-layout. Order: `ready` → `applyAppearance` → `open*`.
   **Consequence: the `DEFAULT_PREFS`-derived baseline stays** as the pre-payload fallback — prefs are
   an async SQLite read, and a slow or failed read must not paint at UA defaults. Those values are now
   *imported* from the contract in `readerMetrics.ts` rather than hand-copied, so the old pins became
   behavioural assertions instead of literal comparisons.
3. **The payload has THREE claimants, and it stays ONE payload.** Personalization owns theme, font and
   typography. Reader owns `reduceMotion`. Accessibility owns `announce.pageChanges`
   (`WEBVIEW_A11Y_FINDINGS.md` §3.7 requires it to arrive "through the same composed-prefs path"), plus
   `highContrast`, bold text, dyslexia font and readable spacing. There is no other channel for those.
   The payload's *name* is Personalization's to choose; the "one command, one resolve seam" property is
   not negotiable.
4. **`fontFamily` and `customFontUri` are user-supplied strings that end up in CSS text.**
   `JSON.stringify` in `buildCommandScript` protects the injected *script*; it does nothing for the
   stylesheet the entry then builds by concatenation, inside a document holding decrypted licensed
   content. They need a character allow-list and CSS quoting on arrival. **Implemented**:
   `sanitizeFontFamily`/`sanitizeFontDataUri` in `readerMetrics.ts`, both called from `epub.entry.ts`'s
   `appearanceCssOptions()` before either value reaches `baselineCss()`.

### The font-size clamp: clamp the FACTOR, not the product

`readerMetrics` computes `clamp(round(16 × width / 393), 15, 22)`. Right for a fixed baseline, wrong the
moment the base is a preference: at a 2× accessibility multiplier the user's chosen size is silently
capped at 22px — and that user is precisely the one who cannot work around it. Widening the bounds only
moves the cap. Clamp the **viewport factor**, which is what the clamp was ever about:

```
viewportFactor = clamp(width / 393, 0.94, 1.375)
fontPx         = round(composedPt × viewportFactor)
```

Behaviour-preserving at base 16 — `0.94 × 16 → 15`, `1.375 × 16 → 22`, identical in between — so it is
not a rendering change today. A wide absolute clamp stays underneath purely so a pathological value
cannot break layout.

**`marginPx` needs a bound for the same reason.** `padBottom = height - padTop - lines × linePx` goes
negative once the margin approaches half the viewport height, because `lines` is already floored to a
minimum of 1. A prefs-driven margin can reach that; a hand-copied 16 could not.

### The live channel, and the two smaller calls

- **No event bus for prefs** (`event-bus.ts` open question #1, answered there). Reader subscribes to the
  prefs store instead: `prefsStore.savePrefs()` already returns the freshly re-read record, so a
  module-level subscription beside the store delivers it. `EVENT_CHANNELS.PREFS_CHANGED` stays in the
  contract — removing an exported key is a Contracts Gate conversation and an unused channel costs
  nothing. Re-read-on-focus is out for a duller reason: there is no navigator to give Reader a focus
  event. **Sync is not a blocker.**
- **`spread`: `single` → `'none'`, `double` → `'auto'`.** `'always'` would not have differed — epub.js
  sets `_spread = (spread === "none") ? false : true` (`layout.js:84-88`) then gates two-up on
  `width >= minSpreadWidth`, default 800 (`layout.js:119-120`). So on any phone `double` renders
  single-page whatever we send. That is the behaviour Reader wants; it does mean the preference is inert
  on the device this is tested on, which is the settings UI's problem to be honest about.

  **KNOWN LIMITATION, ACCEPTED RATHER THAN WORKED AROUND: the cover pairs with page 2 on a wide
  viewport instead of standing alone**, unlike PDF's spread (which is ours to define — see above — and
  deliberately keeps the cover solo). Traced to epub.js itself, not to how this shell calls it:
  `DefaultViewManager`'s "cover stands alone" logic
  (`managers/default/index.js`'s `handleNextPrePaginated` — literally commented "First page (cover)
  should stand alone for pre-paginated books") is gated on `this.layout.name === "pre-paginated"`, i.e.
  FIXED-LAYOUT books only. `layout.js`'s reflowable path computes `divisor = 2` from viewport width
  alone, with no section-index awareness at all, so a reflowable EPUB (what this app's sample/dev books
  are, and what most text-based EPUBs are) has no "cover alone" concept in the library — `rendition.spread()`
  is being called exactly as documented; there is nothing to fix on this side of the call. A workaround
  (forcing `spread: 'none'` only while `book.spine.first()` is displayed, switching back once the reader
  pages past it) was scoped and explicitly declined: it would fight the manager's internal section-packing
  rather than use a supported seam, needing a `display()` re-call — not just `spread()` — at the cover/page-2
  boundary, i.e. a re-render on every crossing, for a cosmetic gap on a fixed-layout-only affordance most
  reader apps accept as-is for reflowable content. Revisit only if this becomes a real complaint, not a
  once-off report.
- **`zoom` is carried, and the WebView may hold the last payload only as a write-only cache**, for
  recomputing on resize. The moment a pinch-zoom gesture inside the WebView *mutates* it, that is state
  RN also models and RN has to own it — the same line the PDF renderer's `currentPage` sits on.

### Decisions closed by this sign-off

Both are recorded in `src/shared/contracts/prefs.ts`'s DECISION LOG rather than here:

- **#4 — `typography.size` is absolute points**, composed as
  `size × resolveFontScale(a11y.text, osFontScale)`, viewport factor applied last. `spacing` ratified
  as px in the same breath.
- ~~**#2 — `reduceMotion` is honoured by Reader.**~~ **The obligation landed, 2026-09-08.** TTS
  auto-follow's teleprompter-style reposition (`repositionForReadingZone`, `epub.entry.ts`,
  scrolled-doc flow only) is the first animation either shell has ever added — a JS
  `Element.scrollBy({ behavior })` call, not CSS, so `readerTemplate.test.ts`'s existing
  `transition`/`animation`/`@keyframes` regex genuinely does not and should not match it. That test's
  own describe block ("reduceMotion has nothing to suppress, and must not quietly acquire one") now
  carries a dedicated case asserting the GATE instead: `currentAppearance?.reduceMotion` is read
  fresh, inline, at the one call site that decides `'instant'` vs `'smooth'` — no cached flag, so a
  live preference toggle takes effect on the very next reposition. `pdf.entry.ts` still consumes
  nothing here — it has no scrolled-doc/continuous-scroll concept for this to apply to.

### The accessibility overrides are resolved HOST-SIDE, and no field was added for them

Landed alongside Accessibility's settings panel. `accessibility.display.highContrast` and
`accessibility.text.dyslexiaFont` are applied in `ReaderScreen.tsx`'s `buildAppearanceWithFont`,
beside `a11yFlowOverride` and for the same stated reason — `readerAppearance.ts` resolves prefs into
primitives and says in as many words that the apply-time meaning of these fields is Reader's.

**What that means for anyone reading a payload off the wire.** Three fields no longer mean quite
what their names suggest:

| Field | Also carries |
| --- | --- |
| `fontFamily` | `'OpenDyslexic'` when `dyslexiaFont` is on and the book is an EPUB — **not** the user's `font.family` |
| `customFontUri` | the dyslexia face's bytes in that case, in place of the bundled font's |
| `fg` / `bg` / `link` | the WCAG-AAA pair from `highContrastColors.ts` when `highContrast` is on, in place of `THEME_PALETTES`' |

The booleans still ride along unchanged — the shells and `appearanceChangeAnnouncement` both read
them — so nothing downstream had to be told about this.

**Why host-side rather than in the shells**, which is the part worth not re-litigating:

- It adds **no `ReaderAppearance` field**, so the nine-step new-field checklist does not apply and
  neither entry needed a line changed.
- `fontFamily` and `customFontUri` are already `GeometryKey` in `epubLayoutSignature.ts`, so a
  dyslexia toggle already moves the layout signature and every painted highlight re-measures for it
  **for free**. Applying the same preference inside `epub.entry.ts` would have obliged promoting
  `dyslexiaFont` itself, and then re-measuring twice for one change. That file's classification
  comment now records this; it stays a `PaintOnlyKey`.
- The contrast pair reaches the PDF shell too, through the `bg`/`link` it already consumes, with no
  PDF-side work at all.

**`dyslexiaFont` is gated on `format === 'EPUB'` at the same seam.** The preference is one per user,
not one per book, so a `true` set while reading an EPUB still arrives on a PDF's payload; pdf.js
rasterises pages and has no text CSS layer, so honouring it there would buy nothing and cost ~330 KB
of base64 on the bridge for every preference change.

**`loadDyslexiaFontFaceSrc` has its own try/catch, and that is not defensive padding.** Unlike
`loadFontFaceSrc`, it can reject. It is awaited inside `buildAppearanceWithFont`, which runs inside
`applyAppearanceWith`'s single catch — so an escaping reject means **no `applyAppearance` is sent at
all**, and the book silently loses theme, text size, margins, flow, spread and both announce gates
for the sake of a font. `ReaderScreen.test.tsx` pins the fallback.

### `reduceMotion` — consumed by `epub.entry.ts` only, and `pdf.entry.ts` stays exactly as it was

This section used to say `reduceMotion` stayed unconsumed by both shells deliberately, on the
reasoning that a variable holding a value nothing reads is reported by `no-unused-vars` at
`--max-warnings=0`. That reasoning is now moot for `epub.entry.ts` — decision #2 above records what
consumed it — but it still holds, unchanged, for `pdf.entry.ts`: PDF has no scrolled-doc/
continuous-scroll concept, TTS never mounts for a PDF book at all
(`readerTextProvider.ts`/`TTS_PROVIDER.md`), and `pdf.entry.ts` still keeps no whole-appearance
object, only `currentBg`/`currentZoom`/`spreadPref`/`wantsScroll` — every one of them read. Adding a
`currentReduceMotion` there with nothing to gate would still be exactly the dead variable this
section originally declined.

`reduceMotion` was already on the payload and already classified in `epubLayoutSignature.ts`
(`PaintOnlyKey`) before this landed — that classification is unchanged, since the teleprompter
reposition is a scroll, not a re-layout, and does not move a glyph.

## Before you change the bridge

- [ ] Change `readerBridge.ts` and let the compiler find the rest. A new `ReaderMessage` case fails to
      compile in the WebView half until it is handled; a new command fails until both entries define it.
- [ ] Add the case to `parseReaderMessage()`. **`tsc` will not tell you about this one** — a missing
      case returns `null` and surfaces as `BRIDGE_PARSE_FAILED` at runtime, which is exactly the class
      of thing types cannot cover here.
- [ ] Run `npm run reader:build-html`. Both artifacts are generated **and tracked**, and a change to
      `bridge.ts` or a shared pure module invalidates both. CI fails if you skip it, but on *your* PR.
- [ ] Update the [Current surface](#current-surface) table.
- [ ] Run all three: `npm test && npm run typecheck && npm run lint`. `typecheck` is now the drift
      guard, so treating it as optional is treating the bridge contract as optional.
- [ ] For anything that changes rendering, **run it on the simulator**. The conversion's own device
      check is above; unit tests cannot see a blank page.

## Related

- `src/features/reader/readerBridge.ts` — the typed contract both halves import.
- `src/features/reader/webview/src/` — the WebView half. `bridge.ts` is the shared module; the two
  `*.entry.ts` files are the per-format shells; `readerMetrics.ts`, `epubOutline.ts` and `pdfOutline.ts`
  are pure and unit-tested.
- `src/features/reader/scripts/buildReaderHtml.ts` — the generator, and the esbuild step. Carries the
  entry-bundle size ceiling that stops a library being value-imported into a shell that already inlines
  it.
- `src/features/reader/readerTemplate.test.ts` — what is left that a compiler cannot see: call order,
  value-type requirements, the PDF shell's offline choices, and the DOM/CSS the entries query.
- `src/features/reader/READER_MEASUREMENTS.md` — the transport and memory numbers, per format.
- `src/features/reader/ReaderWebView.tsx` — the navigation lockdown that contains decrypted content.
- `src/features/sync/sharedPrefs.ts` — `readSharedPrefs()`, the persisted `SharedPrefs` the prefs stage
  will apply.
- `src/features/personalization/READER_PREFS_APPLICATION.md` — Personalization's field-by-field mapping
  and the live-reapply flow. Read it together with the sign-off section above, which amends it.
- `src/features/accessibility/WEBVIEW_A11Y_FINDINGS.md` — §3.7 is the third claimant on that payload.
- `src/features/reader/tts/readerTextProvider.ts`, `TTS_PROVIDER.md` — the seam `requestTtsSentence`/
  `ttsSentence`/`setSpokenRange` exist to carry. `tts/realReaderTextProvider.ts` is the host-side
  correlation layer; `webview/src/epubTtsResolver.ts` (segmentation/CFI-minting, DOM-touching) and
  `webview/src/ttsSegmentation.ts` (pure, unit-tested) are the WebView side.
- `webview/src/highlightSeam.ts` / `highlightNaming.ts` — the owner-namespaced `rendition.annotations`
  seam `setSpokenRange` paints through, built so Personalization/Search can adopt the same `add`/
  `remove` primitive later without re-litigating the collision `TTS_PROVIDER.md` open item 4 named.
