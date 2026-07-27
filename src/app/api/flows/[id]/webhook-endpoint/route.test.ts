import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  adminFrom: vi.fn(),
  encrypted: [] as string[],
}));

vi.mock("@/lib/auth/account", () => ({
  requireRole: h.requireRole,
  toErrorResponse: () => Response.json({ error: "Forbidden" }, { status: 403 }),
}));

vi.mock("@/lib/flows/admin-client", () => ({
  supabaseAdmin: () => ({ from: h.adminFrom }),
}));

vi.mock("@/lib/whatsapp/encryption", () => ({
  encrypt: (secret: string) => {
    h.encrypted.push(secret);
    return `enc:${secret}`;
  },
}));

import { DELETE, POST } from "./route";

const context = { params: Promise.resolve({ id: "flow-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  h.encrypted = [];
  h.requireRole.mockResolvedValue({ accountId: "account-1", userId: "user-1" });
  h.adminFrom.mockImplementation((table: string) => {
    if (table === "flows") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: "flow-1", account_id: "account-1" },
                error: null,
              }),
            }),
          }),
        }),
      };
    }
    if (table === "flow_webhook_endpoints") {
      return {
        upsert: (row: Record<string, unknown>) => ({
          select: () => ({
            maybeSingle: async () => ({
              data: { ...row, id: "endpoint-1" },
              error: null,
            }),
          }),
        }),
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "endpoint-1",
                  secret_ciphertext: "enc:old",
                  secret_fingerprint: "old-fp",
                },
                error: null,
              }),
            }),
          }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: () => ({
            eq: () => ({
              select: () => ({
                maybeSingle: async () => ({
                  data: { id: "endpoint-1", ...patch },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      };
    }
    throw new Error(`unexpected table ${table}`);
  });
});

describe("flow webhook endpoint management", () => {
  it("provisions a webhook secret and returns it exactly once", async () => {
    const response = await POST(
      new Request("http://localhost/api/flows/flow-1/webhook-endpoint", {
        method: "POST",
        body: JSON.stringify({ trigger_node_key: "trigger" }),
      }),
      context,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.secret).toMatch(/^whsec_/);
    expect(body.endpoint.endpoint_key).toMatch(/^fw_/);
    expect(JSON.stringify(body.endpoint)).not.toContain(body.secret);
  });

  it("rotates by preserving the previous ciphertext", async () => {
    const response = await POST(
      new Request("http://localhost/api/flows/flow-1/webhook-endpoint", {
        method: "POST",
        body: JSON.stringify({ trigger_node_key: "trigger", rotate: true }),
      }),
      context,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.secret).toMatch(/^whsec_/);
  });

  it("revokes without returning any secret", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/flows/flow-1/webhook-endpoint", {
        method: "DELETE",
        body: JSON.stringify({ trigger_node_key: "trigger" }),
      }),
      context,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      endpoint: { id: "endpoint-1", status: "revoked" },
    });
  });
});
