# Cobrança recorrente (Asaas) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ligar cobrança recorrente mensal via Asaas por conta — trial de 7 dias, plano único, bloqueio total de acesso quando não paga, tudo autoatendido (o cliente assina/cancela sozinho).

**Architecture:** Colunas de assinatura direto em `accounts` (já é a fronteira multi-tenant desde a migração 017) + trigger que impede o cliente de escrever nelas por conta própria. `isAccountBlocked()` é uma função pura que decide o bloqueio a partir de `subscription_status`/`trial_ends_at`. Gate em dois lugares: o layout do dashboard (Server Component, redireciona pra `/billing`) e `getCurrentAccount()` (defesa em profundidade pra toda rota de API). O Asaas cobra os meses seguintes sozinho; o CRM só reage ao webhook.

**Tech Stack:** Next.js 16 (App Router, Server Components, route handlers com `params`/service-role client), TypeScript, Supabase (Postgres + RLS + trigger), `fetch` puro pra API do Asaas (sem SDK), Vitest, next-intl (`messages/en.json` + `messages/ko.json` + `messages/pt-BR.json` — **três** locales agora, não dois).

**Spec:** `docs/superpowers/specs/2026-09-03-asaas-billing-design.md` — leitura obrigatória.

## Global Constraints

- **Plano único, sem tiers.** Preço vem de env var, não hardcoded.
- **Bloqueio total** (não somente-leitura) quando `past_due`, `canceled`, ou trial expirado.
- **Ingestão do WhatsApp nunca é bloqueada** — só o acesso autenticado ao CRM.
- **As 5 colunas de billing em `accounts` só podem ser escritas pelo service-role** (trigger `protect_billing_columns_trigger`) — nenhuma rota client-facing escreve nelas diretamente; toda escrita passa pelas rotas de billing usando o service-role client.
- **`messages.test.ts` exige paridade total de chaves entre `en.json`, `ko.json` E `pt-BR.json`** — toda chave nova entra nos três.
- **`getCurrentAccount()`/`requireRole()` continuam retrocompatíveis** — nenhuma chamada existente (sem `opts`) muda de comportamento pra uma conta com `subscription_status` ausente/undefined no mock (default seguro pra `'active'`, nunca lança em teste que não conhece a coluna nova).
- Prettier: `semi: true` estilo TS (arquivos `.ts`); segue o style já presente em `src/lib/auth/account.ts` (sem ponto e vírgula — confirmar no arquivo antes de editar) e `src/lib/whatsapp/uazapi-admin.ts` (com ponto e vírgula) — cada arquivo mantém o estilo do arquivo vizinho que está sendo modificado/espelhado.
- Portas por task: `npm run typecheck`, `npm run lint` (0 erros), `npm test` (baseline: 0 falhas — a suíte está 100% verde nesta sessão, diferente de sessões anteriores do UAZAPI que tinham baseline de 5 falhas conhecidas).

---

## File Structure

