import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  state: {
    updateCalls: [] as Array<{ patch: Record<string, unknown>; eqArgs: unknown[][] }>,
    foundAccount: { id: "acc-1" } as { id: string } | null,
    findError: null as unknown,
    updateError: null as unknown,
  },
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from(_table: string) {
      return {
        select: (_cols: string) => ({
          eq: (_col: string, _val: unknown) => ({
            maybeSingle: () =>
              Promise.resolve({ data: h.state.foundAccount, error: h.state.findError }),
          }),
        }),
        update: (patch: Record<string, unknown>) => {
          const eqArgs: unknown[][] = [];
          return {
            eq: (...args: unknown[]) => {
              eqArgs.push(args);
              h.state.updateCalls.push({ patch, eqArgs });
              return Promise.resolve({ error: h.state.updateError });
            },
          };
        },
      };
    },
  }),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ body, init }),
  },
}));

function post(payload: unknown, token = "correct-token") {
  const request = {
    headers: { get: (name: string) => (name === "asaas-access-token" ? token : null) },
    json: async () => payload,
  } as unknown as Request;
  return request;
}

let infoSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  process.env.ASAAS_WEBHOOK_TOKEN = "correct-token";
  h.state.updateCalls = [];
  h.state.foundAccount = { id: "acc-1" };
  h.state.findError = null;
  h.state.updateError = null;
  infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  delete process.env.ASAAS_WEBHOOK_TOKEN;
});

describe("POST /api/billing/webhook/asaas", () => {
  it("wrong token → 401, nothing written", async () => {
    const { POST } = await import("./route");
    const res = (await POST(post({ event: "PAYMENT_CONFIRMED" }, "wrong"))) as unknown as {
      init: { status: number };
    };
    expect(res.init.status).toBe(401);
    expect(h.state.updateCalls).toHaveLength(0);
  });

  it("PAYMENT_CONFIRMED → subscription_status = active", async () => {
    const { POST } = await import("./route");
    const res = (await POST(
      post({ event: "PAYMENT_CONFIRMED", payment: { subscription: "sub_1" } })
    )) as unknown as { init: { status: number } };
    expect(res.init).toEqual({ status: 200 });
    expect(h.state.updateCalls[0].patch).toMatchObject({ subscription_status: "active" });
    expect(h.state.updateCalls[0].eqArgs).toContainEqual(["id", "acc-1"]);
  });

  it("PAYMENT_RECEIVED → subscription_status = active", async () => {
    const { POST } = await import("./route");
    await POST(post({ event: "PAYMENT_RECEIVED", payment: { subscription: "sub_1" } }));
    expect(h.state.updateCalls[0].patch).toMatchObject({ subscription_status: "active" });
  });

  it("PAYMENT_OVERDUE → subscription_status = past_due", async () => {
    const { POST } = await import("./route");
    await POST(post({ event: "PAYMENT_OVERDUE", payment: { subscription: "sub_1" } }));
    expect(h.state.updateCalls[0].patch).toMatchObject({ subscription_status: "past_due" });
  });

  it("PAYMENT_DELETED → subscription_status = canceled", async () => {
    const { POST } = await import("./route");
    await POST(post({ event: "PAYMENT_DELETED", payment: { subscription: "sub_1" } }));
    expect(h.state.updateCalls[0].patch).toMatchObject({ subscription_status: "canceled" });
  });

  it("unrecognized event → 200, nothing written, console.info", async () => {
    const { POST } = await import("./route");
    const res = (await POST(
      post({ event: "PAYMENT_CREATED", payment: { subscription: "sub_1" } })
    )) as unknown as { init: { status: number } };
    expect(res.init).toEqual({ status: 200 });
    expect(h.state.updateCalls).toHaveLength(0);
    expect(infoSpy).toHaveBeenCalledWith("[asaas webhook] unhandled event:", "PAYMENT_CREATED");
  });

  it("missing subscription id in payload → 200, console.warn, nothing written", async () => {
    const { POST } = await import("./route");
    const res = (await POST(
      post({ event: "PAYMENT_CONFIRMED", payment: {} })
    )) as unknown as { init: { status: number } };
    expect(res.init).toEqual({ status: 200 });
    expect(h.state.updateCalls).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("no account found for subscription id → 200, console.warn, nothing written", async () => {
    h.state.foundAccount = null;
    const { POST } = await import("./route");
    const res = (await POST(
      post({ event: "PAYMENT_CONFIRMED", payment: { subscription: "sub_missing" } })
    )) as unknown as { init: { status: number } };
    expect(res.init).toEqual({ status: 200 });
    expect(h.state.updateCalls).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("DB update failure → 500", async () => {
    h.state.updateError = { message: "db down" };
    const { POST } = await import("./route");
    const res = (await POST(
      post({ event: "PAYMENT_CONFIRMED", payment: { subscription: "sub_1" } })
    )) as unknown as { init: { status: number } };
    expect(res.init.status).toBe(500);
  });
});
