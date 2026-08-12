// Exercises api.ts's HTTP client logic against a mocked global.fetch — not testing a real
// network call (that's what syncManager's own on-device confirmation is for), but the real
// request-building, timestamp-canonicalization, and error-classification logic in this file.

import { api, ApiError } from './api';

function jsonResponse(body: unknown, init: { status?: number; dateHeader?: string } = {}): Response {
  const headers = new Headers();
  headers.set('date', init.dateHeader ?? new Date().toUTCString());
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
}

describe('api — request/response handling', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('create() sends a POST with the body and returns the parsed data + serverTime', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({ id: '1', offset: 5 }));

    const result = await api.create('progress', { id: '1', offset: 5 });
    expect(result.data).toEqual({ id: '1', offset: 5 });
    expect(typeof result.serverTime).toBe('string');
    expect(new Date(result.serverTime).toISOString()).toBe(result.serverTime);

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ id: '1', offset: 5 });
  });

  it('a non-2xx response throws ApiError carrying the status and parsed body', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({ error: 'nope' }, { status: 409 }));

    await expect(api.create('progress', {})).rejects.toMatchObject({
      status: 409,
      body: { error: 'nope' },
    });
  });

  it('ApiError.isConflict / isNotFound / isValidation / isTransient classify status codes correctly', () => {
    expect(new ApiError('x', 409).isConflict).toBe(true);
    expect(new ApiError('x', 404).isNotFound).toBe(true);
    expect(new ApiError('x', 400).isValidation).toBe(true);
    expect(new ApiError('x', 422).isValidation).toBe(true);
    expect(new ApiError('x', 500).isTransient).toBe(true);
    expect(new ApiError('x', 0).isTransient).toBe(true);
    expect(new ApiError('x', 200).isTransient).toBe(false);
  });

  it('a transport failure (fetch throws) becomes ApiError with status 0', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed'));

    await expect(api.create('progress', {})).rejects.toMatchObject({ status: 0 });
  });

  it('a 204 response resolves with undefined data, not a JSON-parse error', async () => {
    const headers = new Headers();
    headers.set('date', new Date().toUTCString());
    global.fetch = jest.fn().mockResolvedValue(new Response(null, { status: 204, headers }));

    const result = await api.create('progress', {});
    expect(result.data).toBeUndefined();
  });

  it('normalizes Mongo _id to id when the server omits id', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({ _id: 'abc123', offset: 1 }));

    const result = await api.create<{ id: string }>('progress', {});
    expect(result.data.id).toBe('abc123');
  });

  it('truncates microsecond timestamps to millisecond precision (the LWW string-comparison bug this fixes)', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse({ id: '1', updatedAt: '2024-01-01T00:00:00.199801Z' })
    );

    const result = await api.create<{ updatedAt: string }>('progress', {});
    // Without truncation this would stay '...199801Z', which string-sorts AFTER a
    // millisecond-precision '...199Z' value the next GET would return for the same instant.
    expect(result.data.updatedAt).toBe('2024-01-01T00:00:00.199Z');
  });

  it('list() sends includeDeleted=true so tombstones are never dropped from a pull', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse([]));
    await api.list('progress', { userId: 'u1' });

    const [url] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('includeDeleted=true');
    expect(url).toContain('userId=u1');
  });

  it('health() returns true for a reachable server even if the ping itself 404s', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({}, { status: 404 }));
    await expect(api.health()).resolves.toBe(true);
  });

  it('health() returns false when the host is unreachable (transient failure)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
    await expect(api.health()).resolves.toBe(false);
  });
});