**Criados:**

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/042_billing.sql` | Colunas de assinatura em `accounts`, trigger de proteção, trial no `handle_new_user`. |
| `src/lib/billing/access.ts` | `isAccountBlocked()` — função pura. |
| `src/lib/billing/access.test.ts` | — |
| `src/lib/billing/asaas.ts` | `createCustomer`, `createSubscription`, `cancelSubscription`. |
| `src/lib/billing/asaas.test.ts` | — |
| `src/app/api/billing/subscribe/route.ts` | `POST` — cria cliente+assinatura no Asaas, devolve `invoiceUrl`. |
| `src/app/api/billing/cancel/route.ts` | `POST` — cancela no Asaas, bloqueia na hora. |
| `src/app/api/billing/subscribe-cancel.test.ts` | Testes das duas rotas acima. |
| `src/app/api/billing/webhook/asaas/route.ts` | `POST` — sincroniza status a partir do webhook do Asaas. |
| `src/app/api/billing/webhook/asaas/route.test.ts` | — |
| `src/app/billing/page.tsx` | Tela de assinatura — status, botão assinar/cancelar. **Fora** do grupo `(dashboard)` de propósito (ver Task 7 Step 2) — senão o próprio redirect de bloqueio cria um loop nela. |
| `src/app/billing/billing-actions.tsx` | Client component — botões assinar/cancelar (`onClick` não roda em Server Component). |

**Modificados:**

| Arquivo | Mudança |
|---|---|
| `src/lib/auth/account.ts` | `PaymentRequiredError`; `getCurrentAccount(opts?)` e `requireRole(min, opts?)` ganham `{ allowBlocked?: boolean }`; `AccountContext.account` ganha `subscription_status`/`trial_ends_at`. |
| `src/lib/auth/account.test.ts` | + casos novos de bloqueio (os 6 testes existentes continuam passando sem mudança — default seguro). |
| `src/lib/auth/roles.ts` | + `canManageBilling(role)` (owner only, mesmo padrão de `canDeleteAccount`). |
| `src/app/(dashboard)/layout.tsx` | Vira `async`; consulta leve resiliente; `redirect('/billing')` quando bloqueado. |
| `messages/en.json` + `messages/ko.json` + `messages/pt-BR.json` | + namespace `Billing`. |

---

## Pre-flight (controlador, antes da Task 1)

| Par | Interface | Nota |
|---|---|---|
| T1 → T2/T4/T6 | Colunas `subscription_status`/`trial_ends_at` em `accounts` | T2/T4/T6 usam esses nomes de coluna nos tipos/queries; a migração define o CHECK exato (`'trialing'\|'active'\|'past_due'\|'canceled'`). T1 primeiro. |
| T2 → T4/T7 | `isAccountBlocked({ subscription_status, trial_ends_at }): boolean` | Import direto, sem I/O. T2 antes de T4/T7. |
| T3 → T5 | `createCustomer`, `createSubscription`, `cancelSubscription` | T5 (rotas subscribe/cancel) chama essas três funções. T3 antes de T5. **Ruling:** T5 chama `createCustomer(ctx.account.name, undefined)` sem e-mail — `email` é opcional em `createCustomer`, corpo da requisição omite o campo quando ausente. |
| T4 → T5 | `requireRole(min, { allowBlocked: true })` | T5 precisa que o gate já aceite a opção — senão a própria rota de assinar fica bloqueada pra quem está bloqueado. T4 antes de T5. |
| T1 → T5/T6 | Trigger `protect_billing_columns_trigger` | T5/T6 escrevem as colunas de billing via client service-role — o trigger só libera pra esse role. Ordem não é estritamente bloqueante pro código (o trigger só importa em runtime contra um banco real), mas T1 primeiro evita confusão. |
| T5/T6 → T7 | Rotas `/api/billing/subscribe`, `/api/billing/cancel` existem | O botão da tela `/billing` (T7) chama essas rotas. T5/T6 antes de T7. |
| T2 → T7 | `isAccountBlocked` | O layout do dashboard (T7) usa a mesma função pra decidir o redirect. |

---

## Task 1: Migração — colunas de assinatura + trigger + trial

**Files:**
- Create: `supabase/migrations/042_billing.sql`

- [ ] **Step 1: escrever a migração**

```sql
-- ============================================================
-- 042_billing.sql — Cobrança recorrente (Asaas)
--
-- Adiciona o estado de assinatura direto em `accounts` (já é a
-- fronteira multi-tenant desde 017_account_sharing.sql). Um trigger
-- impede qualquer escrita client-side nessas colunas — só o
-- service-role (as rotas de billing) pode gravá-las.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'active'
    CHECK (subscription_status IN ('trialing', 'active', 'past_due', 'canceled')),
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS asaas_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS asaas_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS subscription_updated_at TIMESTAMPTZ;

-- Contas que já existem antes desta migração ficam `active` (default
-- acima), sem trial — não bloqueia retroativamente quem já usa o CRM.
-- Só contas criadas DEPOIS desta migração (via handle_new_user abaixo)
-- nascem em trial.

-- ============================================================
-- PROTEÇÃO — só o service-role escreve nas colunas de billing
--
-- accounts_update (017) permite admin+ editar a própria conta (hoje,
-- só o nome). Sem isso, um admin poderia chamar o client Supabase
-- direto do navegador e setar subscription_status = 'active' nele
-- mesmo, contornando o Asaas inteiro.
-- ============================================================
CREATE OR REPLACE FUNCTION protect_billing_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    NEW.subscription_status      := OLD.subscription_status;
    NEW.trial_ends_at            := OLD.trial_ends_at;
    NEW.asaas_customer_id        := OLD.asaas_customer_id;
    NEW.asaas_subscription_id    := OLD.asaas_subscription_id;
    NEW.subscription_updated_at  := OLD.subscription_updated_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_billing_columns_trigger ON accounts;
CREATE TRIGGER protect_billing_columns_trigger
  BEFORE UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION protect_billing_columns();

-- ============================================================
-- SIGNUP — novas contas nascem em trial de 7 dias
--
-- Mesma função de 017_account_sharing.sql, só adiciona
-- trial_ends_at / subscription_status = 'trialing' no INSERT.
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name TEXT;
  v_account_id UUID;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');

  INSERT INTO public.accounts (name, owner_user_id, subscription_status, trial_ends_at)
  VALUES (
    COALESCE(NULLIF(v_full_name, ''), NEW.email, 'My account'),
    NEW.id,
    'trialing',
    NOW() + INTERVAL '7 days'
  )
  RETURNING id INTO v_account_id;

  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (NEW.id, v_full_name, NEW.email, v_account_id, 'owner');

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to bootstrap account/profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;
```

- [ ] **Step 2: conferir que a migração roda limpa localmente**

Se tiver Supabase CLI local configurado: `supabase db reset` (ou o comando equivalente já usado neste projeto pras migrações anteriores). Se não tiver ambiente local, pular — o workflow `migrations.yml` do CI já faz replay de todas as migrações contra um banco novo a cada push; qualquer erro de sintaxe aparece lá.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/042_billing.sql
git commit -m "feat(billing): accounts subscription columns + protection trigger + trial on signup"
```

---

## Task 2: `isAccountBlocked()`

**Files:**
- Create: `src/lib/billing/access.ts`, `src/lib/billing/access.test.ts`

**Interfaces:**
- Produces: `export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled'`; `export function isAccountBlocked(account: { subscription_status: SubscriptionStatus; trial_ends_at: string | null }): boolean`.

