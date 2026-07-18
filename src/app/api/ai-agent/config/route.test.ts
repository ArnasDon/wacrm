import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  config: null as Record<string, unknown> | null,
  selectError: null as { message: string } | null,
  upsertError: null as { message: string } | null,
  upsertPayload: null as Record<string, unknown> | null,
  filters: [] as Array<[string, unknown]>,
}));

const getCurrentAccount = vi.hoisted(() => vi.fn());
const requireRole = vi.hoisted(() => vi.fn());

vi.mock('next/server', () => ({
  NextResponse: {
    json(payload: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(payload), {
        status: init?.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  },
}));

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount,
  requireRole,
  toErrorResponse(error: unknown) {
    const status =
      error instanceof Error && error.message === 'Forbidden' ? 403 : 500;
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Internal server error',
      }),
      {
        status,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  },
}));

import { GET, PATCH } from './route';

const accountId = 'account-1';
const userId = 'user-1';

beforeEach(() => {
  requireRole.mockClear();
  h.config = null;
  h.selectError = null;
  h.upsertError = null;
  h.upsertPayload = null;
  h.filters = [];

  const supabase = {
    from: vi.fn(() => {
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn((column: string, value: unknown) => {
          h.filters.push([column, value]);
          return query;
        }),
        maybeSingle: vi.fn(async () => ({
          data: h.config,
          error: h.selectError,
        })),
        upsert: vi.fn((payload: Record<string, unknown>) => {
          h.upsertPayload = payload;
          return query;
        }),
        single: vi.fn(async () => ({ data: h.config, error: h.upsertError })),
      };
      return query;
    }),
  };

  getCurrentAccount.mockResolvedValue({ accountId, userId, supabase });
  requireRole.mockResolvedValue({ accountId, userId, supabase });
});

describe('AI agent config route', () => {
  it('GET returns migration defaults when the account has no configuration', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: null,
      enabled: false,
      model_provider: 'openai',
      model_name: 'gpt-4.1-mini',
      instructions: '',
      auto_reply: true,
      auto_move_deals: false,
      handoff_keywords: ['humano', 'atendente', 'cancelar'],
      max_messages: 20,
      cooldown_seconds: 15,
    });
    expect(h.filters).toContainEqual(['account_id', accountId]);
  });

  it('PATCH rejects a non-admin through requireRole', async () => {
    requireRole.mockRejectedValue(new Error('Forbidden'));

    const response = await PATCH(request(validPayload()));

    expect(response.status).toBe(403);
    expect(requireRole).toHaveBeenCalledWith('admin');
    expect(h.upsertPayload).toBeNull();
  });

  it.each([
    [{ max_messages: 0 }, 'max_messages must be an integer between 1 and 50'],
    [
      { cooldown_seconds: 3601 },
      'cooldown_seconds must be an integer between 5 and 3600',
    ],
    [
      { instructions: 'x'.repeat(4001) },
      'instructions must be 4000 characters or fewer',
    ],
    [{ model_provider: 'anthropic' }, 'model_provider must be openai'],
  ])('PATCH rejects invalid input', async (overrides, error) => {
    const response = await PATCH(request({ ...validPayload(), ...overrides }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error });
    expect(h.upsertPayload).toBeNull();
  });

  it('PATCH upserts a normalized admin payload scoped to the current account', async () => {
    h.config = {
      id: 'agent-1',
      enabled: true,
      model_provider: 'openai',
      model_name: 'gpt-4.1-mini',
      instructions: 'Help customers.',
      auto_reply: true,
      auto_move_deals: false,
      handoff_keywords: ['human', 'billing'],
      max_messages: 12,
      cooldown_seconds: 30,
    };

    const response = await PATCH(
      request({
        ...validPayload(),
        handoff_keywords: ' Human, billing, , HUMAN ',
        ignored_column: 'must not persist',
      })
    );

    expect(response.status).toBe(200);
    expect(h.upsertPayload).toEqual({
      account_id: accountId,
      user_id: userId,
      enabled: true,
      model_provider: 'openai',
      model_name: 'gpt-4.1-mini',
      instructions: 'Help customers.',
      auto_reply: true,
      auto_move_deals: false,
      handoff_keywords: ['human', 'billing', 'human'],
      max_messages: 12,
      cooldown_seconds: 30,
    });
    await expect(response.json()).resolves.toEqual(h.config);
  });
});

function request(body: Record<string, unknown>) {
  return new Request('http://localhost/api/ai-agent/config', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function validPayload() {
  return {
    enabled: true,
    model_provider: 'openai',
    model_name: 'gpt-4.1-mini',
    instructions: 'Help customers.',
    auto_reply: true,
    auto_move_deals: false,
    handoff_keywords: ['human', 'billing'],
    max_messages: 12,
    cooldown_seconds: 30,
  };
}
