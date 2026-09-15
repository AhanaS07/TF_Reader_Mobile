// Owner: Search (Vaishnavi).
//
// Dev tool (NODE-ONLY, not shipped): build a REAL in-book search index for an arbitrary local book
// and write it out as the plaintext `BookSearchIndex` JSON — the exact wire shape `queryBookIndex`
// parses after `getIndex(bookId)` decrypts. This is the file the backend's ingestion worker would
// normally produce; until that integration lands, this stands in so a demo can show search working
// against a real book.
//
//   npx tsx src/features/search/scripts/buildBookSearchIndex.ts <epub|pdf> "<path-to-book>" <bookId> "<out.json>"
//
// THE bookId ARGUMENT IS LOAD-BEARING, not cosmetic. `queryBookIndex` throws outright when the
// index's bookId is not the one asked for (a guard against handing over the wrong book's ciphertext),
// so this MUST be the exact id the demo book opens under — i.e. whatever id Download/seed serves the
// book with (e.g. `dev-fixture-epub` for the EPUB pushed via EXPO_PUBLIC_READER_FIXTURE_EPUB). A
// beautiful index keyed to the wrong id turns every search into an error, not an empty list.
//
// Unlike `searchEpub.ts`/`searchPdf.ts` (which build in memory and query), this WRITES the index to
// disk so it can be handed to Encryption to encrypt + attach. Uses the same extractor -> buildIndex
// pipeline the app's search does, so what ships is what a real search returns.

import { writeFileSync } from 'node:fs';

import { createEpubExtractor, createPdfExtractor } from '../extractor';
import type { Extractor } from '../extractor';
import { createPrototypeBuildIndex } from '../buildIndex';

async function main(): Promise<void> {
  const format = (process.argv[2] ?? '').trim().toLowerCase();
  const bookPath = (process.argv[3] ?? '').trim(); // trim: drag-and-drop often adds a leading space
  const bookId = (process.argv[4] ?? '').trim();
  const output = (process.argv[5] ?? '').trim();

  if ((format !== 'epub' && format !== 'pdf') || !bookPath || !bookId || !output) {
    console.error(
      'usage: npx tsx src/features/search/scripts/buildBookSearchIndex.ts ' +
        '<epub|pdf> "<path-to-book>" <bookId> "<out.json>"',
    );
    process.exit(1);
  }

  const extractor: Extractor =
    format === 'epub' ? createEpubExtractor(bookPath) : createPdfExtractor(bookPath);

  console.log(`\nBuilding ${format.toUpperCase()} index for: ${bookPath}\n  bookId: ${bookId}`);
  const index = await createPrototypeBuildIndex(extractor)(bookId);

  // Compact, not pretty-printed — this is a payload to be encrypted and shipped, not diffed by eye.
  writeFileSync(output, `${JSON.stringify(index)}\n`);

  const words = Object.keys(index.index).length;
  const postings = Object.values(index.index).reduce((total, list) => total + list.length, 0);
  console.log(`\nWrote ${output}\n  ${words} distinct words, ${postings} postings, format ${index.format}, v${index.version}.\n`);
}

main().catch((error: unknown) => {
  console.error('\nbuildBookSearchIndex failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
