import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { embedTexts, toVectorLiteral } from './embeddings';
import { AiError } from './types';

function okEmbeddings(count: number, shuffle = false): Response {
  const rows = Array.from({ length: count }, (_, i) => ({
    embedding: [i, i + 0.5],
    index: i,
  }));
  if (shuffle) rows.reverse();
  return {
    ok: true,
    status: 200,
    json: async () => ({ data: rows }),
  } as unknown as Response;
}

beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => vi.unstubAllGlobals());

describe('toVectorLiteral', () => {
  it('formats a pgvector literal', () => {
    expect(toVectorLiteral([0.1, 0.2, 0.3])).toBe('[0.1,0.2,0.3]');
  });
});

describe('embedTexts', () => {
  it('returns [] and makes no request for empty input', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await embedTexts('sk-x', [])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('embeds a single batch and sends the key', async () => {
    const fetchMock = vi.fn(async (_url: string, opts: { body: string }) => {
      const n = JSON.parse(opts.body).input.length;
      return okEmbeddings(n);
    });
    vi.stubGlobal('fetch', fetchMock);

    const out = await embedTexts('sk-x', ['a', 'b', 'c']);
    expect(out).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain('api.openai.com');
    expect(
      (opts as unknown as { headers: Record<string, string> }).headers
        .Authorization
    ).toBe('Bearer sk-x');
  });

  it('splits large inputs into multiple batches', async () => {
    const fetchMock = vi.fn(async (_url: string, opts: { body: string }) => {
      const n = JSON.parse(opts.body).input.length;
      return okEmbeddings(n);
    });
    vi.stubGlobal('fetch', fetchMock);

    const inputs = Array.from({ length: 100 }, (_, i) => `t${i}`);
    const out = await embedTexts('sk-x', inputs);
    expect(out).toHaveLength(100);
    expect(fetchMock).toHaveBeenCalledTimes(2); // 96 + 4
  });

  it('reorders by index when the provider returns them shuffled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, opts: { body: string }) => {
        const n = JSON.parse(opts.body).input.length;
        return okEmbeddings(n, true);
      })
    );
    const out = await embedTexts('sk-x', ['a', 'b', 'c']);
    expect(out[0]).toEqual([0, 0.5]); // index 0 first despite shuffle
    expect(out[2]).toEqual([2, 2.5]);
  });

  it('maps a 401 to an invalid_key AiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: 'bad key' } }),
      } as unknown as Response)
    );
    await expect(embedTexts('sk-x', ['a'])).rejects.toMatchObject({
      code: 'invalid_key',
    });
  });

  it('throws when the provider omits result indices', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ embedding: [0.1] }, { embedding: [0.2] }],
        }),
      } as unknown as Response)
    );
    await expect(embedTexts('sk-x', ['a', 'b'])).rejects.toBeInstanceOf(
      AiError
    );
  });

  it('throws on a malformed response (count mismatch)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      } as unknown as Response)
    );
    await expect(embedTexts('sk-x', ['a', 'b'])).rejects.toBeInstanceOf(
      AiError
    );
  });
});
