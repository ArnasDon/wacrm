import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiError } from "@/lib/ai/types";

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  checkRateLimit: vi.fn(),
  rateLimitResponse: vi.fn(),
  loadAiConfig: vi.fn(),
  loadCatalog: vi.fn(),
  generateFlowFromPrompt: vi.fn(),
  recordTelemetry: vi.fn(),
  admin: { service: true },
}));

vi.mock("@/lib/auth/account", () => ({
  requireRole: h.requireRole,
  toErrorResponse: (error: unknown) =>
    new Response(JSON.stringify({ error: String(error) }), { status: 500 }),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: h.checkRateLimit,
  rateLimitResponse: h.rateLimitResponse,
  RATE_LIMITS: { aiCopilot: { limit: 20, windowMs: 60_000 } },
}));
vi.mock("@/lib/ai/config", () => ({ loadAiConfig: h.loadAiConfig }));
vi.mock("@/lib/flows/admin-client", () => ({
  supabaseAdmin: () => h.admin,
}));
vi.mock("@/lib/flows/flow-code-server", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/flows/flow-code-server")
  >("@/lib/flows/flow-code-server");
  return {
    ...actual,
    loadFlowCodeCatalog: h.loadCatalog,
  };
});
vi.mock("@/lib/ai/flow-generate", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/flow-generate")>(
    "@/lib/ai/flow-generate",
  );
  return {
    ...actual,
    generateFlowFromPrompt: h.generateFlowFromPrompt,
  };
});
vi.mock("@/lib/ai/automation-telemetry", () => ({
  recordAutomationGeneration: h.recordTelemetry,
}));

import { POST } from "./route";

const CONFIG = {
  accountId: "acct-1",
  provider: "openai" as const,
  model: "gpt-test",
  apiKey: "sk-test",
  agentEnabled: false,
  pipelineMoveEnabled: false,
  autoReplyMaxPerConversation: 3,
  handoffAgentId: null,
};

const FLOW = {
  kind: "wacrm.flow" as const,
  schema_version: 1 as const,
  name: "Atendimento",
  description: null,
  trigger: { type: "manual" as const, config: {} },
  fallback: {
    on_unknown_reply: "ignore" as const,
    max_reprompts: 0,
    on_timeout_hours: 24,
    on_exhaust: "end" as const,
  },
  variables: [],
  resources: [],
  secret_requirements: [],
  entry: "send",
  nodes: [
    {
      key: "send",
      type: "send_message",
      config: { text: "Olá", next_node_key: "end" },
      position: { x: 0, y: 0 },
    },
    { key: "end", type: "end", config: {}, position: { x: 260, y: 0 } },
  ],
};

const METADATA = {
  generationCount: 1,
  repairCount: 0,
  verificationCount: 1,
  promptTokens: 20,
  completionTokens: 8,
  issueCount: 0,
};

function req(body: unknown): Request {
  return new Request("http://localhost/api/flows/generate", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.requireRole.mockResolvedValue({
    supabase: { authenticated: true },
    accountId: "acct-1",
    userId: "user-1",
  });
  h.checkRateLimit.mockResolvedValue({
    success: true,
    remaining: 19,
    reset: Date.now() + 60_000,
    limit: 20,
  });
  h.loadAiConfig.mockResolvedValue(CONFIG);
  h.loadCatalog.mockResolvedValue({ resources: [], flows: [] });
  h.recordTelemetry.mockResolvedValue("generation-1");
  h.generateFlowFromPrompt.mockResolvedValue({
    kind: "draft",
    flow: FLOW,
    code: JSON.stringify(FLOW),
    graph: {
      name: "Atendimento",
      trigger_type: "manual",
      trigger_config: {},
      entry_node_id: "send",
      nodes: [],
    },
    preview: { normalized: "{}", digest: "digest-1", issues: [] },
    verified: true,
    issues: [],
    metadata: METADATA,
  });
});

describe("POST /api/flows/generate", () => {
  it("enforces agent auth, rate limit, AI config and account catalog before generation", async () => {
    await POST(req({ message: "crie um fluxo" }));

    expect(h.requireRole).toHaveBeenCalledWith("agent");
    expect(h.checkRateLimit).toHaveBeenCalledWith(
      "ai-flow-copilot:user-1",
      expect.objectContaining({ limit: 20 }),
    );
    expect(h.loadAiConfig).toHaveBeenCalledWith(
      { authenticated: true },
      "acct-1",
    );
    expect(h.loadCatalog).toHaveBeenCalledWith(h.admin, "acct-1");
    expect(h.generateFlowFromPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        config: CONFIG,
        locale: "en",
        catalog: { resources: [], flows: [] },
      }),
    );
  });

  it("returns a verified flow-code draft with graph preview and telemetry id", async () => {
    const response = await POST(req({ message: "crie um fluxo" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      kind: "draft",
      flow: FLOW,
      code: expect.any(String),
      draft: expect.objectContaining({ trigger_type: "manual" }),
      generation_id: "generation-1",
      verified: true,
      issues: [],
    });
    expect(h.recordTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "acct-1",
        userId: "user-1",
        result: "draft",
        draftHash: "digest-1",
      }),
    );
  });

  it("fails closed when no AI config is available", async () => {
    h.loadAiConfig.mockResolvedValue(null);

    const response = await POST(req({ message: "crie um fluxo" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "ai_not_configured" });
    expect(h.generateFlowFromPrompt).not.toHaveBeenCalled();
  });

  it("returns provider errors with telemetry when generation fails", async () => {
    h.generateFlowFromPrompt.mockRejectedValue(
      new AiError("provider down", { code: "provider_error", status: 502 }),
    );

    const response = await POST(req({ message: "crie um fluxo" }));

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: "provider_error" });
    expect(h.recordTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        result: "failed",
        failureCode: "provider_error",
      }),
    );
  });
});
