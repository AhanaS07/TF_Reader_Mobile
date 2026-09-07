// Owner: Reader (Ahana).
//
// "Did anything that MOVES A GLYPH change?" — asked by `epub.entry.ts`'s `applyAppearance` before it
// decides whether to re-measure every painted highlight. Pure and unit-tested, per CLAUDE.md's
// split: the entry reads the DOM and drives epub.js, this decides.
//
// >>> WHY THE QUESTION HAS TO BE ASKED AT ALL, RATHER THAN JUST ALWAYS RE-MEASURING. <<<
// The EPUB re-measure is a remove-then-add of every annotation in the loaded chapter
// (`repaintLiveAnnotations`), which is the only correct primitive against a live rendition and is
// not free. A theme toggle already has its own reason to run it (the fill is derived from the page
// colour) and a `zoom` change does nothing at all in a reflowable book, so re-measuring on every
// payload would pay that cost for changes that cannot move a single rect.
//
// >>> THE CLASSIFICATION IS EXHAUSTIVE, AND THAT IS THE POINT OF `Unclassified` BELOW. <<<
// Every key of `ReaderAppearance` must be named in exactly one of the two lists, so ADDING A FIELD
// TO ReaderAppearance FAILS TO COMPILE HERE until someone decides which kind it is. Without that,
// the failure mode is silent: a new typography field lands, nothing re-measures for it, and the
// highlights drift again for a reason no test can see.

import type { ReaderAppearance } from '@/features/personalization/readerAppearance';

/** Viewport dimensions the line grid is derived from — `readerMetrics(width, height, ...)` scales
 * type size and quantises the column to whole lines, so a size change moves every glyph even when
 * no preference did. */
export interface LayoutViewport {
  width: number;
  height: number;
}

/**
 * Fields the EPUB shell RENDERS WITH, i.e. that reach `baselineCss`/`readerMetrics` or epub.js's own
 * layout. A change to any of these re-flows the chapter.
 */
type GeometryKey =
  | 'fontSizePt'
  | 'lineHeight'
  | 'letterSpacingPx'
  | 'marginPx'
  | 'fontFamily'
  | 'customFontUri'
  | 'flow'
  | 'spread';

/**
 * Fields that cannot move a glyph in THIS shell, as it renders today.
 *
 * Two groups, and the second is a live trap rather than a settled fact:
 *
 *  - genuinely not geometry — the four colours (they change the paint, and `applyAppearance` has its
 *    own `bg` path for that), `zoom` (a reflowable EPUB scales through `fontSizePt`; `zoom` is the
 *    PDF shell's), and the three `announce`/`reduceMotion` gates.
 *
 *  - >>> `highContrast` AND `dyslexiaFont` ARE WIRED, AND STILL BELONG HERE. <<< Both are applied
 *    HOST-SIDE, in `ReaderScreen.tsx`'s `buildAppearanceWithFont`, by resolving them into fields
 *    that are already classified above: the dyslexia face arrives as `fontFamily` +
 *    `customFontUri`, and the contrast pair as `fg`/`bg`/`link`. So the signature already moves for
 *    a dyslexia toggle — via the two font keys — and a contrast toggle already takes the `bg` path.
 *    Promoting either key would re-measure a second time for a change the font keys have already
 *    accounted for. THE RULE BELOW IS UNCHANGED; these two simply do not trigger it, because
 *    nothing about them reaches this shell as itself.
 *
 *  - >>> NOT GEOMETRY ONLY BECAUSE THIS SHELL DOES NOT APPLY THEM YET. <<< `boldText` and
 *    `readableSpacing` are absent from `appearanceCssOptions()` and `currentTypography()` in
 *    `epub.entry.ts`, so today they change nothing and re-measuring for them would be waste. Both
 *    are unambiguously typographic — a heavier weight and looser spacing each re-flow every line.
 *    WHOEVER WIRES ONE OF THEM INTO THE STYLESHEET MUST MOVE ITS KEY UP TO `GeometryKey` IN THE
 *    SAME CHANGE, or highlights will drift under it exactly the way they did under `fontSizePt`.
 *    That obligation binds anything applied INSIDE this shell; it is precisely what the host-side
 *    route above sidesteps, and the reason that route was chosen.
 */
type PaintOnlyKey =
  | 'colorScheme'
  | 'fg'
  | 'bg'
  | 'link'
  | 'zoom'
  | 'reduceMotion'
  | 'highContrast'
  | 'boldText'
  | 'dyslexiaFont'
  | 'readableSpacing'
  | 'announcePageChanges'
  | 'announceChapterChanges';

/** Every `ReaderAppearance` key not named above. Must be `never`. */
type Unclassified = Exclude<keyof ReaderAppearance, GeometryKey | PaintOnlyKey>;

/** The canary. A new `ReaderAppearance` field makes `Unclassified` non-empty and this line red —
 * find out which kind the field is, don't widen the type. */
const CLASSIFICATION_IS_EXHAUSTIVE: Unclassified extends never ? true : never = true;
void CLASSIFICATION_IS_EXHAUSTIVE;

/**
 * A custom font's bytes, as a value cheap enough to compare on every payload.
 *
 * SAMPLED RATHER THAN HASHED, and rather than embedded whole: `customFontUri` reaches this shell as
 * a `data:` URI carrying the whole font file, which can be a megabyte. Embedding it would make the
 * signature that long, and hashing it would walk every byte on a path that runs on each preference
 * change. Length plus both ends discriminates every real swap (a different face is a different file
 * with different tables at both ends); a collision would cost one skipped re-measure, which the
 * `fonts.ready` refresh in `epub.entry.ts` covers anyway, since a font swap always lands there.
 */
function fontFingerprint(uri: string | null): string {
  if (uri === null) return '-';
  return `${String(uri.length)}:${uri.slice(0, 32)}:${uri.slice(-32)}`;
}

/**
 * Everything about `appearance` that decides WHERE TEXT LANDS, as one comparable string.
 *
 * >>> COMPARED WITH `!==`, AND NOTHING ELSE. <<< There is no `layoutMoved(previous, next)` helper,
 * because a `null` previous is not a separate case: the pre-first-payload state gets its own
 * signature below rather than being refused, so the transition into a real payload is a change like
 * any other and one comparison covers every caller. A wrapper would only have been `!==` with a
 * second, unreachable spelling of the same question.
 */
export function layoutSignature(
  appearance: ReaderAppearance | null,
  viewport: LayoutViewport,
): string {
  const box = `${String(viewport.width)}x${String(viewport.height)}`;
  if (appearance === null) return `none|${box}`;

  return [
    String(appearance.fontSizePt),
    String(appearance.lineHeight),
    String(appearance.letterSpacingPx),
    String(appearance.marginPx),
    appearance.fontFamily,
    fontFingerprint(appearance.customFontUri),
    appearance.flow,
    appearance.spread,
    box,
  ].join('|');
}

