# Screen-reader announcements — the seam, the gates, and what is still open

**Owner of this doc and of everything under `src/features/reader/`: Ahana (Reader).**
**Owner of the two items in §5: Hruthik (Accessibility) — they are specced here, not implemented.**
Last updated 2026-08-28.

Before this landed, `AccessibilityInfo.announceForAccessibility` was called **nowhere in the repo**.
`ACCESSIBILITY_ARCHITECTURE_MAP.md` §5 recorded that as an open gap: *"the `relocated` bridge message
only updates RN visual state; it never calls `AccessibilityInfo.announceForAccessibility`."* This is
what closed it, and the contract every future announcement should be built against.

---

## 1. The two files

| File | Holds |
| ---- | ----- |
| `a11yAnnounce.ts` | `announce(message)` — the transport. Trims, drops blanks, never throws. **No opinions.** |
| `readerAnnouncements.ts` | The strings and the gates. Pure — no React, no react-native — so every rule is tested by calling it. |

The split is the same one `a11yFocus.ts` draws: one implementation of the native call and its
error handling, so "the screen reader said something odd" has one place to look.

`a11yAnnounce.ts` is **shared with Accessibility, not Reader-private**, exactly as `a11yFocus.ts` is.
Items 8 and 9 below are specified against it.

## 2. The three gates

Nothing in this app announces unconditionally. Every announcement passes all three:

1. **A previous value must exist.** The first `applyAppearance` of a session and the first
   `relocated` after an open are not changes. Announcing them narrates opening a book, which is the
   over-announcement `WEBVIEW_A11Y_FINDINGS.md` §3.7 exists to prevent.
2. **The user's preference for that kind of announcement.** `announce.pageChanges` and
   `announce.chapterChanges` (`src/shared/contracts/accessibility.ts`, both defaulting to **true**).
   They are separate fields and are honoured separately: a page turn fires constantly, a chapter
   change a handful of times a book, and a reader who silenced pages has not asked to stop being
   told which chapter they are in.
3. **TTS must not be speaking.** react-native-tts and the screen reader share one output device and
   neither ducks for the other, so an announcement lands **on top of** the sentence being read
   aloud. `SearchMatchBar.tsx:50-64` already declined a live region in writing for this reason. The
   case that matters is the one that looks harmless: `useTtsSession`'s `autoContinueChapter` drives
   `relocated` events *while reading*, so an ungated announcement would interrupt the book on every
   page it turns for itself.

**How the preference reaches the Reader.** Not by reading `AccessibilityPrefs` — the standing rule
(`ACCESSIBILITY_ARCHITECTURE_MAP.md` §2) is that Reader does not. Both flags are resolved host-side
by Personalization's `toReaderAppearance()` onto `ReaderAppearance`, arrive over the
`applyAppearance` bridge command, and `ReaderScreen` retains the last-sent payload in
`lastAppearanceRef`. That ref **is** the mechanism by which `announcePageChanges` is readable at
`relocated` time.

**Assertive is reserved for errors the user must act on.** The app's only assertive channel is
`TtsControls.tsx`'s error `Text`. Everything here is polite.

## 3. What the Reader announces today

| Event | Says | Gated on |
| ----- | ---- | -------- |
| PDF page change | "Page 12 of 340" | `announcePageChanges`, page number actually moved |
| EPUB chapter change | "Chapter: The Cave", else "Chapter 4" | `announceChapterChanges`, `section.href` actually changed |
| Resolved appearance change | "Dark theme", "Text size 18 point", … | a real change in the **resolved** payload |

Three details that are decisions, not incidentals:

- **A reflowable EPUB announces no page.** `ReaderPosition` is `{kind:'cfi'}` because there is no
  stable page number, so there is no honest string. "Page turned" with no number is noise. The
  meaningful unit for a reflowable book is the chapter.
- **One relocation, one utterance.** Crossing a chapter boundary is also a page change. The chapter
  is tried first and the page only if it said nothing.
- **The appearance diff is over the RESOLVED payload, not the prefs edit.** Trigger C re-resolves and
  re-sends on every OS appearance tick, and `theme: 'system'` resolving to the same scheme twice is
  not a change the user made. Only one field is named per change — listing every derived field turns
  one tap into a paragraph.

## 4. What is deliberately NOT announced

