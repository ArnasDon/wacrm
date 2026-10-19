import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { authenticateTunnelRequest } from './auth';

vi.mock('@/lib/push/admin-client', () => {
  const queryBuilder: any = {};
  queryBuilder.select = vi.fn(() => queryBuilder);
  queryBuilder.eq = vi.fn(() => queryBuilder);
  queryBuilder.not = vi.fn(() => queryBuilder);
  queryBuilder.order = vi.fn(() => queryBuilder);
  queryBuilder.limit = vi.fn(() => queryBuilder);
  queryBuilder.maybeSingle = vi.fn().mockResolvedValue({
    data: { id: 'test-account-uuid-1234', account_id: 'test-account-uuid-1234' },
    error: null,
  });

  return {
    supabaseAdmin: vi.fn(() => ({
      from: vi.fn(() => queryBuilder),
    })),
  };
});

describe('Tunnel Authentication Hardening (auth.ts)', () => {
  const originalEnv = process.env;
  const TEST_TUNNEL_KEY = 'test_tunnel_secret_key_12345';
  const TEST_SERVICE_ROLE_KEY = 'test_service_role_key_admin_999';

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.TUNNEL_API_KEY = TEST_TUNNEL_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = TEST_SERVICE_ROLE_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('permite acesso com Bearer token válido correspondente a TUNNEL_API_KEY', async () => {
    const req = new Request('https://crmronaldomeira.com/api/tunnel/v1/properties/sync', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TEST_TUNNEL_KEY}`,
      },
    });

    const result = await authenticateTunnelRequest(req);
    expect(result).not.toBeNull();
    expect(result?.db).not.toBeNull();
    expect(result?.accountId).toBe('test-account-uuid-1234');
  });

  it('permite acesso case-insensitive no prefixo Bearer', async () => {
    const req = new Request('https://crmronaldomeira.com/api/tunnel/v1/properties/sync', {
      method: 'POST',
      headers: {
        Authorization: `bearer ${TEST_TUNNEL_KEY}`,
      },
    });

    const result = await authenticateTunnelRequest(req);
    expect(result).not.toBeNull();
    expect(result?.accountId).toBe('test-account-uuid-1234');
  });

  it('bloqueia requisição sem header Authorization', async () => {
    const req = new Request('https://crmronaldomeira.com/api/tunnel/v1/properties/sync', {
      method: 'POST',
    });

    const result = await authenticateTunnelRequest(req);
    expect(result).toBeNull();
  });

  it('bloqueia requisição com token inválido / incorreto', async () => {
    const req = new Request('https://crmronaldomeira.com/api/tunnel/v1/properties/sync', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer chave_totalmente_invalida',
      },
    });

    const result = await authenticateTunnelRequest(req);
    expect(result).toBeNull();
  });

  it('REJEITA categoricamente SUPABASE_SERVICE_ROLE_KEY como credencial do túnel', async () => {
    const req = new Request('https://crmronaldomeira.com/api/tunnel/v1/properties/sync', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TEST_SERVICE_ROLE_KEY}`,
      },
    });

    const result = await authenticateTunnelRequest(req);
    expect(result).toBeNull();
  });

  it('FAIL CLOSED: rejeita todas as requisições se TUNNEL_API_KEY for undefined ou vazia', async () => {
    delete process.env.TUNNEL_API_KEY;

    const req1 = new Request('https://crmronaldomeira.com/api/tunnel/v1/properties/sync', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TEST_TUNNEL_KEY}`,
      },
    });
    expect(await authenticateTunnelRequest(req1)).toBeNull();

    process.env.TUNNEL_API_KEY = '';
    const req2 = new Request('https://crmronaldomeira.com/api/tunnel/v1/properties/sync', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TEST_TUNNEL_KEY}`,
      },
    });
    expect(await authenticateTunnelRequest(req2)).toBeNull();
  });
});
