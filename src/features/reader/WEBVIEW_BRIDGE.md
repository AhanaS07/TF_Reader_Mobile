# Reader ⇄ WebView bridge — the hand-sync contract, and when to end it

**Owner:** Reader (Ahana) · **Status:** accepted debt, now **called in** — prefs-application has
been formally requested (2026-08-18) and signed off, so the conversion is the next Reader task
rather than a forecast. TTS is the second claimant and needs the same conversion.
**Last reviewed:** 2026-08-18, for the **prefs-application sign-off**. **The bridge was not
touched** — no message type, no command, no template edit, neither artifact regenerated. What
changed is that the predicted stage is now a real request with a real design behind it
(`features/personalization/READER_PREFS_APPLICATION.md` + `readerAppearance.ts`, both landed), and
three decisions that blocked it are closed. Read
[The prefs-application design, as signed off](#the-prefs-application-design-as-signed-off) before
starting the conversion; it is the agreed shape of the thing the conversion is FOR. Trigger 1's
wording changed in the same review — it was asymmetric and could be read as not counting command
payloads at all (see the note under [The trigger](#the-trigger)). The verdict is unmoved.
**Previously reviewed:** 2026-08-17, when PDF support landed. **All five triggers re-run and NONE fired**,
but this is the largest change the bridge has absorbed without converting, so read the PDF row in
[Stage forecast](#stage-forecast) before assuming it was free. Two things did change structurally:
the WebView half is now **three files rather than one** (two templates plus a shared fragment), and
there are **two generated artifacts**. The surface grew by one command — see
[Two templates, one bridge](#two-templates-one-bridge). The due date is unmoved.
**Previously reviewed:** 2026-08-16, when the Reader → TTS seam was agreed (`TTS_PROVIDER.md`). **The
bridge was not touched** — no message type, no command, no template edit, no regenerated
`reader.html`; the interface and its fake are RN-side only. What changed is the forecast: the TTS
row's design is now settled, trigger 5 is designed out of it, and triggers 1 and 2 fire harder than
the row previously claimed. See the TTS bullet under [Stage forecast](#stage-forecast). The
practical effect is that this file no longer has one predicted converting stage but two, either of
which can go first.
**Previously reviewed:** 2026-08-16, when the in-book search UI landed — **all five triggers re-run and
NONE fired**; the bridge was not touched at all (see the In-book search row in
[Stage forecast](#stage-forecast)). The state of trigger 1 is unchanged from the review below.
Same review confirmed the prefs row's **second** blocker is gone: prefs now have a real persisted
source (`readSharedPrefs()`), so the bridge is the only thing left standing between here and
prefs-application. Status was left at "not yet due", meaning nobody had asked rather than that it
couldn't be done — which is exactly what the review above changed.

**Before that:** 2026-08-14, after the Contents-panel fix flattened epub.js's nested `subitems`
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

| Half                 | File                                                    | Typechecked?        |
| -------------------- | ------------------------------------------------------- | ------------------- |
| Host (React Native)  | `src/features/reader/readerBridge.ts`                   | yes — `tsc`, strict |
| WebView — EPUB       | `src/features/reader/webview/reader-epub.template.html` | **no**              |
| WebView — PDF        | `src/features/reader/webview/reader-pdf.template.html`  | **no**              |
| WebView — shared     | `src/features/reader/webview/reader.bridge.html`        | **no**              |

The WebView side is plain ES5-ish JS inside `.html` files _precisely_ so `tsc` cannot see it
(`tsconfig` sets `allowJs` + `checkJs` over `src/`, so a `.js` file there would be typechecked and
would fail — it references browser globals and epub.js/pdf.js internals that RN's types don't
model). `reader.bridge.html` is the same trick one level down: it is raw JavaScript despite the
extension, because it is spliced into both templates' IIFEs.

`buildReaderHtml.ts` inlines JSZip + epub.js into one template and pdf.js + its worker into the
other, plus the shared fragment into both, and emits **two** tracked, generated artifacts:
`assets/reader/reader-epub.html` and `assets/reader/reader-pdf.html`. Regenerate both with
`npm run reader:build-html` after editing **either template or the fragment** — a fragment edit
invalidates both. CI's "Reader HTML is freshly generated" step rebuilds and `git diff --exit-code`s
both files, so forgetting is a red build rather than a stale ship.

Note what that step does and does not cover: it proves the artifacts match their sources, _not_ that
the sources match `readerBridge.ts` — the drift guard in `readerBridge.test.ts` is what does that
(see [What protects it today](#what-protects-it-today--and-what-doesnt)).

`buildReaderHtml.ts` also **parses every script it emits** (`assertScriptsParse`, via Node's `vm`).
That is not belt-and-braces: the first two-artifact build shipped a syntactically broken IIFE in
_both_ files, because the fragment's header described its own comment syntax and thereby closed the
comment early. Every marker was substituted, every fingerprint present, every size plausible. On a
device it would have presented as a blank page and a `READY_TIMEOUT` ten seconds later.

## Current surface

As of 2026-08-17. **Keep this table accurate — it is the input to the trigger test below.**

**WebView → host** (`ReaderMessage`, one case per `post({ type: ... })` in the template)

| Type        | Payload fields                     | Count |
| ----------- | ---------------------------------- | ----- |
| `ready`     | —                                  | 0     |
| `rendered`  | —                                  | 0     |
| `relocated` | `cfi`, `atStart`, `atEnd`          | 3     |
| `toc`       | `items[]` (`{label, href, depth}`) | 1     |
| `error`     | `code`, `message`                  | 2     |

**Host → WebView** (`READER_COMMANDS` keys ↔ `window.TFReader` method names)

| Command    | Args     | Reply? | Defined in     |
| ---------- | -------- | ------ | -------------- |
| `openEpub` | `base64` | no     | EPUB template  |
| `openPdf`  | `base64` | no     | PDF template   |
| `next`     | —        | no     | both           |
| `prev`     | —        | no     | both           |
| `goTo`     | `target` | no     | both           |

`goTo.target` is a spine href **or** an EPUB CFI, as one bare `string`. It is deliberately not a
`Locator`: Search stores the union, the host unwraps `.cfi`, and only the string crosses. Widening
it to the union would fire trigger 3 for no runtime gain, since epub.js's `spine.get()` already
discriminates the two forms itself via `isCfiString()`.

**5 message types, 5 commands, max 3 fields per case, zero request/reply.** That is the whole
contract. It is small enough to hold in your head, which is the only reason this is safe.

## Two templates, one bridge

PDF support could have been one template branching on a format, or two templates. It is two, so an
EPUB read does not carry ~1.4 MB of inlined pdf.js it can never call. The consequence that matters
here is that the bridge now has **three source files**, and the obvious naive split — copy the
shared JS into both templates — would have doubled the hand-synced surface on a boundary whose only
safety argument is that it is small. So the shared half lives once, in `reader.bridge.html`, and is
injected into both.

Two properties of that fragment are load-bearing:

- **It is injected _raw_, inside each template's existing `<script>` and IIFE.** Its functions stay
  IIFE-locals rather than becoming globals in a document that holds decrypted book content. A
  separate `<script>` tag would be a separate scope and would force a global to bridge them.
- **Its indentation is _not_ semantic**, unlike the templates'. `buildReaderHtml.ts` re-indents it to
  its marker's depth. The one position-anchored regex in `readerBridge.test.ts` targets
  `window.TFReader`, which stays in the templates because its methods differ per format.

**How format crosses the bridge — and why it does not.** `ContentFormat` is frozen
(`shared/types/primitives.ts`), so putting its value in a payload would be trigger 3 outright. It
never crosses. The host reads it in typechecked TS and picks **between two command names**; each
template defines exactly one of them. The discriminant is therefore a `READER_COMMANDS` key, owned
by `readerBridge.ts`, not a frozen enum hand-copied into untypechecked JS. This is the same
manoeuvre that kept `goTo` cheap: discriminate host-side, send a primitive.

Do not "simplify" this to `open(base64, format)`. It reads tidier and it converts the bridge.
`readerBridge.test.ts` asserts no `ContentFormat` literal appears in any generated command script,
so the simplification fails a test rather than passing review.

**What the drift guard does differently now.** It reads all three files and compares the **union**
against the TS side. Unioning is not a loosening — each template legitimately raises codes the other
cannot (`EPUBJS_MISSING`/`JSZIP_MISSING` vs `PDFJS_MISSING`) and defines only its own `open*`. The
per-file expectations that _do_ still hold are asserted separately: each template defines exactly one
open command and it is its own; both implement `next`/`prev`/`goTo`; neither redefines what the
fragment provides.

`toc.items[].depth` is the nesting level in the book's navigation tree, 0 for a top-level entry.
The tree is flattened depth-first **in the template** and crosses as one ordered flat list, because
a recursive payload is the shape hand-sync is worst at — the host indents by `depth` instead. Both
sides clamp it to `MAX_TOC_DEPTH` (6): the template as it flattens, and `parseReaderMessage` again
because the value originates in a book's own navigation document. A **missing** `depth` parses as 0
rather than rejecting the entry, so a working tree holding a stale generated `reader-epub.html`
degrades to today's flat list instead of an empty Contents panel. **Counting the TOC entry as 3 fields, this
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

1. The message union passes **~8 cases**, or **any single payload grows past ~3 fields** — in
   either direction. A command's arguments count exactly as a message's fields do.
   > **Wording fixed 2026-08-18, during the prefs-application sign-off.** This used to read "any
   > single _case_", and "case" only ever meant a `ReaderMessage` case — which is how the PDF row
   > below can say "commands went 4 → 5, which this trigger does not count". Read literally, that
   > left a 13-field _command_ firing nothing, while the same doc asserted prefs-application
   > "trips 1 and 3". The intent was always shape complexity, and shape drift is not
   > direction-sensitive: a command whose payload the host and the template disagree about fails
   > exactly the same way a message does. Fixed so nobody argues the letter to skip the
   > conversion. What is still deliberately uncounted is the NUMBER of commands — five
   > fire-and-forget one-argument commands is not the thing that gets dangerous.
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
build. It walks straight past the WebView templates. The frozen contracts are enforced by the
compiler _and by `__typecheck__.ts`, the canary_ — and the WebView is the one consumer of those
contracts that sits outside both. Hand-copying a frozen shape into untypechecked JS doesn't just
risk drift; it silently removes that shape from the freeze's blast radius.

**And it is the one trigger the conversion DISSOLVES rather than satisfies.** Triggers 1, 2 and 5
describe surfaces that stay awkward however they are typed; trigger 3 exists _only_ because one
consumer is invisible to `tsc`. Once the WebView is a typechecked entry point, importing a frozen
contract into it is not a risk, it is the mechanism — `tsc` walks it like any other consumer. So
after the conversion the right move inverts: values that are structurally a frozen contract's
should be **derived from it** (`LayoutPrefs['flow']`, `LayoutPrefs['spread']`) rather than
re-declared as local literals, because a re-declared union silently tolerates the contract growing
a member and an indexed access does not. Do not carry the pre-conversion habit past the conversion.

## Stage forecast

Which upcoming CAP-7 work actually trips this. Ordered by likely sequence, not certainty.

| Stage                                                              | Owner                               | What it adds to the bridge                                                                        | Triggers                             | Verdict                       |
| ------------------------------------------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------ | ----------------------------- |
| **Day 3 — whole-book decrypt** ✅ done                             | Ahana                               | _nothing_ — reused `open` unchanged                                                               | none                                 | debt stayed cheap             |
| **Day 4 — 20 MB whole-book transport** ✅ done                     | Ahana                               | _nothing_ — `open(base64)` unchanged; both codecs swapped BEHIND it                               | **none — 4 tested, not hit**         | ⚠️ was the predicted trigger  |
| **Contents panel fix — nested TOC + typographic baseline** ✅ done | Ahana                               | `toc` items gain `depth`; stylesheet, line grid and column breaks are all inside the WebView      | **none — 1 tested, AT the boundary** | ⚠️ next TOC field converts    |
| **Navigation / library shell**                                     | feature teams                       | nothing — `RootNavigator` supplies `bookId`, host-side only                                       | none                                 | no action                     |
| **Progress persistence** (`progress.ts`)                           | Personalization                     | nothing new inbound — `relocated.cfi` already arrives; host just stores it                        | none                                 | no action                     |
| **Prefs applied to the rendition** (`prefs.ts`) ⬅ **requested 2026-08-18** | Vaishnavi writes, **Ahana applies** | one `applyAppearance(ReaderAppearance)` — flat and primitive-only, so **trigger 3 is designed out**; see the signed-off design below | **1 — 3 designed out, 2/4/5 clear** | 🛑 **convert here, now**      |
| **Annotations** (`annotations.ts`)                                 | Personalization                     | `selected` message carrying `Locator` start+end; `applyHighlights` / `removeHighlight` commands   | **1, 2, 3**                          | 🛑 hard deadline              |
| **In-book search** (`search.ts`) ✅ bridge side done               | Vaishnavi                           | _nothing_ — the index is queried in RN memory; navigating to a `SearchHit` reuses `goTo`          | **none — tested, not hit**           | cheap — don't let it fool you |
| **PDF support — pdf.js + `ContentFormat` routing** ✅ done          | Ahana                               | `open` → `openEpub`/`openPdf` (4 → 5 commands); `PDFJS_MISSING`; **no message change at all**     | **none — all five re-run**            | ⚠️ read the row note           |
| **TTS + word/sentence highlight** (`accessibility.ts`)             | **Ahana** builds, Hruthik consumes  | `requestSentence` + `setSpokenRange` commands, one `sentence` reply — see the row note below      | **1 and 2 — 5 designed out**         | 🛑 convert first              |

Five things worth calling out, because all five contradict the obvious guess:

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
  >
  > **Re-run 2026-08-16, when the search UI landed: DID NOT FIRE.** The unwrap this row was
  > conditional on is now real code rather than an intention — `cfiOf()` in `useBookSearch.ts` is
  > the single place `locator.type` is read, and it returns a bare `string`. All five re-checked:
  > no command added (still 4), none needs a reply, no frozen contract crosses, transport
  > unchanged, and hits/active-index/query all live in RN — the WebView holds nothing new. The
  > surface table above is unchanged and `reader.html` was not regenerated because the template was
  > not touched.
  >
  > What makes this durable rather than a promise is the test: `ReaderScreen.test.tsx`'s "sends
  > goTo carrying a bare CFI string" asserts the injected script equals
  > `buildCommandScript({ type: 'goTo', target: '<cfi>' })`. Widening the bridge to carry the
  > `Locator` union now fails that test instead of quietly succeeding.

- **PDF support looks like it must have converted this, and it did not — but only because one field
  was left out on purpose.** A whole second renderer, a second template and a second generated
  artifact landed without firing anything. All five, re-run 2026-08-17:

  | # | Trigger | Verdict |
  | - | ------- | ------- |
  | 1 | union past ~8 cases, or a case past ~3 fields | **clear** — `ReaderMessage` is byte-for-byte unchanged. Commands went 4 → 5, which this trigger does not count |
  | 2 | a command needs a reply | **clear** — all five stay fire-and-forget |
  | 3 | a frozen contract crosses | **clear** — format is a command NAME, never a value; see [Two templates, one bridge](#two-templates-one-bridge) |
  | 4 | transport changes | **clear** — base64-over-`injectJavaScript`, both formats, shared codec |
  | 5 | WebView holds state RN also models | **clear, and this is the closest one** — the PDF client holds `currentPage`, but RN receives only `atStart`/`atEnd`, so it models "can I move", not the position |

  **What was left out, and why it is the whole reason this row is not a conversion:** reporting the
  PDF **page** in `relocated`. That is a fourth field on a case already _at_ trigger 1's boundary, so
  it fires trigger 1 outright. It was dropped rather than argued about, on the grounds that nothing
  consumes a reading position yet — `ReaderScreen` reads `relocated.cfi` and stores it nowhere, and
  the position record is Personalization's Progress stage. So the field would have bought nothing and
  cost the conversion. It costs nothing to defer either: the PDF client already tracks `currentPage`
  internally to implement `next`/`prev`, so adding the field later is small. **When Progress asks for
  it, adding it IS the conversion. Say so then instead of re-arguing the boundary.**

  Also left out for the same reason: mapping the PDF outline into `toc`. That would overload
  `ReaderTocItem.href` to mean "spine href **or** page number" across an untypechecked boundary,
  which is precisely the shape drift this file says nothing protects. The PDF client posts
  `toc {items: []}` instead — an explicit empty list rather than silence, because the host waits for
  that message before enabling its Contents control.

- **TTS was forecast to fire trigger 5 and the agreed design removes it — but 1 and 2 still fire,
  so the conversion is still first.** This row long read "high-frequency range events + highlight
  driving", which assumed a cursor: the WebView tracking which sentence is being spoken while RN
  tracked it too. The seam agreed on 2026-08-16 (`TTS_PROVIDER.md`) is **stateless per request** —
  every `requestSentence` carries its own anchor CFI, so the WebView holds no TTS position for RN
  to duplicate. That is worth having deliberately rather than by luck: with no cursor there is
  nothing to reset, so cancelling an in-flight request and starving one across `closeBook` are the
  same mechanism, and the data-minimisation guarantee (no sentence delivered after teardown) does
  not depend on the two sides agreeing about where the reader is.

  What it does **not** buy is a cheaper bridge. `requestSentence` needs a **reply** — trigger 2,
  outright, the first request/reply on this bridge — and the `sentence` payload carries seven
  fields, past trigger 1's boundary twice over. So the verdict below is unchanged in substance and
  sharper in scope: **whichever of prefs-application and TTS lands first pays for the conversion,
  and neither can be built without it.** Nothing in this change touched the bridge — no message
  type, no command, no template edit, and `reader.html` was not regenerated. The interface and its
  fake are RN-side only, which is precisely why Accessibility is not blocked on any of this.

## The verdict

**Convert at the start of the prefs-application stage — before writing the prefs commands, not
after.** As of 2026-08-18 that stage has been requested and its design signed off, so this is no
longer a scheduling opinion: it is the next task. The agreed shape is in
[The prefs-application design, as signed off](#the-prefs-application-design-as-signed-off).

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

**What is no longer a reason to wait: the source.** This stage used to have two blockers, and the
other one was upstream — `InMemoryPrefsStore` reset on every launch, so there was no durable
`SharedPrefs` to apply and no way to tell a bug from a restart. Sync closed that:
`features/sync/sharedPrefs.ts`'s `readSharedPrefs()` reads the `personalization` and `accessibility`
rows off SQLite and merges them into one contract-shaped record, falling back to `DEFAULT_PREFS`
when a row is missing. Reader does not call it yet — there is no prefs command to feed. So the
sequencing is now unambiguous rather than merely recommended: **the bridge is the whole of what is
left**, and it is the first thing to do, not the thing discovered halfway through.

**Do not convert before then.** At 5 messages and 4 fire-and-forget commands, a build step buys a
compiler check over a surface you can verify by eye in thirty seconds, and costs a new toolchain
stage that everyone on T4 has to understand. That trade is not worth it yet.

## The prefs-application design, as signed off

Requested by Personalization on 2026-08-18 and signed off the same day. Personalization's half is
built and committed (`features/personalization/readerAppearance.ts`, `READER_PREFS_APPLICATION.md`);
Reader's half is the conversion plus the apply. **Read this before starting the conversion** — it is
what the conversion is for, and two of its consequences (who the payload's claimants are, and where
the command has to be defined) change what "done" means.

**The surface: one fire-and-forget command.**

```
applyAppearance(appearance)   // host -> WebView, no reply
```

`ReaderAppearance` is a flat, primitive-only, **bridge-local** shape — not a `src/shared/contracts/`
type. The host resolves `SharedPrefs` into it in typechecked TS (`toReaderAppearance`) and only
primitives cross. That is the third use of a manoeuvre this file already relies on twice: `goTo`
unwraps `Locator` → `.cfi`, `openEpub`/`openPdf` route `ContentFormat` by command _name_, and prefs
resolve to primitives. **Not** `applyPrefs(SharedPrefs)`, which is trigger 3 by definition, and
**not** five granular setters — prefs are applied together, so N setters is N surfaces to hand-sync
and N chances at a partial apply, for no gain.

All five re-run against this design:

| # | Trigger | Verdict |
| - | ------- | ------- |
| 1 | payload past ~3 fields | **FIRES** — twelve, and more once the a11y claimants below are counted. The conversion is the first task of this stage |
| 2 | a command needs a reply | clear — fire-and-forget, and it must stay so; live re-apply is "re-send the whole payload" |
| 3 | a frozen contract crosses | **designed out** by the flattening. It would have fired outright against `applyPrefs(SharedPrefs)` |
| 4 | transport changes | clear — same base64-over-`injectJavaScript`, one more `JSON.stringify` |
| 5 | WebView holds state RN also models | clear **conditionally** — see the `zoom` constraint below |

Trigger 1 firing is not a formality to note and move past. It is the whole reason the conversion
comes first, and it is what the wording fix under [The trigger](#the-trigger) protects.

### Four things the design has to add, found while signing it off

1. **`applyAppearance` must be defined in BOTH templates.** As proposed it lands in the EPUB one
   only — and `buildCommandScript` guards on `typeof window.TFReader.applyAppearance === 'function'`,
   so every PDF open would answer `NOT_READY` and show the user a coded error for a command that
   simply is not there. The PDF half applies `bg` and `zoom` and ignores typography. Shared
   behaviour goes in `reader.bridge.html`; per-format application stays per template.
2. **It must be sent BEFORE `openEpub`/`openPdf`, not alongside.** `flow` and `spread` are
   `renderTo()` options and `renderTo` runs _inside_ `openEpub`, so a payload arriving after it
   renders the book in the wrong flow and needs a second re-layout to correct. Order: `ready` →
   `applyAppearance` → `open*`. **Consequence: `BASELINE_FONT_SIZE_PX` / `_LINE_HEIGHT` /
   `_MARGIN_PX` stay** as the pre-payload fallback — prefs are an async SQLite read, and a slow or
   failed read must not paint at UA defaults. So the `DEFAULT_PREFS` pins in `readerTemplate.test.ts`
   survive this stage rather than being deleted with the constants, which is the opposite of what
   that test's own comment predicted; the comment is corrected there.
3. **The payload has THREE claimants, and it stays ONE payload.** Personalization owns theme, font
   and typography. Reader owns `reduceMotion` (below). Accessibility owns `announce.pageChanges` —
   `WEBVIEW_A11Y_FINDINGS.md` §3.7 requires the WebView to read it "through the same composed-prefs
   path", i.e. over this command — plus `highContrast`, bold text, dyslexia font and readable
   spacing, which `READER_PREFS_APPLICATION.md` §4 currently sets aside as applied "on top". There
   is no other channel for those to arrive by. **One command carries everything the WebView renders
   with, already resolved**, because the alternative is an `applyA11y` sibling landing the week
   after the conversion and reopening every question this section answers. The payload's _name_ is
   Personalization's to choose; the "one command, one resolve seam" property is not negotiable.
4. **`fontFamily` and `customFontUri` are user-supplied strings that end up in CSS text.**
   `JSON.stringify` in `buildCommandScript` protects the injected _script_; it does nothing for the
   stylesheet the template then builds by concatenation, inside a document holding decrypted
   licensed content. They need a character allow-list and CSS quoting on arrival. Reader's to
   implement — recorded because the existing escaping looks like it already covers this and does
   not.

### The font-size clamp: clamp the FACTOR, not the product

`readerMetrics` currently computes `clamp(round(16 × width / 393), 15, 22)`. That is right for a
fixed baseline and wrong the moment the base is a preference: at a 2× accessibility multiplier the
user's chosen size is silently capped at 22px — and that user is precisely the one who cannot work
around it. Widening the bounds only moves the cap. The fix is to clamp the **viewport factor**,
which is what the clamp was ever about (device fit), and let the composed base through:

```
viewportFactor = clamp(width / 393, 0.94, 1.375)
fontPx         = round(composedPt × viewportFactor)
```

Behaviour-preserving at base 16 — `0.94 × 16 → 15`, `1.375 × 16 → 22`, identical in between — so it
is not a rendering change today. A wide absolute clamp stays underneath purely so a pathological
value cannot break layout. Reader owns these numbers; they are recorded so they are not re-derived
from scratch later.

**`marginPx` needs a bound for the same reason.** `padBottom = height - padTop - lines × linePx`
goes negative once the margin approaches half the viewport height, because `lines` is already
floored to a minimum of 1. A prefs-driven margin can reach that; a hand-copied 16 could not.

### The live channel, and the two smaller calls

- **No event bus for prefs** (`event-bus.ts` open question #1, now answered there). Reader
  subscribes to the prefs store instead: `prefsStore.savePrefs()` already returns the freshly
  re-read record, so the change is known at its source and a module-level subscription beside the
  store delivers it — no runtime to build, and none of that file's question-2 ownership problem.
  `EVENT_CHANNELS.PREFS_CHANGED` stays in the contract: removing an exported key is a Contracts
  Gate conversation and an unused channel costs nothing. The bus still earns its place for
  `content.*`, where emitter and consumer must not import each other. Re-read-on-focus, the other
  candidate, is out for a duller reason — there is no navigator to give Reader a focus event
  (`App.tsx` still mounts `ReaderScreen` directly). **Sync is not a blocker for this stage.**
- **`spread`: `single` → `'none'`, `double` → `'auto'`.** `'always'` would not have differed —
  epub.js sets `_spread = (spread === "none") ? false : true` (`layout.js:84-88`) and then gates
  two-up on `width >= minSpreadWidth`, default 800 (`layout.js:119-120`). So on any phone `double`
  renders single-page whatever we send. That is the behaviour Reader wants; it does mean the
  preference is inert on the device this is tested on, which is the settings UI's problem to be
  honest about rather than the bridge's.
- **`zoom` is carried, and it is the one field that can fire trigger 5 later.** The WebView may
  hold the last payload only as a **write-only cache**, for recomputing on resize. The moment a
  pinch-zoom gesture inside the WebView _mutates_ `zoom`, that is state RN also models and RN has
  to own it — the same line the PDF renderer's `currentPage` sits on.

### Decisions closed by this sign-off

Both were open items blocking the stage. Both are answered in `src/shared/contracts/prefs.ts`'s
DECISION LOG rather than here, so there is one home for them:

- **#4 — `typography.size` is absolute points**, composed as
  `size × resolveFontScale(a11y.text, osFontScale)`, with the viewport factor applied last (above).
  `spacing` is ratified as px in the same breath.
- **#2 — `reduceMotion` is honoured by Reader.** Free today, and worth saying precisely why: there
  is **no animation anywhere in the reader** — no `transition`, `animation`, `@keyframes` or
  `prefers-reduced-motion` in either template or `ReaderScreen.tsx`, and epub.js page turns are
  instant `display()` calls. So suppression is currently vacuous and the real obligation falls on
  whoever adds the first page-turn animation. `readerTemplate.test.ts` now pins it, which makes
  that a red build rather than a promise in a doc nobody re-reads.

## What "convert" means concretely

Not a rewrite of the reader — a change to how one file is produced:

1. Move the IIFEs out of the two templates into real `.ts` entry points under
   `src/features/reader/webview/` — one per format, over a shared module that replaces
   `reader.bridge.html`,
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

- [ ] Update **every** half — `readerBridge.ts` plus whichever of the two templates and the shared
      fragment are affected. Shared behaviour belongs in the fragment, not copied into both.
- [ ] Add the case to `parseReaderMessage()`; a new type without a `case` returns `null` and
      surfaces as `BRIDGE_PARSE_FAILED`.
- [ ] Run `npm run reader:build-html` — `assets/reader/reader-epub.html` AND `reader-pdf.html` are
      generated **and tracked**, and a fragment edit invalidates both. CI fails if you skip this, but
      it fails on _your_ PR; running it locally is still faster.
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
- `src/features/sync/sharedPrefs.ts` — `readSharedPrefs()`, the persisted `SharedPrefs` the prefs
  stage will apply. Not Reader's, and not called from Reader yet; listed so the conversion is not
  re-scheduled on the belief that prefs have nowhere to come from.
- `src/features/personalization/READER_PREFS_APPLICATION.md` — Personalization's design for the
  stage: the full field-by-field mapping table and the live-reapply flow. Vaishnavi's; read it
  together with the sign-off section above, which amends it.
- `src/features/personalization/readerAppearance.ts` — `toReaderAppearance()`, the host-side
  resolve seam that keeps the frozen contract off the bridge. The payload this bridge will carry.
- `src/features/accessibility/WEBVIEW_A11Y_FINDINGS.md` — §3.7 is the third claimant on that
  payload: `announce.pageChanges` has to arrive over this command rather than be read inside the
  WebView.
