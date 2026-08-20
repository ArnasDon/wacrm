import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  resolveProductCatalogueService: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() =>
    Response.json({ error: 'auth failed' }, { status: 403 })
  ),
}));
vi.mock('@/lib/products/catalogue-service', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/products/catalogue-service')
  >('@/lib/products/catalogue-service');
  return {
    ...actual,
    resolveProductCatalogueService: mocks.resolveProductCatalogueService,
  };
});

const { GET, POST } = await import('./route');

function makeSupabase({
  product,
  image,
  insertResult,
}: {
  product: Record<string, unknown> | null;
  image?: Record<string, unknown> | null;
  insertResult?: { data: unknown; error: unknown };
}) {
  const insertCalls: Record<string, unknown>[] = [];
  return {
    insertCalls,
    storage: {
      from: () => ({
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://cdn/${path}` },
        }),
      }),
    },
    from: (table: string) => {
      if (table === 'products') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: product, error: null }),
            }),
          }),
        };
      }
      if (table === 'product_images') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({
                    data: image ?? null,
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'whatsapp_sync_log') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            }),
          }),
          insert: (row: Record<string, unknown>) => {
            insertCalls.push(row);
            return {
              select: () => ({
                single: async () =>
                  insertResult ?? {
                    data: { id: 'log-1', ...row },
                    error: null,
                  },
              }),
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

describe('POST /api/products/[id]/catalogue-sync', () => {
  it('requires admin', async () => {
    mocks.requireRole.mockRejectedValueOnce(new Error('Forbidden'));
    const res = await POST(new Request('http://localhost'), {
      params: Promise.resolve({ id: 'p1' }),
    });
    expect(res.status).toBe(403);
    expect(mocks.requireRole).toHaveBeenCalledWith('admin');
  });

  it('404s when the product does not exist', async () => {
    mocks.requireRole.mockResolvedValueOnce({
      supabase: makeSupabase({ product: null }),
      accountId: 'acct-1',
    });
    const res = await POST(new Request('http://localhost'), {
      params: Promise.resolve({ id: 'p1' }),
    });
    expect(res.status).toBe(404);
  });

  it('records a Sync Error row (200, not 500) when the catalogue service is not configured', async () => {
    const supabase = makeSupabase({
      product: {
        id: 'p1',
        product_code: 'R6-20L',
        product_name: 'Rimula R6',
        description: 'Full desc',
        short_description: 'Short desc',
      },
    });
    mocks.requireRole.mockResolvedValueOnce({ supabase, accountId: 'acct-1' });
    mocks.resolveProductCatalogueService.mockReturnValueOnce({
      isConfigured: false,
      syncProduct: vi.fn().mockRejectedValue(
        Object.assign(new Error('not configured'), {
          name: 'CatalogueNotConfiguredError',
        })
      ),
    });

    const res = await POST(new Request('http://localhost'), {
      params: Promise.resolve({ id: 'p1' }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.warning).toBe('not configured');
    expect(supabase.insertCalls[0]).toMatchObject({
      product_id: 'p1',
      sync_status: 'Sync Error',
      sync_error: 'not configured',
    });
  });

  it('records a Synced row with the returned whatsapp_catalogue_id on success', async () => {
    const supabase = makeSupabase({
      product: {
        id: 'p1',
        product_code: null,
        product_name: 'Rimula R6',
        description: 'Full desc',
        short_description: null,
      },
      image: { storage_path: 'account-acct-1/products/p1.jpg' },
    });
    mocks.requireRole.mockResolvedValueOnce({ supabase, accountId: 'acct-1' });
    mocks.resolveProductCatalogueService.mockReturnValueOnce({
      isConfigured: true,
      syncProduct: vi
        .fn()
        .mockResolvedValue({ whatsappCatalogueId: 'meta-cat-123' }),
    });

    const res = await POST(new Request('http://localhost'), {
      params: Promise.resolve({ id: 'p1' }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.sync_log).toMatchObject({
      sync_status: 'Synced',
      whatsapp_catalogue_id: 'meta-cat-123',
    });
    // No product_code -> falls back to the product's own id as retailer_id.
    expect(mocks.resolveProductCatalogueService).toHaveBeenCalled();
  });
});

describe('GET /api/products/[id]/catalogue-sync', () => {
  it('requires admin', async () => {
    mocks.requireRole.mockRejectedValueOnce(new Error('Forbidden'));
    const res = await GET(new Request('http://localhost'), {
      params: Promise.resolve({ id: 'p1' }),
    });
    expect(res.status).toBe(403);
  });
});
