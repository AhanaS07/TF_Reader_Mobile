// Owner: Reader (Ahana).
//
// >>> TEMPORARY, WITH THE SCAFFOLDING IT GUARDS. <<< Delete alongside devContentSeed.ts.
//
// Guards the EXPO_PUBLIC_READER_FIXTURE_PATH x EXPO_PUBLIC_READER_FORMAT crossing, which is
// measurement scaffolding whose failure mode is a PLAUSIBLE WRONG NUMBER rather than an error —
// the most expensive kind to debug, and the reason this is worth a test at all.
//
// THE DEFECT THIS PINS. FIXTURE_PATH used to select the book id outright, so
// `EXPO_PUBLIC_READER_FIXTURE_PATH=<big.pdf> EXPO_PUBLIC_READER_FORMAT=PDF` seeded PDF bytes under
// `format: 'EPUB'`. getFormat() then reported EPUB, readerAssets loaded the epub.js shell, and
// JSZip failed on PDF bytes — i.e. the large-PDF measurement was unreachable, and the symptom
// pointed at the renderer rather than at the two env vars that disagreed. They are two independent
// axes: FIXTURE_PATH picks the SOURCE, DEV_FORMAT picks the FORMAT. Anything that collapses them
// again fails here.
//
// WHY require() RATHER THAN import: both env vars are read at MODULE LOAD (they must be literal
// member accesses so Metro can inline them — see readerTiming.ts's isTimingEnabled), so a static
// import would bind one combination for the whole file. isolateModules + require is the only way to
// exercise the ladder. Mocking is inherited, not declared: real AES-GCM, real file I/O over a temp
// dir, in-memory keychain — same setup as contentStore.test.ts.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { BookId, ContentFormat } from '@/shared/contracts';

interface SeedModule {
  DEV_SAMPLE_BOOK_ID: BookId;
  ensureSeeded: (bookId: BookId) => Promise<void>;
}

interface ProviderModule {
  getFormat: (bookId: BookId) => Promise<ContentFormat>;
}

const FIXTURE_KEY = 'EXPO_PUBLIC_READER_FIXTURE_PATH';
const FORMAT_KEY = 'EXPO_PUBLIC_READER_FORMAT';

// LITERAL member access for the READS, computed keys only for the writes — which is exactly the
// distinction `expo/no-dynamic-env-var` enforces, and it caught this file getting it wrong. A read
// is what Metro's serializer substitutes at bundle time, so a computed read would never be inlined;
// a write is plain runtime mutation and has no such constraint.
const originalFixture = process.env.EXPO_PUBLIC_READER_FIXTURE_PATH;
const originalFormat = process.env.EXPO_PUBLIC_READER_FORMAT;

function restore(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

/**
 * Load devContentSeed, and the provider that reads back what it stored, under one env combination.
 *
 * Both come from the SAME isolated registry deliberately: contentStore holds module-level session
 * and package maps, so a devContentSeed from one registry and a getFormat from another would not be
 * talking about the same store, and the integration cases below would pass vacuously.
 */
function loadWith(env: { fixturePath?: string; format?: string }): {
  seed: SeedModule;
  provider: ProviderModule;
} {
  restore(FIXTURE_KEY, env.fixturePath);
  restore(FORMAT_KEY, env.format);

  let loaded: { seed: SeedModule; provider: ProviderModule } | null = null;
  jest.isolateModules(() => {
    /* eslint-disable @typescript-eslint/no-require-imports -- see the header: env is read at load. */
    loaded = {
      seed: require('@/features/reader/devContentSeed') as SeedModule,
      provider: require('@/features/encryption/contentProvider') as ProviderModule,
    };
    /* eslint-enable @typescript-eslint/no-require-imports */
  });

  if (loaded === null) throw new Error('jest.isolateModules did not run its callback.');
  return loaded;
}

/** A real file on disk for FIXTURE_PATH to point at — the expo-file-system mock is Node fs. */
function writeFixture(name: string, text: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-fixture-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, text);
  return file;
}

afterAll(() => {
  restore(FIXTURE_KEY, originalFixture);
  restore(FORMAT_KEY, originalFormat);
});

