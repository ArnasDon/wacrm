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
  it("POSTa /customers com access_token, cpfCnpj e devolve o id", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "cus_123" }));
    const { createCustomer } = await import("./asaas");
    const out = await createCustomer("Loja Exemplo", "12345678901", "dono@exemplo.com");
    expect(out).toEqual({ customerId: "cus_123" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://sandbox.asaas.com/api/v3/customers");
    expect(init.method).toBe("POST");
    expect(init.headers.access_token).toBe("test-asaas-key");
    expect(JSON.parse(init.body)).toEqual({
      name: "Loja Exemplo",
      cpfCnpj: "12345678901",
      email: "dono@exemplo.com",
    });
  });

  it("lança quando a resposta não é ok (ex.: CPF/CNPJ faltando ou inválido)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { errors: [{ description: "Para criar esta cobrança é necessário preencher o CPF ou CNPJ do cliente." }] },
        false,
        400
      )
    );
    const { createCustomer } = await import("./asaas");
    await expect(createCustomer("Loja", "bad")).rejects.toThrow(
      "Para criar esta cobrança é necessário preencher o CPF ou CNPJ do cliente."
    );
  });

  it("omite o campo email do corpo quando não informado (caminho que a rota subscribe usa)", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "cus_456" }));
    const { createCustomer } = await import("./asaas");
    const out = await createCustomer("Loja Sem Email", "12345678901");
    expect(out).toEqual({ customerId: "cus_456" });
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ name: "Loja Sem Email", cpfCnpj: "12345678901" });
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

  it("usa o nextDueDate fornecido em vez do padrão (amanhã) quando informado", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ id: "sub_789", invoiceUrl: "https://sandbox.asaas.com/i/sub_789" })
    );
    const { createSubscription } = await import("./asaas");
    await createSubscription("cus_123", "Assinatura wacrm", "2026-09-20");
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toMatchObject({ nextDueDate: "2026-09-20" });
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

  it("trata 404 (assinatura já não existe no Asaas) como sucesso", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ errors: [{ description: "not found" }] }, false, 404));
    const { cancelSubscription } = await import("./asaas");
    await expect(cancelSubscription("sub_gone")).resolves.toBeUndefined();
  });

  it("continua lançando em outros erros (não-404)", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ errors: [{ description: "server error" }] }, false, 500));
    const { cancelSubscription } = await import("./asaas");
    await expect(cancelSubscription("sub_1")).rejects.toThrow("server error");
  });
});
