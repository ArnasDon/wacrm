import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() =>
    Response.json({ error: 'auth failed' }, { status: 403 })
  ),
}));

const { GET, POST } = await import('./route');

function makeSupabase() {
  const insertCalls: Record<string, unknown>[] = [];
  const eqCalls: [string, unknown][] = [];
  return {
    insertCalls,
    eqCalls,
    from: (table: string) => {
      expect(table).toBe('products');
      const chain = {
        select: () => chain,
        order: () => chain,
        eq: (col: string, val: unknown) => {
          eqCalls.push([col, val]);
          return chain;
        },
        insert: (values: Record<string, unknown>) => {
          insertCalls.push(values);
          return chain;
        },
        single: async () => ({
          data: { id: 'prod-1', ...insertCalls[0] },
          error: null,
        }),
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: [], error: null }),
      };
      return chain;
    },
  };
}

function request(url: string, init?: RequestInit) {
  return new Request(url, init);
}

describe('GET /api/products', () => {
  it('requires at least viewer role', async () => {
    mocks.requireRole.mockRejectedValueOnce(new Error('Forbidden'));
    const res = await GET(request('http://localhost/api/products'));
    expect(res.status).toBe(403);
    expect(mocks.requireRole).toHaveBeenCalledWith('viewer');
  });

  it('applies status and category_id filters when present', async () => {
    const supabase = makeSupabase();
    mocks.requireRole.mockResolvedValueOnce({ supabase });
    const res = await GET(
      request('http://localhost/api/products?status=draft&category_id=cat-1')
    );
    expect(res.status).toBe(200);
    expect(supabase.eqCalls).toContainEqual(['status', 'draft']);
    expect(supabase.eqCalls).toContainEqual(['category_id', 'cat-1']);
  });
});

describe('POST /api/products', () => {
  it('requires admin — writes are administrator-curated (§11)', async () => {
    mocks.requireRole.mockRejectedValueOnce(new Error('Forbidden'));
    const res = await POST(
      request('http://localhost/api/products', {
        method: 'POST',
        body: JSON.stringify({ product_name: 'Rimula R4 X' }),
      })
    );
    expect(res.status).toBe(403);
    expect(mocks.requireRole).toHaveBeenCalledWith('admin');
  });

  it('400s when product_name is missing', async () => {
    const supabase = makeSupabase();
    mocks.requireRole.mockResolvedValueOnce({
      supabase,
      userId: 'admin-1',
      accountId: 'acct-1',
    });
    const res = await POST(
      request('http://localhost/api/products', {
        method: 'POST',
        body: JSON.stringify({ product_name: '   ' }),
      })
    );
    expect(res.status).toBe(400);
  });

  it('creates a Draft product stamped with created_by/account_id', async () => {
    const supabase = makeSupabase();
    mocks.requireRole.mockResolvedValueOnce({
      supabase,
      userId: 'admin-1',
      accountId: 'acct-1',
    });
    const res = await POST(
      request('http://localhost/api/products', {
        method: 'POST',
        body: JSON.stringify({ product_name: 'Rimula R4 X' }),
      })
    );
    expect(res.status).toBe(201);
    expect(supabase.insertCalls[0]).toMatchObject({
      account_id: 'acct-1',
      product_name: 'Rimula R4 X',
      status: 'draft',
      created_by: 'admin-1',
    });
  });
});
