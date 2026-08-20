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
| `relocated` | `position` (`ReaderPosition`), `atStart`, `atEnd` |
| `toc`       | `items[]` (`{label, target, depth}`)        |
| `error`     | `code`, `message`                           |

`ReaderPosition` is **discriminated by format**: `{format:'EPUB', cfi}` or
`{format:'PDF', page, pageCount}`. The two formats have no common notion of position — a CFI addresses
a spine offset and has no PDF meaning; a page number has no reflowable meaning — so carrying both flat
would mean one of them is always `null` and the reader has to know which. That is the same "one field,
two meanings" arrangement `toc.items[].href` still has, and this is the first place it was undone.

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

`applyAppearance` is implemented — the design in "The prefs-application design, as signed off" below
is now code, not a forecast. Sent before `openEpub`/`openPdf` (order enforced host-side, in
`ReaderScreen.tsx`'s `handleReady`); EPUB applies theme/typography/flow/spread through the same
`addStylesheetCss` path as the baseline. PDF applies `bg`, `zoom`, and — as of continuous scroll —
`flow`: a payload with `flow: 'scrolled-doc'` switches the PDF shell from its single-canvas renderer
into a virtualised, scrollable multi-page one (`enterScrollMode`/`leaveScrollMode` in `pdf.entry.ts`);
everything else (theme/typography) is still silently ignored, since pdf.js rasterises pages and there
is no text CSS layer to override. EPUB now also injects an `@font-face` from `customFontUri` (the
bundled-font bytes `ReaderScreen.tsx`'s `buildAppearanceWithFont` loads via `loadFontFaceSrc`) when it
and `fontFamily` both sanitise non-empty — `sanitizeFontDataUri`/`sanitizeFontFamily` in
`readerMetrics.ts` gate what reaches the stylesheet. PDF continues to ignore `customFontUri` for the
same rasterisation reason as the rest of typography.

**This table is now documentation rather than an input to a decision.** Keep it accurate for the next
reader, but nothing is gated on its counts any more.

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

Search stores a `Locator`; the host unwraps `.cfi` before sending (`cfiOf()` in `useBookSearch.ts`).
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

**It is surfaced, not persisted.** `progressStore.savePage()` / `savePosition()` exist on Sync's side
and this is finally the value they need, but writing a progress record is Personalization's stage and
carries its own decisions (when to write, how often, what wins on conflict). Reader's half is reporting
the position; storing it is not, and doing both here would prejudge those. **Karthik / Vaishnavi: the
value is available now.**

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
- **`zoom` is carried, and the WebView may hold the last payload only as a write-only cache**, for
  recomputing on resize. The moment a pinch-zoom gesture inside the WebView *mutates* it, that is state
  RN also models and RN has to own it — the same line the PDF renderer's `currentPage` sits on.

### Decisions closed by this sign-off

Both are recorded in `src/shared/contracts/prefs.ts`'s DECISION LOG rather than here:

- **#4 — `typography.size` is absolute points**, composed as
  `size × resolveFontScale(a11y.text, osFontScale)`, viewport factor applied last. `spacing` ratified
  as px in the same breath.
- **#2 — `reduceMotion` is honoured by Reader.** Free today, and worth saying precisely why: there is
  **no animation anywhere in the reader**. So suppression is currently vacuous and the real obligation
  falls on whoever adds the first page-turn animation. `readerTemplate.test.ts` pins that across both
  templates **and both entries** now — before the conversion an animation could only have come from
  CSS; a `.ts` entry can add one imperatively.

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
