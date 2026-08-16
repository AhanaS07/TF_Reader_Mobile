// Owner: Reader (Ahana).
//
// >>> TEMPORARY SCAFFOLDING — DELETE WITH devContentSeed.ts. <<<
//
// Generates a real search index for the bundled sample EPUB, so in-book search has
// something to find while it is being developed. Nothing ships an index for the
// dev-seeded book yet (devContentSeed.ts stands in for Download's real pass and does
// not build one), so without this every search in the app correctly returns [] and
// the UI cannot be exercised on a device at all.
//
// SIX THINGS GO TOGETHER WHEN THE REAL DOWNLOAD PASS LANDS. Deleting only some of
// them leaves a dangling script, a stale asset, or a test that fails on a file that
// no longer exists:
//
//   1. this file
//   2. assets/reader/sample-search-index.json          (its output)
//   3. the "reader:build-sample-index" script in package.json
//   4. the index attachment in devContentSeed.ts       (goes with that whole file)
//   5. src/features/reader/devSearchIndex.test.ts      (guards 2 against 4)
//   6. the Temporary scaffolding entry in CLAUDE.md
//
// None of src/features/reader/SearchPanel.tsx, useBookSearch.ts or ReaderScreen.tsx
// is on that list. The search UI does not know this fixture exists, and removing all
// five must leave it compiling and green — on-device searches simply go back to
// returning [] until a real index ships. If deleting the fixture breaks the UI or a
// test, the boundary has leaked and THAT is the bug.
//
// NODE-ONLY, and this is why it is a script rather than app code: it imports Search's
// extractor, which pulls in fs, jszip, jsdom and epubjs. Importing any of that from
// the RN bundle would break Metro. Run it with `npm run reader:build-sample-index`.
//
// The CFIs are GENERATED, not hand-written, deliberately: they have to resolve
// against the live epub.js rendition, and a hand-written `epubcfi(...)` that merely
// looks plausible would fail silently at exactly the point the feature is being
// demonstrated. Search's extractor already generates them the way ingestion will.

import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { createPrototypeBuildIndex } from '@/features/search/buildIndex';
import { epubSampleExtractor } from '@/features/search/extractor';

/**
 * MUST match DEV_SAMPLE_BOOK_ID's non-fixture value in devContentSeed.ts.
 * queryBookIndex throws outright when the index's bookId is not the one asked for —
 * a guard against handing over the wrong book's ciphertext — so a mismatch here turns
 * every search in the app into an error rather than an empty list.
 */
const SAMPLE_BOOK_ID = 'dev-sample-epub';

const OUTPUT = path.join('assets', 'reader', 'sample-search-index.json');

async function main(): Promise<void> {
  const buildIndex = createPrototypeBuildIndex(epubSampleExtractor);
  const index = await buildIndex(SAMPLE_BOOK_ID);

  // Compact, not pretty-printed. This is a bundled asset that gets read, encrypted
  // and shipped inside the app — indentation doubles it for no reader's benefit, and
  // nobody diffs it by eye (it is regenerated, never edited).
  writeFileSync(OUTPUT, `${JSON.stringify(index)}\n`);

  const words = Object.keys(index.index).length;
  const postings = Object.values(index.index).reduce((total, list) => total + list.length, 0);
  console.log(`Wrote ${OUTPUT}: ${words} words, ${postings} postings, format ${index.format}.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
