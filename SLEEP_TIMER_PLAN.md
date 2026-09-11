# Audio Sleep Timer — implementation plan

Owner: Reader (Ahana). One cross-owner touchpoint flagged below (Accessibility/Hruthik).

## 1. Scope

A sleep timer for the **audiobook player only** (`AudioPlayerScreen`), not TTS, not the EPUB/PDF
reader. After a user-chosen duration, whatever is currently playing on the singleton audio player
(`audioPlayerInstance.ts`) pauses and its position is committed — regardless of which book/track is
live, regardless of queue position. A user-facing notification announces this, both when the screen
is on (foreground or background) and when the device is locked. While a timer is armed, turning TTS
on/off gets one small additive behavior on top of the existing, unmodified TTS⇄audio exclusivity
rule. Nothing about that existing rule changes.

Durations: three presets (**30 sec, 1 min, 5 min**) plus a custom picker constrained to **whole
minutes, 1–5**, via a drag control (not a slider dependency — see §4).

## 2. Key architecture decision: real OS notifications, not a hand-rolled banner

The ask ("slides from the top, floats, then joins the notification stack" when the screen is on;
"shows on the lock screen" when it isn't) is, verbatim, what iOS and Android already do for a local
notification presented while the app is foregrounded (banner → Notification Center / shade) versus
one delivered while locked (lock-screen notification). Building a custom `Animated` slide-down view
would:

- Not work at all on a locked screen — no RN view can paint above the OS lock screen.
- Not fire reliably from a backgrounded/suspended JS context.
- Duplicate exactly what `expo-notifications` gives for free, correctly adapted to screen size and
  platform convention already (the "consider iOS and Android, various screen sizes" requirement).

**Decision: use `expo-notifications`**, scheduled as a one-shot local notification for the timer's
deadline, with the foreground presentation handler configured to show the banner
(`shouldShowBanner: true` in the modern API) rather than suppressing it. One mechanism covers both
"screen active" and "screen locked" cases — no custom banner component needed.

**Cost to flag explicitly**: `expo-notifications` is not currently a dependency
(confirmed — absent from `package.json`). Adding it is a **new native module**, which means:
- `npx expo prebuild` / rebuilding the dev client (this project already requires
  `expo-dev-client`, per `CLAUDE.md`'s "Expo Go cannot load the crypto native modules" note — same
  constraint applies here).
- An Android notification channel must be created once at startup.
- Notification permission must be requested (iOS prompts; Android 13+ requires the runtime
  `POST_NOTIFICATIONS` permission).
- This needs a real-device test pass (locked-screen delivery and background timer firing do not
  reliably reproduce on simulators, especially Android emulators).

This is a real, one-time infrastructure cost — surfacing it now rather than discovering it mid-build.

## 3. State model — new, in-memory only, un-synced

No new field belongs in the frozen `SharedPrefs` contract (`src/shared/contracts/prefs.ts`) for
this. A sleep timer is a per-session, this-device-only concept — persisting/syncing "the last
sleep-timer duration chosen" across devices is not something the user asked for, and doing it would
require Contracts Gate sign-off (Ahana as contracts lead, Karthik for sync, Hruthik if it nested
under accessibility) for zero real benefit. Mirror `audioQueueStore.ts`'s shape instead: plain
Zustand store, no `persist` middleware, plus a plain-object export for imperative (non-React)
call sites — same pattern already used for the audio queue.

**New file: `src/features/reader/audio/sleepTimerStore.ts`**

```ts
export type SleepTimerPhase = 'idle' | 'running' | 'fired';

interface SleepTimerState {
  phase: SleepTimerPhase;
  durationSeconds: number | null;   // the armed duration, for display ("5:00 selected")
  deadlineAt: number | null;        // Date.now() + durationSeconds*1000, wall-clock target
  remainingSeconds: number;         // ticked once/sec for the UI, derived from deadlineAt
  pausedForTts: boolean;            // true only when THIS module paused audio for a TTS toggle-on
  arm(durationSeconds: number, deadlineAt: number): void;
  tick(remainingSeconds: number): void;
  fire(): void;                     // phase -> 'fired', pausedForTts stays whatever it was (see §5)
  cancel(): void;                   // phase -> 'idle', clears everything
  setPausedForTts(value: boolean): void;
}
```

Wall-clock deadline, not "playback time elapsed": the timer counts down in real time regardless of
whether the audio is actively playing at every instant (matches "irrespective of whether audio is
still actively playing"). If you actually want it to pause the countdown when the user manually
pauses mid-session, say so — current spec reads as wall-clock and that's simpler; flagging the
alternative rather than guessing wrong.

## 4. The countdown engine — survives navigation and backgrounding

**New file: `src/features/reader/audio/sleepTimerEngine.ts`**, following the exact closure-timer
shape `src/features/download/readingAccessMonitor.ts` already uses in this codebase (module-scope
variables, not React state/refs, so it isn't tied to any component's mount lifecycle):

```ts
export function startSleepTimer(durationSeconds: number): void {
  cancelSleepTimer(); // idempotent — replaces any existing timer
  const deadlineAt = Date.now() + durationSeconds * 1000;
  sleepTimerStore.getState().arm(durationSeconds, deadlineAt);
  void scheduleSleepTimerNotification(new Date(deadlineAt)); // sleepTimerNotifications.ts
  fireTimeout = setTimeout(fire, durationSeconds * 1000);
  tickInterval = setInterval(tickOnce, 1000);
}

export function cancelSleepTimer(): void {
  if (fireTimeout) clearTimeout(fireTimeout);
  if (tickInterval) clearInterval(tickInterval);
  fireTimeout = null;
  tickInterval = null;
  void cancelSleepTimerNotification();
  sleepTimerStore.getState().cancel();
}

function fire(): void {
  if (tickInterval) clearInterval(tickInterval);
  fireTimeout = null;
  tickInterval = null;
  pauseCurrentAudioPlayer();          // audioPlayerInstance.ts — existing, unmodified.
  sleepTimerStore.getState().fire();  // phase -> 'fired'
}

function tickOnce(): void {
  const { deadlineAt } = sleepTimerStore.getState();
  if (deadlineAt === null) return;
  sleepTimerStore.getState().tick(Math.max(0, Math.round((deadlineAt - Date.now()) / 1000)));
}

/** Catch-up path — see the AppState note below. Idempotent: no-ops if already fired/idle. */
export function checkSleepTimerDeadlinePassed(): void {
  const { phase, deadlineAt } = sleepTimerStore.getState();
  if (phase === 'running' && deadlineAt !== null && Date.now() >= deadlineAt) {
    fire();
  }
}
```

`pauseCurrentAudioPlayer()` already does exactly what's needed on fire — pauses if loaded and
playing, commits the position via `commitCurrentPlayerPosition()`, and sets
`audioQueueStore.setIsPlaying(false)`. **No changes to that function.** It's also correctly a no-op
if nothing is playing (e.g., TTS currently owns the audio session — see §5), so firing never throws
or double-pauses.

**Backgrounding survival — wire into the existing app-wide hook, per the original ticket's own
instruction.** `useAudioPlayerSetup.ts:91-98` already has an `AppState` listener that runs on every
transition away from `'active'` to commit position. Extend that *same* listener (don't add a second
one) to also call `checkSleepTimerDeadlinePassed()` on **every** transition (not just away from
active) — this is the safety net for the case where the JS timer itself didn't get to run while
backgrounded (Android in particular may suspend timers even with a foreground service active; iOS
audio background mode is generally more permissive but not guaranteed for the full duration). The
`setTimeout` above handles the common case (screen on, app foregrounded or actively playing
background audio) with on-time precision; this closes the gap for the rest. The scheduled OS
notification is unaffected by any of this — it's armed independently and fires from the OS side
regardless of JS process state, which is exactly why it's the right mechanism for the locked-screen
requirement (§2).

## 5. New files: notification wrapper

**New file: `src/features/reader/audio/sleepTimerNotifications.ts`** — isolate all
`expo-notifications` calls here so nothing else in the feature imports it directly (keeps the rest
of the feature testable under Jest without mocking a native module everywhere):

- `configureSleepTimerNotificationChannel(): Promise<void>` — Android channel, call once from
  `useAudioPlayerSetup.ts` alongside the existing one-time `ensureAudioModeConfigured()` call.
- `requestSleepTimerNotificationPermission(): Promise<boolean>` — call lazily, the first time a
  user actually starts a sleep timer (don't prompt for permission on app launch for a feature they
  haven't touched yet).
- `scheduleSleepTimerNotification(fireDate: Date): Promise<void>` — one-shot local notification,
  title "Sleep Timer", body "Sleep timer is over — audio has been paused." Store the returned
  notification id in a module-level variable so it can be cancelled.
- `cancelSleepTimerNotification(): Promise<void>` — cancels the pending one, no-ops if none pending.
- Set the notification handler (`Notifications.setNotificationHandler`) once, **at module load
  (top-level, not inside a `useEffect`)**, with `shouldShowBanner: true, shouldShowList: true,
  shouldPlaySound: false, shouldSetBadge: false` — confirmed against current Expo docs as the
  correct iOS 14+ pair (`shouldShowAlert` is deprecated; iOS split the foreground banner and the
  Notification Center/lock-screen list into two separate flags). This is what makes the foreground
  case slide in as a banner instead of being silently swallowed (`expo-notifications`' default
  foreground behavior with no handler set is to NOT show anything on iOS). Module-load timing
  matters: a notification that fires during cold start can slip past a handler registered inside an
  effect that hasn't run yet, so importing this file early (from `useAudioPlayerSetup.ts`, which is
  already called once at app root) is sufficient — no separate wiring into `App.tsx` needed.
  Confirmed this works in the dev-client build this project already requires (local notifications
  are unaffected by SDK 53's removal of *remote* push support from Expo Go — irrelevant here since
  this project never runs under Expo Go and local notifications were never part of that removal).

If permission is denied, degrade gracefully: the JS-side pause (§4) still fires on schedule; only
the notification is skipped. Don't block starting the timer on permission being granted.

## 6. UI

**New file: `src/features/reader/audio/SleepTimerModal.tsx`** — bottom-sheet modal, visually
matching `AudioQueueModal.tsx` exactly (`animationType="slide"`, `transparent`, the same
`modalOverlay`/`modalContainer` pair, `SafeAreaView`, header row with title + `✕` close button —
copy the styles rather than inventing new ones, this app has no shared theme module to pull from).

Content:
- Three preset pills — "30 sec", "1 min", "5 min" — styled like `AudioPlayerScreen.tsx`'s existing
  `PLAYBACK_RATES` pill row (`rateButton`/`rateButtonActive`).
- A "Custom" section: a drag control snapped to integer values 1–5 (minutes), following the same
  `onTouchStart`/`onTouchMove` + `locationX/trackWidth` pattern as `AudioPlayerScreen.tsx`'s
  `Scrubber` component (this repo deliberately avoids `PanResponder` — a lint rule flags it — and
  has no slider library dependency; don't add one for a 5-position control). Round to the nearest
  of 5 discrete stops rather than computing a continuous fraction. Show the live selection as
  "3 min" text above/beside it.
- A "Start" button, disabled until a preset or a custom value is chosen.
- When a timer is already running (`phase === 'running'`), replace the picker with the live
  countdown (`sleepTimerStore.remainingSeconds`, formatted `m:ss`) and a "Cancel Timer" button.
- When `phase === 'fired'`, show a brief "Timer ended — audio paused" state with a "Dismiss"
  (resets to idle) — this is the in-modal echo of the notification, for a user who has the modal
  open when it fires.

**`AudioPlayerScreen.tsx` change**: add one header button beside the existing Queue button
(`headerRow`, lines 472–486), following its exact `Pressable`/pill styling. Label: "Sleep Timer" when
idle, or the live countdown (e.g. "4:32") when running — subscribe to
`useSleepTimerStore((s) => s.phase)`/`remainingSeconds`. Pressing it opens `SleepTimerModal`. This
is the only edit to this file, and it's additive — no existing prop, state, or callback changes.

## 7. TTS interaction — additive only, scoped strictly to "a sleep timer is armed"

**Nothing in `audioTtsCoordinator.ts`'s two documented rules changes.** `pauseActiveAudio()`
(TTS→pause audio) and `stopActiveTts()` (audio→stop TTS) keep doing exactly what they do today, for
every caller, sleep timer or not. What's new sits *beside* them, gated on
`sleepTimerStore.getState().phase === 'running'`.

**New exported functions in `audioTtsCoordinator.ts`** (already co-owned Reader+Accessibility, so
this is the right home — it keeps the actual behavioral logic on Reader's side of the boundary):

```ts
/**
 * Called before TTS is switched ON. If a sleep timer is currently running and audio is currently
 * playing, pauses it (via the EXISTING pauseActiveAudio(), unchanged), marks that pause as
 * TTS-caused for §7's resume rule, shows a compulsory one-button Alert, and only invokes
 * `proceed` after the user acknowledges. Otherwise invokes `proceed` immediately — this is a
 * total no-op outside the sleep-timer-armed case.
 */
export function guardTtsEnableForSleepTimer(proceed: () => void): void {
  if (sleepTimerStore.getState().phase === 'running' && isAudioPlaying()) {
    pauseActiveAudio();
    sleepTimerStore.getState().setPausedForTts(true);
    Alert.alert(
      'Sleep Timer Active',
      'Audio has been paused because Text-to-Speech is starting. It will not play while TTS is '
        + 'active — your sleep timer will keep running in the background.',
      [{ text: 'OK', onPress: proceed }],
      { cancelable: false },
    );
    return;
  }
  proceed();
}

/**
 * Called when TTS is switched OFF. If the pause it left behind was this module's own doing (not
 * an ordinary manual pause) and the timer hasn't fired since, resumes playback the same way
 * AudioPlayerScreen's own beginPlayback() would — including re-asserting the audio session, since
 * TTS may have touched AVAudioSession. A no-op otherwise (nothing here ever resumes audio that
 * paused for any other reason, and never resumes after the timer has already fired).
 */
export function resumeAudioIfPausedForSleepTimerTts(): void {
  const { phase, pausedForTts } = sleepTimerStore.getState();
  if (phase === 'running' && pausedForTts) {
    sleepTimerStore.getState().setPausedForTts(false);
    void ensureAudioModeConfigured(true).then(() => resumeCurrentAudioPlayer());
  }
}
```

`resumeCurrentAudioPlayer()` is one small new export needed in `audioPlayerInstance.ts` (mirrors
`pauseCurrentAudioPlayer()`'s existing shape exactly):

```ts
export function resumeCurrentAudioPlayer(): void {
  if (current && current.player.isLoaded && !current.player.playing) {
    current.player.play();
    audioQueueStore.getState().setIsPlaying(true);
  }
}
```

Calling `.play()` here runs straight through the *existing*, unmodified
`playbackStatusUpdate` listener (`audioPlayerInstance.ts:266-269`, `if (status.playing &&
!wasPlaying) stopActiveTts()`) — harmless, since TTS is already being switched off through this
same flow. This is composing the existing rule, not bypassing or duplicating it.

**On sleep timer fire** (`sleepTimerEngine.ts`'s `fire()`), also clear `pausedForTts` unconditionally
via `sleepTimerStore.getState().fire()` (phase transitions out of `'running'`), so
`resumeAudioIfPausedForSleepTimerTts()` becomes a no-op from that point on even if the user turns
TTS off later — once the sleep timer has genuinely ended, nothing should bring audio back.

### The one cross-owner file this plan touches

**`src/features/accessibility/AccessibilitySettingsPanel.tsx`** (owned by Hruthik, per
`CLAUDE.md`'s ownership table) needs its `toggleTts` (lines 141–149) changed from an unconditional
write to routing through the two guard functions above:

```ts
const toggleTts = (): void => {
  const nextEnabled = !prefs.tts.enabled;
  const apply = (): void => {
    void prefsStore
      .savePrefs({ accessibility: { ...prefs, tts: { ...prefs.tts, enabled: nextEnabled } } })
      .catch((error: unknown) => {
        console.warn('AccessibilitySettingsPanel: failed to save tts.enabled', error);
      });
  };
  if (nextEnabled) {
    guardTtsEnableForSleepTimer(apply);
  } else {
    resumeAudioIfPausedForSleepTimerTts();
    apply();
  }
};
```

This is intentionally the smallest possible diff to that file — all the actual sleep-timer logic
lives in Reader-owned `audioTtsCoordinator.ts`; the accessibility file just calls two imported
functions. **Flag this to Hruthik before merging** per the repo's stated ownership rule
("Editing outside Reader needs the owner looped in") — the change is small and behaviorally inert
unless a sleep timer is armed, but it's still their file.

## 8. Files touched — summary

| File | Change | Owner |
|---|---|---|
| `src/features/reader/audio/sleepTimerStore.ts` | **new** | Reader |
| `src/features/reader/audio/sleepTimerEngine.ts` | **new** | Reader |
| `src/features/reader/audio/sleepTimerNotifications.ts` | **new** | Reader |
| `src/features/reader/audio/SleepTimerModal.tsx` | **new** | Reader |
| `src/features/reader/audio/AudioPlayerScreen.tsx` | add header button + modal mount | Reader |
| `src/features/reader/audio/audioPlayerInstance.ts` | add `resumeCurrentAudioPlayer()` export | Reader |
| `src/features/reader/audio/audioTtsCoordinator.ts` | add `guardTtsEnableForSleepTimer`, `resumeAudioIfPausedForSleepTimerTts` | Reader + Accessibility (co-owned already) |
| `src/features/reader/audio/useAudioPlayerSetup.ts` | extend existing `AppState` effect with `checkSleepTimerDeadlinePassed()`; add one-time notification channel setup | Reader |
| `src/features/accessibility/AccessibilitySettingsPanel.tsx` | `toggleTts` routes through the two guard functions | **Accessibility — loop in Hruthik** |
| `package.json` / `app.json` | add `expo-notifications` + config plugin entry | Reader (infra) |

No changes anywhere to `src/shared/contracts/` (nothing frozen is touched), no changes to
`audioQueueCoordinator.ts`, `audioQueueStore.ts`, or `useTtsSession.ts`.

## 9. Edge cases explicitly decided (call these out if any should go differently)

- **Timer fires while TTS is actively speaking**: `pauseCurrentAudioPlayer()` is a no-op (nothing
  is playing — TTS already owns the session per the existing rule), but the notification still
  fires and `phase` still moves to `'fired'`, and `pausedForTts` is cleared — so turning TTS off
  afterward does *not* resume audio. This matches "the sleep session is over" rather than treating
  TTS-speaking-at-fire-time as a reason to keep the audio resumable.
- **User backgrounds the app with the sleep timer running, screen stays unlocked (e.g., switches
  to another app)**: covered by the `setTimeout` if the process stays alive, and by the
  `AppState`-driven catch-up otherwise. Either way the notification is guaranteed by the OS
  scheduler independent of JS state.
- **User manually pauses audio, unrelated to TTS, while a sleep timer is running**: no interaction
  — `pausedForTts` was never set, so nothing auto-resumes when the user manually presses Play again
  (that's just the ordinary Play button, untouched).
- **A second call to start the timer while one is already running** (re-opening the modal and
  picking a new duration): `startSleepTimer()` calls `cancelSleepTimer()` first — this replaces
  rather than stacks. Worth confirming this is the wanted behavior (vs. "extend by N minutes");
  replace is what's implemented unless you'd rather have an "Add time" affordance.
- **Notification permission denied**: sleep timer still functions (pause still happens on time);
  user simply gets no OS notification. Not treated as a blocking error.

## 10. Testing

- Unit tests (Jest, matching this codebase's existing style — e.g.
  `audioTtsCoordinator.test.ts` if one exists, or a new one): `sleepTimerStore` transitions,
  `guardTtsEnableForSleepTimer`/`resumeAudioIfPausedForSleepTimerTts` against a mocked
  `audioPlayerInstance`, `checkSleepTimerDeadlinePassed()`'s idempotency.
  `sleepTimerNotifications.ts` needs an `expo-notifications` mock (there's a `__mocks__/` directory
  pattern already established in this repo — follow it, and record the new mock in `CLAUDE.md`'s
  "shared mocks" section the same way the two existing ones are, if this mock ends up shared).
- Manual/device verification (simulators are not sufficient for these three):
  1. Start a 30-second timer, background the app (press home), confirm the notification appears
     and audio is paused on return.
  2. Start a 1-minute timer, lock the device, confirm the lock-screen notification appears with
     the exact message and the audiobook is paused.
  3. With a sleep timer running and audio playing, toggle TTS on from the accessibility panel:
     confirm the Alert appears, audio pauses immediately, and TTS starts only after pressing OK.
  4. Toggle TTS back off: confirm audio resumes on both iOS and Android (Android's TTS pause/resume
     asymmetry per `useTtsSession.ts`'s own header doesn't affect this path — it's audio being
     resumed, not TTS).
  5. Let the timer fire while TTS is actively speaking: confirm no crash, no double-pause, and that
     turning TTS off afterward does *not* resume audio.

## 11. Suggested implementation order for Claude Code

1. `expo-notifications` install + `app.json` plugin entry + one dev-client rebuild — do this first
   and confirm a bare scheduled notification fires on both platforms before building anything else
   on top of it.
2. `sleepTimerStore.ts` + `sleepTimerEngine.ts` (no notifications yet — just the pause-on-fire and
   the `AppState` catch-up wired into `useAudioPlayerSetup.ts`). Verify with the existing
   `pauseCurrentAudioPlayer()` alone.
3. `sleepTimerNotifications.ts`, wired into `sleepTimerEngine.ts`.
4. `SleepTimerModal.tsx` + the `AudioPlayerScreen.tsx` header button.
5. The two `audioTtsCoordinator.ts` guard functions + the `AccessibilitySettingsPanel.tsx` diff —
   loop in Hruthik before merging this step.
6. Tests, then the manual device pass in §10.
