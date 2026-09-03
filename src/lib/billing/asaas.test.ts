import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  process.env.ASAAS_API_KEY = "test-asaas-key";
  process.env.ASAAS_BASE_URL = "https://sandbox.asaas.com/api/v3";
  process.env.ASAAS_SUBSCRIPTION_PRICE_CENTS = "9900";
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ASAAS_API_KEY;
  delete process.env.ASAAS_BASE_URL;
  delete process.env.ASAAS_SUBSCRIPTION_PRICE_CENTS;
});

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as unknown as Response;
}

describe("createCustomer", () => {
  it("POSTa /customers com access_token e devolve o id", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "cus_123" }));
    const { createCustomer } = await import("./asaas");
    const out = await createCustomer("Loja Exemplo", "dono@exemplo.com");
    expect(out).toEqual({ customerId: "cus_123" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://sandbox.asaas.com/api/v3/customers");
    expect(init.method).toBe("POST");
    expect(init.headers.access_token).toBe("test-asaas-key");
    expect(JSON.parse(init.body)).toEqual({ name: "Loja Exemplo", email: "dono@exemplo.com" });
  });

  it("lança quando a resposta não é ok", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ errors: [{ description: "invalid email" }] }, false, 400));
    const { createCustomer } = await import("./asaas");
    await expect(createCustomer("Loja", "bad")).rejects.toThrow("invalid email");
  });
});

describe("createSubscription", () => {
  it("POSTa /subscriptions com billingType UNDEFINED, cycle MONTHLY, e o valor da env var", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ id: "sub_456", invoiceUrl: "https://sandbox.asaas.com/i/sub_456" })
    );
    const { createSubscription } = await import("./asaas");
    const out = await createSubscription("cus_123", "Assinatura wacrm");
    expect(out).toEqual({ subscriptionId: "sub_456", invoiceUrl: "https://sandbox.asaas.com/i/sub_456" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://sandbox.asaas.com/api/v3/subscriptions");
    expect(JSON.parse(init.body)).toEqual({
      customer: "cus_123",
      billingType: "UNDEFINED",
      cycle: "MONTHLY",
      value: 99,
      description: "Assinatura wacrm",
      nextDueDate: expect.any(String),
    });
  });
});

describe("cancelSubscription", () => {
  it("DELETE /subscriptions/:id", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ deleted: true }));
    const { cancelSubscription } = await import("./asaas");
    await cancelSubscription("sub_456");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://sandbox.asaas.com/api/v3/subscriptions/sub_456");
    expect(init.method).toBe("DELETE");
  });
});
