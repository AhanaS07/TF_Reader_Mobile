// Real end-to-end test of downloadBook() against a REAL running mock-backend (mock-backend/,
// gitignored, Abhinav's own throwaway dev server) — no mocked readingSessionClient, no mocked
// chunkedAssetFetcher. Same philosophy as syncEngine.integration.test.ts: no health-check skip.
// If the mock backend isn't running on :4000, the failure IS the useful signal, not something to
// swallow into a green suite.
//
// PREREQUISITE — run in another terminal before this file, once per boot of the mock backend:
//   cd mock-backend && npm install && node fixtures/genFixtures.js && npm start
//
// Run with: npm run test:integration:download
//
// global.fetch is swapped for a plain node:http client BEFORE anything else runs, for the exact
// reason syncEngine.integration.test.ts's own header explains: jest-expo's `fetch` talks to RN's
// native XHR bridge, which doesn't exist under Jest and resolves every call with `status:
// undefined` regardless of what a real server returned. readingSessionClient.ts and
// chunkedAssetFetcher.ts both read `fetch` off the global at call time, so swapping it here is
// enough — no change to either file.
//
// Crypto stays on the SAME mocks every other test in this repo uses (__mocks__/react-native-aes-
// gcm-crypto.js, __mocks__/react-native-quick-crypto.js) — both are real Node `crypto` under the
// hood (genuine AES-256-GCM, genuine RSA-OAEP-256), so this exercises the actual wrap/unwrap and
// decrypt math, not a fake. mock-backend/routes/readingSessions.js wraps its fixed test BEK under
// THIS device's real, freshly-generated public key on every request (see that file's
// wrapBekForDevice) — the same way a real backend would — so unwrapBek() here is doing real work,
// not skipped.
//
// This is the ONE test in the repo that exercises a REAL, structurally-valid PDF end to end:
// mock-backend/fixtures/genFixtures.js encrypts `assets/test-15mb.pdf` (repo root) into
// sample.pdf.enc, ~15 MiB, so this also proves chunkedAssetFetcher.ts's 1 MiB chunking loop
// against a real multi-chunk transfer, not the single-chunk placeholder buffers every unit test
// uses. If `assets/test-15mb.pdf` is ever replaced, re-run genFixtures.js before this test.
import * as http from 'node:http';
import * as https from 'node:https';

import { downloadBook } from './downloadManager';
import { getBook, closeBook } from '../encryption/contentProvider';
import { contentStore } from '../encryption/contentStore';
import { downloadTable } from '../sync/stores/downloadStore';
import { USER_ID } from '../sync/syncConfig';

function nodeFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === 'https:' ? https : http;
    const req = transport.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: init.method ?? 'GET',
        headers: init.headers as Record<string, string>,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          const headers = new Headers();
          for (const [key, value] of Object.entries(res.headers)) {
            if (typeof value === 'string') headers.set(key, value);
          }
          resolve(
            new Response(body.length ? body : null, {
              status: res.statusCode ?? 0,
              statusText: res.statusMessage ?? '',
              headers,
            }),
          );
        });
      },
    );

    req.on('error', reject);

    const signal = init.signal;
    if (signal) {
      if (signal.aborted) {
        req.destroy();
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      signal.addEventListener('abort', () => req.destroy(new DOMException('Aborted', 'AbortError')));
    }

    if (typeof init.body === 'string') req.write(init.body);
    req.end();
  });
}

const originalFetch = global.fetch;
beforeAll(() => {
  global.fetch = nodeFetch as typeof fetch;
});
afterAll(() => {
  global.fetch = originalFetch;
});

// Chunked over ~15 MiB in 1 MiB slices, all against localhost — should be seconds, not minutes,
// but a cold `npm run test:integration:download` also pays Jest/ts-jest transform startup cost.
jest.setTimeout(60000);

// Fixed, dedicated id so repeated runs against the same live mock-backend process hit the SAME
// (idempotent) loan rather than piling up loanStore.js rows — see mock-backend/routes/loans.js's
// own "borrow is idempotent" comment. Distinct from any other test's book id so a stray leftover
// download row from a different suite can never make this one see BOOK_LIMIT_REACHED.
const PDF_BOOK_ID = 'integration-test-pdf-15mb';

afterAll(async () => {
  await closeBook(PDF_BOOK_ID);
  await contentStore.destroy(PDF_BOOK_ID);
});

describe('downloadBook (real mock-backend, real PDF)', () => {
  it('downloads, decrypts and stores the real 15MB test PDF', async () => {
    await downloadBook(PDF_BOOK_ID, 'PDF');

    // Proves the download actually persisted, not just resolved without throwing.
    const rows = await downloadTable.listActive(USER_ID);
    const row = rows.find((r) => r.book_id === PDF_BOOK_ID);
    expect(row).toBeDefined();
    expect(row?.status).toBe('COMPLETED');

    // Proves the whole chain — chunked fetch, RSA-OAEP unwrap, AES-256-GCM decrypt with tag
    // verification — produced back the EXACT original plaintext, not just "some bytes".
    const bytes = await getBook(PDF_BOOK_ID);
    expect(bytes.length).toBe(15368312); // assets/test-15mb.pdf's real, uncompressed size

    // A real PDF starts with the "%PDF-" magic header — confirms this is genuinely the source
    // file after a full encrypt-by-the-mock/decrypt-by-the-app round trip, not coincidentally
    // right-length garbage.
    const header = Buffer.from(bytes.slice(0, 5)).toString('ascii');
    expect(header).toBe('%PDF-');
  });
});
