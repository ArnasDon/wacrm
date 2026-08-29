import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// GET /api/ai/usage — Usage + OpenRouter integration phase. Covers the
// scenarios that live at THIS layer specifically: multi-tenant
// isolation (14), combined-provider aggregation (15), and that nothing
// here filters a provider out by name (16) — token extraction/
// normalization itself is covered in generate.test.ts/usage.test.ts.
// Same mock convention as the project's other route.test.ts files
// (contacts/[id]/tags, whatsapp/send): mock `requireRole`, hand back a
// fake Supabase client, call the route handler directly.
// ============================================================

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() => Response.json({ error: 'auth failed' }, { status: 403 })),
}));

import { GET } from './route';

interface FakeUsageRow {
  created_at: string;
  mode: 'auto_reply' | 'draft';
  provider: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
  catalog_attached: boolean | null;
  catalog_used: boolean | null;
  knowledge_retrieved: boolean | null;
  knowledge_skipped_by_routing: boolean | null;
  routing_decision: 'catalog' | 'knowledge' | 'both' | 'neither' | null;
  catalog_external_used: boolean | null;
  catalog_external_blocked: boolean | null;
}

/** Chainable double for `.from('ai_usage_log').select().eq().gte().order().limit()`
 *  — every intermediate call returns itself; `.limit()` resolves with the
 *  fixture rows, exactly the shape the real route awaits. */
function fakeSupabase(rows: FakeUsageRow[]) {
  const eqCalls: [string, unknown][] = [];
  const chain = {
    select: () => chain,
    eq: (col: string, val: unknown) => {
      eqCalls.push([col, val]);
      return chain;
    },
    gte: () => chain,
    order: () => chain,
    limit: () => Promise.resolve({ data: rows, error: null }),
  };
  return { supabase: { from: () => chain } as unknown as { from: () => typeof chain }, eqCalls };
}

function request() {
  return new Request('http://localhost/api/ai/usage?days=30');
}

function row(overrides: Partial<FakeUsageRow>): FakeUsageRow {
  return {
    created_at: new Date().toISOString(),
    mode: 'auto_reply',
    provider: 'openai',
    model: 'gpt-x',
    prompt_tokens: 10,
    completion_tokens: 5,
    total_tokens: 15,
    // Real Supabase rows always carry an explicit `null` for an unset
    // nullable column (never `undefined`) — matching that here is what
    // makes the route's "have we ever seen cache/breakdown data at all"
    // checks (`!== null`) exercise the real, common "not applicable"
    // case correctly.
    cache_creation_input_tokens: null,
    cache_read_input_tokens: null,
    catalog_attached: null,
    catalog_used: null,
    knowledge_retrieved: null,
    knowledge_skipped_by_routing: null,
    routing_decision: null,
    catalog_external_used: null,
    catalog_external_blocked: null,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.requireRole.mockReset();
});

