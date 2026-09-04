// src/shared/contracts/accessibility.ts
// Accessibility preferences — CAP-7 Reader & Offline (Team t4targaryen)
// Owner: Accessibility (Hruthik). FINAL, confirmed 2026-09-02.
//
// SPLIT OUT OF prefs.ts RATHER THAN GROWN INSIDE IT. The flat four-boolean
// `AccessibilityPrefs` that used to live in prefs.ts carried a "PROVISIONAL —
// NEEDS HRUTHIK'S SIGN-OFF" note for exactly this reason: the shape was another
// owner's to publish. It is published now, and it lives in its own file so the
// boundary is visible in the folder rather than only in a comment.
//
// FOUR SUB-BLOCKS, AND THE NESTING IS LOad-BEARING. Patches merge at the top
// level only, so `text`, `display`, `announce` and `tts` each replace wholesale.
// A writer naming one field has to spread its group AND the parent — see
// `expandPatch` in useReaderPrefs.ts, which does both so no section has to.
//
// `tts` IS DECLARED AND NOT OURS TO WRITE. Its fields (enabled, voiceId, rate,
// pitch, autoContinueChapter, highlightMode, backgroundPlayback) are controlled
// from the in-reader `TtsControls` panel, which is Ahana's surface. The Reader
// Preferences screen renders no TTS section and exposes no TTS field. The key
// stays in the type so the record round-trips through this app unchanged rather
// than being silently dropped on write.

/**
 * Whether page-turn and transition animation is suppressed.
 *
 * A TRI-STATE, NEVER A BOOLEAN, and the third member is the point: 'system'
 * means "follow whatever the OS reports right now", which is not the same fact
 * as 'off' and cannot be recovered once collapsed. Settings stores the raw
 * string; resolving it to an effective boolean against live OS state is the
 * reader's job, not this app's.
 */
export type ReduceMotion = 'system' | 'on' | 'off';

export interface AccessibilityPrefs {
  text: {
    /** OpenDyslexic. */
    dyslexiaFont: boolean;
    /** Honour the OS Dynamic Type setting. */
    respectOsFontScale: boolean;
    /**
     * Applied ON TOP OF the OS scale, not instead of it.
     *
     * THE TYPE IS UNBOUNDED ON PURPOSE — the contract says so. Sensible
     * on-screen bounds are the UI's to choose and the UI's to enforce; see
     * `FONT_SCALE_MULTIPLIER` in prefsOptions.ts and the clamp in
     * useReaderPrefs.ts.
     */
    fontScaleMultiplier: number;
    /** Looser line and word spacing preset. */
    readableSpacing: boolean;
  };

  display: {
    /** Heavier weight throughout. */
    boldText: boolean;
    /**
     * THE ONLY PLACE CONTRAST LIVES. The `Theme` union's deprecated
     * 'highContrast' member is not offered by the Theme picker and must not be
     * reintroduced there — contrast is independent of theme, so dark plus high
     * contrast is a valid combination.
     */
    highContrast: boolean;
    reduceMotion: ReduceMotion;
    /** Enlarges reader control hit targets. */
    largeTouchTargets: boolean;
    /** Enlarges the TTS transport controls. */
    largeAudioControls: boolean;
  };

  /**
   * Ahana's, via the in-reader `TtsControls` panel. Declared so the record
   * round-trips; never rendered or written by Reader Preferences.
   */
  // `{}` IS THE CONTRACT'S OWN SHAPE, and the lint rule is right in general —
  // it allows any non-nullish value. It is suppressed rather than "fixed"
  // because the two obvious fixes are both worse: `object` or
  // `Record<string, unknown>` would invite this app to write into a group it
  // does not own, and naming the seven TTS fields would claim Ahana's surface
  // outright. The group exists here only so the record round-trips.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  tts: {};

  announce: {
    /** Screen-reader announcement on page turn. */
    pageChanges: boolean;
    /** Screen-reader announcement on chapter change. */
    chapterChanges: boolean;
  };

  /**
   * Extra a11y labels on NATIVE React Native controls.
   *
   * SCOPE LIMIT, CARRIED INTO THE UI COPY: this does not reach EPUB content
   * inside the WebView — that accessibility tree comes from the DOM and is
   * unreachable from RN props. The label must not imply otherwise.
   */
  screenReaderHints: boolean;
}