- [ ] **Step 1: teste que falha** — `src/lib/billing/access.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { isAccountBlocked } from "./access";

describe("isAccountBlocked", () => {
  it("active is never blocked", () => {
    expect(isAccountBlocked({ subscription_status: "active", trial_ends_at: null })).toBe(false);
  });

  it("past_due is always blocked", () => {
    expect(isAccountBlocked({ subscription_status: "past_due", trial_ends_at: null })).toBe(true);
  });

  it("canceled is always blocked", () => {
    expect(isAccountBlocked({ subscription_status: "canceled", trial_ends_at: null })).toBe(true);
  });

  it("trialing with trial_ends_at in the future is not blocked", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(isAccountBlocked({ subscription_status: "trialing", trial_ends_at: future })).toBe(false);
  });

  it("trialing with trial_ends_at in the past is blocked", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(isAccountBlocked({ subscription_status: "trialing", trial_ends_at: past })).toBe(true);
  });

  it("trialing with trial_ends_at null is not blocked (defensive — should not happen post-migration)", () => {
    expect(isAccountBlocked({ subscription_status: "trialing", trial_ends_at: null })).toBe(false);
  });
});
```

- [ ] **Step 2: rodar** `npx vitest run src/lib/billing/access.test.ts` → deve **falhar** (módulo não existe ainda). Confirmar a falha antes de implementar.

- [ ] **Step 3: implementar** `src/lib/billing/access.ts`

```ts
// ============================================================
// Decide se uma conta está bloqueada por causa da assinatura.
// Função pura — sem I/O, sem Supabase. Usada tanto pelo gate do
// layout (src/app/(dashboard)/layout.tsx) quanto pela defesa em
// profundidade em getCurrentAccount() (src/lib/auth/account.ts).
// ============================================================

export type SubscriptionStatus = "trialing" | "active" | "past_due" | "canceled";

export interface SubscriptionState {
  subscription_status: SubscriptionStatus;
  trial_ends_at: string | null;
}

export function isAccountBlocked(account: SubscriptionState): boolean {
  if (account.subscription_status === "past_due" || account.subscription_status === "canceled") {
    return true;
  }
  if (account.subscription_status === "trialing") {
    return account.trial_ends_at !== null && new Date(account.trial_ends_at) < new Date();
  }
  return false; // 'active'
}
```

- [ ] **Step 4: rodar** `npx vitest run src/lib/billing/access.test.ts` → verde. `npm run typecheck && npm run lint`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/billing/access.ts src/lib/billing/access.test.ts
git commit -m "feat(billing): isAccountBlocked pure function"
```

---

## Task 3: Cliente da API do Asaas

**Files:**
- Create: `src/lib/billing/asaas.ts`, `src/lib/billing/asaas.test.ts`

**Interfaces:**
- Consumes: env vars `ASAAS_API_KEY`, `ASAAS_BASE_URL` (default `https://api.asaas.com/v3` — sandbox é `https://sandbox.asaas.com/api/v3`, confirmar exato na doc durante o smoke), `ASAAS_SUBSCRIPTION_PRICE_CENTS`.
- Produces: `createCustomer(name: string, email?: string)` (email é opcional — T5 chama sem e-mail, ver ruling no pre-flight), `createSubscription(customerId, description)`, `cancelSubscription(subscriptionId)`.

- [ ] **Step 1: teste que falha** — `src/lib/billing/asaas.test.ts`

```ts
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

  it("omite o campo email do corpo quando não informado (caminho que a Task 5 usa)", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "cus_456" }));
    const { createCustomer } = await import("./asaas");
    const out = await createCustomer("Loja Sem Email");
    expect(out).toEqual({ customerId: "cus_456" });
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ name: "Loja Sem Email" });
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
```

- [ ] **Step 2: rodar** `npx vitest run src/lib/billing/asaas.test.ts` → falha (módulo não existe).

- [ ] **Step 3: implementar** `src/lib/billing/asaas.ts`

```ts
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
  email?: string
): Promise<{ customerId: string }> {
  const json = await call("/customers", {
    method: "POST",
    body: JSON.stringify(email ? { name, email } : { name }),
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
```

