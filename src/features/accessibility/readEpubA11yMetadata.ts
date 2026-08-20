// Owner: Accessibility (Hruthik).
//
// EPUB container  ──▶  META-INF/container.xml  ──▶  rootfile  ──▶  OPF  ──▶  metadata.
//
// THE OPF PATH IS ALWAYS DISCOVERED FROM container.xml. Never hard-coded. `OEBPS/content.opf`
// is a convention, not a rule — real files use `EPUB/package.opf`, `content/book.opf`, or the
// archive root, and OCF's whole point is that container.xml is the one entry whose location
// is fixed. A hard-coded path works on the fixtures and silently returns nothing on a third
// of a real library.
//
// WHY THIS TAKES A READER FUNCTION AND NOT A ZIP.
// The only zip library here is `jszip`, and it is a devDependency — it exists for the
// fixture generator and for inlining into the WebView, not for device code. On device the
// bytes arrive through the ContentProvider seam (readerAssets.ts), decrypted in RAM, and
// what unzips them is Reader's and Download's decision, not Accessibility's.
//
// So this module names what it needs — "give me this entry as text" — and stays out of that
// decision. It also keeps the offline guarantee structural: an EpubEntryReader over an
// in-memory archive has nowhere to make a network call from.

import {
  type PublicationA11yMetadata,
  createEmptyPublicationA11y,
} from '@/features/accessibility/publicationA11y';
import {
  type ParseOpfAccessibilityOptions,
  parseOpfAccessibility,
} from '@/features/accessibility/parseOpfAccessibility';
import { childrenNamed, findElement, readXml } from '@/features/accessibility/miniXml';

/** OCF fixes this one path. Everything else in an EPUB is found by following it. */
export const CONTAINER_PATH = 'META-INF/container.xml';

const OPF_MEDIA_TYPE = 'application/oebps-package+xml';

/**
 * Reads one archive entry as UTF-8 text. Resolves to null when the entry is absent.
 *
 * Paths are container-relative and forward-slashed, exactly as they appear in the zip
 * (`META-INF/container.xml`, `EPUB/package.opf`).
 */
export type EpubEntryReader = (path: string) => Promise<string | null>;

/**
 * The `@full-path` of the package document, or null when container.xml does not yield one.
 *
 * Exported so `container.xml` resolution can be tested without building an archive, and so
 * a future import pass that already resolves the OPF can reuse this instead of repeating it.
 */
export function resolveOpfPath(containerXml: string): string | null {
  const document = readXml(containerXml);
  if (!document.ok || document.root.name !== 'container') return null;

  const rootfiles = findElement(document.root, 'rootfiles');
  if (!rootfiles) return null;

  const candidates = childrenNamed(rootfiles, 'rootfile');

  const withPath = (element: (typeof candidates)[number]): string | null => {
    const path = element.attributes.get('full-path')?.trim();
    if (!path) return null;
    // `full-path` is container-relative. A leading slash is a producer error; stripping it
    // is the difference between finding the OPF and reporting a book as unannotated.
    return path.replace(/^\/+/, '');
  };

  const declared = candidates.find(
    (element) => element.attributes.get('media-type') === OPF_MEDIA_TYPE,
  );
  if (declared) {
    const path = withPath(declared);
    if (path) return path;
  }

  // Fallback for a rootfile whose media-type is missing or misspelled. Spec-wrong, but the
  // path is still the only package document on offer, and refusing to read a book's
  // metadata over a producer's typo helps nobody.
  for (const element of candidates) {
    const path = withPath(element);
    if (path) return path;
  }

  return null;
}

/**
 * Full flow: container.xml → OPF → normalized accessibility metadata.
 *
 * Never throws, never rejects — including when `readEntry` itself fails. A book with
 * unreadable accessibility metadata is still a book, and this must not be able to break an
 * import (Day-3 risk R8). Every failure comes back as an empty model plus a `malformed-xml`
 * issue for the log.
 */
export async function readEpubA11yMetadata(
  readEntry: EpubEntryReader,
  options: ParseOpfAccessibilityOptions = {},
): Promise<PublicationA11yMetadata> {
  const failure = (reason: string): PublicationA11yMetadata => {
    const result = createEmptyPublicationA11y();
    result.issues.push({ code: 'malformed-xml', value: reason });
    return result;
  };

  const containerXml = await readText(readEntry, CONTAINER_PATH);
  if (containerXml === null) return failure(`missing or unreadable ${CONTAINER_PATH}`);

  const opfPath = resolveOpfPath(containerXml);
  if (opfPath === null) return failure(`no rootfile in ${CONTAINER_PATH}`);

  const opfXml = await readText(readEntry, opfPath);
  if (opfXml === null) return failure(`missing or unreadable ${opfPath}`);

  return parseOpfAccessibility(opfXml, options);
}

/**
 * A rejecting reader is treated the same as an absent entry.
 *
 * Swallowing the error is deliberate: the caller's contract is that this cannot fail, and an
 * I/O fault reaching a caller that only asked for metadata would take down whatever it was
 * doing. The reason is preserved in `issues` rather than discarded.
 */
async function readText(readEntry: EpubEntryReader, path: string): Promise<string | null> {
  try {
    return await readEntry(path);
  } catch {
    return null;
  }
}
