import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  createCustomer: vi.fn(),
  createSubscription: vi.fn(),
  cancelSubscription: vi.fn(),
  state: {
    updateCalls: [] as Array<{ table: string; patch: Record<string, unknown>; eqArgs: unknown[][] }>,
  },
}));

vi.mock("@/lib/auth/account", () => {
  // Minimal stand-ins for the real classes — enough for `instanceof`
  // checks in subscribe/route.ts to behave correctly against plain
  // `Error`s thrown by the mocked asaas.ts functions below.
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  class PaymentRequiredError extends Error {}
  return {
    requireRole: h.requireRole,
    UnauthorizedError,
    ForbiddenError,
    PaymentRequiredError,
    toErrorResponse: (err: unknown) => ({
      body: { error: (err as Error).message },
      init: { status: (err as { status?: number }).status ?? 500 },
    }),
  };
});
vi.mock("@/lib/billing/asaas", () => ({
  createCustomer: h.createCustomer,
  createSubscription: h.createSubscription,
  cancelSubscription: h.cancelSubscription,
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from(table: string) {
      return {
        update: (patch: Record<string, unknown>) => {
          const eqArgs: unknown[][] = [];
          const chain = {
            eq: (...args: unknown[]) => {
              eqArgs.push(args);
              h.state.updateCalls.push({ table, patch, eqArgs });
              return Promise.resolve({ error: null });
            },
          };
          return chain;
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

afterEach(() => {
  vi.clearAllMocks();
  h.state.updateCalls = [];
});

describe("POST /api/billing/subscribe", () => {
  it("creates a customer + subscription and returns invoiceUrl", async () => {
    h.requireRole.mockResolvedValue({
      accountId: "acc-1",
      account: {
        id: "acc-1",
        name: "Loja X",
        asaas_customer_id: null,
        asaas_subscription_id: null,
        trial_ends_at: null,
      },
    });
    h.createCustomer.mockResolvedValue({ customerId: "cus_1" });
    h.createSubscription.mockResolvedValue({ subscriptionId: "sub_1", invoiceUrl: "https://asaas/i/1" });

    const { POST } = await import("./subscribe/route");
    const res = await POST();

    expect(h.requireRole).toHaveBeenCalledWith("owner", { allowBlocked: true });
    expect(h.cancelSubscription).not.toHaveBeenCalled();
    expect(h.createCustomer).toHaveBeenCalledWith("Loja X", undefined);
    expect(h.createSubscription).toHaveBeenCalledWith(
      "cus_1",
      "Assinatura wacrm — Loja X",
      expect.any(String)
    );
    expect(res.body).toEqual({ invoiceUrl: "https://asaas/i/1" });
    expect(h.state.updateCalls).toHaveLength(1);
    expect(h.state.updateCalls[0].patch).toEqual({
      asaas_customer_id: "cus_1",
      asaas_subscription_id: "sub_1",
      subscription_updated_at: expect.any(String),
    });
  });

  it("cancels the existing Asaas subscription before creating a new one, to avoid double billing", async () => {
    h.requireRole.mockResolvedValue({
      accountId: "acc-1",
      account: {
        id: "acc-1",
        name: "Loja X",
        asaas_customer_id: "cus_1",
        asaas_subscription_id: "sub_old",
        trial_ends_at: null,
      },
    });
    h.createSubscription.mockResolvedValue({ subscriptionId: "sub_new", invoiceUrl: "https://asaas/i/new" });

    const { POST } = await import("./subscribe/route");
    await POST();

    expect(h.cancelSubscription).toHaveBeenCalledWith("sub_old");
    expect(h.createCustomer).not.toHaveBeenCalled();
    expect(h.state.updateCalls[0].patch).toEqual({
      asaas_customer_id: "cus_1",
      asaas_subscription_id: "sub_new",
      subscription_updated_at: expect.any(String),
    });
  });

  it("charges no earlier than the trial's end date", async () => {
    const trialEndsAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    h.requireRole.mockResolvedValue({
      accountId: "acc-1",
      account: {
        id: "acc-1",
        name: "Loja X",
        asaas_customer_id: "cus_1",
        asaas_subscription_id: null,
        trial_ends_at: trialEndsAt,
      },
    });
    h.createSubscription.mockResolvedValue({ subscriptionId: "sub_1", invoiceUrl: "https://asaas/i/1" });

    const { POST } = await import("./subscribe/route");
    await POST();

    const [, , nextDueDate] = h.createSubscription.mock.calls[0];
    expect(nextDueDate).toBe(trialEndsAt.slice(0, 10));
  });

  it("returns 502 and writes nothing when Asaas fails", async () => {
    h.requireRole.mockResolvedValue({
      accountId: "acc-1",
      account: {
        id: "acc-1",
        name: "Loja X",
        asaas_customer_id: null,
        asaas_subscription_id: null,
        trial_ends_at: null,
      },
    });
    h.createCustomer.mockRejectedValue(new Error("asaas down"));

    const { POST } = await import("./subscribe/route");
    // `next/server` is mocked above, so at runtime this is the mock's
    // `{ body, init }` shape, not the real `NextResponse` the static
    // types describe — cast to match what actually comes back.
    const res = (await POST()) as unknown as { body: unknown; init: { status: number } };

    expect(res.init.status).toBe(502);
    expect(h.state.updateCalls).toHaveLength(0);
  });
});

describe("POST /api/billing/cancel", () => {
  it("cancels on Asaas and blocks the account immediately", async () => {
    h.requireRole.mockResolvedValue({
      accountId: "acc-1",
      account: { id: "acc-1", asaas_subscription_id: "sub_1" },
    });

    const { POST } = await import("./cancel/route");
    const res = await POST();

    expect(h.requireRole).toHaveBeenCalledWith("owner", { allowBlocked: true });
    expect(h.cancelSubscription).toHaveBeenCalledWith("sub_1");
    expect(h.state.updateCalls[0].patch).toEqual({
      subscription_status: "canceled",
      asaas_subscription_id: null,
      subscription_updated_at: expect.any(String),
    });
    expect(res.body).toEqual({ status: "canceled" });
  });

  it("does not call Asaas when there is no existing subscription, but still blocks the account", async () => {
    h.requireRole.mockResolvedValue({
      accountId: "acc-1",
      account: { id: "acc-1", asaas_subscription_id: null },
    });

    const { POST } = await import("./cancel/route");
    const res = await POST();

    expect(h.cancelSubscription).not.toHaveBeenCalled();
    expect(h.state.updateCalls[0].patch).toEqual({
      subscription_status: "canceled",
      asaas_subscription_id: null,
      subscription_updated_at: expect.any(String),
    });
    expect(res.body).toEqual({ status: "canceled" });
  });
});