- [ ] **Step 4: rodar** `npx vitest run src/lib/billing/asaas.test.ts` → verde. `npm run typecheck && npm run lint`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/billing/asaas.ts src/lib/billing/asaas.test.ts
git commit -m "feat(billing): Asaas API client (customer, subscription, cancel)"
```

---

## Task 4: Gate em `getCurrentAccount()` / `requireRole()`

**Files:**
- Modify: `src/lib/auth/account.ts`, `src/lib/auth/account.test.ts`

**Interfaces:**
- Consumes: `isAccountBlocked` de `@/lib/billing/access` (Task 2).
- Produces: `export class PaymentRequiredError extends Error { readonly status = 402 }`; `getCurrentAccount(opts?: { allowBlocked?: boolean }): Promise<AccountContext>`; `requireRole(min: AccountRole, opts?: { allowBlocked?: boolean }): Promise<AccountContext>`; `AccountContext.account` ganha `subscription_status: SubscriptionStatus`, `trial_ends_at: string | null`, `asaas_customer_id: string | null` e `asaas_subscription_id: string | null` (os dois últimos existem só pra Task 5 conseguir ler/gravar sem cast — não entram em nenhuma checagem de bloqueio).

- [ ] **Step 1: teste que falha** — adicionar em `src/lib/auth/account.test.ts` (no fim do arquivo, mesmo describe block ou um novo `describe("getCurrentAccount — billing gate", ...)`):

```ts
describe("getCurrentAccount — billing gate", () => {
  it("throws PaymentRequiredError when the account is blocked and allowBlocked is not set", async () => {
    const { client } = makeClient({
      user: { id: "user-1" },
      byTable: {
        profiles: { data: { account_id: "acc-1", account_role: "owner" }, error: null },
        accounts: {
          data: { id: "acc-1", name: "Acme", subscription_status: "past_due", trial_ends_at: null },
          error: null,
        },
      },
    });
    createClient.mockReturnValue(client);

    await expect(getCurrentAccount()).rejects.toThrow(PaymentRequiredError);
  });

  it("does not throw when the account is blocked but allowBlocked is true", async () => {
    const { client } = makeClient({
      user: { id: "user-1" },
      byTable: {
        profiles: { data: { account_id: "acc-1", account_role: "owner" }, error: null },
        accounts: {
          data: { id: "acc-1", name: "Acme", subscription_status: "canceled", trial_ends_at: null },
          error: null,
        },
      },
    });
    createClient.mockReturnValue(client);

    const ctx = await getCurrentAccount({ allowBlocked: true });
    expect(ctx.account.subscription_status).toBe("canceled");
  });

  it("defaults subscription_status to 'active' (never blocks) when the mock/row omits it — back-compat with every pre-existing test", async () => {
    const { client } = makeClient({
      user: { id: "user-1" },
      byTable: {
        profiles: { data: { account_id: "acc-1", account_role: "owner" }, error: null },
        accounts: { data: { id: "acc-1", name: "Acme" }, error: null },
      },
    });
    createClient.mockReturnValue(client);

    const ctx = await getCurrentAccount();
    expect(ctx.account.subscription_status).toBe("active");
  });
});
```

Também trocar a linha de import do topo do arquivo pra trazer `PaymentRequiredError`:

```ts
const { getCurrentAccount, UnauthorizedError, ForbiddenError, PaymentRequiredError } = await import(
  "./account"
);
```

- [ ] **Step 2: rodar** `npx vitest run src/lib/auth/account.test.ts` → os 3 casos novos falham (`PaymentRequiredError` não existe ainda / gate não implementado). Os 6 testes existentes continuam passando (confirma que não regrediu nada antes de mexer).

- [ ] **Step 3: implementar** — em `src/lib/auth/account.ts`:

Import novo no topo:
```ts
import { isAccountBlocked, type SubscriptionStatus } from "@/lib/billing/access";
```

Nova classe de erro, logo depois de `ForbiddenError`:
```ts
export class PaymentRequiredError extends Error {
  readonly status = 402 as const;
  constructor(message = "Subscription required") {
    super(message);
    this.name = "PaymentRequiredError";
  }
}
```

`toErrorResponse` ganha o novo caso:
```ts
export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof UnauthorizedError || err instanceof ForbiddenError || err instanceof PaymentRequiredError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("[toErrorResponse] uncategorized error:", err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
```

`AccountContext.account` ganha os dois campos:
```ts
export interface AccountContext {
  supabase: SupabaseClient;
  userId: string;
  accountId: string;
  role: AccountRole;
  account: {
    id: string;
    name: string;
    subscription_status: SubscriptionStatus;
    trial_ends_at: string | null;
    asaas_customer_id: string | null;
    asaas_subscription_id: string | null;
  };
}
```

`getCurrentAccount` ganha o parâmetro e a checagem — a query de `accounts` passa a selecionar as duas colunas novas, e a montagem do retorno usa o default seguro:

```ts
export async function getCurrentAccount(
  opts: { allowBlocked?: boolean } = {}
): Promise<AccountContext> {
  const supabase = await createClient();

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) {
    throw new UnauthorizedError();
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("account_id, account_role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[getCurrentAccount] profile fetch error:", error);
    throw new ForbiddenError("Could not load account context");
  }
  if (!data || !data.account_id || !data.account_role) {
    throw new ForbiddenError("Profile is not linked to an account");
  }
  if (!isAccountRole(data.account_role)) {
    throw new ForbiddenError(`Unknown account role: ${data.account_role}`);
  }

  const { data: account, error: accountErr } = await supabase
    .from("accounts")
    .select("id, name, subscription_status, trial_ends_at, asaas_customer_id, asaas_subscription_id")
    .eq("id", data.account_id)
    .maybeSingle();

  if (accountErr) {
    console.error("[getCurrentAccount] account fetch error:", accountErr);
    throw new ForbiddenError("Could not load account context");
  }
  if (!account) {
    throw new ForbiddenError("Profile is not linked to an account");
  }

  const subscriptionStatus = (account.subscription_status as SubscriptionStatus) ?? "active";
  const trialEndsAt = (account.trial_ends_at as string | null) ?? null;

  if (!opts.allowBlocked && isAccountBlocked({ subscription_status: subscriptionStatus, trial_ends_at: trialEndsAt })) {
    throw new PaymentRequiredError();
  }

  return {
    supabase,
    userId: user.id,
    accountId: data.account_id,
    role: data.account_role,
    account: {
      id: account.id,
      name: account.name,
      subscription_status: subscriptionStatus,
      trial_ends_at: trialEndsAt,
      asaas_customer_id: (account.asaas_customer_id as string | null) ?? null,
      asaas_subscription_id: (account.asaas_subscription_id as string | null) ?? null,
    },
  };
}

