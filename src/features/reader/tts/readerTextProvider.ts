// Owner: Reader (Ahana). Consumed by Accessibility (Hruthik).
//
// The Reader → TTS seam: how a text-to-speech session gets one sentence at a time,
// and how it is told to stop. This file is TYPES ONLY and is PERMANENT — the
// implementation that will back it does not exist yet (see TTS_PROVIDER.md for the
// sequencing and for what stands in until then).
//
// Accessibility codes against this interface and nothing else. It does not reach into
// the WebView, does not send bridge commands, and does not model spine order — all
// three live behind here on purpose, because two components modelling reading order is
// how they come to disagree.
//
// WHY THE SEAM IS THIS NARROW. contentProvider.ts's rule is one call, whole book, in
// RAM, never to disk; the same instinct applies one level up. A TTS session needs the
// current sentence and the next one, so that is all that crosses. Handing it a chapter
// would put a second copy of decrypted licensed content in React Native for no
// capability gain — see the data-minimisation notes on TtsSentence below.

/**
 * Longest run of text the provider will emit as one sentence.
 *
 * THE CAP IS THE PROVIDER'S, NOT THE CALLER'S, and that is load-bearing rather than a
 * tidiness preference. `text` and `cfi` are two projections of ONE DOM Range (see
 * TtsSentence). A caller that receives an over-long string and truncates it before
 * speaking would leave the highlight covering more than what is spoken — the exact
 * desync this shape exists to prevent. So the cap has to apply while the range is still
 * being built, which is inside the provider.
 *
 * WHY 400 AND NOT SOMETHING LARGER. Two independent limits, and this sits under both.
 * A "sentence" of a few thousand characters is roughly forty unpausable seconds and a
 * highlight spanning most of a screen, which is a worse reading experience than an
 * arbitrary split. Separately, Android's TextToSpeech.speak() silently drops input past
 * ~4000 characters; capping an order of magnitude below that makes the platform limit
 * unreachable instead of something each caller has to defend against.
 *
 * Real prose almost never reaches this. What does: reference lists, tables rendered as
 * running text, and legal front matter — content with no sentence-terminal punctuation
 * for pages at a time. The split falls on a word boundary, never mid-word.
 */
export const TTS_MAX_SENTENCE_CHARS = 400;

/**
 * One speakable unit. The only shape that crosses this seam.
 *
 * THE INVARIANT THAT MATTERS: `text` and `cfi` are derived from the SAME DOM Range and
 * are never computed independently. The provider walks text nodes to build a Range, then
 * emits `range.toString()` as `text` and `new EpubCFI(range, cfiBase)` as `cfi`. There is
 * no second code path producing the string, so the two cannot drift — which is what
 * makes it safe to speak one and highlight the other.
 *
 * The corollary is a rule for callers: do not re-derive one from the other. Do not
 * re-segment `text`, and do not parse `cfi` to work out where you are. Pass `cfi` back
 * verbatim as `next`'s `after` argument and treat it as opaque.
 */
export interface TtsSentence {
  /**
   * Exactly what to speak. Whitespace already collapsed, non-readable nodes already
   * removed (script/style, aria-hidden, role="presentation", pagebreak markers).
   *
   * Never longer than TTS_MAX_SENTENCE_CHARS.
   */
  text: string;

  /**
   * EPUB CFI *range* covering exactly `text`. Two jobs: the anchor you pass to
   * `setSpokenRange` to paint the highlight, and the `after` argument that gets you the
   * next sentence. Opaque — see the note above.
   */
  cfi: string;

  /**
   * 0-based index into the EPUB spine, i.e. reading order.
   *
   * NOT a TOC position and deliberately NOT a chapter href. A real book's navigation
   * document repeats hrefs — the 20 MB fixture's NCX has the same `src` five times, which
   * is documented at the Contents list in ReaderScreen.tsx — so an href is not identity
   * and cannot be used to tell two positions apart. This can.
   *
   * IT IS NOT CONTIGUOUS ACROSS CONSECUTIVE SENTENCES. The provider skips spine items
   * with nothing speakable in them (empty sections, pure-navigation pages, decorative
   * plates), so a jump from 4 to 7 is normal and means nothing was lost.
   */
  spineIndex: number;

  /**
   * Position within this spine item, counting only sentences that were actually emitted.
   * Monotonic from 0, resets at each spine item.
   *
   * For logging and ordering assertions. Do not use it to compute the next position —
   * that is what `next` is for.
   */
  sentenceIndex: number;

  /**
   * Nothing speakable follows in this spine item.
   *
   * ADVISORY, and the division of labour here is deliberate. `next` crosses spine items
   * on its own, so auto-continue needs no special call. This flag exists so a caller with
   * `accessibility.tts.autoContinueChapter` switched OFF knows where to stop. The
   * provider does not read that preference: it belongs to Accessibility's contract and
   * Accessibility's session already has it, so having Reader read it too would put a
   * second consumer of someone else's pref behind this seam for no gain.
   */
  lastInSection: boolean;
}

