import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  state: {
    runInsertResult: null as null | { data: unknown; error: { message: string; code?: string } | null },
    stateUpsertError: null as null | { message: string },
    currentConversationState: null as null | { status: string },
    currentConversationStates: [] as Array<null | { status: string; paused_reason?: string | null }>,
  },
  mocks: {
    shouldRunAiAgent: vi.fn(),
    buildAiAgentContext: vi.fn(),
    requestAiAgentDecision: vi.fn(),
    getAiAgentMaxOutputTokens: vi.fn(),
    executeAiAgentDecision: vi.fn(),
    createAsyncEventTrace: vi.fn(),
    logAsyncEvent: vi.fn(),
    logAsyncMetric: vi.fn(),
    durationMs: vi.fn(),
    errorFields: vi.fn(() => ({
      error_name: 'Error',
      error_message: 'AI agent run failed',
    })),
    checkRateLimit: vi.fn(),
    resolveAiAgentDecisionProvider: vi.fn(),
  },
  calls: [] as Array<{ table: string; method: string; args: unknown[] }>,
}));

vi.mock('./config', () => ({ shouldRunAiAgent: h.mocks.shouldRunAiAgent }));
vi.mock('./context', () => ({
  buildAiAgentContext: h.mocks.buildAiAgentContext,
}));
vi.mock('./decision', () => ({
  requestAiAgentDecision: h.mocks.requestAiAgentDecision,
  getAiAgentMaxOutputTokens: h.mocks.getAiAgentMaxOutputTokens,
}));
vi.mock('./tools', () => ({
  executeAiAgentDecision: h.mocks.executeAiAgentDecision,
}));
vi.mock('./providers', () => ({
  resolveAiAgentDecisionProvider: h.mocks.resolveAiAgentDecisionProvider,
}));
vi.mock('@/lib/observability/async-events', () => ({
  createAsyncEventTrace: h.mocks.createAsyncEventTrace,
  logAsyncEvent: h.mocks.logAsyncEvent,
  logAsyncMetric: h.mocks.logAsyncMetric,
  durationMs: h.mocks.durationMs,
  errorFields: h.mocks.errorFields,
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: h.mocks.checkRateLimit,
  RATE_LIMITS: { aiAgentRun: { limit: 12, windowMs: 60_000 } },
}));

