import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// GET/POST/DELETE /api/ai/config — AI optimization "Fase 2" (blindaje de
// instrucciones del agente interno). This route never had a test file
// before. Covers the `system_prompt` ("Business context & instructions")
// round-trip specifically, plus the existing GET/DELETE behavior, using
// the real route handlers against a fake Supabase table — only auth
// (`getCurrentAccount`/`requireRole`) and the two provider-network calls
// (`validateAiCredentials`, `embedTexts`) are mocked, since those would
// otherwise hit a real LLM provider.
// ============================================================

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  requireRole: vi.fn(),
  validateAiCredentials: vi.fn(),
  embedTexts: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: mocks.getCurrentAccount,
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn((err: unknown) => Response.json({ error: String(err) }, { status: 403 })),
}));

vi.mock('@/lib/ai/validate', () => ({
  validateAiCredentials: mocks.validateAiCredentials,
}));

vi.mock('@/lib/ai/embeddings', () => ({
  embedTexts: mocks.embedTexts,
}));

import { GET, POST, DELETE } from './route';

/**
 * Minimal multi-table, multi-row fake mirroring the exact chains
 * route.ts actually calls: `.select().eq().maybeSingle()` for reads,
 * and `.update().eq()` / `.insert()` / `.delete().eq()` awaited
 * directly (no `.select()` after a write — this route never chains one,
 * unlike business-profile's). Rows are plain objects filtered by
 * `.eq()`, scoped per table, so two accounts' rows never collide unless
 * a query is missing its `account_id` filter — exactly what the
 * isolation test below would catch.
 */
function fakeSupabase() {
  const tables: Record<string, Record<string, unknown>[]> = { ai_configs: [], profiles: [] };
  let nextId = 1;

  function builder(table: string, op: 'select' | 'update' | 'delete', payload?: Record<string, unknown>) {
    const rows = tables[table];
    const filters: [string, unknown][] = [];
    const matches = (row: Record<string, unknown>) => filters.every(([c, v]) => row[c] === v);

    function run(single: boolean) {
      if (op === 'select') {
        const matched = rows.filter(matches);
        return { data: single ? (matched[0] ?? null) : matched, error: null };
      }
      if (op === 'update') {
        for (const row of rows.filter(matches)) Object.assign(row, payload);
        return { error: null };
      }
      if (op === 'delete') {
        const remaining = rows.filter((r) => !matches(r));
        rows.length = 0;
        rows.push(...remaining);
        return { error: null };
      }
      return { error: null };
    }

    const api = {
      eq(col: string, val: unknown) {
        filters.push([col, val]);
        return api;
      },
      maybeSingle: () => Promise.resolve(run(true)),
      then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
        Promise.resolve(run(false)).then(resolve, reject),
    };
    return api;
  }

  return {
    supabase: {
      from: (table: string) => ({
        select: () => builder(table, 'select'),
        update: (payload: Record<string, unknown>) => builder(table, 'update', payload),
        insert: (payload: Record<string, unknown>) => {
          tables[table].push({ id: `${table}-${nextId++}`, ...payload });
          return Promise.resolve({ error: null });
        },
        delete: () => builder(table, 'delete'),
      }),
    } as never,
    tables,
  };
}

function postRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/ai/config', { method: 'POST', body: JSON.stringify(body) });
}

const BASE_BODY = {
  provider: 'openai',
  model: 'gpt-5.4-mini',
  api_key: 'sk-test-key',
  system_prompt: 'Somos una ferretería. Sé breve y cordial.',
  is_active: true,
  auto_reply_enabled: false,
  auto_reply_max_per_conversation: 3,
};

beforeEach(() => {
  mocks.getCurrentAccount.mockReset();
  mocks.requireRole.mockReset();
  mocks.validateAiCredentials.mockReset().mockResolvedValue(undefined);
  mocks.embedTexts.mockReset().mockResolvedValue([[0.1]]);
});

describe('GET /api/ai/config', () => {
  it('returns configured:false with no row', async () => {
    const { supabase } = fakeSupabase();
    mocks.getCurrentAccount.mockResolvedValue({ supabase, accountId: 'acct-1' });

    const res = await GET();
    const body = (await res.json()) as { configured: boolean };
    expect(body.configured).toBe(false);
  });

  it('returns the stored config, including system_prompt, and never leaks the raw key', async () => {
    const { supabase, tables } = fakeSupabase();
    tables.ai_configs.push({
      account_id: 'acct-1', provider: 'openai', model: 'gpt-5.4-mini',
      system_prompt: 'Somos una ferretería.', is_active: true, auto_reply_enabled: false,
      auto_reply_max_per_conversation: 3, handoff_agent_id: null,
      api_key: 'encrypted-blob', embeddings_api_key: null,
    });
    mocks.getCurrentAccount.mockResolvedValue({ supabase, accountId: 'acct-1' });

    const res = await GET();
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.configured).toBe(true);
    expect(body.system_prompt).toBe('Somos una ferretería.');
    expect(body.has_key).toBe(true);
    expect(body).not.toHaveProperty('api_key');
    expect(body).not.toHaveProperty('embeddings_api_key');
  });
});

