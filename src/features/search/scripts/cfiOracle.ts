// Owner: Search (Vaishnavi). NODE-ONLY dev/test tool — not shipped, not imported by app entry.
//
// STRATEGY A — the CFI conformance ORACLE.
//
// wokay's backend is Java Spring Boot and will reimplement the index builder in Java. The one
// genuinely hard part is EPUB CFI generation: the CFIs the Java builder mints MUST be byte-for-byte
// identical to the ones this repo's epub.js-under-jsdom extractor produces, or they will not resolve
// in the client's epub.js at read time (search finds hits, tapping navigates nowhere).
//
// This script freezes the epub.js output as a GOLDEN FIXTURE. The Java builder runs against the same
// EPUB and diffs its output against the golden line-for-line. The golden is the spec-by-example; this
// extractor is the reference implementation, used at TEST TIME only (it never runs in wokay's stack,
// so their "no Node in production" constraint is untouched).
//
//   npx tsx src/features/search/scripts/cfiOracle.ts "<path-to.epub>" "<bookId>" ["<out.jsonl>"]
//
// Output: one JSON object per line, in READING ORDER (the order the extractor emits tokens):
//   { "seq": <number>, "word": "<normalized>", "chapterId": "<id>", "cfi": "<epubcfi(...)>", "snippet": "<...>" }
//
// Reading order + one token per line is deliberate: the file is a stable, line-diffable artifact, so a
// single CFI divergence surfaces as one changed line at the exact token, not a reshuffled blob.

import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import { createEpubExtractor } from '../extractor';

// Where goldens live. Under search/ (Vaishnavi owns it), NOT samples/ (Ahana's).
const CONFORMANCE_DIR = resolve(__dirname, '../conformance');

interface GoldenLine {
  seq: number | null;
  word: string;
  chapterId: string;
  cfi: string;
  snippet: string;
}

async function main(): Promise<void> {
  const epubPath = (process.argv[2] ?? '').trim(); // trim: drag-and-drop often prepends a space
  const bookId = (process.argv[3] ?? '').trim();
  if (!epubPath || !bookId) {
    console.error(
      'usage: npx tsx src/features/search/scripts/cfiOracle.ts "<path-to.epub>" "<bookId>" ["<out.jsonl>"]',
    );
    process.exit(1);
  }

  const outPath =
    (process.argv[4] ?? '').trim() ||
    join(CONFORMANCE_DIR, `${basename(epubPath).replace(/\.epub$/i, '')}.cfi-golden.jsonl`);

  console.log(`\nCFI oracle — reference build for: ${epubPath}`);
  const { format, entries } = await createEpubExtractor(epubPath).extract(bookId);

  if (format !== 'EPUB') {
    // This oracle is EPUB-only on purpose: PDF locators (page + offset) carry no CFI, so they are
    // trivial for Java to reproduce and need no golden. The risk this de-risks is CFIs alone.
    throw new Error(`cfiOracle: expected an EPUB, got ${format} — PDF needs no CFI golden`);
  }

  // Fixed key order so the JSONL is byte-stable across runs (JSON.stringify preserves insertion
  // order for string keys). Entries already arrive in reading order — do NOT sort.
  const lines: GoldenLine[] = entries.map((e) => ({
    seq: e.seq ?? null,
    word: e.word,
    chapterId: e.chapterId,
    cfi: e.locator.type === 'EPUB' ? e.locator.cfi : '',
    snippet: e.snippet,
  }));

  const bad = lines.find((l) => !l.cfi.startsWith('epubcfi('));
  if (bad) {
    throw new Error(
      `cfiOracle: token "${bad.word}" (${bad.chapterId}) produced a non-CFI locator — the extractor is not emitting EPUB CFIs`,
    );
  }

  mkdirSync(dirname(outPath), { recursive: true });
  const body = lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
  writeFileSync(outPath, body, 'utf8');

  const distinctWords = new Set(lines.map((l) => l.word)).size;
  console.log(`  tokens (postings): ${lines.length}`);
  console.log(`  distinct words:    ${distinctWords}`);
  console.log(`  wrote golden:      ${outPath}`);
  console.log('\n  first 3 lines (Java must reproduce these exactly):');
  lines.slice(0, 3).forEach((l) => console.log(`    ${JSON.stringify(l)}`));
  console.log('');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
