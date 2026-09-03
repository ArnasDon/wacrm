// ============================================================
// Client da API do Asaas (cobrança recorrente). `fetch` direto — o
// Asaas não tem SDK oficial em Node. Auth por header `access_token`
// (confirmar o nome exato na doc durante o smoke — item "confirmar
// na prática", mesmo espírito da integração UAZAPI).
// ============================================================

type Json = Record<string, unknown>;

function baseUrl(): string {
  const url = process.env.ASAAS_BASE_URL;
  if (!url) throw new Error("ASAAS_BASE_URL is not set");
  return url.replace(/\/+$/, "");
}

function apiKey(): string {
  const key = process.env.ASAAS_API_KEY;
  if (!key) throw new Error("ASAAS_API_KEY is not set");
  return key;
}

async function call(path: string, init: RequestInit): Promise<Json> {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      access_token: apiKey(),
      ...init.headers,
    },
  });
  const json = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok) {
    const errors = json.errors as Array<{ description?: string }> | undefined;
    const msg = errors?.[0]?.description || `Asaas ${path} failed (${res.status})`;
    throw new Error(msg);
  }
  return json;
}

export async function createCustomer(
  name: string,
  email: string
): Promise<{ customerId: string }> {
  const json = await call("/customers", {
    method: "POST",
    body: JSON.stringify({ name, email }),
  });
  const customerId = json.id as string | undefined;
  if (!customerId) throw new Error("Asaas /customers response missing id");
  return { customerId };
}

function priceReais(): number {
  const cents = process.env.ASAAS_SUBSCRIPTION_PRICE_CENTS;
  if (!cents) throw new Error("ASAAS_SUBSCRIPTION_PRICE_CENTS is not set");
  return Number(cents) / 100;
}

/** Amanhã, formato YYYY-MM-DD — primeira cobrança da assinatura. */
function tomorrowDateStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export async function createSubscription(
  customerId: string,
  description: string
): Promise<{ subscriptionId: string; invoiceUrl: string }> {
  const json = await call("/subscriptions", {
    method: "POST",
    body: JSON.stringify({
      customer: customerId,
      billingType: "UNDEFINED", // PIX + cartão + boleto no checkout hospedado
      cycle: "MONTHLY",
      value: priceReais(),
      description,
      nextDueDate: tomorrowDateStr(),
    }),
  });
  const subscriptionId = json.id as string | undefined;
  const invoiceUrl = json.invoiceUrl as string | undefined;
  if (!subscriptionId || !invoiceUrl) {
    throw new Error("Asaas /subscriptions response missing id or invoiceUrl");
  }
  return { subscriptionId, invoiceUrl };
}

export async function cancelSubscription(subscriptionId: string): Promise<void> {
  await call(`/subscriptions/${subscriptionId}`, { method: "DELETE" });
}
