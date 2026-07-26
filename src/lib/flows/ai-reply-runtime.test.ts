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
  it("claims the shared reply cap once and exposes only declared variables", async () => {
    const db = {
      rpc: vi.fn(async () => ({ data: true, error: null })),
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
      },
      { loadConfig, generate },
    );
    expect(result).toEqual({ text: "Answer" });
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(db.rpc).toHaveBeenCalledWith("claim_ai_reply_slot", {
      conversation_id: "conversation",
      max_replies: 2,
    });
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "Hello Ada " }),
    );
  });

  it("fails closed without config, conversation or reply credit", async () => {
    const db = {
      rpc: vi.fn(async () => ({ data: false, error: null })),
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
        },
        {
          loadConfig: vi.fn(async () => aiConfig),
          generate: vi.fn(),
        },
      ),
    ).rejects.toThrow(/credit|cap/i);
  });
});
