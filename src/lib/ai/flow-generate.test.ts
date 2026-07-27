import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  generateStructured: vi.fn(),
  verifyFlowSemantics: vi.fn(),
}));

vi.mock("./generate-structured", () => ({
  generateStructured: h.generateStructured,
}));

vi.mock("./flow-verify", () => ({
  verifyFlowSemantics: h.verifyFlowSemantics,
}));

import { generateFlowFromPrompt } from "./flow-generate";
import type { AiConfig } from "./types";
import type { FlowCodeCatalog, FlowCodeDocument } from "@/lib/flows/flow-code";

const TAG_ID = "11111111-1111-4111-8111-111111111111";

function config(): AiConfig {
  return {
    accountId: "acct-1",
    provider: "openai",
    model: "gpt-test",
    apiKey: "sk-test",
    agentEnabled: false,
    pipelineMoveEnabled: false,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
  };
}

const CATALOG: FlowCodeCatalog = {
  resources: [{ id: TAG_ID, kind: "tag", name: "VIP" }],
  flows: [],
};

function document(text = "Olá"): FlowCodeDocument {
  return {
    kind: "wacrm.flow",
    schema_version: 1,
    name: "Atendimento",
    description: null,
    trigger: { type: "manual", config: {} },
    fallback: {
      on_unknown_reply: "ignore",
      max_reprompts: 0,
      on_timeout_hours: 24,
      on_exhaust: "end",
    },
    variables: [],
    resources: [],
    secret_requirements: [],
    entry: "send",
    nodes: [
      {
        key: "send",
        type: "send_message",
        config: { text, next_node_key: "end" },
        position: { x: 0, y: 0 },
      },
      {
        key: "end",
        type: "end",
        config: {},
        position: { x: 260, y: 0 },
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.verifyFlowSemantics.mockResolvedValue({
    verified: true,
    issues: [],
    usage: { promptTokens: 3, completionTokens: 2 },
  });
});

describe("generateFlowFromPrompt", () => {
  it("generates a verified flow-code draft with a v2 graph preview and no internal ids in model context", async () => {
    h.generateStructured.mockResolvedValue({
      data: { kind: "draft", flow: document() },
      usage: { promptTokens: 10, completionTokens: 5 },
    });

    const result = await generateFlowFromPrompt({
      config: config(),
      history: [{ role: "user", text: "Crie um fluxo manual de saudação" }],
      currentDraft: null,
      locale: "pt-BR",
      catalog: CATALOG,
    });

    expect(result).toMatchObject({
      kind: "draft",
      verified: true,
      issues: [],
      metadata: {
        generationCount: 1,
        repairCount: 0,
        verificationCount: 1,
        promptTokens: 13,
        completionTokens: 7,
        issueCount: 0,
      },
    });
    if (result.kind !== "draft") throw new Error("expected draft");
    expect(result.graph).toMatchObject({
      trigger_type: "manual",
      entry_node_id: "send",
      nodes: expect.arrayContaining([
        expect.objectContaining({ node_key: "send", node_type: "send_message" }),
      ]),
    });

    const generationArgs = h.generateStructured.mock.calls[0][0];
    expect(generationArgs.maxTokens).toBe(4096);
    expect(generationArgs.name).toBe("emit_flow_turn");
    expect(generationArgs.systemPrompt).toContain("schema_version");
    expect(generationArgs.systemPrompt).toContain("first-class trigger node");
    expect(generationArgs.userPrompt).toContain('"locale":"pt-BR"');
    expect(generationArgs.userPrompt).toContain('"VIP"');
    expect(generationArgs.userPrompt).not.toContain(TAG_ID);
  });

  it("repairs once when the independent verifier rejects the first draft", async () => {
    h.generateStructured
      .mockResolvedValueOnce({
        data: { kind: "draft", flow: document("Errado") },
        usage: { promptTokens: 10, completionTokens: 4 },
      })
      .mockResolvedValueOnce({
        data: { kind: "draft", flow: document("Certo") },
        usage: { promptTokens: 12, completionTokens: 5 },
      });
    h.verifyFlowSemantics
      .mockResolvedValueOnce({
        verified: false,
        issues: [{ code: "wrong_message", message: "Wrong message." }],
        usage: { promptTokens: 3, completionTokens: 1 },
      })
      .mockResolvedValueOnce({
        verified: true,
        issues: [],
        usage: { promptTokens: 4, completionTokens: 1 },
      });

    const result = await generateFlowFromPrompt({
      config: config(),
      history: [{ role: "user", text: "Envie Certo" }],
      currentDraft: null,
      locale: "pt-BR",
      catalog: CATALOG,
    });

    expect(result.kind).toBe("draft");
    if (result.kind !== "draft") throw new Error("expected draft");
    expect(result.flow.nodes[0].config.text).toBe("Certo");
    expect(result.metadata).toEqual({
      generationCount: 2,
      repairCount: 1,
      verificationCount: 2,
      promptTokens: 29,
      completionTokens: 11,
      issueCount: 0,
    });
    expect(h.generateStructured).toHaveBeenCalledTimes(2);
    expect(h.generateStructured.mock.calls[1][0]).toMatchObject({
      name: "repair_flow_turn",
      maxTokens: 4096,
    });
  });
});