export async function requireRole(
  min: AccountRole,
  opts: { allowBlocked?: boolean } = {}
): Promise<AccountContext> {
  const ctx = await getCurrentAccount(opts);
  if (!hasMinRole(ctx.role, min)) {
    throw new ForbiddenError(
      `This action requires the '${min}' role or higher`,
    );
  }
  return ctx;
}
```

- [ ] **Step 4: rodar** `npx vitest run src/lib/auth/account.test.ts` → os 9 testes (6 existentes + 3 novos) verdes. `npm run typecheck && npm run lint`. `npx vitest run` (suíte inteira) — confirmar que nada mais que consome `AccountContext.account` quebrou (o typecheck já pega isso).

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/account.ts src/lib/auth/account.test.ts
git commit -m "feat(billing): PaymentRequiredError + allowBlocked gate in getCurrentAccount/requireRole"
```

---

## Task 5: Rotas `subscribe` e `cancel`

**Files:**
- Create: `src/app/api/billing/subscribe/route.ts`, `src/app/api/billing/cancel/route.ts`, `src/app/api/billing/subscribe-cancel.test.ts`

**Interfaces:**
- Consumes: `requireRole` (Task 4), `createCustomer`/`createSubscription`/`cancelSubscription` (Task 3).
- Produces: as duas rotas. Sem exports além dos handlers HTTP.

- [ ] **Step 1: teste que falha** — `src/app/api/billing/subscribe-cancel.test.ts`

```ts
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

vi.mock("@/lib/auth/account", () => ({
  requireRole: h.requireRole,
  toErrorResponse: (err: unknown) => ({
    body: { error: (err as Error).message },
    init: { status: (err as { status?: number }).status ?? 500 },
  }),
}));
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
      account: { id: "acc-1", name: "Loja X", asaas_customer_id: null },
    });
    h.createCustomer.mockResolvedValue({ customerId: "cus_1" });
    h.createSubscription.mockResolvedValue({ subscriptionId: "sub_1", invoiceUrl: "https://asaas/i/1" });

    const { POST } = await import("./subscribe/route");
    const res = await POST();

    expect(h.requireRole).toHaveBeenCalledWith("owner", { allowBlocked: true });
    expect(h.createCustomer).toHaveBeenCalledWith("Loja X", undefined);
    expect(h.createSubscription).toHaveBeenCalledWith("cus_1", "Assinatura wacrm — Loja X");
    expect(res.body).toEqual({ invoiceUrl: "https://asaas/i/1" });
    expect(h.state.updateCalls).toHaveLength(1);
    expect(h.state.updateCalls[0].patch).toEqual({
      asaas_customer_id: "cus_1",
      asaas_subscription_id: "sub_1",
      subscription_updated_at: expect.any(String),
    });
  });

  it("returns 502 and writes nothing when Asaas fails", async () => {
    h.requireRole.mockResolvedValue({
      accountId: "acc-1",
      account: { id: "acc-1", name: "Loja X", asaas_customer_id: null },
    });
    h.createCustomer.mockRejectedValue(new Error("asaas down"));

    const { POST } = await import("./subscribe/route");
    const res = await POST();

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
      subscription_updated_at: expect.any(String),
    });
    expect(res.body).toEqual({ status: "canceled" });
  });
});
```

- [ ] **Step 2: rodar** `npx vitest run src/app/api/billing/subscribe-cancel.test.ts` → falha (rotas não existem).

- [ ] **Step 3: implementar `subscribe/route.ts`**

```ts
import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { createCustomer, createSubscription } from "@/lib/billing/asaas";

function admin(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST() {
  try {
    // allowBlocked: quem já está bloqueado precisa conseguir assinar
    // pra se desbloquear — senão fica trancado sem saída.
    const ctx = await requireRole("owner", { allowBlocked: true });

    let customerId = ctx.account.asaas_customer_id;
    if (!customerId) {
      const created = await createCustomer(ctx.account.name, undefined);
      customerId = created.customerId;
    }

    const { subscriptionId, invoiceUrl } = await createSubscription(
      customerId,
      `Assinatura wacrm — ${ctx.account.name}`
    );

    const db = admin();
    await db
      .from("accounts")
      .update({
        asaas_customer_id: customerId,
        asaas_subscription_id: subscriptionId,
        subscription_updated_at: new Date().toISOString(),
      })
      .eq("id", ctx.accountId);

    return NextResponse.json({ invoiceUrl });
  } catch (err) {
    if (err instanceof Error && !("status" in err)) {
      console.error("[billing subscribe] failed", err);
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return toErrorResponse(err);
  }
}
```

- [ ] **Step 4: implementar `cancel/route.ts`**

```ts
import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { cancelSubscription } from "@/lib/billing/asaas";

function admin(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST() {
  try {
    const ctx = await requireRole("owner", { allowBlocked: true });

    if (ctx.account.asaas_subscription_id) {
      await cancelSubscription(ctx.account.asaas_subscription_id);
    }

    const db = admin();
    await db
      .from("accounts")
      .update({
        subscription_status: "canceled",
        subscription_updated_at: new Date().toISOString(),
      })
      .eq("id", ctx.accountId);

    return NextResponse.json({ status: "canceled" });
  } catch (err) {
    return toErrorResponse(err);
  }
}
```

