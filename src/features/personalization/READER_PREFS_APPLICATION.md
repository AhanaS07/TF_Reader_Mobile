# Applying prefs to the reader — design + cross-team handoff

**Owner:** Personalization (Vaishnavi) writes; **Reader (Ahana) applies.** · **Status:** design
signed off by Ahana (2026-08-18). Personalization's half built (`readerAppearance.ts` +
`prefsStore.subscribe`). The Reader half (WebView conversion, then the apply command) is Ahana's —
she is sizing the conversion and will give a date. All the design decisions this doc used to leave
open are now settled — see the resolved notes in §8.

This is the "prefs-application stage" that `WEBVIEW_BRIDGE.md` has forecast for weeks as the first
stage that trips a bridge trigger. This doc is the design for it and the handoff to the two owners
it depends on. Week-2 Day-2 goal, restated from the task list:

- Themes (system/light/dark, + sepia) applied **live** in the reader via `SharedPrefs`
- Fonts + custom font family applied to the reflowable EPUB
- A theme/font change **re-renders without reopening the book**

---

## 1. The gate: the bridge must be converted first, and it is Reader's

`WEBVIEW_BRIDGE.md`'s verdict is explicit and unchanged: **convert the WebView to a typechecked
build _before_ writing the prefs commands, not after.** Prefs-application trips two triggers:

- **Trigger 1** — a payload with more than ~3 fields (anything describing theme + font +
  typography + layout at once).
- **Trigger 3** (the sharp one) — a **frozen `src/shared/contracts/` type** (`SharedPrefs`,
  `TypographyPrefs`) crossing into the untypechecked WebView JS.

Hand-syncing `setTheme`/`setFont` into the templates is the specific move the doc forbids, and a
test in `readerBridge.test.ts` already fails if a frozen literal crosses the bridge.

**This work is therefore cross-team.** `src/features/reader/` is Ahana's; the forecast row reads
"Vaishnavi **writes**, Ahana **applies**." Personalization can build the resolver (done) and design
the surface (this doc); the conversion and the epub.js application are Ahana's.

### What this design does about trigger 3

It removes it. Instead of sending `SharedPrefs` (or `TypographyPrefs`) across the bridge, the host
resolves prefs into **`ReaderAppearance`** — a flat, primitive-only, _bridge-local_ shape defined in
`readerAppearance.ts`, owned by Personalization/Reader, not by the freeze. This is the same
"resolve host-side, send a primitive" manoeuvre that kept `goTo` (unwraps `Locator` → `.cfi`) and
`openEpub`/`openPdf` (routes `ContentFormat` by command _name_) cheap.

**It does not remove the conversion.** `ReaderAppearance` is still multi-field, so **trigger 1 still
fires** and the typechecked-WebView build is still the first task of this stage. What the flattening
buys is a smaller blast radius (only primitives cross) and a clean freeze boundary (no
`src/shared/contracts/` type on the untypechecked side).

---

## 2. What exists today (the seam this plugs into)

The reader currently reads **no** prefs. It applies typography only, as three constants hand-copied
from `DEFAULT_PREFS.typography` into `reader-epub.template.html`:

- `BASELINE_FONT_SIZE_PX = 16`, `BASELINE_LINE_HEIGHT = 1.5`, `BASELINE_MARGIN_PX = 16`
- `READER_FLOW = 'paginated'` (a constant; `isPaginated()` keys everything flow-specific off it)
- `readerMetrics(width, height)` — pure; scales font by viewport width, clamps 15–22px, quantises
  the line grid
- `baselineCss(m)` — pure; builds the stylesheet text
- `applyBaselineCss()` + a `rendition.hooks.content` handler — inject the sheet into every chapter
  (idempotent via `addStylesheetCss(css, STYLESHEET_KEY)`, which _replaces_ its `<style>` node)

Theme and font are **not applied at all**. Everything is computed once at open (and again on
resize). There is no live re-apply path.

The template comment already anticipates this stage: "They stop being constants at the
prefs-application stage", and `readerMetrics`/`baselineCss` are pure precisely so prefs can feed
them as arguments.

---

## 3. Bridge surface: one `applyAppearance` command (DECIDED)

**One command carrying the whole `ReaderAppearance`, not five granular setters and not
`applyPrefs(SharedPrefs)`.** Ahana holds this: "one command and one resolve seam."

```
applyAppearance(appearance: ReaderAppearance)   // RN -> WebView, fire-and-forget
```

