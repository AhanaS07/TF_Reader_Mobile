// Owner: Search (Vaishnavi).
//
// The `Extractor` seam from the Day-3 design: it hides WHERE the plaintext comes
// from behind the frozen `BuildIndex(bookId)` facade, and — because it is the only
// format-aware stage — it is also where the per-format `Locator` is minted.
//   • Server impl (production, not built yet): fetches the book by id.
//   • Prototype impl (this file): reads Ahana's local sample EPUB.
// Per the design, the extractor emits `IndexEntry[]` (word + Posting); `buildIndex`
// only groups them. No contract change — `__typecheck__.ts` stays green.
//
// PROTOTYPE / NODE-ONLY. Reads a file with `fs`, unzips with `jszip`, and builds
// EPUB CFIs with `epub.js` under `jsdom` — all Node, never on device. Not imported
// by the app entry, so the RN bundler never pulls these into a device build.
//
// EPUB LOCATORS ARE REAL NOW (was: a PDF-modeled stand-in — see git history).
// ITEM 2 is settled with Ahana (Reader): Search generates the CFI at index-build
// time, the Reader resolves it via `goTo`. Confirmed by round-trip spike — epub.js
// `EpubCFI` run headlessly here reproduces the exact CFIs her WebView resolves.
//   • cfiBase (e.g. `/6/2[ch1]`) is COMPUTED from the OPF, not assumed — the spine
//     step and the itemref step each use the CFI even-index rule `(elementIndex+1)*2`.
//   • The risky in-document path (`/4/4/1:offset`, with text nodes on ODD indices)
//     is left to epub.js via a Range — Ahana's explicit advice, since hand-deriving
//     the even/odd numbering is the most common CFI error.

import * as fs from 'fs';
import * as path from 'path';
import JSZip from 'jszip';
import { EpubCFI } from 'epubjs';
import { JSDOM } from 'jsdom';
import type { DOMWindow } from 'jsdom';
import type { IndexEntry, Locator } from '@/shared/contracts';
import { makeSnippet, tokenize } from './text';

export interface ExtractedBook {
  format: 'EPUB' | 'PDF';
  entries: IndexEntry[];
}

export interface Extractor {
  extract(bookId: string): Promise<ExtractedBook>;
}

const SAMPLE_EPUB = path.resolve(__dirname, '../../../assets/reader/sample-plaintext.epub');

// --- locate the OPF (do NOT assume OEBPS/) --------------------------------
//
// A real EPUB may keep its package document anywhere (OEBPS/, OPS/, root, …);
// the true location is declared in META-INF/container.xml. The prototype used to
// hardcode `OEBPS/content.opf`, which happens to be where the sample puts it but
// breaks on most real books. Resolve it properly so any EPUB works.

async function resolveOpfPath(zip: JSZip): Promise<string> {
  const containerXml = await zip.file('META-INF/container.xml')?.async('string');
  if (!containerXml) throw new Error('EPUB missing META-INF/container.xml');
  const doc = new JSDOM(containerXml, { contentType: 'application/xml' }).window.document;
  const fullPath = doc.querySelector('rootfile')?.getAttribute('full-path');
  if (!fullPath) throw new Error('container.xml has no <rootfile full-path>');
  return fullPath;
}

/** The directory the OPF lives in, e.g. "OEBPS/content.opf" -> "OEBPS/" (""=root). */
function opfDirOf(opfPath: string): string {
  const i = opfPath.lastIndexOf('/');
  return i === -1 ? '' : opfPath.slice(0, i + 1);
}

/**
 * Resolve a spine href (relative to the OPF dir) to a zip entry key, collapsing
 * `.`/`..` segments and dropping any fragment/percent-encoding. Zip keys have no
 * leading slash, so empty segments are dropped too.
 */
