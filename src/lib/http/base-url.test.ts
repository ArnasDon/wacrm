import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveBaseUrl } from './base-url';

// ---------------------------------------------------------------------------
// This exact bug — NEXT_PUBLIC_SITE_URL misconfigured to localhost in
// production — broke seller-invite emails (and potentially the uazapi/Z-API
// webhook URLs registered when an account connects via QR code) at the same
// time, since 5 routes each reimplemented this resolution. The test that
// matters most here is the production+localhost console.error: it's the
// guardrail that makes sure this specific failure mode is never silent
// again.
// ---------------------------------------------------------------------------

function makeRequest(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers });
}

describe('resolveBaseUrl', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('uses NEXT_PUBLIC_SITE_URL when set, trimming a trailing slash', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://crm.example.com/';
    const result = resolveBaseUrl(makeRequest('https://ignored.example/api/x'));
    expect(result).toBe('https://crm.example.com');
  });

  it('falls back to the forwarded host header when unset', () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    const result = resolveBaseUrl(
      makeRequest('https://ignored.example/api/x', {
        'x-forwarded-host': 'wacrm-alpha-ecru.vercel.app',
        'x-forwarded-proto': 'https',
      }),
    );
    expect(result).toBe('https://wacrm-alpha-ecru.vercel.app');
  });

  it('falls back to the plain Host header + request protocol when no forwarded headers exist', () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    const result = resolveBaseUrl(makeRequest('http://example.com/api/x', { host: 'example.com' }));
    expect(result).toBe('http://example.com');
  });

  it('logs an error when the resolved URL is localhost AND VERCEL_ENV=production', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
    process.env.VERCEL_ENV = 'production';
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    resolveBaseUrl(makeRequest('https://ignored.example/api/x'));

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain('localhost:3000');
  });

  it('does not log when VERCEL_ENV is not production, even if the URL is localhost', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
    process.env.VERCEL_ENV = 'preview';
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    resolveBaseUrl(makeRequest('https://ignored.example/api/x'));

    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('does not log in production when the resolved URL is a real domain', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://wacrm-alpha-ecru.vercel.app';
    process.env.VERCEL_ENV = 'production';
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    resolveBaseUrl(makeRequest('https://ignored.example/api/x'));

    expect(errorSpy).not.toHaveBeenCalled();
  });
});