Why one command:

- Prefs are applied together — a theme change and a font change both rebuild the same stylesheet, so
  splitting them into `setTheme`/`setFont`/`setTypography` means N methods to hand-sync and N
  chances for a partial apply, for no gain.
- Live re-apply is then trivially "re-send the whole thing" — the WebView holds no per-field prefs
  state to diff (keeps trigger 5 clear).
- It is fire-and-forget (no reply → trigger 2 stays clear).

Why not `applyPrefs(SharedPrefs)`: that is trigger 3 by definition. `ReaderAppearance` is the
flattened, de-frozen equivalent — see §1.

**One payload carries all three claimants.** The payload is not just Personalization's theme/font/
typography/layout/zoom — it also carries the **resolved `reduceMotion`** and Hruthik's a11y content
flags (`highContrast`, `boldText`, `dyslexiaFont`, `readableSpacing`, `announcePageChanges`). This is
deliberate and is Ahana's call: those flags have no other channel into the WebView, and Hruthik's
`WEBVIEW_A11Y_FINDINGS.md` §3.7 requires `announce.pageChanges` to arrive through exactly this
composed-prefs path. There is no "applied on top" that is not a second command, so they ride here.
`readerAppearance.ts` only resolves them to primitives; their apply-time meaning is Reader/Hruthik's
(see §4).

**Type home (DECIDED — option 1):** `readerBridge.ts` **imports `ReaderAppearance` from
`readerAppearance.ts`** (a reader → personalization type import; the value resolution stays in
personalization). This is not trigger 3 — `ReaderAppearance` is a feature-local type, not a
`src/shared/contracts/` one.

**Defined in both templates, sent before `open*`.** Ahana: `applyAppearance` must be a method on the
EPUB **and** PDF `window.TFReader`, and the host must send it before `openEpub`/`openPdf` — otherwise
a PDF open raises `NOT_READY`, and `flow`/`spread` miss `renderTo()`.

---

## 4. Field-by-field mapping into the template