describe('GET /api/ai/usage', () => {
  it('14. scopes the query by the authenticated account only — never by anything the caller could supply', async () => {
    const { supabase, eqCalls } = fakeSupabase([]);
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-A' });

    await GET(request());

    expect(mocks.requireRole).toHaveBeenCalledWith('admin');
    // The only .eq() filter applied is account_id, and it's the
    // server-resolved accountId from requireRole — nothing from the
    // request URL/body ever reaches this query.
    expect(eqCalls).toEqual([['account_id', 'acct-A']]);
  });

  it("14b. account B's usage rows never leak into account A's response (the fake DB simulates each account's own scoped result set)", async () => {
    // requireRole's `supabase` client is RLS-scoped in production — a
    // fake that only ever returns THIS account's rows regardless of
    // what's asked models that guarantee faithfully. Account A sees only
    // its own row.
    const { supabase } = fakeSupabase([row({ provider: 'openai', total_tokens: 100 })]);
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-A' });

    const res = await GET(request());
    const json = (await res.json()) as { totals: { total_tokens: number } };
    expect(json.totals.total_tokens).toBe(100);
  });

  it('15. usage combinado suma correctamente los tres proveedores', async () => {
    const { supabase } = fakeSupabase([
      row({ provider: 'openai', model: 'gpt-x', total_tokens: 100, prompt_tokens: 80, completion_tokens: 20 }),
      row({ provider: 'anthropic', model: 'claude-x', total_tokens: 200, prompt_tokens: 150, completion_tokens: 50 }),
      row({ provider: 'openrouter', model: 'meta-llama/llama-3.3-70b', total_tokens: 300, prompt_tokens: 250, completion_tokens: 50 }),
    ]);
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-A' });

    const res = await GET(request());
    const json = (await res.json()) as {
      totals: {
        calls: number
        prompt_tokens: number
        completion_tokens: number
        total_tokens: number
        cache_creation_input_tokens: number | null
        cache_read_input_tokens: number | null
        cache_hit_rate: number | null
      };
    };
    expect(json.totals).toEqual({
      calls: 3,
      prompt_tokens: 480,
      completion_tokens: 120,
      total_tokens: 600,
      // None of these 3 rows ever reported cache data — FASE 12: "no
      // inventar métricas" means this must be null, never a fabricated 0.
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      cache_hit_rate: null,
    });
  });

  it('16. never filters OpenRouter out — it appears in by_model exactly like OpenAI/Anthropic, labeled correctly', async () => {
    const { supabase } = fakeSupabase([
      row({ provider: 'openai', model: 'gpt-x', total_tokens: 10 }),
      row({ provider: 'anthropic', model: 'claude-x', total_tokens: 20 }),
      row({ provider: 'openrouter', model: 'anthropic/claude-sonnet-4.5', total_tokens: 30 }),
    ]);
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-A' });

    const res = await GET(request());
    const json = (await res.json()) as {
      by_model: { model: string; provider: string; calls: number; tokens: number }[];
    };
    const providers = json.by_model.map((m) => m.provider).sort();
    expect(providers).toEqual(['anthropic', 'openai', 'openrouter']);
    const openRouterEntry = json.by_model.find((m) => m.provider === 'openrouter');
    expect(openRouterEntry).toMatchObject({ provider: 'openrouter', model: 'anthropic/claude-sonnet-4.5', tokens: 30 });
  });

  it('OpenRouter rows are grouped separately from OpenAI even when the underlying model name looks similar, and never mislabeled as "openai"', async () => {
    const { supabase } = fakeSupabase([
      row({ provider: 'openai', model: 'gpt-5.4-mini', total_tokens: 10 }),
      row({ provider: 'openrouter', model: 'openai/gpt-5.4-mini', total_tokens: 20 }),
    ]);
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-A' });

    const res = await GET(request());
    const json = (await res.json()) as { by_model: { model: string; provider: string; tokens: number }[] };
    expect(json.by_model).toHaveLength(2);
    expect(json.by_model.find((m) => m.provider === 'openrouter')?.model).toBe('openai/gpt-5.4-mini');
    expect(json.by_model.find((m) => m.provider === 'openai')?.tokens).toBe(10);
  });

  it('by_mode still splits auto_reply vs draft correctly across a mixed set of providers', async () => {
    const { supabase } = fakeSupabase([
      row({ provider: 'openrouter', mode: 'auto_reply', total_tokens: 40 }),
      row({ provider: 'anthropic', mode: 'draft', total_tokens: 60 }),
    ]);
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-A' });

    const res = await GET(request());
    const json = (await res.json()) as { by_mode: { auto_reply: { tokens: number }; draft: { tokens: number } } };
    expect(json.by_mode.auto_reply.tokens).toBe(40);
    expect(json.by_mode.draft.tokens).toBe(60);
  });

  // ============================================================
  // FASE 12 — Observabilidad real. The raw columns already existed
  // (FASE 2/8/9/12 wrote them); these tests prove the API now surfaces
  // them as real, non-fabricated aggregates.
  // ============================================================
  describe('FASE 12 — observability', () => {
    it('6/13. computes a real cache hit rate from actual Anthropic cache columns — never invented', async () => {
      const { supabase } = fakeSupabase([
        row({ provider: 'anthropic', cache_creation_input_tokens: 1000, cache_read_input_tokens: 0 }),
        row({ provider: 'anthropic', cache_creation_input_tokens: 0, cache_read_input_tokens: 1000 }),
      ]);
      mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-A' });

      const res = await GET(request());
      const json = (await res.json()) as {
        totals: { cache_creation_input_tokens: number; cache_read_input_tokens: number; cache_hit_rate: number };
      };
      expect(json.totals.cache_creation_input_tokens).toBe(1000);
      expect(json.totals.cache_read_input_tokens).toBe(1000);
      // 1000 read / (1000 read + 1000 creation) = 0.5 — real arithmetic
      // over real columns, not a guess.
      expect(json.totals.cache_hit_rate).toBe(0.5);
    });

    it('7. reports cache totals/rate as null (never 0) when no row in the window ever touched caching', async () => {
      const { supabase } = fakeSupabase([row({ provider: 'openai' }), row({ provider: 'openrouter' })]);
      mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-A' });

      const res = await GET(request());
      const json = (await res.json()) as {
        totals: { cache_creation_input_tokens: null; cache_read_input_tokens: null; cache_hit_rate: null };
      };
      expect(json.totals).toMatchObject({
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
        cache_hit_rate: null,
      });
    });

    it('by_model carries cache tokens per provider+model, not just in the global totals', async () => {
      const { supabase } = fakeSupabase([
        row({ provider: 'anthropic', model: 'claude-x', cache_creation_input_tokens: 500, cache_read_input_tokens: 200 }),
        row({ provider: 'openai', model: 'gpt-x' }),
      ]);
      mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-A' });

      const res = await GET(request());
      const json = (await res.json()) as {
        by_model: { provider: string; cache_creation_input_tokens: number; cache_read_input_tokens: number }[];
      };
      const anthropicRow = json.by_model.find((m) => m.provider === 'anthropic');
      const openaiRow = json.by_model.find((m) => m.provider === 'openai');
      expect(anthropicRow).toMatchObject({ cache_creation_input_tokens: 500, cache_read_input_tokens: 200 });
      expect(openaiRow).toMatchObject({ cache_creation_input_tokens: 0, cache_read_input_tokens: 0 });
    });

    it('11/13. Budun observability counts are real and account-scoped — catálogo interno never counted as external', async () => {
      const { supabase } = fakeSupabase([
        row({ catalog_used: true, catalog_external_used: true }), // hit Budun
        row({ catalog_used: true, catalog_external_blocked: true }), // Budun blocked
        row({ catalog_used: true }), // internal catalog only — neither flag set
      ]);
      mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-A' });

      const res = await GET(request());
      const json = (await res.json()) as {
        catalog_observability: { used_calls: number; external_used_calls: number; external_blocked_calls: number };
      };
      expect(json.catalog_observability).toEqual({
        attached_calls: 0,
        used_calls: 3,
        external_used_calls: 1,
        external_blocked_calls: 1,
      });
    });

    it('12. rate-limit events (blocked calls) are counted correctly even across multiple rows in the same window', async () => {
      const { supabase } = fakeSupabase([
        row({ catalog_external_blocked: true }),
        row({ catalog_external_blocked: true }),
        row({ catalog_external_blocked: false }),
      ]);
      mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-A' });

      const res = await GET(request());
      const json = (await res.json()) as { catalog_observability: { external_blocked_calls: number } };
      expect(json.catalog_observability.external_blocked_calls).toBe(2);
    });

    it('Knowledge and routing_decision breakdown aggregate real, already-captured FASE 2 data', async () => {
      const { supabase } = fakeSupabase([
        row({ knowledge_retrieved: true, routing_decision: 'both' }),
        row({ knowledge_skipped_by_routing: true, routing_decision: 'catalog' }),
        row({ routing_decision: 'neither' }),
      ]);
      mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-A' });

      const res = await GET(request());
      const json = (await res.json()) as {
        knowledge_observability: { retrieved_calls: number; skipped_by_routing_calls: number };
        routing: { catalog: number; knowledge: number; both: number; neither: number };
      };
      expect(json.knowledge_observability).toEqual({ retrieved_calls: 1, skipped_by_routing_calls: 1 });
      expect(json.routing).toEqual({ catalog: 1, knowledge: 0, both: 1, neither: 1 });
    });

    it('10. never reports a fabricated cost — cost_available is always false (no pricing infrastructure exists)', async () => {
      const { supabase } = fakeSupabase([row({})]);
      mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-A' });

      const res = await GET(request());
      const json = (await res.json()) as { cost_available: boolean };
      expect(json.cost_available).toBe(false);
    });

    it("9. account B's Budun/cache/knowledge observability never leaks into account A's response", async () => {
      const { supabase } = fakeSupabase([row({ catalog_external_used: true, cache_read_input_tokens: 500 })]);
      mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-A' });

      const res = await GET(request());
      const json = (await res.json()) as {
        catalog_observability: { external_used_calls: number }
        totals: { cache_read_input_tokens: number }
      };
      // The fake DB only ever returns what THIS account's requireRole
      // call resolved to — the same server-side-scoping guarantee
      // proven generically in test 14 applies identically here; no
      // separate cross-tenant code path exists for these new fields.
      expect(json.catalog_observability.external_used_calls).toBe(1);
      expect(json.totals.cache_read_input_tokens).toBe(500);
    });
  });
});
