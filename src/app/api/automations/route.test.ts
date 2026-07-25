import { beforeEach, describe, expect, it, vi } from 'vitest';

interface GenerationRow {
  id: string;
  account_id: string;
  user_id: string | null;
  result: string;
  automation_id: string | null;
  draft_hash: string | null;
}

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  getTemplate: vi.fn(),
  insertSteps: vi.fn(),
  validateTriggerForActivation: vi.fn(),
  validateStepsForActivation: vi.fn(),
  hashAutomationDraft: vi.fn(),
  state: {
    user: { id: 'user-1' } as { id: string } | null,
    accountId: 'account-1' as string | null,
    insertedAutomation: {
      id: 'automation-1',
      name: 'Automation',
    } as Record<string, unknown> | null,
    automationInsertError: null as { message: string } | null,
    rollbackError: null as { message: string } | null,
    generation: {
      id: 'generation-1',
      account_id: 'account-1',
      user_id: 'user-1',
      result: 'draft',
      automation_id: null,
      draft_hash: 'expected-draft-hash',
    } as GenerationRow | null,
    generationSelectError: null as { message: string } | null,
    generationUpdateError: null as { message: string } | null,
    linkedGeneration: { id: 'generation-1' } as { id: string } | null,
    automationInsertCalls: [] as Record<string, unknown>[],
    automationDeleteCalls: [] as Array<{ column: string; value: unknown }>,
    generationSelectCalls: [] as Array<{ column: string; value: unknown }>,
    generationUpdateCalls: [] as Array<{
      payload: Record<string, unknown>;
      filters: Array<{ method: 'eq' | 'is'; column: string; value: unknown }>;
    }>,
  },
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: h.requireRole,
  toErrorResponse: (err: unknown) =>
    new Response(JSON.stringify({ error: String(err) }), { status: 500 }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: {
      getUser: () => Promise.resolve({ data: { user: h.state.user } }),
    },
    from: (table: string) => {
      if (table !== 'profiles') throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            single: () =>
              Promise.resolve({
                data: h.state.accountId
                  ? { account_id: h.state.accountId }
                  : null,
                error: null,
              }),
          }),
        }),
      };
    },
  }),
}));

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'automations') {
        return {
          insert: (payload: Record<string, unknown>) => {
            h.state.automationInsertCalls.push(payload);
            return {
              select: () => ({
                single: () =>
                  Promise.resolve({
                    data: h.state.insertedAutomation,
                    error: h.state.automationInsertError,
                  }),
              }),
            };
          },
          delete: () => ({
            eq: (column: string, value: unknown) => {
              h.state.automationDeleteCalls.push({ column, value });
              return Promise.resolve({ error: h.state.rollbackError });
            },
          }),
        };
      }

      if (table === 'ai_automation_generations') {
        return {
          select: () => {
            const filters: Array<{ column: string; value: unknown }> = [];
            const builder = {
              eq(column: string, value: unknown) {
                filters.push({ column, value });
                h.state.generationSelectCalls.push({ column, value });
                return builder;
              },
              maybeSingle() {
                const generation = h.state.generation;
                const matchesScope =
                  generation !== null &&
                  filters.every(
                    ({ column, value }) =>
                      generation[column as keyof GenerationRow] === value
                  );
                return Promise.resolve({
                  data: matchesScope ? generation : null,
                  error: h.state.generationSelectError,
                });
              },
            };
            return builder;
          },
          update: (payload: Record<string, unknown>) => {
            const call = {
              payload,
              filters: [] as Array<{
                method: 'eq' | 'is';
                column: string;
                value: unknown;
              }>,
            };
            h.state.generationUpdateCalls.push(call);

            const builder = {
              eq(column: string, value: unknown) {
                call.filters.push({ method: 'eq' as const, column, value });
                return builder;
              },
              is(column: string, value: unknown) {
                call.filters.push({ method: 'is' as const, column, value });
                return builder;
              },
              select() {
                return {
                  maybeSingle: () =>
                    Promise.resolve({
                      data: h.state.linkedGeneration,
                      error: h.state.generationUpdateError,
                    }),
                };
              },
            };
            return builder;
          },
        };
      }

      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

vi.mock('@/lib/automations/templates', () => ({
  getTemplate: h.getTemplate,
}));

vi.mock('@/lib/automations/steps-tree', () => ({
  insertSteps: h.insertSteps,
}));

vi.mock('@/lib/automations/validate', () => ({
  validateTriggerForActivation: h.validateTriggerForActivation,
  validateStepsForActivation: h.validateStepsForActivation,
}));

vi.mock('@/lib/automations/draft-integrity', () => ({
  hashAutomationDraft: h.hashAutomationDraft,
}));

