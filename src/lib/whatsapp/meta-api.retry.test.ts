import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MetaApiError, sendTextMessage, getMediaUrl } from './meta-api';

// §8/§16 Phase 8 hardening: retry-on-transient-failure + classified
// errors. Fake timers keep these tests instant despite the real
// exponential-backoff `setTimeout` calls inside `metaFetch`.

const BASE_ARGS = {
  phoneNumberId: 'test-phone',
  accessToken: 'test-token',
  to: '1234567890',
  text: 'Hello',
} as const;

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

function jsonResponseWithRetryAfter(
  body: unknown,
  status: number,
  retryAfter: string
): Response {
  return {
    ok: false,
    status,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'retry-after' ? retryAfter : null,
    },
    json: async () => body,
  } as unknown as Response;
}

describe('metaFetch retry behavior (via sendTextMessage)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('succeeds on the first try with exactly one fetch call', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ messages: [{ id: 'wamid.OK' }] })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendTextMessage(BASE_ARGS);

    expect(result).toEqual({ messageId: 'wamid.OK' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a 429 with backoff and succeeds on the second attempt', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ error: { message: 'rate limited' } }, 429)
      )
      .mockResolvedValueOnce(
        jsonResponse({ messages: [{ id: 'wamid.RETRIED' }] })
      );
    vi.stubGlobal('fetch', fetchMock);

    const promise = sendTextMessage(BASE_ARGS);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({ messageId: 'wamid.RETRIED' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a 500 and eventually throws a retryable MetaApiError after exhausting attempts', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        { error: { message: 'internal error', code: 1, type: 'server' } },
        500
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const promise = sendTextMessage(BASE_ARGS);
    const assertion = expect(promise).rejects.toMatchObject({
      name: 'MetaApiError',
      httpStatus: 500,
      isRetryable: true,
    });
    await vi.runAllTimersAsync();
    await assertion;

    // Initial attempt + META_MAX_RETRIES(2) retries = 3 total calls.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('honors the Retry-After header instead of the default backoff delay', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponseWithRetryAfter(
          { error: { message: 'rate limited' } },
          429,
          '2'
        )
      )
      .mockResolvedValueOnce(
        jsonResponse({ messages: [{ id: 'wamid.AFTER_WAIT' }] })
      );
    vi.stubGlobal('fetch', fetchMock);

    const promise = sendTextMessage(BASE_ARGS);
    // Only 1.9s elapsed — the 2s Retry-After hasn't fired yet, so the
    // second attempt must not have gone out.
    await vi.advanceTimersByTimeAsync(1900);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(200);
    const result = await promise;
    expect(result).toEqual({ messageId: 'wamid.AFTER_WAIT' });
  });

  it('does NOT retry a non-retryable 400 — fails fast with a classified error', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          error: {
            message: 'Invalid recipient',
            code: 131026,
            type: 'OAuthException',
          },
        },
        400
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendTextMessage(BASE_ARGS)).rejects.toMatchObject({
      name: 'MetaApiError',
      httpStatus: 400,
      code: 131026,
      type: 'OAuthException',
      isRetryable: false,
      message: 'Invalid recipient',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a network-level fetch() rejection (DNS/timeout) same as a 5xx', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND'))
      .mockResolvedValueOnce(
        jsonResponse({ messages: [{ id: 'wamid.AFTER_NETWORK_ERR' }] })
      );
    vi.stubGlobal('fetch', fetchMock);

    const promise = sendTextMessage(BASE_ARGS);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({ messageId: 'wamid.AFTER_NETWORK_ERR' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('applies the same retry/classification path to getMediaUrl (media-retrieval hot path)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'busy' } }, 503))
      .mockResolvedValueOnce(
        jsonResponse({
          url: 'https://cdn/x',
          mime_type: 'image/jpeg',
          file_size: 100,
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    const promise = getMediaUrl({ mediaId: 'media-1', accessToken: 'tok' });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({
      url: 'https://cdn/x',
      mimeType: 'image/jpeg',
      fileSize: 100,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('MetaApiError', () => {
  it('is a real Error subclass carrying Meta-specific fields', () => {
    const err = new MetaApiError('boom', {
      httpStatus: 429,
      isRetryable: true,
      retryAfterSeconds: 5,
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('MetaApiError');
    expect(err.httpStatus).toBe(429);
    expect(err.isRetryable).toBe(true);
    expect(err.retryAfterSeconds).toBe(5);
  });
});
