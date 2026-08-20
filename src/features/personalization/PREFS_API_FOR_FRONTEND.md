# Preferences API — frontend integration (profile / settings screen)

**Owner:** Personalization (Vaishnavi). **For:** the frontend team building the profile page.
**Status:** the store below is built, tested, and shipped. Wire the UI to it — do **not** read or
write SQLite, Sync, or the contracts directly.

## TL;DR

There is exactly **one** thing to call: the `prefsStore` singleton.

```ts
import { prefsStore } from '@/features/personalization/prefsStore';
import type { SharedPrefs } from '@/shared/contracts';

const prefs = await prefsStore.getPrefs();          // load — DEFAULT_PREFS on first run
await prefsStore.savePrefs({ theme: 'dark' });      // change one thing, persists + syncs
await prefsStore.resetPrefs();                       // restore all defaults
const off = prefsStore.subscribe(p => { /* … */ }); // live updates; call off() to stop
```

`prefsStore` is a per-user **singleton** — no `userId` argument today (single-account). It persists,
marks the write for Sync, and hands you back the fresh record. You never touch storage.

## The functions

| Function | Signature | What it does |
| --- | --- | --- |
| `getPrefs()` | `() => Promise<SharedPrefs>` | Current prefs. Returns the **defaults** on first run (before any write) — safe to render immediately, never null. |
| `savePrefs(patch)` | `(patch: PrefsPatch) => Promise<SharedPrefs>` | Applies a patch, persists it (marked for sync), notifies subscribers, returns the re-read record. |
| `resetPrefs()` | `() => Promise<SharedPrefs>` | Restores all defaults, notifies subscribers, returns them. |
| `subscribe(listener)` | `(l: (p: SharedPrefs) => void) => () => void` | Fires **after** each `savePrefs`/`resetPrefs` with the fresh record. Returns an unsubscribe. |

`PrefsPatch` is a partial of the value fields only:

```ts
type PrefsPatch = Partial<Omit<SharedPrefs,
  'id' | 'userId' | 'updatedAt' | 'isDeleted' | 'synced'>>;
```

### ⚠️ The one rule that bites: a patch merges at the TOP level only

Nested groups (`font`, `typography`, `layout`, `zoom`, `accessibility`) are replaced **wholesale**,
not deep-merged. To change one field inside a group, spread the current group and override:

```ts
// ✅ correct — keep the other typography fields
const cur = await prefsStore.getPrefs();
await prefsStore.savePrefs({ typography: { ...cur.typography, size: 18 } });

// ❌ wrong — wipes lineHeight/spacing/margins back to whatever you omitted
await prefsStore.savePrefs({ typography: { size: 18 } }); // TS will actually reject this — good
```

The settings screen should send the **full group** it owns.

## Suggested wiring for the profile screen

```ts
function useReaderPrefs() {
  const [prefs, setPrefs] = useState<SharedPrefs | null>(null);

  useEffect(() => {
    prefsStore.getPrefs().then(setPrefs);      // initial load
    return prefsStore.subscribe(setPrefs);     // stay in sync with live changes
  }, []);

  return {
    prefs,
    save: (patch: PrefsPatch) => prefsStore.savePrefs(patch), // resolves with fresh record
    reset: () => prefsStore.resetPrefs(),
  };
}
```

Optimistic UI is fine; `savePrefs`/`resetPrefs` resolve with the authoritative record, and
`subscribe` will also deliver it — reconcile to whatever they return.

## Field catalogue

Import the type and defaults from the barrel — never restate them in the UI:

```ts
import type { SharedPrefs } from '@/shared/contracts';
import { DEFAULT_PREFS, DEFAULT_ACCESSIBILITY_PREFS } from '@/shared/contracts';
```

### Store-managed — the UI never sets these

`id`, `userId`, `updatedAt`, `isDeleted`, `synced` come from the sync base. The store stamps them;
they are excluded from `PrefsPatch`, so you can't set them by accident.

### Reader prefs (top-level groups)