| `ReaderAppearance` field | Applied in the template by |
| --- | --- |
| `fontSizePt` | Replaces `BASELINE_FONT_SIZE_PX` as the input to `readerMetrics()`. Viewport scaling + the clamp stay the reader's — Ahana clamps the **viewport factor (0.94–1.375)**, not the product, so the user's chosen pt is never capped (§8.2, resolved). |
| `lineHeight` | Replaces `BASELINE_LINE_HEIGHT`. |
| `marginPx` | Replaces `BASELINE_MARGIN_PX`. |
| `letterSpacingPx` | New rule in `baselineCss` body: `letter-spacing: Npx` — **omit the rule when 0** (the template already documents "a rule setting a property to its own default only adds a declaration for a real book's CSS to lose to"). |
| `fg`, `bg`, `link` | New block in `baselineCss`: `color` on body + text elements, `background` on `html,body`, `color` on `a`. Applied through the SAME `addStylesheetCss`/content-hook path as typography — **not** `rendition.themes`. The template's own note explains why: `Themes.inject()` never reads a serialized CSS theme, so it silently skips every chapter loaded _after_ the call. `addStylesheetCss` replaces its node and the content hook re-runs per chapter, so both are idempotent and cover late chapters. |
| `bg` (host) | Also set on the host `#viewer` / `<body>` background in the template's static CSS path, so the gutter around the column matches the page — otherwise a dark theme shows a white frame. |
| `fontFamily` | New body rule in `baselineCss` when non-empty: `font-family: <fontFamily>, <fallback>`. Empty string = leave the book's own font (the baseline deliberately does not set font-family today). |
| `customFontUri` | `@font-face` + use as the family. **Blocked on transport** — see §8; the WebView cannot fetch `file://`. |
| `flow` | Sets `READER_FLOW`. `isPaginated()` already gates the line grid and column breaks, so this is the value that constant becomes. **Changing flow live needs a re-layout** — see §5. |
| `spread` | `rendition.spread(...)` — `single`→`'none'`, `double`→`'auto'` (Ahana). `'always'` is identical in epub.js; `minSpreadWidth` (800) gates it, so **`double` is inert on a phone** — the settings picker should be honest about that. Today hard-coded `spread: 'none'`. |
| `zoom` | PDF renderer (pdf.js scale) + images; reflowable EPUB scales via `fontSizePt` so the EPUB template may ignore it. Carried so one payload serves both renderers. **Pinch-zoom inside the WebView is ruled out (Ahana)** — zoom changes arrive only through prefs. |
| `reduceMotion` | Already **resolved to a boolean** host-side (tri-state × OS). Reader suppresses the page-turn animation when true (prefs.ts DECISION LOG #2, confirmed). |
| `highContrast`, `boldText`, `dyslexiaFont`, `readableSpacing` | Hruthik's flags, carried as booleans. Apply-time meaning is **Reader/Hruthik's** — including `dyslexiaFont`'s precedence over `fontFamily`, and the contrast recipe. `readerAppearance.ts` only forwards them. |
| `announcePageChanges` | `announce.pageChanges` (defaults true). Gates the WebView's `polite` page-change announcement — Hruthik `WEBVIEW_A11Y_FINDINGS.md` §3.7, which requires it through this composed-prefs path. |

fontFamily/customFontUri **sanitising before they enter CSS is Ahana's, at apply time** — this file
keeps passing them through unresolved. The a11y flags above are carried, not interpreted here: their
meaning is applied Reader/Hruthik-side, which is what "one command, one resolve seam" buys.

---

## 5. The live-reapply flow — "re-render without reopening"

Three things must cause a re-apply. The first is the easy one; the other two are the ones that make
the third checkbox real.

**A. On open.** After `ready`, `ReaderScreen` reads `prefsStore.getPrefs()`, resolves via
`toReaderAppearance(prefs, env)`, and sends `applyAppearance` alongside `openEpub`. (Today nothing
reads prefs at open — this is new host wiring.)

**B. On a prefs edit — the settings screen changed something.** DECIDED (Ahana, no event bus,
Karthik not on the critical path): **the Reader subscribes to `prefsStore.subscribe(...)`**. A
`savePrefs`/`resetPrefs` notifies subscribers with the fresh record; the Reader re-resolves and
re-sends `applyAppearance`. `savePrefs` also returns the fresh record, so the settings screen itself
needs nothing extra. This is built — see §7. The `PrefsChangedEvent`/event-bus path is dropped: the
prefs store is a singleton in one JS process, so a direct subscription is simpler than a bus and
needs no second emitter.

> Scope note: only writes THROUGH `prefsStore` notify. A prefs row pulled from the server by Sync
> does not pass through here; if that ever needs to drive a live re-apply, it must notify too. Called
> out in `prefsStore.ts`.

**C. On an OS change — the user flipped system dark mode, Dynamic Type, or Reduce Motion.** When
`theme: 'system'`, `reduceMotion: 'system'`, or `respectOsFontScale` is on, the resolved values
depend on the OS. Subscribe to `Appearance.addChangeListener` (colour scheme + font scale) and the
platform reduce-motion signal → re-resolve → re-send. This is **independent of B** and easy to
forget: without it, `'system'` is only "system at open time".

**What the WebView does on re-apply.** `applyAppearance` rebuilds `currentCss` from the new values
and re-runs the equivalent of `applyBaselineCss()` across loaded chapters, then — because font
size/line-height change the line-grid remainder and column count — triggers epub.js to re-lay-out
and re-display the current CFI (the same path `resized` already uses). Net effect: the page the user
is on re-renders in place. **No `openEpub`, no reopen.** A `flow` change is the heaviest case (it
switches the manager) and may need a `rendition.flow()` + re-display; call it out to Ahana as the
one field that is more than a stylesheet swap.

---

## 6. Who resolves the OS-derived values — the host, not the WebView

Every OS-derived value resolves host-side in `toReaderAppearance`, via `AppearanceEnv`:
`osColorScheme` resolves `theme: 'system'`, `osReduceMotionEnabled` resolves the tri-state
`reduceMotion`, and `osFontScale` feeds the text-scale composition. The WebView is handed concrete
values (`light`/`dark`/`sepia`, a boolean, a number) and never observes the OS itself — that would be
state RN already models (trigger 5). Keeping resolution host-side keeps the WebView stateless about
the device, and the Reader re-sends when any OS input changes (§5C).

---

## 7. What Personalization built (this half)

`readerAppearance.ts` + `readerAppearance.test.ts` and the `prefsStore` subscription (all green;
typecheck + lint clean):

- `ReaderAppearance` — the flat payload type: theme (resolved) + font + typography + layout + zoom +
  the resolved `reduceMotion` + Hruthik's a11y flags (`highContrast`/`boldText`/`dyslexiaFont`/
  `readableSpacing`/`announcePageChanges`).
