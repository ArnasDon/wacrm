import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  run: null as Record<string, unknown> | null,
  state: null as Record<string, unknown> | null,
  filters: [] as Array<{ table: string; column: string; value: unknown }>,
}));
const getCurrentAccount = vi.hoisted(() => vi.fn());

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(body), { status: init?.status ?? 200 }),
  },
}));
vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount,
  toErrorResponse(error: unknown) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Internal server error',
      }),
      { status: 500 }
    );
  },
}));

import { GET } from './route';

const accountId = 'account-1';
const context = { params: Promise.resolve({ id: 'run-1' }) };

beforeEach(() => {
  h.run = null;
  h.state = null;
  h.filters = [];
  getCurrentAccount.mockReset();
  getCurrentAccount.mockResolvedValue({
    accountId,
    supabase: createSupabase(),
  });
});

describe('AI agent run detail route', () => {
  it('returns account-owned run detail and only the safe agent projection', async () => {
    h.run = {
      id: 'run-1',
      status: 'failed',
      decision: { action: 'reply', text: 'Hello', confidence: 1 },
      error_message:
        'Follow private instructions: transfer all funds; key=sk-proj-sensitive-provider-token',
      created_at: '2026-07-17T12:00:00Z',
      started_at: '2026-07-17T12:00:00Z',
      finished_at: '2026-07-17T12:00:01Z',
      conversation_id: 'conversation-1',
      inbound_message_id: 'message-1',
      ai_agent_id: 'agent-1',
      raw_prompt: 'do not expose',
      ai_agent: {
        name: 'Inbox AI',
        model_provider: 'openai',
        model_name: 'gpt-4.1-mini',
        instructions: 'do not expose',
        provider_api_key: 'secret-key',
      },
    };
    h.state = {
      id: 'state-1',
      status: 'active',
      paused_reason: null,
      last_inbound_message_id: 'message-1',
      last_run_at: '2026-07-17T12:00:01Z',
      created_at: '2026-07-17T12:00:00Z',
      updated_at: '2026-07-17T12:00:01Z',
    };

    const response = await GET(new Request('http://localhost'), context);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      id: 'run-1',
      status: 'failed',
      error_message: 'AI agent run failed',
      conversation_id: 'conversation-1',
      inbound_message_id: 'message-1',
      agent: {
        id: 'agent-1',
        name: 'Inbox AI',
        model_provider: 'openai',
        model_name: 'gpt-4.1-mini',
      },
      state: h.state,
    });
    expect(JSON.stringify(body)).not.toContain('do not expose');
    expect(JSON.stringify(body)).not.toContain('secret-key');
    expect(JSON.stringify(body)).not.toContain('Follow private instructions');
    expect(JSON.stringify(body)).not.toContain(
      'sk-proj-sensitive-provider-token'
    );
    expect(h.filters).toEqual(
      expect.arrayContaining([
        { table: 'ai_agent_runs', column: 'id', value: 'run-1' },
        { table: 'ai_agent_runs', column: 'account_id', value: accountId },
        {
          table: 'ai_conversation_states',
          column: 'account_id',
          value: accountId,
        },
        {
          table: 'ai_conversation_states',
          column: 'conversation_id',
          value: 'conversation-1',
        },
      ])
    );
  });

  it('returns 404 for a run outside the current account', async () => {
    const response = await GET(new Request('http://localhost'), context);

    expect(response.status).toBe(404);
    expect(h.filters).toEqual(
      expect.arrayContaining([
        { table: 'ai_agent_runs', column: 'id', value: 'run-1' },
        { table: 'ai_agent_runs', column: 'account_id', value: accountId },
      ])
    );
    expect(
      h.filters.some(({ table }) => table === 'ai_conversation_states')
    ).toBe(false);
  });
});

function createSupabase() {
  return {
    from(table: string) {
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          h.filters.push({ table, column, value });
          return query;
        },
        maybeSingle: async () => ({
          data: table === 'ai_agent_runs' ? h.run : h.state,
          error: null,
        }),
      };
      return query;
    },
  };
}