import { POST } from './route';

function request(body: unknown): Request {
  return new Request('http://localhost/api/automations', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function baseBody() {
  return {
    name: 'Automation',
    description: '',
    trigger_type: 'new_message_received',
    trigger_config: {},
    is_active: false,
    steps: [
      {
        step_type: 'send_message',
        step_config: { text: 'hello' },
        branch: null,
        parent_index: null,
      },
    ],
  };
}

function aiBody() {
  return {
    ...baseBody(),
    source: 'ai_copilot',
    generation_id: 'generation-1',
  };
}

function allowValidAutomation() {
  h.validateTriggerForActivation.mockReturnValue([]);
  h.validateStepsForActivation.mockReturnValue([]);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.requireRole.mockResolvedValue({
    supabase: {},
    accountId: 'account-1',
    userId: 'user-1',
  });
  h.getTemplate.mockReturnValue(undefined);
  h.insertSteps.mockResolvedValue(null);
  h.validateTriggerForActivation.mockReturnValue([
    { path: 'trigger_config', message: 'invalid trigger' },
  ]);
  h.validateStepsForActivation.mockReturnValue([
    { path: 'steps[0]', message: 'invalid step' },
  ]);
  h.state.user = { id: 'user-1' };
  h.state.accountId = 'account-1';
  h.state.insertedAutomation = {
    id: 'automation-1',
    name: 'Automation',
  };
  h.state.automationInsertError = null;
  h.state.rollbackError = null;
  h.state.generation = {
    id: 'generation-1',
    account_id: 'account-1',
    user_id: 'user-1',
    result: 'draft',
    automation_id: null,
    draft_hash: 'expected-draft-hash',
  };
  h.state.generationSelectError = null;
  h.state.generationUpdateError = null;
  h.state.linkedGeneration = { id: 'generation-1' };
  h.state.automationInsertCalls = [];
  h.state.automationDeleteCalls = [];
  h.state.generationSelectCalls = [];
  h.state.generationUpdateCalls = [];
  h.hashAutomationDraft.mockReturnValue('expected-draft-hash');
});

describe('POST /api/automations validation', () => {
  it('continues to accept an incomplete manual draft without activation validation', async () => {
    const res = await POST(
      request({
        ...baseBody(),
        trigger_type: 'keyword_match',
        trigger_config: {},
        steps: [
          {
            step_type: 'send_message',
            step_config: { text: '' },
          },
        ],
      })
    );

    expect(res.status).toBe(201);
    expect(h.validateTriggerForActivation).not.toHaveBeenCalled();
    expect(h.validateStepsForActivation).not.toHaveBeenCalled();
    expect(h.state.automationInsertCalls).toHaveLength(1);
    expect(h.state.generationSelectCalls).toHaveLength(0);
    expect(h.state.generationUpdateCalls).toHaveLength(0);
  });

  it('validates an active automation before creating its parent record', async () => {
    const res = await POST(request({ ...baseBody(), is_active: true }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe(
      'Cannot activate automation with invalid configuration'
    );
    expect(body.issues).toHaveLength(2);
    expect(h.state.automationInsertCalls).toHaveLength(0);
  });

  it('requires a non-empty generation_id for the AI copilot source', async () => {
    const res = await POST(
      request({
        ...baseBody(),
        source: 'ai_copilot',
        generation_id: '   ',
      })
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'generation_id is required for AI-generated automations',
    });
    expect(h.state.generationSelectCalls).toHaveLength(0);
    expect(h.state.automationInsertCalls).toHaveLength(0);
  });

  it('rejects generation_id when the request does not declare the AI copilot source', async () => {
    const res = await POST(
      request({
        ...baseBody(),
        generation_id: 'generation-1',
      })
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'generation_id requires source "ai_copilot"',
    });
    expect(h.state.generationSelectCalls).toHaveLength(0);
    expect(h.state.automationInsertCalls).toHaveLength(0);
  });

  it('validates an AI copilot draft even when it is inactive', async () => {
    const res = await POST(request(aiBody()));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe(
      'Cannot save AI-generated automation with invalid configuration'
    );
    expect(body.issues).toHaveLength(2);
    expect(h.validateTriggerForActivation).toHaveBeenCalledTimes(1);
    expect(h.validateStepsForActivation).toHaveBeenCalledTimes(1);
    expect(h.state.automationInsertCalls).toHaveLength(0);
  });
});

describe('POST /api/automations AI generation ownership', () => {
  it('rejects an AI draft whose canonical hash differs from the verified generation', async () => {
    allowValidAutomation();
    h.hashAutomationDraft.mockReturnValue('tampered-draft-hash');

    const res = await POST(request(aiBody()));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'AI automation draft does not match the verified generation',
    });
    expect(h.state.automationInsertCalls).toHaveLength(0);
    expect(h.state.generationUpdateCalls).toHaveLength(0);
  });

  it('rejects a missing generation before creating an automation', async () => {
    h.state.generation = null;
    allowValidAutomation();

    const res = await POST(request(aiBody()));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: 'AI automation generation not found',
    });
    expect(h.state.automationInsertCalls).toHaveLength(0);
  });

  it('does not reveal a generation from another account', async () => {
    h.state.generation = {
      ...h.state.generation!,
      account_id: 'account-2',
    };
    allowValidAutomation();

    const res = await POST(request(aiBody()));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: 'AI automation generation not found',
    });
    expect(h.state.automationInsertCalls).toHaveLength(0);
  });

  it('does not reveal a generation created by another user', async () => {
    h.state.generation = {
      ...h.state.generation!,
      user_id: 'user-2',
    };
    allowValidAutomation();

    const res = await POST(request(aiBody()));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: 'AI automation generation not found',
    });
    expect(h.state.automationInsertCalls).toHaveLength(0);
  });

  it('rejects a generation that did not produce a draft', async () => {
    h.state.generation = {
      ...h.state.generation!,
      result: 'question',
    };
    allowValidAutomation();

    const res = await POST(request(aiBody()));

    expect(res.status).toBe(409);
    expect(h.state.automationInsertCalls).toHaveLength(0);
  });

  it('rejects a generation that is already linked', async () => {
    h.state.generation = {
      ...h.state.generation!,
      automation_id: 'automation-existing',
    };
    allowValidAutomation();

    const res = await POST(request(aiBody()));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'AI automation generation is already linked',
    });
    expect(h.state.automationInsertCalls).toHaveLength(0);
  });
});

