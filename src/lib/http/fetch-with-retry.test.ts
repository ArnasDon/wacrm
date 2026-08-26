import { afterEach, describe, expect, it, vi } from 'vitest';
import { postJsonWithRetry } from './fetch-with-retry';

function bareGatewayError(status = 502) {
  return new Response('<html>Bad Gateway</html>', {
    status,
    headers: { 'content-type': 'text/html' },
  });
}

function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, { status });
}

describe('postJsonWithRetry', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns immediately on a successful JSON response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true }));
    vi.stubGlobal('fetch', fetchMock);

    const { res, payload } = await postJsonWithRetry('/api/x', { a: 1 });

    expect(res.ok).toBe(true);
    expect(payload).toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns immediately on a real application error with a JSON body, without retrying', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: 'Template not approved' }, 400));
    vi.stubGlobal('fetch', fetchMock);

    const { res, payload } = await postJsonWithRetry('/api/x', {});

    expect(res.status).toBe(400);
    expect(payload).toEqual({ error: 'Template not approved' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a bare gateway error (no JSON body) and succeeds on a later attempt', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(bareGatewayError())
      .mockResolvedValueOnce(jsonResponse({ success: true }));
    vi.stubGlobal('fetch', fetchMock);

    const promise = postJsonWithRetry('/api/x', {}, { baseDelayMs: 1 });
    const { res, payload } = await promise;

    expect(res.ok).toBe(true);
    expect(payload).toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after exhausting retries and returns the last bare error with an empty payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue(bareGatewayError());
    vi.stubGlobal('fetch', fetchMock);

    const { res, payload } = await postJsonWithRetry(
      '/api/x',
      {},
      { retries: 2, baseDelayMs: 1 }
    );

    expect(res.status).toBe(502);
    expect(payload).toEqual({});
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries a network-level fetch failure and succeeds on a later attempt', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse({ success: true }));
    vi.stubGlobal('fetch', fetchMock);

    const { res, payload } = await postJsonWithRetry('/api/x', {}, { baseDelayMs: 1 });

    expect(res.ok).toBe(true);
    expect(payload).toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting retries on a persistent network failure', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      postJsonWithRetry('/api/x', {}, { retries: 1, baseDelayMs: 1 })
    ).rejects.toThrow('Failed to fetch');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
