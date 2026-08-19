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

const { POST } = await import('./route');

function makeSupabase(opts: {
  myLanguages?: string[];
  contentExists?: boolean;
}) {
  const upsertCalls: Record<string, unknown>[] = [];
  return {
    upsertCalls,
    from: (table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { languages: opts.myLanguages ?? [] },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'content') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: opts.contentExists === false ? null : { id: 'ct-1' },
                error: null,
              }),
            }),
          }),
        };
      }
      // content_translations
      const chain = {
        upsert: (row: Record<string, unknown>) => {
          upsertCalls.push(row);
          return chain;
        },
        select: () => chain,
        single: async () => ({
          data: { id: 'tr-1', ...upsertCalls[0] },
          error: null,
        }),
      };
      return chain;
    },
  };
}

function params() {
  return { params: Promise.resolve({ id: 'ct-1' }) };
}

function request(body: unknown) {
  return new Request('http://localhost/api/content/ct-1/translations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/content/[id]/translations', () => {
  it('rejects an unsupported language', async () => {
    mocks.requireRole.mockResolvedValueOnce({
      supabase: makeSupabase({}),
      userId: 'ba-1',
      accountId: 'acct-1',
      role: 'agent',
    });
    const res = await POST(
      request({ language: 'fr', body: 'Bonjour' }),
      params()
    );
    expect(res.status).toBe(400);
  });

  it('blocks a BA from writing a language not in their own profile.languages', async () => {
    mocks.requireRole.mockResolvedValueOnce({
      supabase: makeSupabase({ myLanguages: ['ps'] }),
      userId: 'ba-1',
      accountId: 'acct-1',
      role: 'agent',
    });
    const res = await POST(request({ language: 'ur', body: 'اردو' }), params());
    expect(res.status).toBe(403);
  });

  it('allows a BA to write a language that IS in their profile.languages', async () => {
    const supabase = makeSupabase({ myLanguages: ['ur', 'ps'] });
    mocks.requireRole.mockResolvedValueOnce({
      supabase,
      userId: 'ba-1',
      accountId: 'acct-1',
      role: 'agent',
    });
    const res = await POST(
      request({ language: 'ur', body: 'اردو باڈی' }),
      params()
    );
    expect(res.status).toBe(201);
    expect(supabase.upsertCalls[0]).toMatchObject({
      content_id: 'ct-1',
      language: 'ur',
      body: 'اردو باڈی',
      translated_by: 'ba-1',
    });
  });

  it('lets an admin write any language regardless of their own profile.languages', async () => {
    const supabase = makeSupabase({ myLanguages: [] });
    mocks.requireRole.mockResolvedValueOnce({
      supabase,
      userId: 'admin-1',
      accountId: 'acct-1',
      role: 'admin',
    });
    const res = await POST(
      request({ language: 'pa', body: 'ਪੰਜਾਬੀ' }),
      params()
    );
    expect(res.status).toBe(201);
  });

  it('404s when the content item does not exist', async () => {
    mocks.requireRole.mockResolvedValueOnce({
      supabase: makeSupabase({ myLanguages: ['ur'], contentExists: false }),
      userId: 'ba-1',
      accountId: 'acct-1',
      role: 'agent',
    });
    const res = await POST(request({ language: 'ur', body: 'اردو' }), params());
    expect(res.status).toBe(404);
  });
});