/** Why a fetch produced no sentence. See TtsFetchResult. */
export type TtsFetchStatus = 'ok' | 'endOfBook' | 'invalidAnchor' | 'unavailable' | 'error';

/**
 * The result of asking for a sentence. ONE channel — these methods never reject.
 *
 * WHY NEVER REJECT. Type-aware lint is on for this directory (no-floating-promises,
 * no-misused-promises — see the scoped block in eslint.config.js), and a seam that can
 * both resolve a status and throw makes every call site carry two error paths for one
 * question. A caller can `switch` on `status` and be exhaustive. There is no case where
 * catching adds information.
 *
 * FOUR NON-OK CASES, NOT SEVEN. Two things that look like they need their own status
 * deliberately do not:
 *
 *  - End of *chapter* is `lastInSection` on an ok result, not a status. With
 *    auto-continue on, the caller does not care that a boundary was crossed.
 *  - An empty or unreadable chapter is not a status either. The provider skips it and
 *    returns the next real sentence, so the caller never learns it existed.
 *
 * Collapsing those two is the whole reason this union is small enough to handle
 * correctly.
 */
export type TtsFetchResult =
  | { status: 'ok'; sentence: TtsSentence }
  /** No speakable text after this point. Terminal for a forward read. */
  | { status: 'endOfBook' }
  /**
   * The `from`/`after` CFI does not resolve in this book any more — a stale anchor kept
   * across a reopen, or content that changed underneath it.
   *
   * RECOVERY IS THE PROVIDER'S, NOT THE CALLER'S. Do not try to repair the anchor. Call
   * `current(null)` to start again from wherever the reader actually is; the provider
   * falls back through section start to book start internally.
   */
  | { status: 'invalidAnchor' }
  /**
   * There is nothing to read from: the book is not rendered yet, the reader closed it,
   * access was revoked, or the caller aborted this request.
   *
   * An aborted request lands here rather than rejecting — see "never reject" above. The
   * caller asked for the cancellation, so it already knows; a distinct status would be
   * information it supplied itself.
   */
  | { status: 'unavailable' }
  /** Something genuinely unexpected. `message` is diagnostic, not user-facing copy. */
  | { status: 'error'; message: string };

/**
 * Why a TTS session must stop what it is doing.
 *
 *  closed    — the reader is tearing this book down (unmount, or a switch to another
 *              book). Fired BEFORE contentProvider.closeBook(), so a handler still runs
 *              while the session is coherent.
 *  revoked   — entitlement was withdrawn. Same handling as `closed` and separate only so
 *              it can be reported differently.
 *  navigated — the user moved somewhere else in the book (a Contents entry, a search
 *              hit, a page turn). NOT a teardown: the provider stays usable and
 *              `current(null)` now resolves at the new position.
 *
 * The first two are terminal — after either, every method resolves `unavailable` for the
 * life of this provider. The third is not.
 */
export type TtsInterruption = 'closed' | 'revoked' | 'navigated';

/**
 * A sub-range of one spoken sentence — the word the engine is saying right now.
 *
 * `start`/`end` are half-open offsets into that sentence's `text`, which is the string the
 * caller handed to the TTS engine, so they are exactly what the engine reports back
 * (iOS `location`/`length`, Android `start`/`end`). They are NOT offsets into any DOM text
 * node: `text` is whitespace-collapsed and trimmed and the sentence may span several nodes,
 * so the mapping back to a paintable range is arithmetic the WebView does against the live
 * document (`webview/src/ttsWordOffsets.ts`, `epubTtsResolver.ts`). A caller supplies the
 * offsets it was given and nothing else.
 *
 * ONE OBJECT, NOT THREE ARGUMENTS, and that is a bridge constraint rather than a style
 * preference: every `ReaderCommand` carries exactly one non-`type` field, and
 * `webview/src/bridge.ts`'s `ExpectedArgs`/`CommandArgsMatchPayloads` proof enforces the
 * 1:1 field-to-argument mapping. A three-field command collapses to a 1-tuple of a union
 * there and cannot match a 3-tuple. It would also force a bespoke branch in
 * `buildCommandScript` instead of the uniform `JSON.stringify` chain, and make "clear"
 * mean `(null, 0, 0)` rather than `null`.
 */
export interface SpokenWordRange {
  /** The `cfi` of the sentence being spoken — one this provider emitted. */
  cfi: string;
  start: number;
  end: number;
}

/**
 * What Accessibility codes against.
 *
 * NOTE WHAT IS ABSENT: there is no `dispose`. Lifetime belongs to whoever owns the book
 * — ReaderScreen, in the same effect that calls closeBook — and a consumer that could
 * tear down the provider could tear it down while another consumer was using it. A TTS
 * session learns the provider is finished through `onInterrupted`, and that is the only
 * direction that information travels.
 */