- `resolveColorScheme` / `resolveTheme` / `THEME_PALETTES` — theme → concrete scheme + palette;
  `'system'` from the env; defensive `'highContrast'`.
- `resolveFont` — `'system'`/blank → don't override; named family verbatim; `customFontUri` passthrough.
- `composeFontSizePt` — the ratified composition (`size × resolveFontScale`), points, no clamp.
- `toReaderAppearance(prefs, env)` — the single resolve-host-side seam, incl. `resolveReduceMotion`.
- `AppearanceEnv` — `osColorScheme`, `osFontScale`, `osReduceMotionEnabled`.
- `prefsStore.subscribe(listener)` — the live-reapply channel; `savePrefs`/`resetPrefs` notify with
  the fresh record (§5B). No event bus.

No bridge, no `reader/` edits.

---

## 8. Decisions — all resolved except custom-font transport

1. ~~**`typography.size` units.**~~ **RESOLVED (Ahana, 2026-08-18):** absolute **points**; composition
   is `size × resolveFontScale(a11y.text, osFontScale)`, exactly `composeFontSizePt`. Closes prefs.ts
   DECISION LOG #4 and API_CONTRACT_NOTES §6.
2. ~~**The font-size clamp.**~~ **RESOLVED (Ahana):** clamp the **viewport factor (0.94–1.375)**, not
   the product, so the user's chosen pt is never capped. Reader-side; nothing here changes.
3. **Custom font transport — STILL OPEN (deferred, joint item).** `customFontUri` is likely a
   `file://` path, which the WebView cannot fetch (the reader makes _zero_ sub-resource requests — see
   the template header). A real custom font must arrive as **bytes** (base64 / `data:` URI in
   `@font-face`), same as the book. Personalization + Reader design item; not a blocker. The field is
   carried through unresolved so the decision lives in one place; Ahana sanitises fontFamily/
   customFontUri at apply time regardless.
4. ~~**Live channel.**~~ **RESOLVED (Ahana):** no event bus — the Reader subscribes to
   `prefsStore.subscribe` (§5B, built). Karthik is off the critical path.
5. ~~**`reduceMotion` → page-turn suppression.**~~ **RESOLVED (Ahana):** confirmed. `reduceMotion` is
   in the payload (resolved boolean) and `osReduceMotionEnabled` is in `AppearanceEnv`.

---

## Cross-team status

All the design questions are settled (Ahana signed off 2026-08-18); what remains is sequencing.

**Ahana (Reader) — owns what's next.** The apply half is hers, in two steps, and she is sizing the
first before it can be scheduled:

1. **The WebView typechecked-build conversion.** Per `WEBVIEW_BRIDGE.md` this is the first task of the
   stage (the payload trips trigger 1). Ahana notes it is now **more than the doc's "a morning"** —
   two templates, the shared fragment, two tracked artifacts, the no-sub-resource property,
   `assertScriptsParse`, and `readerTemplate.test.ts` currently lifting the pure region out as text.
   She'll give a date before Day-2 is planned around it.
2. **The apply half:** one fire-and-forget `applyAppearance(ReaderAppearance)`, defined on **both**
   templates and sent **before** `open*` (§3), wired into the seam — `fontSizePt`/`lineHeight`/
   `marginPx` → `readerMetrics()` inputs, `fg`/`bg`/`link`/`fontFamily`/`letterSpacingPx`/a11y flags →
   `baselineCss` rules via `addStylesheetCss` (not `rendition.themes`). Mapping in §4. Ahana also owns:
   the `marginPx` bound + `readerMetrics` rework, fontFamily/customFontUri sanitising at apply time,
   and deriving flow/spread from `LayoutPrefs` by indexed access post-conversion.

**Karthik (Sync) — dropped from the critical path.** No event bus; the live channel is
`prefsStore.subscribe` (§5B). No `PrefsChangedEvent` emit is needed for this stage.

**Hruthik (Accessibility) — satisfied.** `announce.pageChanges` and his display/text flags now ride
the one composed payload (§3/§4), which is what `WEBVIEW_A11Y_FINDINGS.md` §3.7 requires. The flags'
apply-time meaning is his, at apply time.

**Still open (deferred, not blocking):** custom-font-as-bytes transport (§8.3), a joint
Personalization + Reader design item.
