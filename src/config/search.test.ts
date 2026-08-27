// src/config/search.test.ts
//
// Mirrors the shape of catalogue.test.ts: one describe per exported function,
// and the same failure-mode priority — a typo'd env var that silently falls
// back to fixtures is the failure that is hardest to notice and ships the most
// quietly wrong build.
import { FixtureSearchPipeline } from '@search/FixtureSearchPipeline';
import {
  createSearchPipeline,
  getSearchPipeline,
  resolveSearchPipelineKind,
  setSearchPipeline,
} from '@config/search';

afterEach(() => {
  // Clear the shared singleton so each test starts with a clean slate.
  setSearchPipeline(undefined);
});

describe('resolveSearchPipelineKind', () => {
  // Unset is explicitly not a mistake while wokay's search endpoint does not exist.
  it('defaults to fixture when the env var is unset', () => {
    expect(resolveSearchPipelineKind(undefined)).toBe('fixture');
  });

  it('defaults to fixture when the env var is an empty string', () => {
    expect(resolveSearchPipelineKind('')).toBe('fixture');
  });

  it('defaults to fixture when the env var is only whitespace', () => {
    expect(resolveSearchPipelineKind('   ')).toBe('fixture');
  });

  it('honours an explicit fixture selection', () => {
    expect(resolveSearchPipelineKind('fixture')).toBe('fixture');
  });

  it('honours an explicit api selection', () => {
    expect(resolveSearchPipelineKind('api')).toBe('api');
  });

  it('ignores case and surrounding whitespace', () => {
    expect(resolveSearchPipelineKind('  API  ')).toBe('api');
    expect(resolveSearchPipelineKind('FIXTURE')).toBe('fixture');
  });

  // A typo'd env var silently falling back to fixtures would produce a build
  // that looks fine but talks to nothing — the failure that is hardest to notice.
  it('rejects an unrecognised value rather than falling back', () => {
    expect(() => resolveSearchPipelineKind('staging')).toThrow(/staging/);
  });
});

describe('createSearchPipeline', () => {
  it('builds a FixtureSearchPipeline for fixture', () => {
    expect(createSearchPipeline({ kind: 'fixture' })).toBeInstanceOf(FixtureSearchPipeline);
  });

  // NOT silently the fixture. Asking for the real endpoint and being handed
  // canned data is the one outcome that would make a green integration test
  // meaningless in Week 4.
  it("throws for api — ApiSearchPipeline does not exist until Week 4", () => {
    expect(() => createSearchPipeline({ kind: 'api' })).toThrow(/api/i);
  });

  it('passes fixture options through so the gallery can inject latency', () => {
    const pipeline = createSearchPipeline({ kind: 'fixture', fixture: { latencyMs: 25 } });
    expect(pipeline).toBeInstanceOf(FixtureSearchPipeline);
  });

  it('returns a pipeline the app can actually call', async () => {
    const pipeline = createSearchPipeline({ kind: 'fixture' });
    const feed = await pipeline.search({
      institutionId: 'inst_7f3',
      query: 'biology',
      filters: {},
    });
    expect(Array.isArray(feed.publications)).toBe(true);
  });
});

describe('getSearchPipeline / setSearchPipeline', () => {
  it('returns a FixtureSearchPipeline by default', () => {
    expect(getSearchPipeline()).toBeInstanceOf(FixtureSearchPipeline);
  });

  it('returns the same instance on repeated calls — singleton', () => {
    expect(getSearchPipeline()).toBe(getSearchPipeline());
  });

  it('setSearchPipeline replaces the shared instance', () => {
    const custom = new FixtureSearchPipeline({ latencyMs: 0 });
    setSearchPipeline(custom);
    expect(getSearchPipeline()).toBe(custom);
  });

  it('setSearchPipeline(undefined) clears the instance so the next call rebuilds', () => {
    const first = getSearchPipeline();
    setSearchPipeline(undefined);
    const second = getSearchPipeline();
    // Both are valid pipelines, but they are not the same object.
    expect(second).toBeInstanceOf(FixtureSearchPipeline);
    expect(second).not.toBe(first);
  });
});