export interface ReaderTextProvider {
  /**
   * The sentence at a position.
   *
   * `from` is `null` for "wherever the reader currently is" — that is the resume path,
   * and it deliberately reads the reader's LIVE position rather than the persisted
   * Progress record. Two reasons: after a search jump or a Contents tap the live position
   * is where the user is actually looking, and `Progress.offset` is an integer whose own
   * contract notes (progress.ts) say it cannot anchor a reflowable EPUB. No new
   * preference is introduced and none is read.
   *
   * When the position falls mid-sentence, this returns that WHOLE sentence, from its
   * start. Resuming mid-sentence would need sub-sentence offsets that neither platform
   * TTS engine reports reliably, and would leave the highlight covering text that was
   * never spoken.
   */
  current(from: string | null, signal?: AbortSignal): Promise<TtsFetchResult>;

  /**
   * The sentence after the range `after`, which must be a `cfi` this provider emitted.
   *
   * Crosses spine items by itself, skipping anything unspeakable on the way, so
   * auto-continue needs no separate call and non-linear spine items (`linear="no"` —
   * answer keys, ad pages, notes reachable only by explicit link) are stepped over
   * rather than read.
   */
  next(after: string, signal?: AbortSignal): Promise<TtsFetchResult>;

  /**
   * Paint or move the spoken-sentence highlight. `null` clears it.
   *
   * ONE RANGE, NOT A STACK: calling this with a new CFI replaces the previous highlight,
   * so there is nothing to clear between sentences.
   *
   * SEPARATE FROM FETCHING ON PURPOSE. A session prefetches the next sentence while the
   * current one is still being spoken, so painting at fetch time would run the highlight
   * one sentence ahead of the voice. Call this when the utterance starts, not when the
   * text arrives.
   *
   * The agreed behaviours at the other transitions: PAUSE keeps the highlight (it is the
   * "you are here" marker and losing it loses the place); STOP clears it; an ERROR clears
   * it, because at that point we do not know what is being spoken. Reader clears it
   * itself on user navigation and reports `navigated` — the caller does not have to.
   *
   * Fire-and-forget and best-effort. It never throws and never reports failure: a
   * highlight that could not be painted must not be able to interrupt speech.
   */
  setSpokenRange(cfi: string | null): void;

  /**
   * Paint or move the spoken-WORD highlight — a sub-range of the sentence `setSpokenRange`
   * is currently showing. `null` clears it.
   *
   * A REFINEMENT OF THE SENTENCE HIGHLIGHT, NOT A REPLACEMENT FOR IT. The two layers compose:
   * the sentence wash says which sentence, the word wash says where inside it. Both are the
   * `tts` owner and the same colour at different intensities (HIGHLIGHT_LAYERS.md §3), so a
   * caller in word mode paints BOTH — `setSpokenRange` when the utterance starts, this on
   * every progress event.
   *
   * CALLING `setSpokenRange` CLEARS THIS. The word is a sub-range of one sentence, so moving
   * to the next sentence invalidates it; the caller does not have to clear it first, and a
   * caller that does anyway is harmless. That also means a caller which stops sending word
   * ranges — because the reader turned word mode off mid-utterance — is not leaving a stale
   * wash behind: the next sentence removes it.
   *
   * WHEN THE RANGE CANNOT BE RESOLVED, THE PREVIOUS WORD IS STILL CLEARED. Reader resolves
   * these offsets against the live document and can legitimately fail — the reader paged
   * away mid-utterance, the section is not rendered, the sentence is a single word already
   * covered by the sentence highlight. Every one of those clears the previous word and paints
   * nothing, because a highlight left on the last word while speech has moved on is worse
   * than no word highlight at all. The sentence wash stays throughout, so what is lost is the
   * refinement, not the "you are here".
   *
   * Fire-and-forget and best-effort, exactly like `setSpokenRange`: it never throws and never
   * reports failure, so nothing here can interrupt speech.
   */
  setSpokenWordRange(range: SpokenWordRange | null): void;

  /**
   * Subscribe to teardown and navigation. Returns an unsubscribe.
   *
   * ONE SUBSCRIPTION COVERS ALL OF IT, including the case a caller cannot otherwise see:
   * a request already in flight when the book closes. Those resolve `unavailable` rather
   * than delivering text, so no sentence can arrive after teardown. The provider stamps
   * every request with a (bookId, generation) pair and drops mismatched replies — that is
   * internal, and a caller neither passes nor sees a generation id.
   *
   * A handler that throws is swallowed, mirroring the property event-bus.ts already
   * requires of `emit`: this fires from a React effect cleanup on the teardown path, and
   * one subscriber's bug must not stop the book being closed.
   */
  onInterrupted(handler: (reason: TtsInterruption) => void): () => void;
}
