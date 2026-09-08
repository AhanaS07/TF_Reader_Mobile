/**
 * @jest-environment jsdom
 */
// Owner: Reader (Ahana).
//
// >>> THE TEST THAT WOULD HAVE CAUGHT AN INVISIBLE FEATURE IN SECONDS. <<<
// A search match is anchored by a CFI that ONE piece of code mints (`search/extractor.ts`, offline,
// into the index) and ANOTHER has to recognise (`epub.entry.ts`, at runtime, against the chapter
// epub.js has loaded). Nothing typechecks that agreement, and neither side can be tested into
// correctness on its own: a fixture written by hand is written from the same assumption the code
// makes, so it agrees with the bug.
//
// It did. `cfiHasBase` compared `contents.cfiBase` as a string, the unit test next door asserted the
// exact mismatch as correct behaviour, and the feature painted nothing on a device with no error and
// no notice — because the two producers spell the same chapter differently:
//
//   search/extractor.ts  ->  /6/2[ch1]   `/${spineStep}/${itemrefStep}[${idref}]`
//   epub.js at runtime   ->  /6/2        spine.js:59 passes the <itemref>'s `id` ATTRIBUTE, not its
//                                        `idref`, and this book's itemrefs have no `id`
//
// So this file runs BOTH producers for real — epub.js's own `Packaging` and `Spine` over the shipped
// sample EPUB, against the shipped index — and asserts they land on the same spine position. No
// browser and no simulator: `Spine.unpack` is pure parsing, which is exactly why this is cheap
// enough to be a unit test and was worth writing instead of another hand-made fixture.

import * as fs from 'fs';
import * as path from 'path';
import { TextDecoder, TextEncoder } from 'util';
import JSZip from 'jszip';

import { cfiSpinePos } from '@/features/reader/webview/src/epubCfiRange';

// BEFORE epub.js is required, and not optional. Its `utils/core.js` touches the global `URL` at
// import time; under jest-expo that getter lazily builds `whatwg-url-minimum`, which needs
// TextEncoder/TextDecoder — and jsdom ships neither. Node's own are drop-in.
const globals = globalThis as unknown as Record<string, unknown>;
globals.TextEncoder ??= TextEncoder;
globals.TextDecoder ??= TextDecoder;

const ASSETS = path.join(__dirname, '../../../assets/reader');

interface RuntimeSection {
  idref: string;
  index: number;
  cfiBase: string;
}

/** The spine as epub.js itself builds it — the source `Contents.sectionIndex` and `cfiBase` come
 * from (`iframe.js` passes `section.index` and `section.cfiBase` straight into `Contents`). */
async function runtimeSpine(): Promise<RuntimeSection[]> {
  const zip = await JSZip.loadAsync(fs.readFileSync(path.join(ASSETS, 'sample-plaintext.epub')));
  const container = await zip.file('META-INF/container.xml')!.async('string');
  const opfPath = /full-path="([^"]+)"/.exec(container)![1];
  const opfXml = await zip.file(opfPath)!.async('string');

  // epub.js's internals, reached directly and LAZILY — the polyfill above has to be in place first,
  // and a top-level import would run before it. Opening a real `Book` needs `URL.createObjectURL`,
  // which jsdom does not implement; `Packaging` + `Spine` are the two objects that actually decide a
  // section's identity, and they need only a parsed OPF. `require` for the same reason
  // `search/extractor.ts` uses it: these paths ship no colocated types.
  /* eslint-disable @typescript-eslint/no-require-imports */
  const Packaging = require('epubjs/lib/packaging').default;
  const Spine = require('epubjs/lib/spine').default;
  /* eslint-enable @typescript-eslint/no-require-imports */

  const doc = new DOMParser().parseFromString(opfXml, 'application/xml');
  const spine = new Spine();
  // Identity resolvers: nothing here resolves a href, and passing real ones would only pull in
  // epub.js's URL handling, which is what makes opening a whole Book impossible under jsdom.
  spine.unpack(new Packaging().parse(doc), (p: string) => p, (p: string) => p);

  const sections: RuntimeSection[] = [];
  spine.each((s: RuntimeSection) => sections.push({ idref: s.idref, index: s.index, cfiBase: s.cfiBase }));
  return sections;
}

interface Posting {
  chapterId: string;
  locator: { type: string; cfi?: string };
}

function indexPostings(): Posting[] {
  const raw = JSON.parse(
    fs.readFileSync(path.join(ASSETS, 'sample-search-index.json'), 'utf8'),
  ) as { index: Record<string, Posting[]> };
  return Object.values(raw.index).flat();
}

describe('the search index and epub.js agree on which chapter a CFI names', () => {
  it('resolves every indexed CFI to the spine position epub.js gives that chapter', async () => {
    // THE ASSERTION THAT WAS MISSING. Both sides computed independently, compared on the number the
    // reader actually branches on (`contents.sectionIndex`), over every posting in the real index.
    const sections = await runtimeSpine();
    const indexByIdref = new Map(sections.map((s) => [s.idref, s.index]));
    const postings = indexPostings().filter((p) => p.locator.type === 'EPUB');

    expect(postings.length).toBeGreaterThan(0);
    const mismatches = postings.filter(
      (p) => cfiSpinePos(p.locator.cfi ?? '') !== indexByIdref.get(p.chapterId),
    );

    expect(
      mismatches.slice(0, 3).map((p) => ({
        chapterId: p.chapterId,
        cfi: p.locator.cfi,
        got: cfiSpinePos(p.locator.cfi ?? ''),
        want: indexByIdref.get(p.chapterId),
      })),
    ).toEqual([]);
  });

  it("epub.js's cfiBase is BARE, and the index's CFIs are not — the divergence, pinned", async () => {
    // Recorded as a fact rather than left to be rediscovered. If this ever starts failing because
    // epub.js began emitting assertions, the reader does not need changing — `cfiSpinePos` ignores
    // them either way. It fails to stop someone "fixing" the extractor to match a base format that
    // was never the thing being compared.
    const sections = await runtimeSpine();
    expect(sections.map((s) => s.cfiBase)).toEqual(['/6/2', '/6/4', '/6/6']);

    const withAssertion = indexPostings().filter((p) => /\[[^\]]+\]!/.test(p.locator.cfi ?? ''));
    expect(withAssertion.length).toBeGreaterThan(0);
  });

  it('every chapter in the index exists in the spine', async () => {
    // A `chapterId` the spine does not know would make the first test vacuous for those postings
    // (both sides `undefined`), so the comparison needs this underneath it.
    const sections = await runtimeSpine();
    const idrefs = new Set(sections.map((s) => s.idref));
    const chapters = new Set(indexPostings().map((p) => p.chapterId));

    expect([...chapters].filter((c) => !idrefs.has(c))).toEqual([]);
  });
});
