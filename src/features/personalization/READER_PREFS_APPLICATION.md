# Applying prefs to the reader — design + cross-team handoff

**Owner:** Personalization (Vaishnavi) writes; **Reader (Ahana) applies.** · **Status:** design +
Personalization's half built (`readerAppearance.ts`). Reader half and the live channel are blocked
— see [Cross-team asks](#cross-team-asks).

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

## 3. Proposed bridge surface: one `applyAppearance` command

**Recommendation: a single command carrying the whole `ReaderAppearance`, not five granular setters
and not `applyPrefs(SharedPrefs)`.**

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

**Where `ReaderAppearance`'s type lives is Ahana's call.** Two clean options, both fine:

1. `readerBridge.ts` imports the type from `readerAppearance.ts` (a reader → personalization type
   import; the _value_ resolution stays in personalization).
2. `readerBridge.ts` declares a structurally-identical local type and Personalization's output flows
   into it. A `satisfies` in a test pins the two together.

Either keeps the frozen contract out of `reader/`. Neither is trigger 3, because `ReaderAppearance`
is not a `src/shared/contracts/` type.

---

## 4. Field-by-field mapping into the template

| `ReaderAppearance` field | Applied in the template by |
| --- | --- |
| `fontSizePt` | Replaces `BASELINE_FONT_SIZE_PX` as the input to `readerMetrics()`. Viewport scaling + clamp stay the reader's — **but the 15–22px clamp must widen** or a large a11y multiplier is silently capped (see §8 open items). |
| `lineHeight` | Replaces `BASELINE_LINE_HEIGHT`. |
| `marginPx` | Replaces `BASELINE_MARGIN_PX`. |
| `letterSpacingPx` | New rule in `baselineCss` body: `letter-spacing: Npx` — **omit the rule when 0** (the template already documents "a rule setting a property to its own default only adds a declaration for a real book's CSS to lose to"). |
| `fg`, `bg`, `link` | New block in `baselineCss`: `color` on body + text elements, `background` on `html,body`, `color` on `a`. Applied through the SAME `addStylesheetCss`/content-hook path as typography — **not** `rendition.themes`. The template's own note explains why: `Themes.inject()` never reads a serialized CSS theme, so it silently skips every chapter loaded _after_ the call. `addStylesheetCss` replaces its node and the content hook re-runs per chapter, so both are idempotent and cover late chapters. |
| `bg` (host) | Also set on the host `#viewer` / `<body>` background in the template's static CSS path, so the gutter around the column matches the page — otherwise a dark theme shows a white frame. |
| `fontFamily` | New body rule in `baselineCss` when non-empty: `font-family: <fontFamily>, <fallback>`. Empty string = leave the book's own font (the baseline deliberately does not set font-family today). |
| `customFontUri` | `@font-face` + use as the family. **Blocked on transport** — see §8; the WebView cannot fetch `file://`. |
| `flow` | Sets `READER_FLOW`. `isPaginated()` already gates the line grid and column breaks, so this is the value that constant becomes. **Changing flow live needs a re-layout** — see §5. |
| `spread` | `rendition.spread('none' \| 'auto')` — map `single`→`none`, `double`→`auto`. Today hard-coded `spread: 'none'`. |
| `zoom` | PDF renderer (pdf.js scale) + images. Reflowable EPUB scales via `fontSizePt`, so the EPUB template may ignore it. Carried so one payload serves both renderers. |

Contrast (`accessibility.display.highContrast`), bold text, dyslexia font and readable-spacing are
**deliberately out of this payload** — they are Hruthik's, applied on top of whichever scheme this
picks. `ReaderAppearance` reads a11y prefs only for the §6 font-scale composition, nothing else.

---

## 5. The live-reapply flow — "re-render without reopening"

Three things must cause a re-apply. The first is the easy one; the other two are the ones that make
the third checkbox real.

**A. On open.** After `ready`, `ReaderScreen` reads `prefsStore.getPrefs()`, resolves via
`toReaderAppearance(prefs, env)`, and sends `applyAppearance` alongside `openEpub`. (Today nothing
reads prefs at open — this is new host wiring.)

**B. On a prefs edit — the settings screen changed something.** Needs a signal from the store to the
reader. Two candidate mechanisms, and **this is an open fork (event-bus.ts open question #1, Ahana):**

- _Event bus:_ subscribe to `EVENT_CHANNELS.PREFS_CHANGED`; on fire, re-read + re-resolve + re-send.
  Clean, but **there is no bus runtime in the repo yet** — the channel is contract-only. Blocks this
  path entirely until a runtime lands, _and_ until someone emits on it (Karthik, in
  `writeSharedPrefs`).
- _Re-read on focus:_ if settings is an overlay/route and the reader stays mounted, re-read prefs
  when it regains focus. No bus needed. Ahana floated exactly this in event-bus.ts (#1): "Reader
  could simply re-read on focus." Weaker (fires on any focus, not only a real change) but unblocked
  today.

**Recommendation:** design the reader's re-apply as a plain `applyAppearance(toReaderAppearance(...))`
call and drive it from whichever signal lands first — bus or focus. The resolver and the command
don't care which. Don't block the whole stage on the bus.

**C. On an OS appearance change — the user flipped system dark mode.** When `theme: 'system'`, the
resolved scheme depends on `Appearance.getColorScheme()`, which can change while the book is open.
Subscribe to `Appearance.addChangeListener` (and OS font-scale change) → re-resolve → re-send. This
is **independent of B** and easy to forget: without it, `'system'` is only "system at open time".

**What the WebView does on re-apply.** `applyAppearance` rebuilds `currentCss` from the new values
and re-runs the equivalent of `applyBaselineCss()` across loaded chapters, then — because font
size/line-height change the line-grid remainder and column count — triggers epub.js to re-lay-out
and re-display the current CFI (the same path `resized` already uses). Net effect: the page the user
is on re-renders in place. **No `openEpub`, no reopen.** A `flow` change is the heaviest case (it
switches the manager) and may need a `rendition.flow()` + re-display; call it out to Ahana as the
one field that is more than a stylesheet swap.

---

## 6. Who resolves `'system'` — the host, not the WebView

Resolved host-side (in `toReaderAppearance`, via `AppearanceEnv.osColorScheme`). The WebView is
handed a concrete `light`/`dark`/`sepia` and never learns what "system" means. Rationale: a WebView
that held `'system'` would also have to observe OS appearance changes — state RN already models,
which is trigger 5. Keeping resolution host-side keeps the WebView stateless about appearance.

---

## 7. What Personalization built (this half)

`readerAppearance.ts` + `readerAppearance.test.ts` (17 tests, green; typecheck + lint clean):

- `ReaderAppearance` — the flat payload type.
- `resolveColorScheme` / `resolveTheme` / `THEME_PALETTES` — theme → concrete scheme + palette;
  `'system'` from the env; defensive `'highContrast'`.
- `resolveFont` — `'system'`/blank → don't override; named family verbatim; `customFontUri` passthrough.
- `composeFontSizePt` — the §6 composition, flagged proposed-pending-ratification, no clamp.
- `toReaderAppearance(prefs, env)` — the single resolve-host-side seam.

No bridge, no `reader/` edits, no store changes.

---

## 8. Open decisions to settle before/while Reader applies this

1. **`typography.size` units** (prefs.ts DECISION LOG #4 / API_CONTRACT_NOTES §6). `composeFontSizePt`
   assumes **points**. If units land as a scale factor, the multiply is wrong. Joint Ahana + Vaishnavi.
2. **The font-size clamp.** `readerMetrics` clamps to 15–22px. That is right for a fixed baseline and
   wrong once a user picks 24pt or sets a 2× a11y multiplier — it caps their choice. The clamp must
   widen (or become relative to the chosen base) at this stage. Reader owns the number; flag it.
3. **Custom font transport.** `customFontUri` is likely a `file://` path, which the WebView cannot
   fetch (the whole reader is built to make _zero_ sub-resource requests — see the template header).
   A real custom font has to arrive as **bytes** (base64 / `data:` URI in `@font-face`), same as the
   book. This is a Personalization + Reader design item, deferred; the field is carried unresolved so
   the decision lives in one place.
4. **Live channel** (§5B) — event bus vs re-read-on-focus. event-bus.ts open question #1, Ahana's call.
5. **`reduceMotion` → page-turn suppression** (prefs.ts DECISION LOG #2, Ahana). Default moved to
   `'system'`; the reader must suppress the page-turn animation when the OS setting is on. Adjacent to
   this stage; confirm.

---

## Cross-team asks

_Draft — Vaishnavi to send. Nothing below has been messaged to anyone._

**→ Ahana (Reader).** The prefs-application stage is ready to start on Personalization's side
(`readerAppearance.ts` resolves `SharedPrefs` → a flat `ReaderAppearance`). Two things are yours and
block it:

1. **The WebView typechecked-build conversion.** Per `WEBVIEW_BRIDGE.md`, this is the first task of
   this stage, not a follow-up — the prefs payload trips trigger 1. The five steps are in that doc's
   "What convert means concretely".
2. **The apply half:** add one fire-and-forget command `applyAppearance(ReaderAppearance)` and wire
   it into the existing seam — `fontSizePt`/`lineHeight`/`marginPx` become `readerMetrics()` inputs
   (replacing the `BASELINE_*` constants), and `fg`/`bg`/`link`/`fontFamily`/`letterSpacingPx` become
   new `baselineCss` rules applied through `addStylesheetCss` (not `rendition.themes` — your own note
   says why). Mapping table in §4; live re-apply in §5. `ReaderAppearance`'s type home is your call
   (§3). Note: **flattening deliberately keeps trigger 3 clear** — no `src/shared/contracts/` type
   crosses the bridge, only primitives.
3. Confirm the two decisions that are yours-with-me: **`typography.size` units** (§6 proposal: points)
   and the **font-size clamp** widening (§8.2). And **`reduceMotion` page-turn suppression** (§8.5).

**→ Karthik (Sync).** When an event-bus runtime lands, emit `PrefsChangedEvent` on
`EVENT_CHANNELS.PREFS_CHANGED` from inside `writeSharedPrefs` — **single fire**, not also from the
`prefsStore` wrapper (avoids a double-fire; the wrapper delegates to your seam). `source` tag:
`'personalization'` for the personalization table, `'accessibility'` for the a11y one. This is what
lets the reader re-apply on a settings edit (§5B) without polling.

**→ Whoever owns app bootstrap / the event-bus runtime (currently unassigned — event-bus.ts open
question #2).** `event-bus.ts` is contract-only; there is no bus instance. The "re-render without
reopening on a settings edit" path (§5B) is blocked on a runtime existing. Either someone builds the
narrow bus, or we adopt the re-read-on-focus alternative (§5B, Ahana's event-bus.ts #1). This is a
Gate/ownership question, not code I can write inside `personalization/`.
