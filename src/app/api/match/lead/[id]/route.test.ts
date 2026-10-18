import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  supabase: {
    from: vi.fn(),
  },
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn((err: unknown) =>
    Response.json({ error: (err as Error).message || 'error' }, { status: 500 })
  ),
}));

vi.mock('@/lib/match/profile-builder', () => ({
  buildLeadSearchProfile: vi.fn(),
}));

vi.mock('@/lib/match/maturity', () => ({
  calculateProfileMaturity: vi.fn(),
}));

import { DELETE } from './route';

describe('DELETE /api/match/lead/[id]', () => {
  const context = {
    supabase: mocks.supabase,
    accountId: 'acc-123',
    userId: 'user-1',
    role: 'agent',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireRole.mockResolvedValue(context);
  });

  it('retorna 404 se o lead não existir ou não pertencer à conta', async () => {
    const maybeSingleMock = vi.fn().mockResolvedValue({ data: null, error: null });
    const selectMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: maybeSingleMock,
        }),
      }),
    });

    mocks.supabase.from.mockImplementation((table: string) => {
      if (table === 'contacts') {
        return { select: selectMock };
      }
      return {};
    });

    const res = await DELETE(new Request('http://localhost/api/match/lead/lead-999', { method: 'DELETE' }), {
      params: Promise.resolve({ id: 'lead-999' }),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Lead não encontrado');
  });

  it('exclui registros relacionados e o contato com sucesso', async () => {
    const maybeSingleMock = vi.fn().mockResolvedValue({
      data: { id: 'lead-123', name: 'Lead Teste' },
      error: null,
    });

    const deleteMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    });

    mocks.supabase.from.mockImplementation((table: string) => {
      if (table === 'contacts') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: maybeSingleMock,
              }),
            }),
          }),
          delete: deleteMock,
        };
      }
      return {
        delete: deleteMock,
      };
    });

    const res = await DELETE(new Request('http://localhost/api/match/lead/lead-123', { method: 'DELETE' }), {
      params: Promise.resolve({ id: 'lead-123' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, deletedId: 'lead-123' });
    expect(mocks.supabase.from).toHaveBeenCalledWith('lead_property_matches');
    expect(mocks.supabase.from).toHaveBeenCalledWith('lead_intelligence');
    expect(mocks.supabase.from).toHaveBeenCalledWith('property_shares');
    expect(mocks.supabase.from).toHaveBeenCalledWith('contacts');
  });
});
