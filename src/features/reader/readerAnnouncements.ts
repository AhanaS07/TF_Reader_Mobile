// Owner: Reader (Ahana).
//
// WHAT the reader announces, and WHETHER an event is worth announcing at all. Pure — no React, no
// react-native — so every rule below is tested by calling it. `a11yAnnounce.ts` is the transport
// and has no opinions; this file has all of them.
//
// >>> THREE RULES, AND EACH ONE IS A DEFECT IF DROPPED <<<
//
// 1. NO PREVIOUS VALUE MEANS NO ANNOUNCEMENT. The first `applyAppearance` of a session and the
//    first `relocated` after an open are not changes — announcing them narrates opening a book,
//    which is the over-announcement WEBVIEW_A11Y_FINDINGS.md §3.7 exists to prevent.
//
// 2. NOTHING IS ANNOUNCED WHILE TTS IS SPEAKING. react-native-tts and the screen reader share one
//    output device and neither ducks for the other, so an announcement lands ON TOP of the sentence
//    being read aloud. This is not a new judgement: `SearchMatchBar.tsx` already declines a live
//    region in writing for exactly this reason. It matters most for the case that looks harmless —
//    `useTtsSession`'s `autoContinueChapter` drives `relocated` events WHILE reading, so an
//    ungated page announcement would interrupt the book on every page it turns for itself.
//
// 3. A REFLOWABLE EPUB HAS NO PAGE TO ANNOUNCE. `ReaderPosition` is `{kind:'cfi'}` for EPUB
//    because there is no stable page number — so there is no honest string, and "page turned" with
//    no number is noise. The meaningful unit for a reflowable book is the CHAPTER, which is what
//    `chapterChangeAnnouncement` is for. PDF, which really does have page N of M, gets one.

import type { ReaderAppearance } from '@/features/personalization/readerAppearance';

import type { ReaderPosition, ReaderTocItem } from '@/features/reader/readerBridge';

/**
 * The two conditions every navigation announcement is subject to.
 *
 * `enabled` is the user's preference for this KIND of announcement, already resolved host-side onto
 * the appearance payload (`announcePageChanges` / `announceChapterChanges`) — the Reader never reads
 * `AccessibilityPrefs` itself, per the standing rule in ACCESSIBILITY_ARCHITECTURE_MAP.md §2.
 */
export interface AnnounceGate {
  enabled: boolean;
  ttsSpeaking: boolean;
}

/** A chapter, as the WebView reports it on `relocated`. Null for formats with no spine. */
export interface AnnouncedSection {
  index: number;
  href: string;
}

function blocked(gate: AnnounceGate): boolean {
  return !gate.enabled || gate.ttsSpeaking;
}

/**
 * What to say when the reading position moved, or null.
 *
 * PDF ONLY, and only when the page NUMBER changed — not merely when a `relocated` arrived.
 * `pdf.entry.ts`'s scroll mode posts `relocated` from a rAF-coalesced scroll listener, so it fires
 * continuously through a drag; keying off arrival rather than change would announce dozens of times
 * per gesture. See rule 3 above for why EPUB returns null.
 */
export function pageChangeAnnouncement(
  previous: ReaderPosition | null,
  next: ReaderPosition,
  gate: AnnounceGate,
): string | null {
  if (blocked(gate)) return null;
  if (previous === null) return null;
  if (next.kind !== 'page' || previous.kind !== 'page') return null;
  if (previous.page === next.page) return null;

  return `Page ${next.page} of ${next.pageCount}`;
}

/**
 * What to say when the chapter changed, or null.
 *
 * `label` is the TOC entry's own text when the host could match the href to one, which is what a
 * reader recognises; the spine index is the fallback, because "Chapter 4" is still more use than
 * silence when a book's nav document does not name the section the spine just moved to.
 *
 * COMPARED BY href, NOT BY INDEX. A `goTo` into the middle of the current chapter reports the same
 * href with the same index, and both are unchanged — but a book whose spine repeats an href (some
 * fixed-layout EPUBs split one document across entries) would look like a chapter change on index
 * alone.
 */