- **Search results and search steps.** `SearchPanel.tsx:144` already carries a polite live region on
  the line whose meaning changes ("14 matches for …"), and `SearchMatchBar.tsx:50-64` declines one on
  the counter in writing, because it changes on every arrow press — the highest-frequency update on
  the screen — and would talk over TTS. A third channel would double-speak on Android and interrupt
  the book on both platforms. **Asked for and declined, 2026-08-28.** If this is revisited, the
  argument to beat is that comment, not this line.
- **The layout override itself is an `Alert`, not an announcement.** When a screen reader forces
  `flow: 'scrolled-doc'` (see `readerA11yLayout.ts`), `ReaderScreen` shows a native alert with a
  "Use pages anyway" opt-out. A native alert is read by the screen reader that caused it and is
  dismissable; an announcement would be spoken once and unrecoverable.

## 5. Open — Accessibility's to implement (Hruthik)

Both live in `src/features/accessibility/tts/**`, which is why they are specified rather than
written. `announce()` is imported from `@/features/reader/a11yAnnounce`; it is shared.

### Item 8 — TTS state announcements (`useTtsSession.ts`)

Call sites are `updateStatus`'s transitions. **One platform asymmetry means one obvious
announcement cannot fire, and shipping it anyway would be shipping a lie.** It is already a
load-bearing comment in that file:

- **iOS never reaches `'error'` from the engine.** `'tts-error'` is absent from
  `@iternio/react-native-tts`'s iOS `supportedEvents` — `AVSpeechSynthesizerDelegate` has no error
  callback to wire it from — so an iOS engine failure leaves the session in `'speaking'`
  (`useTtsSession.ts:355-364`).

**Android reaches `'paused'` too, not just iOS.** `PAUSE_RESUME_SUPPORTED = Platform.OS === 'ios'`
(`useTtsSession.ts:81`) still gates which native call runs — Android's `Tts.pause()`/`resume()` are
documented no-ops — but `pauseRef.current` no longer treats that as "do nothing." On Android it
stops the engine, remembers the interrupted sentence in a closure variable, and drives
`updateStatus('paused')` directly rather than waiting for a `tts-pause` event that will never
arrive. `play()` then re-speaks that sentence from its start instead of re-resolving the reader's
live position. So the button is genuinely "Pause"/"Resume" on both platforms now
(`TtsControls.tsx`); only the resume *granularity* differs (exact word on iOS, sentence start on
Android), not whether pause/resume happen at all.

So: announce `speaking` / `paused` / `resumed` / `idle` on both platforms, and **document the
remaining gap rather than papering over it**. Suppressing these while TTS is speaking would be
wrong — these announcements are *about* the speech, and the engine is not speaking at the moment it
stops or errors.

### Item 9 — TTS error announcement (`TtsControls.tsx:80-85`)

The error `Text` already has `accessibilityRole="alert"` + `accessibilityLiveRegion="assertive"`.
**`accessibilityLiveRegion` is Android-only; iOS ignores it entirely** — so the error is announced on
Android today and silent on iOS.

The fix is therefore **`Platform.OS === 'ios'`-gated** and never unconditional, or Android speaks it
twice: once from the live region and once from `announce()`. Note also the double guard
`status === 'error' && errorMessage !== null`, which combined with item 8's iOS finding means an iOS
engine failure currently renders nothing and announces nothing.

### Item 12 — the suppression question, answered

*"Do page/chapter announcements need to suppress while `ttsSession.status === 'speaking'`?"* **Yes,
and it is implemented** — gate 3 above. `ReaderScreen` mirrors the live status into `ttsStatusRef`
and passes it into every gate. It is a ref rather than a dependency because `handleMessage`'s
dependency array is kept minimal on purpose; a value that changes on every utterance boundary would
rebuild the bridge's message handler several times a sentence.

## 6. Still unverified

Every announcement here is covered by unit tests and **none has been heard on a device**. The Android
re-verification protocol is `src/features/accessibility/WEBVIEW_A11Y_SPIKE.md` §11; iOS/VoiceOver has
never been run at all. In particular, whether one page turn produces exactly one utterance — rather
than one plus whatever the WebView's own DOM changes provoke — is a device question, not a unit-test
one.

## Related

- `src/features/reader/readerA11yLayout.ts` — the screen-reader layout override and why it exists
- `src/features/accessibility/WEBVIEW_A11Y_SPIKE.md` — F4/F6, and §11's re-verification protocol
- `src/features/accessibility/ACCESSIBILITY_ARCHITECTURE_MAP.md` — ownership and the announcement model
- `src/features/reader/WEBVIEW_BRIDGE.md` — `relocated.section`, which chapter announcements are built from
