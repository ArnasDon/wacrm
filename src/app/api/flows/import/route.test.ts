import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  rpc: vi.fn(),
  previewDigest: "a".repeat(64),
  blocking: false,
  capturedSecrets: {} as Record<string, string>,
}));

vi.mock("@/lib/auth/account", () => ({
  requireRole: h.requireRole,
  toErrorResponse: () =>
    Response.json({ code: "IMPORT_FORBIDDEN" }, { status: 403 }),
}));

vi.mock("@/lib/flows/admin-client", () => ({
  supabaseAdmin: () => ({ rpc: h.rpc }),
}));

vi.mock("@/lib/flows/flow-code-server", () => ({
  loadFlowCodeCatalog: async () => ({ resources: [], flows: [] }),
  previewFlowCode: (
    _document: string,
    _catalog: unknown,
    _flowId: unknown,
    _resources: unknown,
    secrets: Record<string, string>,
  ) => {
    h.capturedSecrets = secrets;
    return ({
    preview: {
      normalized: "{}\n",
      digest: h.previewDigest,
      resolved: {},
      secret_requirements: Object.keys(secrets).map((name) => ({
        name,
        node_key: "request",
        path: `config.headers.${name.split(".").at(-1)}`,
      })),
      issues: h.blocking
        ? [
            {
              code: "RESOURCE_MISSING",
              severity: "blocking",
              message: "missing",
            },
          ]
        : [],
    },
    graph: {
      name: "Imported",
      description: null,
      trigger_type: "manual",
      trigger_config: {},
      entry_node_id: null,
      fallback_policy: {
        on_unknown_reply: "reprompt",
        max_reprompts: 2,
        on_timeout_hours: 24,
        on_exhaust: "handoff",
      },
      variable_schema: [],
      nodes:
        Object.keys(secrets).length > 0
          ? [
              {
                node_key: "request",
                node_type: "http_request",
                config: {
                  headers: Object.fromEntries(
                    Object.entries(secrets).map(([name, value]) => [
                      name.split(".").at(-1),
                      value,
                    ]),
                  ),
                },
                position_x: 0,
                position_y: 0,
              },
            ]
          : [],
    },
  });
  },
  hasCommitBlockingIssues: (
    issues: Array<{ severity: string }>,
  ) => issues.some((issue) => issue.severity === "blocking"),
  safeImportRpcError: (message: string) =>
    message.includes("draft_revision_conflict")
      ? { status: 409, code: "DRAFT_REVISION_CONFLICT" }
      : { status: 500, code: "IMPORT_FAILED" },
}));

import { POST as CREATE } from "./route";
import { POST as REPLACE } from "../[id]/import/route";
import { parseFlowCodeInput } from "@/lib/flows/flow-code";

const document = JSON.stringify({
  kind: "wacrm.flow",
  schema_version: 1,
  name: "Imported",
  description: null,
  trigger: { type: "manual", config: {} },
  fallback: {
    on_unknown_reply: "reprompt",
    max_reprompts: 2,
    on_timeout_hours: 24,
    on_exhaust: "handoff",
  },
  variables: [],
  resources: [],
  secret_requirements: [],
  entry: null,
  nodes: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  h.previewDigest = parseFlowCodeInput(document).digest;
  h.blocking = false;
  h.capturedSecrets = {};
  h.requireRole.mockResolvedValue({
    userId: "actor-1",
    accountId: "account-1",
    role: "agent",
  });
  h.rpc.mockResolvedValue({
    data: [{ id: "flow-1", draft_revision: 0 }],
    error: null,
  });
});

