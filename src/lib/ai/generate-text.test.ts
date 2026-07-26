import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  openai: vi.fn(),
  anthropic: vi.fn(),
}));
vi.mock("./providers/openai", () => ({ generateOpenAi: h.openai }));
vi.mock("./providers/anthropic", () => ({ generateAnthropic: h.anthropic }));

import { generateText } from "./generate-text";

const config = {
  accountId: "account",
  provider: "openai" as const,
  model: "gpt-test",
  apiKey: "secret",
  agentEnabled: true,
  pipelineMoveEnabled: false,
  autoReplyMaxPerConversation: 3,
  handoffAgentId: null,
};

describe("generateText", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reuses the configured provider with bounded tokens and AbortSignal", async () => {
    h.openai.mockResolvedValue({
      text: " hello ",
      usage: { promptTokens: 2, completionTokens: 1 },
    });
    const signal = new AbortController().signal;
    await expect(
      generateText({
        config,
        systemPrompt: "system",
        prompt: "prompt",
        maxTokens: 10,
        signal,
      }),
    ).resolves.toEqual({
      text: "hello",
      usage: { promptTokens: 2, completionTokens: 1 },
    });
    expect(h.openai).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "secret",
        maxTokens: 10,
        signal,
      }),
    );
  });

  it("rejects empty or oversized provider output", async () => {
    h.openai.mockResolvedValue({ text: " ", usage: null });
    await expect(
      generateText({
        config,
        systemPrompt: "",
        prompt: "prompt",
        maxTokens: 10,
      }),
    ).rejects.toThrow(/empty/i);
    h.openai.mockResolvedValue({ text: "x".repeat(16_001), usage: null });
    await expect(
      generateText({
        config,
        systemPrompt: "",
        prompt: "prompt",
        maxTokens: 10,
      }),
    ).rejects.toThrow(/long/i);
  });
});