function resolveZipPath(opfDir: string, href: string): string {
  const decoded = decodeURIComponent(href.split('#')[0]);
  const out: string[] = [];
  for (const part of (opfDir + decoded).split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

// --- epub.js DOM env -------------------------------------------------------

/**
 * Point the browser globals epub.js's CFI ops read (document/Node/Range) at the
 * active jsdom window. epub.js's module load needs none of these — only its
 * range-walking does — so a normal top-level import is fine; we just install the
 * globals before each chapter's generation.
 */
function bindDomGlobals(window: DOMWindow): void {
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = window;
  g.document = window.document;
  g.DOMParser = window.DOMParser;
  g.XMLSerializer = window.XMLSerializer;
  g.Node = window.Node;
  g.Range = window.Range;
}

// --- OPF → per-chapter CFI base -------------------------------------------

interface SpineChapter {
  chapterId: string; // the itemref idref; also what a Posting reports
  href: string;
  base: string; // cfiBase, e.g. "/6/2[ch1]"
}

function elementChildren(node: Node): Element[] {
  return Array.from(node.childNodes).filter((n): n is Element => n.nodeType === 1);
}

/**
 * Read the spine in reading order and compute each chapter's cfiBase from the OPF
 * structure. `(elementIndex + 1) * 2` is the CFI even-step rule applied at both
 * levels: the `<spine>`'s position among `<package>`'s element children, then the
 * `<itemref>`'s position among the spine's. This is exactly what epub.js's
 * (private) generateChapterComponent does — recomputed here so we depend only on
 * public API, and locked by the fixture test against Ahana's real CFI.
 */
function readSpine(opfXml: string): SpineChapter[] {
  const doc = new JSDOM(opfXml, { contentType: 'application/xml' }).window.document;
  const pkg = doc.documentElement;
  const pkgChildren = elementChildren(pkg);
  const spine = pkgChildren.find((e) => e.localName === 'spine');
  const manifest = pkgChildren.find((e) => e.localName === 'manifest');
  if (!spine || !manifest) throw new Error('OPF missing <spine> or <manifest>');

  const spineStep = (pkgChildren.indexOf(spine) + 1) * 2; // e.g. 3rd child -> /6

  const hrefById = new Map<string, string>();
  for (const item of elementChildren(manifest)) {
    if (item.localName !== 'item') continue;
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (id && href) hrefById.set(id, href);
  }

  const chapters: SpineChapter[] = [];
  const spineChildren = elementChildren(spine);
  for (let i = 0; i < spineChildren.length; i++) {
    const ref = spineChildren[i];
    if (ref.localName !== 'itemref') continue;
    const idref = ref.getAttribute('idref');
    const href = idref ? hrefById.get(idref) : undefined;
    if (!idref || !href || !/\.x?html?$/i.test(href)) continue;
    const itemrefStep = (i + 1) * 2; // itemref's position within the spine -> /2, /4...
    chapters.push({ chapterId: idref, href, base: `/${spineStep}/${itemrefStep}[${idref}]` });
  }
  if (chapters.length === 0) throw new Error('OPF spine yielded no chapters');
  return chapters;
}

// --- chapter text → IndexEntry[] with real CFIs ---------------------------

function cfiOf(locator: Locator): string {
  return locator.type === 'EPUB' ? locator.cfi : '';
}

/**
 * Walk a chapter's text nodes in document order and emit one entry per token,
 * with a point-CFI at the token's start. `contentType` is a parameter only so the
 * parser-mode check below can run the same walk under both parses.
 */
function chapterEntries(
  xhtml: string,
  chapterId: string,
  base: string,
  contentType: 'application/xhtml+xml' | 'text/html',
): IndexEntry[] {
  const dom = new JSDOM(xhtml, { contentType });
  bindDomGlobals(dom.window);
  const doc = dom.window.document;
  const body = doc.querySelector('body');
  if (!body) throw new Error(`chapter ${chapterId}: no <body>`);

  const entries: IndexEntry[] = [];
  const walker = doc.createTreeWalker(body, dom.window.NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const data = (node as Text).data;
    for (const { word, offset } of tokenize(data)) {
      const range = doc.createRange();
      range.setStart(node, offset);
      range.setEnd(node, offset); // collapsed: a "seek here" point, not a range
      const locator: Locator = { type: 'EPUB', cfi: new EpubCFI(range, base).toString() };
      entries.push({
        word,
        chapterId,
        locator,
        snippet: makeSnippet(data, offset, offset + word.length),
      });
    }
  }
  return entries;
}

/**
 * Ahana's flagged risk, enforced rather than assumed: epub.js parses the spine
 * item as application/xhtml+xml at build time, but the Reader renders it into an
 * HTML-document iframe. If the two parses produce different node trees, the
 * build-time CFI won't resolve at runtime. Generate under both and fail loudly on
 * any divergence instead of shipping silently-wrong hits.
 */
function chapterEntriesChecked(xhtml: string, chapterId: string, base: string): IndexEntry[] {
  const xhtmlEntries = chapterEntries(xhtml, chapterId, base, 'application/xhtml+xml');
  const htmlEntries = chapterEntries(xhtml, chapterId, base, 'text/html');
  const asXhtml = xhtmlEntries.map((e) => cfiOf(e.locator)).join('|');
  const asHtml = htmlEntries.map((e) => cfiOf(e.locator)).join('|');
  if (asXhtml !== asHtml) {
    throw new Error(
      `chapter ${chapterId}: CFI diverges between xhtml and html parse modes — ` +
        `build-time and runtime CFIs would disagree; the extractor must be revisited before indexing this book.`,
    );
  }
  return xhtmlEntries;
}

/**
 * Prototype extractor for ANY local EPUB at `epubPath`: unzips it, locates the OPF
 * via container.xml, and emits one `IndexEntry` per token across all chapters, in
 * reading (spine, then document) order, each carrying a real EPUB CFI locator.
 *
 * Still NODE-ONLY (fs/jszip/jsdom). Production swaps in a server-fetch extractor
 * behind this same `Extractor` seam; the caller (`createPrototypeBuildIndex`) does
 * not change.
 */
export function createEpubExtractor(epubPath: string): Extractor {
  return {
    async extract(_bookId: string): Promise<ExtractedBook> {
      const zip = await JSZip.loadAsync(fs.readFileSync(epubPath));
      const opfPath = await resolveOpfPath(zip);
      const opfXml = await zip.file(opfPath)?.async('string');
      if (!opfXml) throw new Error(`EPUB is missing its OPF at ${opfPath}`);
      const opfDir = opfDirOf(opfPath);

      const entries: IndexEntry[] = [];
      for (const { chapterId, href, base } of readSpine(opfXml)) {
        const xhtml = await zip.file(resolveZipPath(opfDir, href))?.async('string');
        if (!xhtml) continue;
        entries.push(...chapterEntriesChecked(xhtml, chapterId, base));
      }

      if (entries.length === 0) throw new Error(`EPUB ${epubPath} yielded no entries`);
      return { format: 'EPUB', entries };
    },
  };
}

/** The sample-EPUB extractor the Day-4 tests build against. */
export const epubSampleExtractor: Extractor = createEpubExtractor(SAMPLE_EPUB);