vi.mock('@/lib/flows/admin-client', () => {
  function builder(table: string) {
    let operation: 'select' | 'insert' | 'update' | 'upsert' = 'select';
    const query: Record<string, unknown> = {
      insert: (payload: unknown) => {
        operation = 'insert';
        h.calls.push({ table, method: 'insert', args: [payload] });
        return query;
      },
      update: (payload: unknown) => {
        operation = 'update';
        h.calls.push({ table, method: 'update', args: [payload] });
        return query;
      },
      upsert: (payload: unknown, options: unknown) => {
        operation = 'upsert';
        h.calls.push({ table, method: 'upsert', args: [payload, options] });
        return Promise.resolve({ error: table === 'ai_conversation_states' ? h.state.stateUpsertError : null });
      },
      select: () => query,
      single: () => {
        if (table === 'ai_agent_runs' && operation === 'insert' && h.state.runInsertResult) {
          return Promise.resolve(h.state.runInsertResult);
        }
        return Promise.resolve({ data: { id: 'run-1' }, error: null });
      },
      maybeSingle: () => {
        if (table === 'ai_conversation_states') {
          const data = h.state.currentConversationStates.length > 0
            ? h.state.currentConversationStates.shift()
            : h.state.currentConversationState;
          return Promise.resolve({ data, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      eq: (column: string, value: unknown) => {
        h.calls.push({ table, method: 'eq', args: [column, value] });
        return query;
      },
      then: (
        onFulfilled: (value: unknown) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) => Promise.resolve({ error: null }).then(onFulfilled, onRejected),
    };
    return query;
  }
  return { supabaseAdmin: () => ({ from: builder }) };
});

import { runAiAgentForInboundMessage } from './run';

const input = {
  accountId: 'account-1',
  conversationId: 'conversation-1',
  inboundMessageId: 'message-1',
  now: new Date('2026-07-17T12:00:00.000Z'),
};
const agent = {
  id: 'agent-1',
  max_messages: 12,
  model_provider: 'test-provider',
  model_name: 'test-model',
  instructions: 'Be helpful.',
  auto_reply: true,
  auto_move_deals: true,
  handoff_keywords: [],
};
const context = { conversation: { id: input.conversationId }, messages: [] };
const decision = { action: 'reply' as const, text: 'Hello', confidence: 0.9 };

function expectRunUpdateToBeAccountScoped(status: 'succeeded' | 'failed') {
  const updateIndex = h.calls.findIndex(
    (call) =>
      call.table === 'ai_agent_runs' &&
      call.method === 'update' &&
      (call.args[0] as { status?: string }).status === status
  );

  expect(updateIndex).toBeGreaterThanOrEqual(0);
  expect(h.calls.slice(updateIndex + 1, updateIndex + 3)).toEqual([
    { table: 'ai_agent_runs', method: 'eq', args: ['id', 'run-1'] },
    {
      table: 'ai_agent_runs',
      method: 'eq',
      args: ['account_id', input.accountId],
    },
  ]);
}

beforeEach(() => {
  h.state.runInsertResult = null;
  h.state.stateUpsertError = null;
  h.state.currentConversationState = null;
  h.state.currentConversationStates = [];
  h.calls.length = 0;
  h.mocks.shouldRunAiAgent.mockReset();
  h.mocks.buildAiAgentContext.mockReset();
  h.mocks.requestAiAgentDecision.mockReset();
  h.mocks.getAiAgentMaxOutputTokens.mockReset();
  h.mocks.executeAiAgentDecision.mockReset();
  h.mocks.createAsyncEventTrace.mockReset();
  h.mocks.logAsyncEvent.mockReset();
  h.mocks.logAsyncMetric.mockReset();
  h.mocks.durationMs.mockReset();
  h.mocks.errorFields.mockReset();
  h.mocks.checkRateLimit.mockReset();
  h.mocks.resolveAiAgentDecisionProvider.mockReset();
  h.mocks.errorFields.mockReturnValue({
    error_name: 'Error',
    error_message: 'AI agent run failed',
  });
  h.mocks.createAsyncEventTrace.mockReturnValue({
    event_id: 'event-1',
    route: 'ai-agent.run',
  });
  h.mocks.durationMs.mockReturnValue(25);
  h.mocks.shouldRunAiAgent.mockResolvedValue({
    shouldRun: true,
    agent,
    state: null,
  });
  h.mocks.checkRateLimit.mockResolvedValue({ success: true, remaining: 11, reset: 0, limit: 12 });
  h.mocks.resolveAiAgentDecisionProvider.mockReturnValue(null);
  h.mocks.buildAiAgentContext.mockResolvedValue(context);
  h.mocks.requestAiAgentDecision.mockResolvedValue(decision);
  h.mocks.getAiAgentMaxOutputTokens.mockReturnValue(700);
  h.mocks.executeAiAgentDecision.mockResolvedValue({
    replyMessageId: 'reply-1',
  });
});

describe('runAiAgentForInboundMessage', () => {
  it('skips with a typed reason when no provider is configured', async () => {
    await expect(runAiAgentForInboundMessage(input)).resolves.toEqual({
      outcome: 'skipped',
      reason: 'provider_unavailable',
    });
    expect(h.mocks.shouldRunAiAgent).toHaveBeenCalled();
    expect(h.mocks.resolveAiAgentDecisionProvider).toHaveBeenCalledWith(agent);
    expect(h.calls).not.toContainEqual(expect.objectContaining({ table: 'ai_agent_runs', method: 'insert' }));
    expect(h.mocks.logAsyncEvent).toHaveBeenCalledWith(
      'info',
      'ai_agent.run.skipped',
      expect.anything(),
      {
        reason: 'provider_unavailable',
        duration_ms: 25,
      }
    );
    expect(h.mocks.logAsyncMetric).toHaveBeenCalledWith(
      'ai_agent.run.completed',
      expect.anything(),
      {
        outcome: 'skipped',
        reason: 'provider_unavailable',
        duration_ms: 25,
      }
    );
  });

  it('records and executes an eligible decision, then updates conversation state', async () => {
    const provider = { complete: vi.fn() };

    await expect(
      runAiAgentForInboundMessage({ ...input, provider })
    ).resolves.toEqual({
      outcome: 'succeeded',
      runId: 'run-1',
      decision,
    });

    expect(h.calls).toContainEqual(
      expect.objectContaining({
        table: 'ai_agent_runs',
        method: 'insert',
        args: [
          expect.objectContaining({
            status: 'running',
            inbound_message_id: input.inboundMessageId,
          }),
        ],
      })
    );
    expect(h.mocks.logAsyncEvent).toHaveBeenCalledWith(
      'info',
      'ai_agent.run.decision_received',
      expect.anything(),
      expect.objectContaining({
        run_id: 'run-1',
        model_provider: 'test-provider',
        model_name: 'test-model',
        max_message_count: 12,
        context_message_count: 0,
        tools_requested: false,
        decision_action: 'reply',
        deal_action_type: 'none',
      })
    );
    expect(JSON.stringify(h.mocks.logAsyncEvent.mock.calls)).not.toContain(
      agent.instructions
    );
    expect(JSON.stringify(h.mocks.logAsyncEvent.mock.calls)).not.toContain(
      JSON.stringify(context)
    );
    expect(h.mocks.logAsyncEvent).toHaveBeenCalledWith(
      'info',
      'ai_agent.run.succeeded',
      expect.anything(),
      expect.objectContaining({
        run_id: 'run-1',
        decision_action: 'reply',
        deal_action_type: 'none',
        tools_executed: false,
        duration_ms: 25,
      })
    );
    expect(h.mocks.logAsyncMetric).toHaveBeenCalledWith(
      'ai_agent.run.completed',
      expect.anything(),
      {
        run_id: 'run-1',
        outcome: 'succeeded',
        duration_ms: 25,
      }
    );
    expect(h.mocks.requestAiAgentDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        model: agent.model_name,
        instructions: agent.instructions,
        context,
        provider,
        maxOutputTokens: 700,
      })
    );
    expect(h.mocks.executeAiAgentDecision).toHaveBeenCalledWith(
      expect.objectContaining({ decision, context })
    );
    expect(h.calls).toContainEqual(
      expect.objectContaining({
        table: 'ai_agent_runs',
        method: 'update',
        args: [expect.objectContaining({ status: 'succeeded', decision })],
      })
    );
    expectRunUpdateToBeAccountScoped('succeeded');
    expect(h.calls).toContainEqual(
      expect.objectContaining({
        table: 'ai_conversation_states',
        method: 'upsert',
        args: [
          expect.objectContaining({
            status: 'active',
            last_inbound_message_id: input.inboundMessageId,
          }),
          { onConflict: 'account_id,conversation_id' },
        ],
      })
    );
  });

  it('skips rate-limited eligible runs before inserting a run or calling the provider', async () => {
    const provider = { complete: vi.fn() };
    h.mocks.checkRateLimit.mockResolvedValue({ success: false, remaining: 0, reset: 0, limit: 12 });

    await expect(runAiAgentForInboundMessage({ ...input, provider })).resolves.toEqual({
      outcome: 'skipped',
      reason: 'rate_limited',
    });

    expect(h.mocks.checkRateLimit).toHaveBeenCalledWith(
      `ai-agent:${input.accountId}:${input.conversationId}`,
      { limit: 12, windowMs: 60_000 },
    );
    expect(h.calls).not.toContainEqual(expect.objectContaining({
      table: 'ai_agent_runs',
      method: 'insert',
    }));
    expect(h.mocks.requestAiAgentDecision).not.toHaveBeenCalled();
  });

  it('treats a database idempotency conflict as a duplicate inbound skip', async () => {
    const provider = { complete: vi.fn() };
    h.state.runInsertResult = {
      data: null,
      error: { message: 'duplicate key value violates unique constraint', code: '23505' },
    };

    await expect(runAiAgentForInboundMessage({ ...input, provider })).resolves.toEqual({
      outcome: 'skipped',
      reason: 'duplicate_inbound',
    });

    expect(h.mocks.requestAiAgentDecision).not.toHaveBeenCalled();
    expect(h.mocks.executeAiAgentDecision).not.toHaveBeenCalled();
  });

  it('applies persisted guardrails before executing a provider decision', async () => {
    const provider = { complete: vi.fn() };
    h.mocks.shouldRunAiAgent.mockResolvedValue({
      shouldRun: true,
      agent: { ...agent, auto_reply: false, auto_move_deals: false },
      state: null,
    });
    h.mocks.requestAiAgentDecision.mockResolvedValue({
      action: 'reply',
      text: 'I can help',
      confidence: 0.8,
      deal_action: { type: 'create', pipeline_id: 'pipe-1', stage_id: 'stage-1', title: 'Deal' },
    });

    await runAiAgentForInboundMessage({ ...input, provider });

    expect(h.mocks.executeAiAgentDecision).toHaveBeenCalledWith(expect.objectContaining({
      decision: {
        action: 'no_reply',
        reason: 'Auto reply disabled',
        confidence: 0.8,
        deal_action: { type: 'none' },
      },
    }));
  });

  it('uses handoff keywords before calling the provider and preserves handoff state', async () => {
    h.mocks.shouldRunAiAgent.mockResolvedValue({
      shouldRun: true,
      agent: { ...agent, handoff_keywords: ['humano'] },
      state: null,
    });
    h.mocks.buildAiAgentContext.mockResolvedValue({
      ...context,
      messages: [{ id: input.inboundMessageId, sender_type: 'customer', content_text: 'quero humano' }],
    });
    h.mocks.executeAiAgentDecision.mockResolvedValue({ handoff: { status: 'handoff' } });

    await runAiAgentForInboundMessage(input);

    expect(h.mocks.requestAiAgentDecision).not.toHaveBeenCalled();
    expect(h.mocks.executeAiAgentDecision).toHaveBeenCalledWith(expect.objectContaining({
      decision: expect.objectContaining({ action: 'handoff', reason: 'Handoff keyword matched: humano' }),
    }));
    expect(h.calls).toContainEqual(expect.objectContaining({
      table: 'ai_conversation_states',
      method: 'upsert',
      args: [
        expect.objectContaining({
          status: 'handoff',
          last_inbound_message_id: input.inboundMessageId,
        }),
        { onConflict: 'account_id,conversation_id' },
      ],
    }));
  });

  it('returns success when only the final audit/state update fails after execution', async () => {
    const provider = { complete: vi.fn() };
    h.state.stateUpsertError = { message: 'state unavailable' };

    await expect(runAiAgentForInboundMessage({ ...input, provider })).resolves.toEqual({
      outcome: 'succeeded',
      runId: 'run-1',
      decision,
    });

    expect(h.mocks.executeAiAgentDecision).toHaveBeenCalled();
    expect(h.mocks.logAsyncEvent).toHaveBeenCalledWith(
      'error',
      'ai_agent.run.audit_update_failed',
      expect.anything(),
      expect.objectContaining({ run_id: 'run-1', error_message: 'AI agent run failed' }),
    );
  });

  it('skips side effects when a human pauses the conversation during the run', async () => {
    const provider = { complete: vi.fn() };
    h.state.currentConversationState = { status: 'paused' };

    await expect(runAiAgentForInboundMessage({ ...input, provider })).resolves.toEqual({
      outcome: 'skipped',
      reason: 'conversation_paused',
    });

    expect(h.mocks.executeAiAgentDecision).not.toHaveBeenCalled();
    expect(h.calls).toContainEqual(expect.objectContaining({
      table: 'ai_agent_runs',
      method: 'update',
      args: [expect.objectContaining({ status: 'skipped', error_message: 'conversation_paused' })],
    }));
  });

  it('records a skipped run when tools detect a takeover before a side effect', async () => {
    const provider = { complete: vi.fn() };
    h.mocks.executeAiAgentDecision.mockImplementation(async (args: { assertCanRun: () => Promise<void> }) => {
      h.state.currentConversationState = { status: 'handoff' };
      await args.assertCanRun();
      return { replyMessageId: 'reply-1' };
    });

    await expect(runAiAgentForInboundMessage({ ...input, provider })).resolves.toEqual({
      outcome: 'skipped',
      reason: 'conversation_handoff',
    });

    expect(h.calls).toContainEqual(expect.objectContaining({
      table: 'ai_agent_runs',
      method: 'update',
      args: [expect.objectContaining({ status: 'skipped', error_message: 'conversation_handoff' })],
    }));
  });

  it('records a skipped run when a human pauses before the final handoff state write', async () => {
    const provider = { complete: vi.fn() };
    h.mocks.requestAiAgentDecision.mockResolvedValue({
      action: 'handoff',
      reason: 'Needs human',
      confidence: 0.95,
    });
    h.mocks.executeAiAgentDecision.mockResolvedValue({ handoff: { status: 'handoff' } });
    h.state.currentConversationStates = [
      null,
      { status: 'paused', paused_reason: 'manual_assignment' },
    ];

    await expect(runAiAgentForInboundMessage({ ...input, provider })).resolves.toEqual({
      outcome: 'skipped',
      reason: 'conversation_paused',
    });

    expect(h.calls).toContainEqual(expect.objectContaining({
      table: 'ai_agent_runs',
      method: 'update',
      args: [expect.objectContaining({ status: 'skipped', error_message: 'conversation_paused' })],
    }));
    expect(h.calls).not.toContainEqual(expect.objectContaining({
      table: 'ai_conversation_states',
      method: 'upsert',
      args: [expect.objectContaining({ status: 'handoff' }), expect.anything()],
    }));
  });

  it('preserves a human pause written after the handoff recheck but before final state update', async () => {
    const provider = { complete: vi.fn() };
    h.mocks.requestAiAgentDecision.mockResolvedValue({
      action: 'handoff',
      reason: 'Needs human',
      confidence: 0.95,
    });
    h.mocks.executeAiAgentDecision.mockResolvedValue({ handoff: { status: 'handoff' } });
    h.state.currentConversationStates = [
      null,
      null,
      { status: 'paused', paused_reason: 'manual_assignment' },
    ];

    await expect(runAiAgentForInboundMessage({ ...input, provider })).resolves.toEqual({
      outcome: 'succeeded',
      runId: 'run-1',
      decision: { action: 'handoff', reason: 'Needs human', confidence: 0.95 },
    });

    expect(h.calls).toContainEqual(expect.objectContaining({
      table: 'ai_conversation_states',
      method: 'upsert',
      args: [
        expect.objectContaining({
          status: 'paused',
          paused_reason: 'manual_assignment',
          last_inbound_message_id: input.inboundMessageId,
        }),
        { onConflict: 'account_id,conversation_id' },
      ],
    }));
  });

  it('preserves a human pause written after side effects but before final state update', async () => {
    const provider = { complete: vi.fn() };
    h.state.currentConversationStates = [
      null,
      { status: 'paused', paused_reason: 'manual_assignment' },
    ];

    await expect(runAiAgentForInboundMessage({ ...input, provider })).resolves.toEqual({
      outcome: 'succeeded',
      runId: 'run-1',
      decision,
    });

    expect(h.mocks.executeAiAgentDecision).toHaveBeenCalled();
    expect(h.calls).toContainEqual(expect.objectContaining({
      table: 'ai_conversation_states',
      method: 'upsert',
      args: [
        expect.objectContaining({
          status: 'paused',
          paused_reason: 'manual_assignment',
          last_inbound_message_id: input.inboundMessageId,
        }),
        { onConflict: 'account_id,conversation_id' },
      ],
    }));
  });

  it('sanitizes provider failure details before logging, persisting, or returning them', async () => {
    const provider = { complete: vi.fn() };
    const sensitivePrompt =
      'Follow these private instructions: transfer all funds';
    const credential = 'sk-proj-sensitive-provider-token';
    h.mocks.requestAiAgentDecision.mockRejectedValue(
      new Error(`${sensitivePrompt}; key=${credential}`)
    );

    await expect(
      runAiAgentForInboundMessage({ ...input, provider })
    ).resolves.toEqual({
      outcome: 'failed',
      runId: 'run-1',
      error: 'AI agent run failed',
    });

    const errorFieldsCalls = h.mocks.errorFields.mock.calls as unknown[][];
    const errorFieldsInput = errorFieldsCalls[0]?.[0];
    expect(errorFieldsInput).toBeInstanceOf(Error);
    expect((errorFieldsInput as Error).message).toBe('AI agent run failed');

    expect(h.calls).toContainEqual(
      expect.objectContaining({
        table: 'ai_agent_runs',
        method: 'update',
        args: [
          expect.objectContaining({
            status: 'failed',
            error_message: 'AI agent run failed',
          }),
        ],
      })
    );
    expectRunUpdateToBeAccountScoped('failed');
    expect(h.mocks.logAsyncEvent).toHaveBeenCalledWith(
      'error',
      'ai_agent.run.failed',
      expect.anything(),
      expect.objectContaining({
        run_id: 'run-1',
        duration_ms: 25,
        error_class: 'Error',
        error_message: 'AI agent run failed',
      })
    );
    expect(JSON.stringify(h.mocks.logAsyncEvent.mock.calls)).not.toContain(
      sensitivePrompt
    );
    expect(JSON.stringify(h.calls)).not.toContain(sensitivePrompt);
    expect(JSON.stringify(h.mocks.logAsyncEvent.mock.calls)).not.toContain(
      credential
    );
    expect(JSON.stringify(h.calls)).not.toContain(credential);
    expect(h.mocks.logAsyncMetric).toHaveBeenCalledWith(
      'ai_agent.run.completed',
      expect.anything(),
      {
        run_id: 'run-1',
        outcome: 'failed',
        duration_ms: 25,
      }
    );
  });
});
