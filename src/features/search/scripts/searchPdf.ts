// Dev tool (NODE-ONLY, not shipped): build the in-book search index for a local
// PDF and run a query, printing occurrence count + snippets. Uses the same
// extractor → buildIndex → queryIndex pipeline the app's search does, so what you
// see here is what a real search would return — the PDF counterpart of searchEpub.ts.
//
//   npx tsx src/features/search/scripts/searchPdf.ts "<path-to.pdf>" "<term>"
//
// Multi-word terms match as a PHRASE — the words must be side by side, in order,
// within one page (same rule the EPUB side uses within a text node).

import { createPdfExtractor } from '../extractor';
import { createPrototypeBuildIndex } from '../buildIndex';
import { queryIndex } from '../queryIndex';

const MAX_SHOWN = 20;

async function main(): Promise<void> {
  const pdfPath = (process.argv[2] ?? '').trim(); // trim: drag-and-drop often adds a leading space
  const term = process.argv.slice(3).join(' ').trim();
  if (!pdfPath || !term) {
    console.error('usage: npx tsx src/features/search/scripts/searchPdf.ts "<path-to.pdf>" "<term>"');
    process.exit(1);
  }

  console.log(`\nBuilding index for: ${pdfPath}`);
  const buildIndex = createPrototypeBuildIndex(createPdfExtractor(pdfPath));
  const index = await buildIndex('local-pdf');

  const distinctWords = Object.keys(index.index).length;
  const totalPostings = Object.values(index.index).reduce((n, ps) => n + ps.length, 0);
  console.log(`Indexed ${distinctWords} distinct words, ${totalPostings} total word occurrences.\n`);

  const hits = queryIndex(index, term);
  console.log(`Search "${term}"  →  ${hits.length} occurrence(s)\n`);

  hits.slice(0, MAX_SHOWN).forEach((h, i) => {
    const where = h.locator.type === 'PDF' ? `page ${h.locator.page}` : h.locator.cfi;
    console.log(`${String(i + 1).padStart(3)}. [${h.chapterId}]  …${h.snippet}…`);
    console.log(`     ${where}`);
  });
  if (hits.length > MAX_SHOWN) {
    console.log(`\n… and ${hits.length - MAX_SHOWN} more.`);
  }
  console.log('');
}

main().catch((err) => {
  console.error('\nsearchPdf failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