describe('POST /api/ai/config — system_prompt persistence', () => {
  it('saves system_prompt on first creation (insert path)', async () => {
    const { supabase, tables } = fakeSupabase();
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    const res = await POST(postRequest(BASE_BODY));
    expect(res.status).toBe(200);
    expect(tables.ai_configs[0].system_prompt).toBe('Somos una ferretería. Sé breve y cordial.');
  });

  it('preserves the exact text sent, including special characters and line breaks', async () => {
    const { supabase, tables } = fakeSupabase();
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });
    const text = 'Línea uno.\nLínea dos — "citas", 100% garantía, ¿preguntas? sí.';

    await POST(postRequest({ ...BASE_BODY, system_prompt: text }));
    expect(tables.ai_configs[0].system_prompt).toBe(text);
  });

  it('a second POST that changes only system_prompt does not corrupt the other fields the form resent unchanged', async () => {
    const { supabase, tables } = fakeSupabase();
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    await POST(postRequest(BASE_BODY));
    // The real UI always resends the full form (this route has no
    // partial-update contract, unlike business-profile) — mirror that:
    // same provider/model/flags, only system_prompt actually changed.
    const res = await POST(postRequest({ ...BASE_BODY, api_key: '', system_prompt: 'Nuevo texto de instrucciones.' }));
    expect(res.status).toBe(200);

    const row = tables.ai_configs[0];
    expect(row.system_prompt).toBe('Nuevo texto de instrucciones.');
    expect(row.provider).toBe('openai');
    expect(row.model).toBe('gpt-5.4-mini');
    expect(row.is_active).toBe(true);
    expect(row.auto_reply_enabled).toBe(false);
    expect(row.auto_reply_max_per_conversation).toBe(3);
  });

  it('an empty system_prompt clears it to null (the existing clear-the-field behavior)', async () => {
    const { supabase, tables } = fakeSupabase();
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    await POST(postRequest(BASE_BODY));
    await POST(postRequest({ ...BASE_BODY, api_key: '', system_prompt: '' }));
    expect(tables.ai_configs[0].system_prompt).toBeNull();
  });

  it('GET reflects exactly what POST just stored', async () => {
    const { supabase } = fakeSupabase();
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });
    mocks.getCurrentAccount.mockResolvedValue({ supabase, accountId: 'acct-1' });

    await POST(postRequest(BASE_BODY));
    const res = await GET();
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.system_prompt).toBe('Somos una ferretería. Sé breve y cordial.');
  });
});

describe('DELETE /api/ai/config', () => {
  it('removes the account config and reports success — existing behavior, unchanged', async () => {
    const { supabase, tables } = fakeSupabase();
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });
    tables.ai_configs.push({ account_id: 'acct-1', provider: 'openai', model: 'x', system_prompt: 'x', api_key: 'x' });

    const res = await DELETE();
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(true);
    expect(tables.ai_configs).toHaveLength(0);
  });
});

describe('multi-tenant isolation', () => {
  it('saving account acct-1\'s system_prompt never touches acct-2\'s row', async () => {
    const { supabase, tables } = fakeSupabase();
    tables.ai_configs.push({
      account_id: 'acct-2', provider: 'anthropic', model: 'claude-haiku-4-5-20251001',
      system_prompt: 'Instrucciones de la otra cuenta.', api_key: 'other-encrypted-blob',
      is_active: true, auto_reply_enabled: true, auto_reply_max_per_conversation: 5,
    });
    mocks.requireRole.mockResolvedValue({ supabase, accountId: 'acct-1', userId: 'user-1' });

    await POST(postRequest(BASE_BODY));

    expect(tables.ai_configs).toHaveLength(2);
    const acct1 = tables.ai_configs.find((r) => r.account_id === 'acct-1')!;
    const acct2 = tables.ai_configs.find((r) => r.account_id === 'acct-2')!;
    expect(acct1.system_prompt).toBe('Somos una ferretería. Sé breve y cordial.');
    expect(acct2.system_prompt).toBe('Instrucciones de la otra cuenta.');
    expect(acct2.provider).toBe('anthropic');
  });

  it('GET for acct-1 never returns acct-2\'s config', async () => {
    const { supabase, tables } = fakeSupabase();
    tables.ai_configs.push({
      account_id: 'acct-2', provider: 'anthropic', model: 'x', system_prompt: 'Secreto de acct-2',
      api_key: 'x', is_active: true, auto_reply_enabled: false, auto_reply_max_per_conversation: 3,
    });
    mocks.getCurrentAccount.mockResolvedValue({ supabase, accountId: 'acct-1' });

    const res = await GET();
    const body = (await res.json()) as { configured: boolean };
    expect(body.configured).toBe(false);
  });
});