export function chapterChangeAnnouncement(
  previous: AnnouncedSection | null,
  next: AnnouncedSection | null,
  label: string | null,
  gate: AnnounceGate,
): string | null {
  if (blocked(gate)) return null;
  if (next === null) return null;
  // No previous section is the first `relocated` of an open — rule 1.
  if (previous === null) return null;
  if (previous.href === next.href) return null;

  const named = label?.trim();
  return named ? `Chapter: ${named}` : `Chapter ${next.index + 1}`;
}

/**
 * What to say when the resolved appearance changed, or null.
 *
 * DIFFS THE RESOLVED PAYLOAD, NOT THE PREFERENCE EDIT. Trigger C re-resolves and re-sends on every
 * OS appearance tick, and a theme of 'system' resolving to the same scheme twice is not a change the
 * user made. Diffing what the renderer was actually told is the only version of this that stays
 * quiet when nothing visible happened.
 *
 * NOT GATED ON `announce.pageChanges`. That preference is about navigation; this fires only in
 * direct response to the user changing a setting, which is the one case where an announcement is
 * confirmation rather than interruption — and by then they are in the settings menu, not reading.
 * It IS suppressed while TTS is speaking, for rule 2.
 *
 * ONE FIELD, THE MOST SPECIFIC ONE. Changing font size from a menu can also change the resolved
 * line height; listing every derived field would read out a paragraph for one tap.
 */
export function appearanceChangeAnnouncement(
  previous: ReaderAppearance | null,
  next: ReaderAppearance,
  gate: Pick<AnnounceGate, 'ttsSpeaking'>,
): string | null {
  if (gate.ttsSpeaking) return null;
  if (previous === null) return null;

  if (previous.colorScheme !== next.colorScheme) return `${THEME_NAMES[next.colorScheme]} theme`;
  if (previous.dyslexiaFont !== next.dyslexiaFont) {
    return next.dyslexiaFont ? 'Dyslexia-friendly font on' : 'Dyslexia-friendly font off';
  }
  if (previous.fontFamily !== next.fontFamily) {
    return next.fontFamily === '' ? 'Default font' : `Font: ${next.fontFamily}`;
  }
  if (previous.fontSizePt !== next.fontSizePt) {
    return `Text size ${Math.round(next.fontSizePt)} point`;
  }
  if (previous.flow !== next.flow) {
    return next.flow === 'paginated' ? 'Page-by-page layout' : 'Continuous scroll layout';
  }
  if (previous.spread !== next.spread) {
    return next.spread === 'double' ? 'Two-page spread' : 'Single-page spread';
  }
  if (previous.highContrast !== next.highContrast) {
    return next.highContrast ? 'High contrast on' : 'High contrast off';
  }
  if (previous.boldText !== next.boldText) {
    return next.boldText ? 'Bold text on' : 'Bold text off';
  }
  if (previous.zoom !== next.zoom) return `Zoom ${Math.round(next.zoom * 100)} percent`;

  return null;
}

/**
 * The TOC entry naming `href`, or null if nothing in the outline addresses it.
 *
 * COMPARED WITHOUT THE FRAGMENT. A nav document routinely points at `ch4.xhtml#part2` while the
 * spine item epub.js reports is plain `ch4.xhtml`; matching the raw strings would find nothing for
 * exactly the books whose outline is most detailed, and fall back to "Chapter 4" for all of them.
 *
 * FIRST MATCH WINS. A chapter with several sub-entries has the chapter's own row first in the
 * depth-first flattening `epubOutline.ts` produces, so this picks the chapter rather than whichever
 * sub-heading happens to share its file.
 */
export function tocLabelForHref(items: ReaderTocItem[], href: string): string | null {
  const wanted = withoutFragment(href);
  if (wanted === '') return null;

  for (const item of items) {
    if (item.target.kind !== 'href') continue;
    if (withoutFragment(item.target.href) === wanted) return item.label;
  }
  return null;
}

function withoutFragment(href: string): string {
  const hash = href.indexOf('#');
  return hash === -1 ? href : href.slice(0, hash);
}

const THEME_NAMES: Record<ReaderAppearance['colorScheme'], string> = {
  light: 'Light',
  dark: 'Dark',
  sepia: 'Sepia',
};
