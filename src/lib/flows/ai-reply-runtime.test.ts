import { describe, expect, it, vi } from "vitest";

import { generateFlowAiReply } from "./ai-reply-runtime";

const aiConfig = {
  accountId: "account",
  provider: "openai" as const,
  model: "gpt-test",
  apiKey: "secret",
  agentEnabled: true,
  pipelineMoveEnabled: false,
  autoReplyMaxPerConversation: 2,
  handoffAgentId: null,
};

describe("flow ai reply runtime", () => {
  it("claims an idempotent effect-bound reply credit and exposes only declared variables", async () => {
    const db = {
      rpc: vi.fn(async () => ({
        data: [{ allowed: true, is_owner: true }],
        error: null,
      })),
    };
    const loadConfig = vi.fn(async () => aiConfig);
    const generate = vi.fn(async () => ({ text: "Answer", usage: null }));
    const result = await generateFlowAiReply(
      db,
      {
        accountId: "account",
        conversationId: "conversation",
        systemPrompt: "System",
        prompt: "Hello {{vars.name}} {{vars.secret}}",
        inputVariables: ["name"],
        vars: { name: "Ada", secret: "hidden" },
        maxTokens: 100,
        effectId: "effect-1",
        operationId: "operation-1",
        claimToken: "claim-1",
      },
      { loadConfig, generate },
    );
    expect(result).toEqual({ text: "Answer" });
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(db.rpc).toHaveBeenCalledWith("claim_flow_ai_reply_credit", {
      p_effect_id: "effect-1",
      p_operation_id: "operation-1",
      p_claim_token: "claim-1",
      p_conversation_id: "conversation",
      p_max_replies: 2,
    });
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "Hello Ada " }),
    );
  });

  it("fails closed without config, conversation or reply credit", async () => {
    const db = {
      rpc: vi.fn(async () => ({
        data: [{ allowed: false, is_owner: true }],
        error: null,
      })),
    };
    await expect(
      generateFlowAiReply(
        db,
        {
          accountId: "account",
          conversationId: "conversation",
          systemPrompt: "",
          prompt: "Hello",
          inputVariables: [],
          vars: {},
          maxTokens: 10,
          effectId: "effect-1",
          operationId: "operation-1",
          claimToken: "claim-1",
        },
        {
          loadConfig: vi.fn(async () => null),
          generate: vi.fn(),
        },
      ),
    ).rejects.toThrow(/configured/i);
    await expect(
      generateFlowAiReply(
        db,
        {
          accountId: "account",
          conversationId: "conversation",
          systemPrompt: "",
          prompt: "Hello",
          inputVariables: [],
          vars: {},
          maxTokens: 10,
          effectId: "effect-1",
          operationId: "operation-1",
          claimToken: "claim-1",
        },
        {
          loadConfig: vi.fn(async () => aiConfig),
          generate: vi.fn(),
        },
      ),
    ).rejects.toThrow(/credit|cap/i);
  });

  it("replays the same credit claim after commit plus response loss without spending twice", async () => {
    let count = 0;
    const receipts = new Map<string, boolean>();
    const rpc = vi.fn(
      async (_name: string, args: Record<string, unknown>) => {
        const key = `${args.p_effect_id}:${args.p_operation_id}`;
        if (!receipts.has(key)) {
          count += 1;
          receipts.set(key, true);
          return {
            data: null,
            error: { message: "committed response lost" },
          };
        }
        return {
          data: [{ allowed: receipts.get(key), is_owner: true }],
          error: null,
        };
      },
    );
    const generate = vi.fn(async () => ({ text: "once", usage: null }));

    const result = await generateFlowAiReply(
      { rpc },
      {
        accountId: "account",
        conversationId: "conversation",
        systemPrompt: "",
        prompt: "Hello",
        inputVariables: [],
        vars: {},
        maxTokens: 10,
        effectId: "effect-1",
        operationId: "operation-1",
        claimToken: "claim-1",
      },
      {
        loadConfig: vi.fn(async () => aiConfig),
        generate,
      },
    );

    expect(result).toEqual({ text: "once" });
    expect(count).toBe(1);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("replays denied claims and blocks a concurrent non-owner before the provider", async () => {
    const generate = vi.fn(async () => ({ text: "never", usage: null }));
    const deniedDb = {
      rpc: vi.fn(async () => ({
        data: [{ allowed: false, is_owner: true }],
        error: null,
      })),
    };
    const args = {
      accountId: "account",
      conversationId: "conversation",
      systemPrompt: "",
      prompt: "Hello",
      inputVariables: [],
      vars: {},
      maxTokens: 10,
      effectId: "effect-denied",
      operationId: "operation-denied",
      claimToken: "claim-denied",
    };
    const dependencies = {
      loadConfig: vi.fn(async () => aiConfig),
      generate,
    };

    await expect(
      generateFlowAiReply(deniedDb, args, dependencies),
    ).rejects.toThrow(/cap/i);
    await expect(
      generateFlowAiReply(deniedDb, args, dependencies),
    ).rejects.toThrow(/cap/i);

    const nonOwnerDb = {
      rpc: vi.fn(async () => ({
        data: [{ allowed: true, is_owner: false }],
        error: null,
      })),
    };
    await expect(
      generateFlowAiReply(nonOwnerDb, args, dependencies),
    ).rejects.toThrow(/another|owner|progress/i);
    expect(generate).not.toHaveBeenCalled();
  });
});
