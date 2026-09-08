// Owner: Accessibility (Hruthik).
//
// Bridges readEpubA11yMetadata's EpubEntryReader to the real on-device seam: getBook/getFormat
// faked at the contentProvider boundary — its own decrypt/session behavior is
// contentProvider.test.ts's job, not this bridge's. Same boundary queryBookIndex.test.ts mocks
// for the same reason.

import JSZip from 'jszip';

import { getPublicationAccessibility } from './getPublicationAccessibility';
import { hasNoDeclaredA11yMetadata } from './publicationA11y';
import { CONTAINER_PATH } from './readEpubA11yMetadata';
import {
  FULLY_POPULATED_METADATA,
  containerDocument,
  packageDocument,
} from './__fixtures__/opfFixtures';

jest.mock('@/features/encryption/contentProvider', () => ({
  __esModule: true,
  getBook: jest.fn(),
  getFormat: jest.fn(),
}));

const { getBook, getFormat } = jest.requireMock('@/features/encryption/contentProvider') as {
  getBook: jest.Mock;
  getFormat: jest.Mock;
};

/** Builds a real EPUB archive's bytes, the way `getBook` would return them, decrypted. */
async function epubZipBytes(entries: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  // mimetype first and STORED, as OCF requires — a fixture that is not a valid EPUB proves less.
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  for (const [path, content] of Object.entries(entries)) {
    zip.file(path, content);
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

describe('getPublicationAccessibility', () => {
  beforeEach(() => {
    getBook.mockReset();
    getFormat.mockReset();
  });

  it("reads a well-formed EPUB's accessibility metadata", async () => {
    getFormat.mockResolvedValue('EPUB');
    getBook.mockResolvedValue(
      await epubZipBytes({
        [CONTAINER_PATH]: containerDocument('OEBPS/content.opf'),
        'OEBPS/content.opf': packageDocument(FULLY_POPULATED_METADATA),
      }),
    );

    const result = await getPublicationAccessibility('book-1');

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
  });

  it('returns the empty model for PDF/AUDIO without decrypting', async () => {
    getFormat.mockResolvedValue('PDF');

    const result = await getPublicationAccessibility('book-1');

    expect(hasNoDeclaredA11yMetadata(result)).toBe(true);
    expect(result.issues).toEqual([]);
    expect(getBook).not.toHaveBeenCalled();
  });

  it('contains a getBook rejection into an issue instead of throwing', async () => {
    getFormat.mockResolvedValue('EPUB');
    getBook.mockRejectedValue(new Error('decrypt failed'));

    await expect(getPublicationAccessibility('book-1')).resolves.toEqual({
      accessModes: [],
      accessModesSufficient: [],
      accessibilityFeatures: [],
      accessibilityHazards: [],
      conformsTo: [],
      issues: [{ code: 'malformed-xml', value: `missing or unreadable ${CONTAINER_PATH}` }],
    });
  });

  it('decrypts and unzips only once per call, for both entries it reads', async () => {
    getFormat.mockResolvedValue('EPUB');
    getBook.mockResolvedValue(
      await epubZipBytes({
        [CONTAINER_PATH]: containerDocument('OEBPS/content.opf'),
        'OEBPS/content.opf': packageDocument(''),
      }),
    );

    await getPublicationAccessibility('book-1');

    expect(getBook).toHaveBeenCalledTimes(1);
  });
});
