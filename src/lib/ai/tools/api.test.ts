import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn((s: string) => `plain:${s}`),
}));

// Control the SSRF guard per-test, same pattern as deliver.test.ts /
// template-header-handle.test.ts.
vi.mock('@/lib/webhooks/ssrf', () => ({
  isDeliverableUrl: vi.fn(async () => true),
}));

import { runApiTool, type ApiToolRow } from './api';
import { isDeliverableUrl } from '@/lib/webhooks/ssrf';
import { decrypt } from '@/lib/whatsapp/encryption';

function tool(over: Partial<ApiToolRow> = {}): ApiToolRow {
  return {
    api_url: 'https://api.example.com/weather?q={city}&appid={API_KEY}',
    api_method: 'GET',
    api_params: [{ name: 'city', description: 'City name', required: true }],
    api_headers: {},
    api_body: null,
    api_key_encrypted: null,
    ...over,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  vi.mocked(isDeliverableUrl).mockClear();
  vi.mocked(isDeliverableUrl).mockResolvedValue(true);
  vi.mocked(decrypt).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('runApiTool', () => {
  it('substitutes params and the API key into the URL', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ temp: 21 }));
    vi.stubGlobal('fetch', fetchSpy);

    const result = await runApiTool(
      tool({ api_key_encrypted: 'enc-secret' }),
      { city: 'Bogotá' },
    );

    expect(result).toBe(JSON.stringify({ temp: 21 }));
    const [url] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.com/weather?q=Bogotá&appid=plain:enc-secret');
    expect(isDeliverableUrl).toHaveBeenCalledWith(url);
  });

  it('does not follow redirects, so a public URL cannot bounce to an internal one', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal('fetch', fetchSpy);

    await runApiTool(tool(), { city: 'Lima' });

    const init = (fetchSpy.mock.calls[0] as unknown[])[1] as RequestInit;
    expect(init).toMatchObject({ redirect: 'manual' });
  });

  it('refuses a non-public API URL without fetching it', async () => {
    vi.mocked(isDeliverableUrl).mockResolvedValue(false);
    const fetchSpy = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal('fetch', fetchSpy);

    const result = await runApiTool(
      tool({ api_url: 'http://169.254.169.254/latest/meta-data/' }),
      {},
    );

    expect(result).toMatch(/no es accesible públicamente/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('substitutes headers and posts a body template', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchSpy);

    await runApiTool(
      tool({
        api_url: 'https://api.example.com/lookup',
        api_method: 'POST',
        api_headers: { 'x-api-key': '{API_KEY}' },
        api_body: '{"city":"{city}"}',
        api_key_encrypted: 'secret-1',
        api_params: [{ name: 'city', description: 'City', required: true }],
      }),
      { city: 'Quito' },
    );

    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"city":"Quito"}');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('plain:secret-1');
  });

  it('leaves an unknown placeholder untouched instead of blanking it', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal('fetch', fetchSpy);

    await runApiTool(tool({ api_url: 'https://api.example.com/{typo}' }), { city: 'Lima' });

    const [url] = fetchSpy.mock.calls[0] as unknown as [string];
    expect(url).toBe('https://api.example.com/{typo}');
  });

  it('returns a readable error when the API responds with a non-2xx status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'nope' }, 401)));

    const result = await runApiTool(tool(), { city: 'Lima' });

    expect(result).toMatch(/estado 401/);
  });

  it('returns a readable error when the encrypted key cannot be decrypted', async () => {
    vi.mocked(decrypt).mockImplementation(() => {
      throw new Error('bad key');
    });
    const fetchSpy = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal('fetch', fetchSpy);

    const result = await runApiTool(tool({ api_key_encrypted: 'corrupt' }), { city: 'Lima' });

    expect(result).toMatch(/no se pudo desencriptar/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('never throws — a network failure becomes an error string', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );

    const result = await runApiTool(tool(), { city: 'Lima' });

    expect(result).toMatch(/Error al consultar la API/);
  });

  it('truncates an oversized response', async () => {
    const huge = 'x'.repeat(20_000);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(huge, { status: 200, headers: { 'Content-Type': 'text/plain' } })),
    );

    const result = await runApiTool(tool(), { city: 'Lima' });

    expect(result.length).toBeLessThan(huge.length);
    expect(result).toMatch(/truncada/);
  });
});