describe("flow code commit APIs", () => {
  it("creates a draft only through the atomic account-scoped RPC", async () => {
    const response = await CREATE(
      new Request("http://localhost/api/flows/import", {
        method: "POST",
        body: JSON.stringify({
          document,
          preview_digest: h.previewDigest,
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(h.rpc).toHaveBeenCalledOnce();
    expect(h.rpc).toHaveBeenCalledWith(
      "import_flow_draft",
      expect.objectContaining({
        p_actor_id: "actor-1",
        p_account_id: "account-1",
        p_flow_id: null,
        p_expected_revision: null,
      }),
    );
  });

  it("replaces a draft with CAS and maps conflicts without leaking SQL", async () => {
    h.rpc.mockResolvedValue({
      data: null,
      error: { message: "draft_revision_conflict table=private" },
    });
    const response = await REPLACE(
      new Request("http://localhost/api/flows/flow-1/import", {
        method: "POST",
        body: JSON.stringify({
          document,
          preview_digest: h.previewDigest,
          expected_draft_revision: 7,
        }),
      }),
      { params: Promise.resolve({ id: "flow-1" }) },
    );

    expect(response.status).toBe(409);
    expect(h.rpc).toHaveBeenCalledWith(
      "import_flow_draft",
      expect.objectContaining({
        p_flow_id: "flow-1",
        p_expected_revision: 7,
        p_account_id: "account-1",
      }),
    );
    expect(await response.json()).toEqual({
      code: "DRAFT_REVISION_CONFLICT",
    });
  });

  it("does not mutate when authorization, digest or resolution fails", async () => {
    h.requireRole.mockRejectedValueOnce(new Error("forbidden"));
    const denied = await CREATE(
      new Request("http://localhost/api/flows/import", {
        method: "POST",
        body: JSON.stringify({
          document,
          preview_digest: h.previewDigest,
        }),
      }),
    );
    h.requireRole.mockResolvedValue({
      userId: "actor-1",
      accountId: "account-1",
    });
    const digestMismatch = await CREATE(
      new Request("http://localhost/api/flows/import", {
        method: "POST",
        body: JSON.stringify({
          document,
          preview_digest: "b".repeat(64),
        }),
      }),
    );
    h.blocking = true;
    const blocked = await CREATE(
      new Request("http://localhost/api/flows/import", {
        method: "POST",
        body: JSON.stringify({
          document,
          preview_digest: h.previewDigest,
        }),
      }),
    );

    expect(denied.status).toBe(403);
    expect(digestMismatch.status).toBe(409);
    expect(blocked.status).toBe(422);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("hydrates secrets atomically from the same bounded multipart request", async () => {
    const secretValues = {
      "request.headers.Authorization": "Bearer private-token-value",
      "request.headers.ApiKey": "sk-abcdefghijklmnopqrstuvwxyz",
      "request.headers.Hex": "abcdef0123456789abcdef0123456789",
      "request.headers.Uuid": "11111111-1111-4111-8111-111111111111",
    };
    const secretDocument = JSON.stringify({
      kind: "wacrm.flow",
      schema_version: 1,
      name: "Secret import",
      description: null,
      trigger: { type: "manual", config: {} },
      fallback: {
        on_unknown_reply: "reprompt",
        max_reprompts: 2,
        on_timeout_hours: 24,
        on_exhaust: "handoff",
      },
      variables: [
        { key: "response", type: "json", required: false, sensitive: true },
      ],
      resources: [],
      secret_requirements: Object.keys(secretValues).map((name) => ({
          name,
          node_key: "request",
          path: `config.headers.${name.split(".").at(-1)}`,
        })),
      entry: "request",
      nodes: [
        {
          key: "request",
          type: "http_request",
          config: {
            method: "GET",
            url: "https://example.test",
            headers: Object.fromEntries(
              Object.keys(secretValues).map((name) => [
                name.split(".").at(-1),
                { $secret: name },
              ]),
            ),
            response_var: "response",
            next_node_key: "end",
          },
          position: { x: 0, y: 0 },
        },
      ],
    });
    h.previewDigest = parseFlowCodeInput(secretDocument).digest;
    const form = new FormData();
    form.set("document", secretDocument);
    form.set("preview_digest", h.previewDigest);
    form.set("resource_bindings", "{}");
    for (const [name, value] of Object.entries(secretValues)) {
      form.set(`secret:${name}`, value);
    }

    const response = await CREATE(
      new Request("http://localhost/api/flows/import", {
        method: "POST",
        headers: { "content-length": "4096" },
        body: form,
      }),
    );

    expect(response.status).toBe(201);
    expect(h.capturedSecrets).toEqual(secretValues);
    expect(h.rpc).toHaveBeenCalledWith(
      "import_flow_draft",
      expect.objectContaining({
        p_allowed_secret_paths: Object.keys(secretValues).map((name) => ({
          node_key: "request",
          path: ["config", "headers", name.split(".").at(-1)],
        })),
      }),
    );
    const responseText = await response.text();
    for (const value of Object.values(secretValues)) {
      expect(responseText).not.toContain(value);
    }
  });

  it("rejects suspicious values outside declared secret paths before RPC", async () => {
    const unsafeDocument = JSON.stringify({
      ...JSON.parse(document),
      nodes: [
        {
          key: "message",
          type: "send_message",
          config: {
            text: "sk-abcdefghijklmnopqrstuvwxyz",
            next_node_key: "end",
          },
          position: { x: 0, y: 0 },
        },
      ],
    });
    const response = await CREATE(
      new Request("http://localhost/api/flows/import", {
        method: "POST",
        body: JSON.stringify({
          document: unsafeDocument,
          preview_digest: "a".repeat(64),
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(h.rpc).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
  });
});