describe('POST /api/automations AI generation persistence', () => {
  it('creates a valid inactive draft and links its generation conditionally', async () => {
    allowValidAutomation();

    const res = await POST(request(aiBody()));

    expect(res.status).toBe(201);
    expect(h.state.generationSelectCalls).toEqual([
      { column: 'id', value: 'generation-1' },
      { column: 'account_id', value: 'account-1' },
      { column: 'user_id', value: 'user-1' },
    ]);
    expect(h.state.automationInsertCalls).toEqual([
      expect.objectContaining({
        user_id: 'user-1',
        account_id: 'account-1',
        is_active: false,
      }),
    ]);
    expect(h.insertSteps).toHaveBeenCalledWith('automation-1', aiBody().steps);
    expect(h.state.generationUpdateCalls).toEqual([
      {
        payload: { automation_id: 'automation-1' },
        filters: [
          { method: 'eq', column: 'id', value: 'generation-1' },
          { method: 'eq', column: 'account_id', value: 'account-1' },
          { method: 'eq', column: 'user_id', value: 'user-1' },
          { method: 'eq', column: 'result', value: 'draft' },
          {
            method: 'eq',
            column: 'draft_hash',
            value: 'expected-draft-hash',
          },
          { method: 'is', column: 'automation_id', value: null },
        ],
      },
    ]);
    expect(h.state.automationDeleteCalls).toHaveLength(0);
  });

  it('rolls back the parent when another request wins the generation link race', async () => {
    allowValidAutomation();
    h.state.linkedGeneration = null;

    const res = await POST(request(aiBody()));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'AI automation generation was linked by another request',
    });
    expect(h.state.automationDeleteCalls).toEqual([
      { column: 'id', value: 'automation-1' },
    ]);
  });

  it('rolls back the parent when generation linkage fails', async () => {
    allowValidAutomation();
    h.state.generationUpdateError = { message: 'link update failed' };

    const res = await POST(request(aiBody()));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'link update failed' });
    expect(h.state.automationDeleteCalls).toEqual([
      { column: 'id', value: 'automation-1' },
    ]);
  });
});

describe('POST /api/automations step persistence rollback', () => {
  it('deletes the newly-created parent and returns the original step insertion error', async () => {
    h.insertSteps.mockResolvedValue('step insert failed');

    const res = await POST(request(baseBody()));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'step insert failed' });
    expect(h.state.automationDeleteCalls).toEqual([
      { column: 'id', value: 'automation-1' },
    ]);
  });

  it('logs a rollback failure without hiding the original step insertion error', async () => {
    h.insertSteps.mockResolvedValue('original step error');
    h.state.rollbackError = { message: 'rollback delete failed' };
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    try {
      const res = await POST(request(baseBody()));

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'original step error' });
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining('Failed to roll back automation automation-1'),
        h.state.rollbackError
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});
