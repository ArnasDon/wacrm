import { buildSignatureHeader } from "@/lib/webhooks/sign";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  endpoint: null as Record<string, unknown> | null,
  rpc: vi.fn(),
  decrypt: vi.fn((value: string) => value),
}));

vi.mock("@/lib/flows/admin-client", () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table !== "flow_webhook_endpoints") {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: h.endpoint, error: null }),
            }),
          }),
        }),
      };
    },
    rpc: h.rpc,
  }),
}));

vi.mock("@/lib/whatsapp/encryption", () => ({
  decrypt: h.decrypt,
}));

import { POST } from "./route";

const context = { params: Promise.resolve({ endpointKey: "wh_123" }) };

beforeEach(() => {
  vi.clearAllMocks();
  h.endpoint = {
    id: "endpoint-1",
    account_id: "account-1",
    flow_id: "flow-1",
    trigger_node_key: "trigger",
    endpoint_key: "wh_123",
    status: "active",
    secret_ciphertext: "secret-current",
    previous_secret_ciphertext: "secret-previous",
  };
  h.rpc.mockResolvedValue({
    data: [{ id: "invocation-1", status: "pending" }],
    error: null,
  });
});

function signedRequest(body: string, secret = "secret-current") {
  const now = Math.floor(Date.now() / 1000);
  return new Request("http://localhost/api/flow-webhooks/wh_123", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": "idem-1",
      "x-wacrm-signature": buildSignatureHeader(body, secret, now),
    },
    body,
  });
}

describe("flow webhook ingress", () => {
  it("verifies HMAC and accepts a durable webhook invocation", async () => {
    const body = JSON.stringify({ event: "paid" });
    const response = await POST(signedRequest(body), context);

    expect(response.status).toBe(202);
    expect(h.rpc).toHaveBeenCalledWith(
      "accept_flow_trigger_invocation",
      expect.objectContaining({
        p_account_id: "account-1",
        p_flow_id: "flow-1",
        p_trigger_node_key: "trigger",
        p_source: "webhook",
        p_idempotency_key: "idem-1",
        p_payload: { event: "paid" },
        p_response_mode: "async",
      }),
    );
    expect(await response.json()).toEqual({
      accepted: true,
      invocation_id: "invocation-1",
    });
  });

  it("accepts the previous secret during rotation", async () => {
    const body = JSON.stringify({ event: "paid" });
    const response = await POST(signedRequest(body, "secret-previous"), context);

    expect(response.status).toBe(202);
  });

  it("requires idempotency and a valid signature before mutating", async () => {
    const response = await POST(
      new Request("http://localhost/api/flow-webhooks/wh_123", {
        method: "POST",
        headers: { "x-wacrm-signature": "bad" },
        body: "{}",
      }),
      context,
    );

    expect(response.status).toBe(400);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("rejects oversized bodies without reading them into an invocation", async () => {
    const huge = JSON.stringify({ body: "x".repeat(256 * 1024) });
    const response = await POST(signedRequest(huge), context);

    expect(response.status).toBe(413);
    expect(h.rpc).not.toHaveBeenCalled();
  });
});
