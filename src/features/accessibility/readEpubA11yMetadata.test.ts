// Owner: Accessibility (Hruthik).
//
// Integration coverage for the container.xml → OPF half (Day-3 fixture cases 27-29). Those
// three cannot be tested with an XML string: the point is that the OPF path is DISCOVERED,
// and a bare string has no container to discover it from.
//
// Archives are built in memory with jszip (already a devDependency, and the same library
// generateSampleEpub.ts uses) and never written to disk. Nothing is downloaded — the whole
// suite is bytes authored in this repo, which is the offline requirement demonstrated rather
// than asserted.

import JSZip from 'jszip';

import {
  hasNoDeclaredA11yMetadata,
  resolveHazardDeclaration,
} from '@/features/accessibility/publicationA11y';
import {
  CONTAINER_PATH,
  type EpubEntryReader,
  readEpubA11yMetadata,
  resolveOpfPath,
} from '@/features/accessibility/readEpubA11yMetadata';
import {
  FULLY_POPULATED_METADATA,
  containerDocument,
  packageDocument,
} from '@/features/accessibility/__fixtures__/opfFixtures';

/** Builds a real EPUB archive and returns a reader over it. */
async function epubReader(entries: Record<string, string>): Promise<EpubEntryReader> {
  const zip = new JSZip();
  // mimetype first and STORED, as OCF requires. Not load-bearing for this parser, but a
  // fixture that is not a valid EPUB proves less than one that is.
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  for (const [path, content] of Object.entries(entries)) {
    zip.file(path, content);
  }

  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const reopened = await JSZip.loadAsync(bytes);

  return async (path) => {
    const entry = reopened.file(path);
    return entry ? entry.async('string') : null;
  };
}

describe('resolveOpfPath', () => {
  it('reads the rootfile full-path rather than assuming a location', () => {
    expect(resolveOpfPath(containerDocument('OEBPS/content.opf'))).toBe('OEBPS/content.opf');
    expect(resolveOpfPath(containerDocument('EPUB/package.opf'))).toBe('EPUB/package.opf');
    expect(resolveOpfPath(containerDocument('book.opf'))).toBe('book.opf');
    expect(resolveOpfPath(containerDocument('a/deeply/nested/path/pkg.opf'))).toBe(
      'a/deeply/nested/path/pkg.opf',
    );
  });

  it('prefers the rootfile declaring the OPF media type', () => {
    const container = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="other/thing.xml" media-type="application/something-else"/>
    <rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

    expect(resolveOpfPath(container)).toBe('EPUB/package.opf');
  });

  it('falls back to the only rootfile when its media-type is wrong', () => {
    const container = `<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="EPUB/package.opf" media-type="text/xml"/></rootfiles>
</container>`;

    // Spec-wrong, but the path is still the only package document on offer, and refusing to
    // read a book's metadata over a producer's typo helps nobody.
    expect(resolveOpfPath(container)).toBe('EPUB/package.opf');
  });

  it('strips a leading slash from an absolute full-path', () => {
    expect(resolveOpfPath(containerDocument('/OEBPS/content.opf'))).toBe('OEBPS/content.opf');
  });

  it('returns null rather than throwing for every unusable container', () => {
    const unusable = [
      '',
      'not xml',
      '<container><rootfiles/></container>',
      '<container><rootfiles><rootfile media-type="application/oebps-package+xml"/></rootfiles></container>',
      '<container><rootfiles><rootfile full-path="" media-type="application/oebps-package+xml"/></rootfiles></container>',
      '<container><rootfiles><rootfile full-path="a.opf"</rootfiles></container>',
      '<package><metadata/></package>',
    ];

    for (const source of unusable) {
      expect(() => resolveOpfPath(source)).not.toThrow();
      expect(resolveOpfPath(source)).toBeNull();
    }
  });
});

