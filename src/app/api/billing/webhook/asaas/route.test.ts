import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  state: {
    updateCalls: [] as Array<{ patch: Record<string, unknown>; eqArgs: unknown[][] }>,
    accountFound: true,
  },
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from(table: string) { // eslint-disable-line @typescript-eslint/no-unused-vars
      return {
        update: (patch: Record<string, unknown>) => {
          const eqArgs: unknown[][] = [];
          return {
            eq: (...args: unknown[]) => {
              eqArgs.push(args);
              h.state.updateCalls.push({ patch, eqArgs });
              return Promise.resolve({
                error: null,
                count: h.state.accountFound ? 1 : 0,
              });
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
  h.state.accountFound = true;
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
    const res = (await POST(post({ event: "PAYMENT_CONFIRMED" }, "wrong"))) as unknown as { init: { status: number } };
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
    expect(h.state.updateCalls[0].eqArgs).toContainEqual(["asaas_subscription_id", "sub_1"]);
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

  it("unrecognized event → 200, nothing written, console.info", async () => {
    const { POST } = await import("./route");
    const res = (await POST(post({ event: "PAYMENT_CREATED", payment: { subscription: "sub_1" } }))) as unknown as { init: { status: number } };
    expect(res.init).toEqual({ status: 200 });
    expect(h.state.updateCalls).toHaveLength(0);
    expect(infoSpy).toHaveBeenCalledWith("[asaas webhook] unhandled event:", "PAYMENT_CREATED");
  });

  it("missing subscription id in payload → 200, console.warn, nothing written", async () => {
    const { POST } = await import("./route");
    const res = (await POST(post({ event: "PAYMENT_CONFIRMED", payment: {} }))) as unknown as { init: { status: number } };
    expect(res.init).toEqual({ status: 200 });
    expect(h.state.updateCalls).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
  });
});
