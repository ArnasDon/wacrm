import { afterEach, describe, expect, it, vi } from 'vitest';
import { uazapiEnv, resolveAppBaseUrl } from './uazapi-env';

const OLD = { ...process.env };
afterEach(() => {
  process.env = { ...OLD };
  vi.unstubAllEnvs();
});

describe('uazapiEnv', () => {
  it('devolve baseUrl sem barra final e o admin token', () => {
    vi.stubEnv('UAZAPI_BASE_URL', 'https://api.uazapi.com/');
    vi.stubEnv('UAZAPI_ADMIN_TOKEN', 'admin-xyz');
    expect(uazapiEnv()).toEqual({
      baseUrl: 'https://api.uazapi.com',
      adminToken: 'admin-xyz',
    });
  });

  it('lança quando UAZAPI_BASE_URL falta', () => {
    vi.stubEnv('UAZAPI_BASE_URL', '');
    vi.stubEnv('UAZAPI_ADMIN_TOKEN', 'admin-xyz');
    expect(() => uazapiEnv()).toThrow(/UAZAPI_BASE_URL/);
  });

  it('lança quando UAZAPI_ADMIN_TOKEN falta', () => {
    vi.stubEnv('UAZAPI_BASE_URL', 'https://api.uazapi.com');
    vi.stubEnv('UAZAPI_ADMIN_TOKEN', '');
    expect(() => uazapiEnv()).toThrow(/UAZAPI_ADMIN_TOKEN/);
  });
});

describe('resolveAppBaseUrl', () => {
  it('prioriza NEXT_PUBLIC_SITE_URL', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://crm.example.com/');
    const req = new Request('https://ignored.local/api/x', {
      headers: { host: 'ignored.local' },
    });
    expect(resolveAppBaseUrl(req)).toBe('https://crm.example.com');
  });

  it('cai para x-forwarded-host + x-forwarded-proto', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    const req = new Request('http://internal/api/x', {
      headers: { 'x-forwarded-host': 'crm.proxy.com', 'x-forwarded-proto': 'https' },
    });
    expect(resolveAppBaseUrl(req)).toBe('https://crm.proxy.com');
  });

  it('cai para host com https como proto default', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    const req = new Request('http://internal/api/x', {
      headers: { host: 'crm.bare.com' },
    });
    expect(resolveAppBaseUrl(req)).toBe('https://crm.bare.com');
  });

  it('lança quando nada resolve', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    const req = new Request('http://internal/api/x');
    expect(() => resolveAppBaseUrl(req)).toThrow(/app base URL/);
  });
});