- [ ] **Step 5: rodar** `npx vitest run src/app/api/billing/subscribe-cancel.test.ts` → verde. `npm run typecheck && npm run lint`.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/billing/subscribe src/app/api/billing/cancel src/app/api/billing/subscribe-cancel.test.ts src/lib/auth/account.ts
git commit -m "feat(billing): subscribe + cancel routes"
```

---

## Task 6: Webhook do Asaas

**Files:**
- Create: `src/app/api/billing/webhook/asaas/route.ts`, `src/app/api/billing/webhook/asaas/route.test.ts`

**Interfaces:**
- Consumes: env var `ASAAS_WEBHOOK_TOKEN`.
- Produces: a rota. Sem exports.

- [ ] **Step 1: teste que falha** — `src/app/api/billing/webhook/asaas/route.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  state: {
    updateCalls: [] as Array<{ patch: Record<string, unknown>; eqArgs: unknown[][] }>,
    accountFound: true,
  },
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from(_table: string) {
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
    const res = await POST(post({ event: "PAYMENT_CONFIRMED" }, "wrong"));
    expect(res.init.status).toBe(401);
    expect(h.state.updateCalls).toHaveLength(0);
  });

  it("PAYMENT_CONFIRMED → subscription_status = active", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      post({ event: "PAYMENT_CONFIRMED", payment: { subscription: "sub_1" } })
    );
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
    const res = await POST(post({ event: "PAYMENT_CREATED", payment: { subscription: "sub_1" } }));
    expect(res.init).toEqual({ status: 200 });
    expect(h.state.updateCalls).toHaveLength(0);
    expect(infoSpy).toHaveBeenCalledWith("[asaas webhook] unhandled event:", "PAYMENT_CREATED");
  });

  it("missing subscription id in payload → 200, console.warn, nothing written", async () => {
    const { POST } = await import("./route");
    const res = await POST(post({ event: "PAYMENT_CONFIRMED", payment: {} }));
    expect(res.init).toEqual({ status: 200 });
    expect(h.state.updateCalls).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: rodar** `npx vitest run src/app/api/billing/webhook/asaas/route.test.ts` → falha.

- [ ] **Step 3: implementar** `src/app/api/billing/webhook/asaas/route.ts`

```ts
// ============================================================
// POST /api/billing/webhook/asaas
//
// O Asaas chama isso a cada mudança de status de pagamento. Nome
// exato do header de auth (asaas-access-token) e dos nomes de
// evento — confirmar na prática contra um webhook real do sandbox
// antes de considerar isto pronto pra produção (mesmo espírito do
// "confirmar na prática" da integração UAZAPI).
// ============================================================

import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function admin(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

type Json = Record<string, unknown>;

const EVENT_TO_STATUS: Record<string, string> = {
  PAYMENT_CONFIRMED: "active",
  PAYMENT_RECEIVED: "active",
  PAYMENT_OVERDUE: "past_due",
};

export async function POST(request: Request) {
  const token = request.headers.get("asaas-access-token");
  if (!token || token !== process.env.ASAAS_WEBHOOK_TOKEN) {
    console.warn("[asaas webhook] invalid or missing token");
    return NextResponse.json({ status: "unauthorized" }, { status: 401 });
  }

  const payload = (await request.json().catch(() => ({}))) as Json;
  const event = String(payload.event ?? "");
  const newStatus = EVENT_TO_STATUS[event];

  if (!newStatus) {
    console.info("[asaas webhook] unhandled event:", event);
    return NextResponse.json({ status: "ignored" }, { status: 200 });
  }

  const payment = (payload.payment as Json | undefined) ?? {};
  const subscriptionId = payment.subscription as string | undefined;
  if (!subscriptionId) {
    console.warn("[asaas webhook] payload missing payment.subscription", event);
    return NextResponse.json({ status: "ignored" }, { status: 200 });
  }

  const db = admin();
  const { error } = await db
    .from("accounts")
    .update({ subscription_status: newStatus, subscription_updated_at: new Date().toISOString() })
    .eq("asaas_subscription_id", subscriptionId);

  if (error) {
    console.error("[asaas webhook] account UPDATE failed:", error);
  }

  return NextResponse.json({ status: "received" }, { status: 200 });
}
```

- [ ] **Step 4: rodar** `npx vitest run src/app/api/billing/webhook/asaas/route.test.ts` → verde. `npm run typecheck && npm run lint`.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/billing/webhook/asaas
git commit -m "feat(billing): Asaas webhook syncs subscription_status"
```

---

## Task 7: Gate no layout + tela `/billing`

**Files:**
- Modify: `src/app/(dashboard)/layout.tsx`, `src/lib/auth/roles.ts`
- Create: `src/app/billing/page.tsx`, `src/app/billing/billing-actions.tsx`
- Modify: `messages/en.json`, `messages/ko.json`, `messages/pt-BR.json`

**Interfaces:**
- Consumes: `isAccountBlocked` (Task 2), rotas `/api/billing/subscribe` + `/api/billing/cancel` (Task 5).
- Produces: `canManageBilling(role): boolean` em `roles.ts`.

- [ ] **Step 1: `roles.ts`** — adicionar, perto de `canDeleteAccount`/`canTransferOwnership`:

```ts
/** Owner only: subscribe/cancel the account's billing. */
export function canManageBilling(role: AccountRole): boolean {
  return role === "owner";
}
```

- [ ] **Step 2: `src/app/(dashboard)/layout.tsx`** — vira async, consulta leve e resiliente (NÃO usa `getCurrentAccount()` — essa lança em conta desvinculada, que já tem um fluxo próprio via `AccountAccessAlert`; aqui só queremos agir quando **sabemos** que está bloqueada):

```tsx
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { isAccountBlocked } from "@/lib/billing/access";
import { DashboardShell } from "./dashboard-shell";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
};

async function shouldRedirectToBilling(): Promise<boolean> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;

    const { data: profile } = await supabase
      .from("profiles")
      .select("account_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!profile?.account_id) return false;

    const { data: account } = await supabase
      .from("accounts")
      .select("subscription_status, trial_ends_at")
      .eq("id", profile.account_id)
      .maybeSingle();
    if (!account) return false;

    return isAccountBlocked({
      subscription_status: account.subscription_status,
      trial_ends_at: account.trial_ends_at,
    });
  } catch {
    // Qualquer erro aqui: não bloqueia. O fluxo existente
    // (AccountAccessAlert) já cobre "algo deu errado ao carregar a
    // conta" — este gate só age quando tem certeza do bloqueio.
    return false;
  }
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (await shouldRedirectToBilling()) {
    redirect("/billing");
  }
  return <DashboardShell>{children}</DashboardShell>;
}
```

> Nota: a rota `/billing` fica DENTRO de `(dashboard)` (mesmo grupo, mesmo layout) — o `redirect` acima teria que evitar loop nela. Como `redirect()` do Next lança uma exceção especial capturada pelo próprio framework, e a página `/billing` também passaria por este mesmo layout, é preciso a página `/billing` **não** disparar o mesmo redirect. Isso é automático aqui: a checagem só redireciona quando bloqueado, e a página `/billing` é exatamente onde uma conta bloqueada precisa poder ficar — mas como o layout roda ANTES da página, ele redirecionaria `/billing` pra `/billing` (loop inofensivo, mas redundante). Corrigir: checar `headers()`/o pathname atual não é trivial num layout Server Component sem passar por `usePathname` (client-only). Solução mais simples: mover a página `/billing` pra **fora** do grupo `(dashboard)`, como uma rota irmã (`src/app/billing/page.tsx`, seu próprio layout mínimo, sem passar pelo `DashboardLayout` acima). Ajustar Step 3 abaixo para criar em `src/app/billing/page.tsx`, não `src/app/(dashboard)/billing/page.tsx`.

- [ ] **Step 3: `src/app/billing/page.tsx`** (fora do grupo `(dashboard)`, não passa pelo redirect do Step 2):

```tsx
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { createClient } from "@/lib/supabase/server";
import { canManageBilling } from "@/lib/auth/roles";
import { isAccountRole } from "@/lib/auth/roles";
import { BillingActions } from "./billing-actions";