describe('readEpubA11yMetadata — full flow (case 27)', () => {
  it('walks container.xml to the OPF and returns normalized metadata', async () => {
    const readEntry = await epubReader({
      [CONTAINER_PATH]: containerDocument('OEBPS/content.opf'),
      'OEBPS/content.opf': packageDocument(FULLY_POPULATED_METADATA),
    });

    const result = await readEpubA11yMetadata(readEntry);

    // Identical to the unit suite's case-11 expectation. The two must not be able to drift.
    expect(result).toEqual({
      accessModes: ['textual', 'visual'],
      accessModesSufficient: [['textual'], ['textual', 'visual']],
      accessibilityFeatures: ['alternativeText', 'structuralNavigation', 'MathML'],
      accessibilityHazards: ['noFlashingHazard', 'noSoundHazard'],
      accessibilitySummary: 'This publication conforms to WCAG 2.2 Level AA.',
      conformsTo: [
        'EPUB Accessibility 1.2 - WCAG 2.2 Level AA',
        'http://www.idpf.org/epub/a11y/accessibility-20170105.html#wcag-aa',
      ],
      issues: [],
    });
    expect(resolveHazardDeclaration(result.accessibilityHazards)).toBe('none-declared');
  });

  it('finds an OPF at a non-standard path (case 29)', async () => {
    // The reason the path must never be hard-coded. `OEBPS/content.opf` is a convention;
    // this layout is just as legal and is what several real producers emit.
    const readEntry = await epubReader({
      [CONTAINER_PATH]: containerDocument('content/text/book.opf'),
      'content/text/book.opf': packageDocument(
        '    <meta property="schema:accessibilityFeature">alternativeText</meta>',
      ),
    });

    const result = await readEpubA11yMetadata(readEntry);

    expect(result.accessibilityFeatures).toEqual(['alternativeText']);
    expect(result.issues).toEqual([]);
  });

  it('passes the UI language through to summary selection', async () => {
    const readEntry = await epubReader({
      [CONTAINER_PATH]: containerDocument('EPUB/package.opf'),
      'EPUB/package.opf': packageDocument(`    <meta property="schema:accessibilitySummary" xml:lang="fr">Résumé.</meta>
    <meta property="schema:accessibilitySummary" xml:lang="en">Summary.</meta>`),
    });

    expect((await readEpubA11yMetadata(readEntry, { uiLanguage: 'fr-CA' })).accessibilitySummary).toBe(
      'Résumé.',
    );
    expect((await readEpubA11yMetadata(readEntry, { uiLanguage: 'en' })).accessibilitySummary).toBe(
      'Summary.',
    );
  });

  it('returns the empty state for a real EPUB with no accessibility metadata (case 28)', async () => {
    // The likely majority case in a real library (Day-3 open item V2). An empty state, not
    // an error, and above all not a fabricated "no hazards".
    const readEntry = await epubReader({
      [CONTAINER_PATH]: containerDocument('OEBPS/content.opf'),
      'OEBPS/content.opf': packageDocument(''),
    });

    const result = await readEpubA11yMetadata(readEntry);

    expect(hasNoDeclaredA11yMetadata(result)).toBe(true);
    expect(result.issues).toEqual([]);
    expect(resolveHazardDeclaration(result.accessibilityHazards)).toBe('not-provided');
  });
});

describe('readEpubA11yMetadata — failure containment (risk R8)', () => {
  it('reports a missing container.xml without throwing', async () => {
    const readEntry = await epubReader({
      'OEBPS/content.opf': packageDocument(''),
    });

    const result = await readEpubA11yMetadata(readEntry);

    expect(result.issues).toEqual([
      { code: 'malformed-xml', value: `missing or unreadable ${CONTAINER_PATH}` },
    ]);
  });

  it('reports a container.xml with no usable rootfile', async () => {
    const readEntry = await epubReader({
      [CONTAINER_PATH]: '<container><rootfiles/></container>',
    });

    const result = await readEpubA11yMetadata(readEntry);

    expect(result.issues).toEqual([
      { code: 'malformed-xml', value: `no rootfile in ${CONTAINER_PATH}` },
    ]);
  });

  it('reports an OPF the container points at but the archive does not contain', async () => {
    const readEntry = await epubReader({
      [CONTAINER_PATH]: containerDocument('EPUB/missing.opf'),
    });

    const result = await readEpubA11yMetadata(readEntry);

    expect(result.issues).toEqual([
      { code: 'malformed-xml', value: 'missing or unreadable EPUB/missing.opf' },
    ]);
  });

  it('contains a rejecting reader instead of propagating it', async () => {
    const exploding: EpubEntryReader = () => Promise.reject(new Error('decrypt failed'));

    // An I/O fault reaching a caller that only asked for metadata would take down whatever
    // it was doing. A book with unreadable accessibility metadata is still a book.
    await expect(readEpubA11yMetadata(exploding)).resolves.toEqual({
      accessModes: [],
      accessModesSufficient: [],
      accessibilityFeatures: [],
      accessibilityHazards: [],
      conformsTo: [],
      issues: [{ code: 'malformed-xml', value: `missing or unreadable ${CONTAINER_PATH}` }],
    });
  });

  it('reads only the two entries it needs', async () => {
    const seen: string[] = [];
    const entries: Record<string, string> = {
      [CONTAINER_PATH]: containerDocument('EPUB/package.opf'),
      'EPUB/package.opf': packageDocument(''),
      'EPUB/ch1.xhtml': '<html/>',
    };
    const readEntry: EpubEntryReader = (path) => {
      seen.push(path);
      return Promise.resolve(entries[path] ?? null);
    };

    await readEpubA11yMetadata(readEntry);

    // Bounds the cost: no chapter walk, no manifest crawl, no unzipping the whole book to
    // answer a metadata question.
    expect(seen).toEqual([CONTAINER_PATH, 'EPUB/package.opf']);
  });
});