| Field | Type | Default | Notes / UI hint |
| --- | --- | --- | --- |
| `theme` | `'light' \| 'dark' \| 'sepia' \| 'system'` | `'system'` | See the deprecated 5th value below — **do not** put it in the picker. |
| `font.family` | `string` | `'system'` | e.g. `'Georgia'`, `'system'`. |
| `font.customFontUri` | `string?` | — (unset) | User-supplied font file. Custom-font transport isn't wired end-to-end yet; treat as optional/experimental. |
| `typography.size` | `number` | `16` | **Absolute points**, not a scale factor. This is the user's base size; the a11y scale knobs multiply it. |
| `typography.lineHeight` | `number` | `1.5` | Multiplier. |
| `typography.spacing` | `number` | `0` | Letter/word spacing, px. `0` = none. |
| `typography.margins` | `number` | `16` | Page margin, px. |
| `layout.flow` | `'paginated' \| 'scrolled-doc'` | `'paginated'` | |
| `layout.spread` | `'single' \| 'double'` | `'single'` | `double` is inert on a phone (min spread width 800). |
| `zoom.level` | `number` | `1.0` | `1.0` = 100%. PDF/image zoom. |

### Accessibility (`accessibility.*`) — shape owned by Accessibility (Hruthik)

Defaults come from `DEFAULT_ACCESSIBILITY_PREFS`. Note four defaults are **on**, marked below.

| Field | Type | Default | Notes / UI hint |
| --- | --- | --- | --- |
| `accessibility.text.dyslexiaFont` | `boolean` | `false` | OpenDyslexic. |
| `accessibility.text.respectOsFontScale` | `boolean` | **`true`** | Honour OS Dynamic Type. |
| `accessibility.text.fontScaleMultiplier` | `number` | `1.0` | Extra user multiplier on top of OS scale. |
| `accessibility.text.readableSpacing` | `boolean` | `false` | Looser spacing preset. |
| `accessibility.display.boldText` | `boolean` | `false` | |
| `accessibility.display.highContrast` | `boolean` | `false` | **Single source of truth for contrast** (not the theme). Independent of colour scheme. |
| `accessibility.display.reduceMotion` | `'system' \| 'on' \| 'off'` | `'system'` | Tri-state — see note below. |
| `accessibility.display.largeTouchTargets` | `boolean` | `false` | Enlarged reader controls. |
| `accessibility.display.largeAudioControls` | `boolean` | `false` | Enlarged TTS transport. |
| `accessibility.tts.enabled` | `boolean` | `false` | Master switch. TTS needs a dev build (native module). |
| `accessibility.tts.voiceId` | `string \| null` | `null` | `null` = platform default. |
| `accessibility.tts.rate` | `number` | `1.0` | Range **0.5–3.0** — validate, see below. |
| `accessibility.tts.pitch` | `number` | `1.0` | |
| `accessibility.tts.highlightMode` | `'none' \| 'word' \| 'sentence'` | `'sentence'` | Not read yet (word/sentence sync deferred) — safe to persist, don't promise it works. |
| `accessibility.tts.autoContinueChapter` | `boolean` | **`true`** | |
| `accessibility.tts.backgroundPlayback` | `boolean` | `false` | **Unverified on both platforms — do NOT expose in the UI until a device spike confirms it.** |
| `accessibility.announce.pageChanges` | `boolean` | **`true`** | Screen-reader announcement. |
| `accessibility.announce.chapterChanges` | `boolean` | **`true`** | Screen-reader announcement. |
| `accessibility.screenReaderHints` | `boolean` | `false` | **Scope:** native RN controls only. Does NOT affect EPUB content inside the WebView — don't let the label imply otherwise. |

## Gotchas & validation

- **Deprecated `theme: 'highContrast'`.** The `Theme` union still carries it so old records parse,
  but it's deprecated in favour of `accessibility.display.highContrast`. **Keep it out of the theme
  picker.** Contrast is a separate toggle so a user can run e.g. dark + high contrast.
- **`reduceMotion` is a tri-state, not a checkbox.** Store `'system' | 'on' | 'off'`. When you need
  the effective boolean for display, resolve against live OS state with
  `resolveReduceMotion(pref, osReduceMotionEnabled)` — don't read the stored value as a boolean.
- **Validate `tts.rate`** against `[TTS_RATE_MIN, TTS_RATE_MAX]` (0.5–3.0). Helper:
  `isValidTtsRate(value)`. Also `isValidReduceMotion`, `isValidTtsHighlightMode` — all from
  `@/shared/contracts`.
- **First run is not empty.** `getPrefs()` returns `DEFAULT_PREFS` before any write, so the screen
  always has something to render.
- **`subscribe` only fires for writes through this store.** A prefs row pulled from the server by
  Sync doesn't pass through here (not a concern for the settings screen, but noted).

## Questions

Ping Vaishnavi (Personalization). Anything about how a value is *applied* in the reader (typography
composition, reduce-motion suppression, TTS) is Reader (Ahana) / Accessibility (Hruthik) — this doc
is the read/write seam only.