export default async function BillingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("account_id, account_role")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile?.account_id || !isAccountRole(profile.account_role)) {
    redirect("/dashboard");
  }

  const { data: account } = await supabase
    .from("accounts")
    .select("name, subscription_status, trial_ends_at")
    .eq("id", profile.account_id)
    .maybeSingle();
  if (!account) redirect("/dashboard");

  const t = await getTranslations("Billing");
  const canManage = canManageBilling(profile.account_role);

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-muted-foreground">{account.name}</p>
      </div>
      <div className="rounded-lg border p-4">
        <p className="font-medium">
          {t("statusLabel")}:{" "}
          {t(`status.${account.subscription_status}` as "status.active")}
        </p>
        {account.subscription_status === "trialing" && account.trial_ends_at ? (
          <p className="text-muted-foreground text-sm">
            {t("trialEndsAt", { date: new Date(account.trial_ends_at).toLocaleDateString() })}
          </p>
        ) : null}
      </div>
      {canManage ? (
        <BillingActions status={account.subscription_status} />
      ) : (
        <p className="text-muted-foreground text-sm">{t("ownerOnly")}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: `src/app/billing/billing-actions.tsx`** (client component — os botões precisam de `onClick`):

```tsx
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

export function BillingActions({ status }: { status: string }) {
  const t = useTranslations("Billing");
  const [loading, setLoading] = useState(false);

  const subscribe = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/billing/subscribe", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "failed");
      window.location.href = json.invoiceUrl;
    } catch {
      toast.error(t("subscribeError"));
      setLoading(false);
    }
  };

  const cancel = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/billing/cancel", { method: "POST" });
      if (!res.ok) throw new Error("failed");
      toast.success(t("cancelSuccess"));
      window.location.reload();
    } catch {
      toast.error(t("cancelError"));
      setLoading(false);
    }
  };

  if (status === "active") {
    return (
      <Button variant="outline" onClick={cancel} disabled={loading}>
        {t("cancelBtn")}
      </Button>
    );
  }

  return (
    <Button onClick={subscribe} disabled={loading}>
      {t("subscribeBtn")}
    </Button>
  );
}
```

- [ ] **Step 5: i18n** — adicionar o namespace `Billing` em `messages/en.json`, `messages/ko.json` **e** `messages/pt-BR.json` (os três — `messages.test.ts` exige paridade nos três desde a sessão anterior):

`en.json`:
```json
"Billing": {
  "title": "Subscription",
  "statusLabel": "Status",
  "status": {
    "trialing": "Free trial",
    "active": "Active",
    "past_due": "Payment overdue",
    "canceled": "Canceled"
  },
  "trialEndsAt": "Trial ends {date}",
  "ownerOnly": "Only the account owner can manage billing.",
  "subscribeBtn": "Subscribe now",
  "cancelBtn": "Cancel subscription",
  "subscribeError": "Could not start the subscription. Try again.",
  "cancelSuccess": "Subscription canceled",
  "cancelError": "Could not cancel. Try again."
}
```

`pt-BR.json`:
```json
"Billing": {
  "title": "Assinatura",
  "statusLabel": "Status",
  "status": {
    "trialing": "Teste grátis",
    "active": "Ativa",
    "past_due": "Pagamento atrasado",
    "canceled": "Cancelada"
  },
  "trialEndsAt": "O teste acaba em {date}",
  "ownerOnly": "Só o dono da conta pode gerenciar a assinatura.",
  "subscribeBtn": "Assinar agora",
  "cancelBtn": "Cancelar assinatura",
  "subscribeError": "Não foi possível iniciar a assinatura. Tente de novo.",
  "cancelSuccess": "Assinatura cancelada",
  "cancelError": "Não foi possível cancelar. Tente de novo."
}
```

`ko.json` — coreano real, mesmas chaves:
```json
"Billing": {
  "title": "구독",
  "statusLabel": "상태",
  "status": {
    "trialing": "무료 체험",
    "active": "활성",
    "past_due": "결제 연체",
    "canceled": "취소됨"
  },
  "trialEndsAt": "체험 종료일: {date}",
  "ownerOnly": "계정 소유자만 결제를 관리할 수 있습니다.",
  "subscribeBtn": "지금 구독하기",
  "cancelBtn": "구독 취소",
  "subscribeError": "구독을 시작할 수 없습니다. 다시 시도하세요.",
  "cancelSuccess": "구독이 취소되었습니다",
  "cancelError": "취소할 수 없습니다. 다시 시도하세요."
}
```

Inserir cada bloco como uma chave de topo nova (irmã de `"Settings"`), respeitando a vírgula do JSON.

- [ ] **Step 6:** `npx vitest run src/i18n/` → verde (paridade + ICU). `npm run typecheck && npm run lint && npm run build`. `npx vitest run` (suíte inteira) → 0 falhas.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(dashboard)/layout.tsx" src/app/billing src/lib/auth/roles.ts messages/en.json messages/ko.json messages/pt-BR.json
git commit -m "feat(billing): dashboard block gate + /billing page"
```

---

## Self-Review (autor do plano)

**1. Cobertura da spec:**
- §3.1 migração → T1 ✓
- §3.2 cliente Asaas → T3 ✓
- §3.3 `isAccountBlocked` → T2 ✓
- §3.4 subscribe → T5 ✓
- §3.5 cancel → T5 ✓
- §3.6 webhook → T6 ✓
- §3.7 gate → T4 (API) + T7 (layout) ✓
- §3.8 tela `/billing` → T7 ✓ (localização corrigida pra `src/app/billing/`, fora do grupo `(dashboard)` — ver nota na T7 Step 2)
- §5 "confirmar na prática" → comentários inline em T3 (header `access_token`) e T6 (header do webhook, nomes de evento) ✓

**2. Placeholders:** os itens "confirmar na prática" são forward-refs deliberados (mesmo padrão UAZAPI), cada um com fallback claro (erro lançado com a mensagem do Asaas, evento desconhecido logado e ignorado) — não bloqueiam o smoke, só precisam de confirmação contra o sandbox real.

**3. Consistência de tipos:**
- `SubscriptionStatus` (T2) — usado em T4 (`AccountContext.account`), T7 (payload das queries diretas). ✓
- `isAccountBlocked({ subscription_status, trial_ends_at })` — mesma assinatura usada em T4 e T7. ✓
- **Gap encontrado na auto-revisão, já corrigido no texto acima:** T5 precisa de `asaas_customer_id`/`asaas_subscription_id` em `ctx.account`. T4 (interface `AccountContext.account`, query e retorno de `getCurrentAccount`) já inclui os dois campos — T5 lê `ctx.account.asaas_customer_id`/`asaas_subscription_id` direto, sem cast.
- `requireRole('owner', { allowBlocked: true })` — mesma chamada em T5 (subscribe e cancel). ✓

**4. Ordem:** T1 → T2 → T3 (paralelo a T2) → T4 (depende de T2) → T5 (depende de T3+T4) → T6 (depende de T1, independente de T4/T5) → T7 (depende de T2, T5, T6). T3 e T2 podem trocar de ordem entre si (independentes).

---

## Execution Handoff

Plano salvo em `docs/superpowers/plans/2026-09-03-asaas-billing.md`. Duas opções:

**1. Subagent-Driven (recomendado)** — subagente fresco por task, review entre tasks.

**2. Inline** — tasks nesta sessão com checkpoints.

Qual?
