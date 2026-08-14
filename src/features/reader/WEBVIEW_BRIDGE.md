# Reader ⇄ WebView bridge — the hand-sync contract, and when to end it

**Owner:** Reader (Ahana) · **Status:** accepted debt, not yet due
**Last reviewed:** 2026-08-14, after the Contents-panel fix flattened epub.js's nested `subitems`
into the `toc` message — **all five triggers re-run and NONE fired**, but trigger 1 is now _at_ its
field boundary rather than comfortably inside it, because this was the first change to grow a
payload **shape** rather than a name (see the TOC row in [Stage forecast](#stage-forecast)). The
conversion is still due at prefs-application.

This file exists because the WebView half of the reader bridge is **not typechecked**, that is a
deliberate choice, and a deliberate choice with a cost needs a written expiry date. Everything
here is about one question: _at which stage of the reader's development does the hand-sync
contract stop being cheap, and what do we do then?_

If you are about to add a message type or a command, read [Before you touch the
bridge](#before-you-touch-the-bridge) at the bottom first.

---

## The two halves

| Half                 | File                                               | Typechecked?        |
| -------------------- | -------------------------------------------------- | ------------------- |
| Host (React Native)  | `src/features/reader/readerBridge.ts`              | yes — `tsc`, strict |
| WebView (browser JS) | `src/features/reader/webview/reader.template.html` | **no**              |

The WebView side is plain ES5-ish JS inside a `.html` file _precisely_ so `tsc` cannot see it
(`tsconfig` sets `allowJs` + `checkJs` over `src/`, so a `.js` file there would be typechecked and
would fail — it references browser globals and epub.js internals that RN's types don't model).
`buildReaderHtml.ts` inlines JSZip + epub.js into that template and emits
`assets/reader/reader.html`, which is a **tracked, generated artifact** — regenerate it with
`npm run reader:build-html` after any template edit. CI's "Reader HTML is freshly generated" step
rebuilds and `git diff --exit-code`s that file, so forgetting is a red build rather than a stale
ship. Note what that step does and does not cover: it proves the artifact matches the template,
_not_ that the template matches `readerBridge.ts` — the drift guard in `readerBridge.test.ts` is
what does that (see [What protects it today](#what-protects-it-today--and-what-doesnt)).

## Current surface

As of 2026-08-14. **Keep this table accurate — it is the input to the trigger test below.**

**WebView → host** (`ReaderMessage`, one case per `post({ type: ... })` in the template)

| Type        | Payload fields                     | Count |
| ----------- | ---------------------------------- | ----- |
| `ready`     | —                                  | 0     |
| `rendered`  | —                                  | 0     |
| `relocated` | `cfi`, `atStart`, `atEnd`          | 3     |
| `toc`       | `items[]` (`{label, href, depth}`) | 1     |
| `error`     | `code`, `message`                  | 2     |

**Host → WebView** (`READER_COMMANDS` keys ↔ `window.TFReader` method names)

| Command | Args     | Reply? |
| ------- | -------- | ------ |
| `open`  | `base64` | no     |
| `next`  | —        | no     |
| `prev`  | —        | no     |
| `goTo`  | `target` | no     |

`goTo.target` is a spine href **or** an EPUB CFI, as one bare `string`. It is deliberately not a
`Locator`: Search stores the union, the host unwraps `.cfi`, and only the string crosses. Widening
it to the union would fire trigger 3 for no runtime gain, since epub.js's `spine.get()` already
discriminates the two forms itself via `isCfiString()`.

**5 message types, 4 commands, max 3 fields per case, zero request/reply.** That is the whole
contract. It is small enough to hold in your head, which is the only reason this is safe.

`toc.items[].depth` is the nesting level in the book's navigation tree, 0 for a top-level entry.
The tree is flattened depth-first **in the template** and crosses as one ordered flat list, because
a recursive payload is the shape hand-sync is worst at — the host indents by `depth` instead. Both
sides clamp it to `MAX_TOC_DEPTH` (6): the template as it flattens, and `parseReaderMessage` again
because the value originates in a book's own navigation document. A **missing** `depth` parses as 0
rather than rejecting the entry, so a working tree holding a stale generated `reader.html` degrades
to today's flat list instead of an empty Contents panel. **Counting the TOC entry as 3 fields, this
case is now at trigger 1's boundary — the next field added to it converts.**

## What protects it today — and what doesn't

**Protected: name drift, at runtime.** `parseReaderMessage()` rejects any `type` outside the union,
and the injected command script checks `typeof window.TFReader.<method> === 'function'` before
calling. So renaming one side without the other produces a loud, coded error
(`BRIDGE_PARSE_FAILED`, `NOT_READY`) instead of silence. Cheap, and genuinely sufficient at this
size.

**Protected: name drift, at build time.** The drift guard in `readerBridge.test.ts` reads the
template as text and asserts that the message types it posts, the `fail()` codes it raises, and the
`window.TFReader` methods it defines each match their TS counterpart exactly. Both sides of those
assertions are derived, not transcribed: `READER_MESSAGE_TYPES` (pinned to the `ReaderMessage`
union by a `satisfies` plus an `Exclude`-based exhaustiveness proof), `WEBVIEW_ERROR_CODES`,
`HOST_ERROR_CODES`, and `Object.values(READER_COMMANDS)`. Adding a case to the union without
listing it fails `tsc`; listing it without teaching the template fails jest. So a rename is a red
build, not a runtime error a user has to hit first.

**NOT protected: shape drift.** `parseReaderMessage()` can tell you `type` is one of five strings.
It cannot tell you the template stopped sending a field that a case needs, started sending a
differently-shaped object, or that a payload type owned by _another team's frozen contract_
changed underneath it. Today every case has ≤3 flat primitive fields, so there is almost no shape
to get wrong. **That is the property that expires**, and the triggers below are all restatements
of "shape now matters".

**Partly protected, as of the TOC flatten: template-side payload construction.** The `toc` message
is the one place the template _shapes_ a payload rather than forwarding a primitive, and the failure
it can produce is invisible to everything above — a perfectly well-formed `toc` message carrying
only the top level of a nested navigation tree. `readerTemplate.test.ts` covers that specific class
by reading the template as text: it asserts the flatten recurses through `subitems`, that the depth
cap matches `MAX_TOC_DEPTH`, and that the three typographic constants copied out of `DEFAULT_PREFS`
still equal it. That is a **guard per known trap, not a type system** — it does not generalise, and
each new one has to be written by hand. Which is the argument for the conversion, not against it.

**Also not protected: prose.** The template's comments went stale within one day of the Day-3
wiring — it still claimed "No crypto anywhere in this baseline" while receiving decrypted
licensed content. Fixed 2026-08-12. Nothing points a tool at that file, so nothing caught it.
Treat that as the mildest possible preview of the failure mode.

## The trigger

Convert to a typechecked WebView build when **any one** of these becomes true:

1. The message union passes **~8 cases**, or **any single case grows past ~3 fields**.
2. A command needs a **response** (request/reply rather than fire-and-forget). This doubles the
   hand-synced surface per call and adds correlation ids, which are themselves a shape.
3. Any bridge payload is **a type owned by a frozen contract in `src/shared/contracts/`**
   (`Locator`, `SharedPrefs`, `SearchHit`, …) rather than a primitive local to the bridge.
   This is the sharpest one — see below.
4. The transport stops being base64-over-`injectJavaScript` (see `getBookBase64` in
   `readerAssets.ts`). A new transport means re-agreeing the whole payload shape anyway, which is
   the cheapest possible moment to acquire a compiler.
   > **Re-run 2026-08-13 against a real 20 MB book: DID NOT FIRE.** The transport is still
   > base64-over-`injectJavaScript` and is staying, because measurement showed it is not the
   > bottleneck (~330 ms, ~5% of a warm open). Swapping the base64 _implementation_ on each side —
   > `react-native-quick-base64` host-side, `Uint8Array.fromBase64` in the template — changes no
   > command, no payload shape and no message type, so it is not a new transport. See the Day 4 row
   > in [Stage forecast](#stage-forecast). **Chunking would still fire this** (and trigger 5), so if
   > a future book size forces a sequenced `openBegin`/`openChunk`/`openEnd` protocol, the
   > conversion is the task and comes first.
5. Anything inside the WebView starts holding **state that RN also models**.

### Why trigger 3 is the sharp one

When Vaishnavi changes `TypographyPrefs`, `tsc` walks every TypeScript consumer and fails the
build. It walks straight past `reader.template.html`. The frozen contracts are enforced by the
compiler _and by `__typecheck__.ts`, the canary_ — and the WebView is the one consumer of those
contracts that sits outside both. Hand-copying a frozen shape into untypechecked JS doesn't just
risk drift; it silently removes that shape from the freeze's blast radius.

## Stage forecast

Which upcoming CAP-7 work actually trips this. Ordered by likely sequence, not certainty.

| Stage                                                              | Owner                               | What it adds to the bridge                                                                        | Triggers                             | Verdict                       |
| ------------------------------------------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------ | ----------------------------- |
| **Day 3 — whole-book decrypt** ✅ done                             | Ahana                               | _nothing_ — reused `open` unchanged                                                               | none                                 | debt stayed cheap             |
| **Day 4 — 20 MB whole-book transport** ✅ done                     | Ahana                               | _nothing_ — `open(base64)` unchanged; both codecs swapped BEHIND it                               | **none — 4 tested, not hit**         | ⚠️ was the predicted trigger  |
| **Contents panel fix — nested TOC + typographic baseline** ✅ done | Ahana                               | `toc` items gain `depth`; stylesheet, line grid and column breaks are all inside the WebView      | **none — 1 tested, AT the boundary** | ⚠️ next TOC field converts    |
| **Navigation / library shell**                                     | feature teams                       | nothing — `RootNavigator` supplies `bookId`, host-side only                                       | none                                 | no action                     |
| **Progress persistence** (`progress.ts`)                           | Personalization                     | nothing new inbound — `relocated.cfi` already arrives; host just stores it                        | none                                 | no action                     |
| **Prefs applied to the rendition** (`prefs.ts`)                    | Vaishnavi writes, **Ahana applies** | `setTheme`, `setFont`, `setTypography`, `setLayout`, `setZoom` — or one `applyPrefs(SharedPrefs)` | **1 and 3**                          | ⚠️ **convert here**           |
| **Annotations** (`annotations.ts`)                                 | Personalization                     | `selected` message carrying `Locator` start+end; `applyHighlights` / `removeHighlight` commands   | **1, 2, 3**                          | 🛑 hard deadline              |
| **In-book search** (`search.ts`) ✅ bridge side done               | Vaishnavi                           | _nothing_ — the index is queried in RN memory; navigating to a `SearchHit` reuses `goTo`          | **none — tested, not hit**           | cheap — don't let it fool you |
| **TTS + word/sentence highlight** (`accessibility.ts`)             | Hruthik                             | high-frequency range events + highlight driving                                                   | **1, 2, 5**                          | unthinkable by hand           |

Four things worth calling out, because all four contradict the obvious guess:

- **A typographic baseline looks like prefs-application and is not.** Applying
  `rendition.themes.default(...)` is one of the exact `rendition.*` calls this file names as the
  converting stage — but the theme is built inside the WebView from three local constants and
  crosses nothing. No command, no message type, no `SharedPrefs`. The same distinction as Search:
  what converts is prefs **arriving from RN**, not the epub.js call they eventually drive. What it
  did cost is worth naming honestly, though — three values are now hand-copied out of a frozen
  contract (`DEFAULT_PREFS.typography`) into untypechecked JS. That is trigger 3's _smell_ without
  being trigger 3, since no frozen type crosses the bridge, and it is only survivable because
  `readerTemplate.test.ts` pins the copies to the contract. It is also the clearest preview yet of
  why prefs converts: the second those numbers start arriving over the bridge, a test that greps for
  literals cannot help.

  What that stage inherits, though, is a single seam rather than a rewrite. The template now holds
  the flow in one constant (`READER_FLOW`) and derives everything flow-specific — the line grid, the
  authored-page-break translation — from `isPaginated()`. `LayoutPrefs.flow` becomes the value that
  sets that constant, and `TypographyPrefs` becomes the argument to `readerMetrics()`, which is
  already a pure function of its inputs. So prefs-application is a conversion of how this file is
  BUILT, not a redesign of what it does.

- **Day 3 was the predicted trigger and it didn't fire.** The reviewer expected the
  decrypted-buffer handoff, new error codes and TOC payloads to grow the bridge. In the event the
  handoff reused `open` with an unchanged signature, TOC already existed, and the one new code
  (`CONTENT_LOAD_FAILED`) is host-side and never crosses the bridge. Not blocking on it was
  correct.
- **Day 4 was going to fire trigger 4, and measurement is why it didn't.** This row was not in the
  forecast at all — the table assumed prefs-application would be first. The 20 MB work looked
  certain to trip trigger 4, because `readerAssets.ts` and this file both _asserted in comments_
  that base64-over-`injectJavaScript` "does not scale" to a 20 MB book. **Both comments were
  predictions, and both were wrong.** Tested before changing anything: a 27,962,028-char payload
  (the exact base64 length of a 20 MB book) crossed `injectJavaScript` into WKWebView in **305 ms**,
  and the real book renders in **~330 ms**, about **5%** of a warm open. The remaining ~93% is
  Encryption's base64 round-trip inside `getBook`, which never touches the bridge.
  So the fix was to swap the codec on each side **behind an unchanged `open(base64)`** — no command,
  no payload shape, no message type altered. **Trigger 4 was checked and did not fire.** The
  conversion stays due at prefs-application, exactly as this file already said.
  Recorded because a trigger that was _tested_ and held is evidence; a trigger nobody re-ran is
  just an assumption with a date on it.
- **Search looks like a bridge feature and mostly isn't.** `search.ts` builds the index
  server-side and decrypts it into RAM alongside the book, so querying happens in RN. Only
  _seeking_ touches the WebView, and `goTo` already covers it. Don't schedule the conversion
  around search.
  > **Re-run 2026-08-14, when `goTo` was widened to take a CFI: DID NOT FIRE.** This row was
  > conditional on `goTo` accepting a CFI; it now does. The condition was met by renaming the arg
  > `href` → `target` and carrying a bare `string`, so no command was added, none needs a reply,
  > and no frozen contract crosses. Trigger 3 is the one to watch here and it turns entirely on the
  > unwrap: the host converts `SearchHit.locator` → `.cfi` before sending. Hand the `Locator` union
  > to the bridge instead and this row becomes a conversion. The capability needed no new epub.js
  > surface — `rendition.display()` already resolved CFIs.

## The verdict

**Convert at the start of the prefs-application stage — before writing the prefs commands, not
after.**

Rationale, in order of weight:

1. **It is the first stage that trips a trigger**, and it trips two (nested multi-field payloads,
   and a frozen shared contract crossing the boundary).
2. **Converting 4 flat commands is a morning. Converting 9 commands plus a `Locator` discriminated
   union is a week.** The cost of the conversion grows with exactly the thing that makes it
   necessary, so "later" is strictly more expensive, never less.
3. **Annotations is the hard deadline, and it follows immediately.** `Locator` is a discriminated
   union (`EPUB`/`PDF`) crossing the bridge in both directions. Hand-syncing a discriminated union
   into untypechecked JS is the case where runtime name-checking gives the _most_ false
   confidence: the `type` field validates fine while the variant's payload is wrong.
4. Prefs is a natural rewrite of the template's rendition setup anyway (`flow`, `spread`, themes
   are all `rendition.*` calls), so the file is already open.

**Do not convert before then.** At 5 messages and 4 fire-and-forget commands, a build step buys a
compiler check over a surface you can verify by eye in thirty seconds, and costs a new toolchain
stage that everyone on T4 has to understand. That trade is not worth it yet.

## What "convert" means concretely

Not a rewrite of the reader — a change to how one file is produced:

1. Move the IIFE out of `reader.template.html` into `src/features/reader/webview/readerClient.ts`,
   a real `.ts` file with DOM libs enabled and epub.js types (or a hand-written `.d.ts` shim for
   the handful of epub.js surfaces used).
2. Have it **import the shared types** — `ReaderMessage`, `ReaderCommand`, `ReaderTocItem` — from
   `readerBridge.ts`. That single import is the entire point: the two halves stop being two
   descriptions of one contract and become one contract.
3. Extend `buildReaderHtml.ts` to compile/bundle that entry and inline the output, alongside the
   JSZip and epub.js inlining it already does. Keep the "no sub-resource requests" property —
   `ReaderWebView.tsx`'s navigation lockdown depends on it.
4. Keep `parseReaderMessage()` exactly as it is. Compile-time types do not survive the JSON
   round-trip through `postMessage`; the runtime validation is still the only thing standing
   between untrusted book content and the host. **Types are not a substitute for the parser.**
5. Delete the `>>> REVISIT <<<` block in `readerBridge.ts` and this file's trigger section, and
   replace them with a note saying it's done.

## Before you touch the bridge

Every time you add or change a message type or command:

- [ ] Update **both** halves — `readerBridge.ts` and `reader.template.html`.
- [ ] Add the case to `parseReaderMessage()`; a new type without a `case` returns `null` and
      surfaces as `BRIDGE_PARSE_FAILED`.
- [ ] Run `npm run reader:build-html` — `assets/reader/reader.html` is generated **and tracked**.
      CI fails if you skip this, but it fails on _your_ PR; running it locally is still faster.
- [ ] Update the [Current surface](#current-surface) table above.
- [ ] **Re-run the trigger test.** If any trigger now fires, converting is the task — not a
      follow-up ticket. Say so in the PR.
- [ ] Check the template's prose is still true. Nothing lints it; it has gone stale before.

## Related

- `src/features/reader/readerBridge.ts` — the typed half; carries the same trigger list inline.
- `src/features/reader/readerTemplate.test.ts` — the non-protocol template guards: the
  `DEFAULT_PREFS` constants copied into the theme, the TOC flatten, and the `'100%'` rendition
  dimensions that epub.js's resize handling depends on being non-numeric.
- `src/features/reader/scripts/buildReaderHtml.ts` — the generator that would host the build step.
- `src/features/reader/ReaderWebView.tsx` — the navigation lockdown that contains decrypted
  content; load-bearing since Day 3.
- `src/features/reader/readerAssets.ts` — the base64 transport constraint (trigger 4).