describe('DEV_SAMPLE_BOOK_ID crosses source x format', () => {
  // Nothing is seeded in this block, so the path never has to resolve — only the ladder is tested.
  const FIXTURE = '/tmp/does-not-need-to-exist.bin';

  it.each([
    [{}, 'dev-sample-epub'],
    [{ format: 'PDF' }, 'dev-sample-pdf'],
    [{ fixturePath: FIXTURE }, 'dev-fixture-epub'],
    [{ fixturePath: FIXTURE, format: 'PDF' }, 'dev-fixture-pdf'],
  ])('resolves %j to %s', (env, expected) => {
    expect(loadWith(env).seed.DEV_SAMPLE_BOOK_ID).toBe(expected);
  });

  // The property the four ids exist FOR, stated independently of their spellings: ensureSeeded()
  // short-circuits on isAvailableOffline(), so any two combinations sharing an id would serve
  // whichever package was stored first — silently measuring the wrong book, or loading the wrong
  // renderer for it.
  it('gives every combination its own id, so none can be served another package', () => {
    const ids = [
      loadWith({}),
      loadWith({ format: 'PDF' }),
      loadWith({ fixturePath: FIXTURE }),
      loadWith({ fixturePath: FIXTURE, format: 'PDF' }),
    ].map((loaded) => loaded.seed.DEV_SAMPLE_BOOK_ID);

    expect(new Set(ids).size).toBe(ids.length);
  });

  // Guards the exact-match fallback. 'pdf' and 'AUDIO' are the two that would otherwise be silently
  // wrong rather than loudly wrong — AUDIO has no renderer and no fixture at all.
  it.each(['pdf', 'AUDIO', 'EPUB', ''])(
    'falls back to the EPUB fixture for format %j',
    (format) => {
      expect(loadWith({ fixturePath: FIXTURE, format }).seed.DEV_SAMPLE_BOOK_ID).toBe(
        'dev-fixture-epub',
      );
    },
  );
});

describe('the fixture path seeds the format it was asked for', () => {
  // THE CASE THAT WOULD HAVE CAUGHT THE ORIGINAL DEFECT. Asserting the id is not enough: the id
  // matters only because it selects a DevFixture whose `format` becomes the stored package's, and
  // that is the value readerAssets reads back to pick the shell and the open command.
  //
  // The bytes are not a parseable document, deliberately — nothing in this path parses them. store()
  // encrypts whatever it is handed and getFormat() reads persisted metadata, so a real 20 MB PDF
  // would test the same seam more slowly.
  it('stores a large-PDF fixture as PDF, not as EPUB', async () => {
    const fixturePath = writeFixture('big.pdf', '%PDF-1.4\nnot a parseable document\n');
    const { seed, provider } = loadWith({ fixturePath, format: 'PDF' });

    await seed.ensureSeeded(seed.DEV_SAMPLE_BOOK_ID);

    expect(await provider.getFormat(seed.DEV_SAMPLE_BOOK_ID)).toBe('PDF');
  }, 30_000);

  it('still stores an EPUB fixture as EPUB', async () => {
    const fixturePath = writeFixture('big.epub', 'PK not a parseable archive');
    const { seed, provider } = loadWith({ fixturePath });

    await seed.ensureSeeded(seed.DEV_SAMPLE_BOOK_ID);

    expect(await provider.getFormat(seed.DEV_SAMPLE_BOOK_ID)).toBe('EPUB');
  }, 30_000);

  // A fixture id reads from an absolute path, so a missing file must say so here rather than fail
  // later inside a renderer. It names the expected format because pointing FIXTURE_PATH at the
  // wrong-format file is the mistake the crossing above makes newly possible.
  it('names the expected format when the pushed file is missing', async () => {
    const { seed } = loadWith({ fixturePath: '/tmp/tf-reader-no-such-fixture.pdf', format: 'PDF' });

    await expect(seed.ensureSeeded(seed.DEV_SAMPLE_BOOK_ID)).rejects.toThrow(/PDF/);
  }, 30_000);
});
