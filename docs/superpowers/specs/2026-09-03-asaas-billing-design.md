# Cobrança recorrente (Asaas) — assinatura mensal por conta

**Data:** 2026-09-03
**Status:** design aprovado, aguardando plano de implementação

---

## 1. Contexto

O wacrm já é multi-tenant por construção: todo signup (trigger `handle_new_user`, migração `017_account_sharing.sql`) cria uma `accounts` row isolada com RLS via `is_account_member()`. O que falta pra revender acesso como mensalidade é **cobrança** — hoje não existe nenhum conceito de plano, assinatura, trial ou bloqueio por inadimplência.

Decisões de negócio já fechadas (brainstorming):
- **Um plano único**, sem tiers — sem limites de uso por enquanto.
- **Trial grátis de 7 dias** a partir do cadastro.
- **Bloqueio total** de acesso quando o trial acaba sem assinatura, ou uma cobrança atrasa (`past_due`) — sem modo somente-leitura.
- **Autoatendido via Asaas**: o próprio cliente assina (PIX, cartão ou boleto — `billingType: UNDEFINED`, o Asaas oferece as opções no checkout hospedado). Sem construir tela de checkout própria.
- **Cancelamento self-service**, bloqueia na hora (sem "acesso até o fim do período pago").
- **Sem painel de super-admin** nesta v1 — o painel do próprio Asaas cobre a visão de todos os clientes/assinaturas.
- **Webhook do Asaas** sincroniza o status; sem cron/job agendado (o fim do trial é calculado na hora da checagem, não é um evento).
- **Ingestão do WhatsApp continua funcionando mesmo com a conta bloqueada** — só o acesso autenticado da equipe ao CRM é gateado. Não queremos perder mensagem de cliente por atraso de pagamento.

---

## 2. Escopo

### Entrega

1. **Migração** (§3.1) — colunas de assinatura em `accounts` + trial automático no `handle_new_user` + trigger de proteção contra escrita direta pelo cliente.
2. **`src/lib/billing/asaas.ts`** (§3.2) — cliente da API do Asaas (criar cliente, criar assinatura, cancelar assinatura).
3. **`isAccountBlocked()`** (§3.3) — função pura que decide se uma conta está bloqueada.
4. **Rota `POST /api/billing/subscribe`** (§3.4) — inicia a assinatura, devolve a URL do checkout hospedado.
5. **Rota `POST /api/billing/cancel`** (§3.5) — cancela a assinatura, bloqueia na hora.
6. **Rota `POST /api/billing/webhook/asaas`** (§3.6) — recebe confirmação/atraso/cancelamento do Asaas.
7. **Gate de acesso** (§3.7) — bloqueio no layout do dashboard (Server Component) + defesa em profundidade em `getCurrentAccount()`.
8. **Tela `/billing`** (§3.8) — status da assinatura, botão assinar/cancelar. Único caminho sempre acessível mesmo com a conta bloqueada.

### Fora de escopo

- Múltiplos planos/tiers, limites de uso por plano.
- Painel de super-admin listando todos os clientes.
- Acesso somente-leitura como estado intermediário (é bloqueio total ou nada).
- Cupons/descontos, período de carência configurável, downgrade/upgrade (não há planos além do único).
- Nota fiscal/emissão fiscal automática — fora do escopo técnico desta spec (o Asaas emite recibo/comprovante próprio; nota fiscal de serviço, se necessária, é decisão fiscal separada do usuário).

---

## 3. Arquitetura

### 3.1 Migração

Nova migração `supabase/migrations/0XX_billing.sql`:

```sql
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'trialing'
    CHECK (subscription_status IN ('trialing', 'active', 'past_due', 'canceled')),
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS asaas_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS asaas_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS subscription_updated_at TIMESTAMPTZ;
```

Backfill de contas já existentes: `subscription_status = 'active'`, `trial_ends_at = NULL` (contas que já existem antes desta migração não devem ser bloqueadas retroativamente — presume-se que são contas de teste/operador, não clientes pagantes reais ainda).

`handle_new_user()` (redefinida — mesma função de `017_account_sharing.sql`, só adiciona o `trial_ends_at` no INSERT de `accounts`):

```sql
INSERT INTO public.accounts (name, owner_user_id, trial_ends_at)
VALUES (COALESCE(NULLIF(v_full_name, ''), NEW.email, 'My account'), NEW.id, NOW() + INTERVAL '7 days')
RETURNING id INTO v_account_id;
```

**Requisito de segurança (achado na revisão, não estava na conversa original):** a política `accounts_update` existente (`is_account_member(id, 'admin')`, sem restrição de coluna) permitiria que um admin technically-savvy chamasse o client Supabase direto do navegador e escrevesse `subscription_status = 'active'` nele mesmo, contornando o Asaas inteiramente. Trigger `BEFORE UPDATE` que reverte as 5 colunas de billing pro valor antigo (`OLD.*`) sempre que quem está escrevendo não é o `service_role`:

```sql
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

CREATE TRIGGER protect_billing_columns_trigger
  BEFORE UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION protect_billing_columns();
```

Todas as escritas nessas 5 colunas (subscribe/cancel/webhook) usam o cliente **service-role** (mesmo padrão de `whatsapp_connections.webhook_secret_hash`), então passam pelo trigger sem serem revertidas.

### 3.2 `src/lib/billing/asaas.ts`

Espelha o estilo de `src/lib/whatsapp/uazapi-admin.ts` — `fetch` direto, sem SDK (Asaas não tem SDK oficial em Node), funções puras:

```ts
export async function createCustomer(name: string, email: string): Promise<{ customerId: string }>
export async function createSubscription(customerId: string, value: number, description: string): Promise<{ subscriptionId: string; invoiceUrl: string }>
export async function cancelSubscription(subscriptionId: string): Promise<void>
```

Auth via header `access_token: <ASAAS_API_KEY>` (confirmar o nome exato do header na doc durante a implementação — mesmo espírito de "confirmar na prática" que a integração UAZAPI já usou). `value` (preço da mensalidade) vem de uma env var (`ASAAS_SUBSCRIPTION_PRICE_CENTS` ou similar), não hardcoded — fácil de ajustar sem deploy de código.

### 3.3 `isAccountBlocked()`

Função pura, testável sem mocks:

```ts
export function isAccountBlocked(account: {
  subscription_status: 'trialing' | 'active' | 'past_due' | 'canceled';
  trial_ends_at: string | null;
}): boolean {
  if (account.subscription_status === 'past_due' || account.subscription_status === 'canceled') {
    return true;
  }
  if (account.subscription_status === 'trialing') {
    return account.trial_ends_at !== null && new Date(account.trial_ends_at) < new Date();
  }
  return false; // 'active'
}
```

### 3.4 `POST /api/billing/subscribe`

`requireRole('owner')` — só o dono da conta assina (é decisão financeira). Fluxo:
1. Se `accounts.asaas_customer_id` já existe, reaproveita; senão chama `createCustomer` e grava (service-role).
2. Chama `createSubscription`, grava `asaas_subscription_id` (service-role).
3. Devolve `{ invoiceUrl }` — o front redireciona o navegador pra lá.

Erro do Asaas em qualquer chamada → 502, nenhuma coluna de billing é gravada parcialmente (só grava depois de sucesso confirmado).

### 3.5 `POST /api/billing/cancel`

`requireRole('owner')`. Chama `cancelSubscription(asaas_subscription_id)`, e já grava `subscription_status = 'canceled'` diretamente (não espera o webhook confirmar — cancelamento é uma ação síncrona do próprio usuário, diferente de mudança de status vinda de fora).

### 3.6 `POST /api/billing/webhook/asaas`

Sem auth de sessão (é o Asaas chamando, não um usuário logado) — autentica via token de webhook (`ASAAS_WEBHOOK_TOKEN`, mecanismo exato — header vs. query — a confirmar na doc/implementação). Usa o cliente **service-role** (mesmo padrão da rota de webhook UAZAPI: `src/app/api/whatsapp/webhook/uazapi/[secret]/route.ts`).

1. Token inválido → 401, log, não processa.
2. Localiza a conta por `asaas_subscription_id` vindo no payload. Não encontrada → log de aviso, responde 200 assim mesmo (não deixa o Asaas retentando pra sempre).
3. Mapeia o evento pro novo `subscription_status`:
   - `PAYMENT_CONFIRMED` / `PAYMENT_RECEIVED` → `active`
   - `PAYMENT_OVERDUE` → `past_due`
   - evento de assinatura cancelada/deletada → `canceled`
   - qualquer outro evento → log, ignora (o Asaas manda vários tipos de evento; só reagimos aos que mudam o gate de acesso)
4. `UPDATE accounts SET subscription_status = ..., subscription_updated_at = NOW() WHERE asaas_subscription_id = ...`.

Idempotente por natureza — reprocessar o mesmo evento só reescreve o mesmo valor, sem efeito colateral duplicado.

### 3.7 Gate de acesso

**Server-side (principal):** `src/app/(dashboard)/layout.tsx` vira async, faz uma consulta leve e resiliente (`profiles.account_id` → `accounts.subscription_status, trial_ends_at`) **sem usar `getCurrentAccount()`** — essa função já lança `ForbiddenError` quando o perfil não está vinculado a nenhuma conta, e isso já é tratado hoje por um fluxo **diferente e existente** (`AccountAccessAlert`, banner client-side, `src/components/layout/account-access-alert.tsx`). Se a consulta leve não resolver por qualquer motivo (perfil sem conta, erro de rede), **não bloqueia** — deixa esse outro fluxo já existente cuidar disso, meu gate novo só age quando efetivamente sabe que a conta está bloqueada. Se `isAccountBlocked(account)` → `redirect('/billing')` (de `next/navigation`) antes de renderizar `DashboardShell`.

**API-level (defesa em profundidade):** `getCurrentAccount()` em `src/lib/auth/account.ts` passa a selecionar também `subscription_status, trial_ends_at` e lançar uma nova `PaymentRequiredError` (status 402) quando `isAccountBlocked()`. Como TODA rota autenticada passa por `requireRole`/`getCurrentAccount`, as duas rotas que **precisam** funcionar com a conta já bloqueada (`/api/billing/subscribe`, `/api/billing/cancel` — senão ninguém consegue pagar pra se desbloquear) escapam desse gate via parâmetro opcional:

```ts
getCurrentAccount({ allowBlocked: true })
```

Default `false` (seguro por padrão); as 2-3 rotas que precisam funcionar com a conta bloqueada passam `true` explicitamente.

### 3.8 Tela `/billing`

`src/app/(dashboard)/billing/page.tsx` — Server Component; lê `subscription_status`/`trial_ends_at` com a mesma consulta leve e resiliente do §3.7 (não via `getCurrentAccount()` — evita repetir o problema de lançar em conta desvinculada, e evita mais uma rota de API só pra leitura). Precisa ficar **fora** do redirect do §3.7 (senão vira um loop). Mostra:
- Status atual (`Em teste — faltam N dias`, `Ativa`, `Pagamento atrasado`, `Cancelada`)
- Botão "Assinar agora" (chama `/api/billing/subscribe`, redireciona pro `invoiceUrl`) quando não há assinatura ativa
- Botão "Cancelar assinatura" (chama `/api/billing/cancel`) quando há assinatura ativa

Só visível/acionável pelo `owner` (mesma regra de `requireRole('owner')` das rotas).

---

## 4. Testes

Segue o padrão já usado no projeto (UAZAPI):
- `asaas.ts` — `fetch` mockado, testes unitários (padrão `uazapi-admin.test.ts`).
- `isAccountBlocked()` — testes puros, várias combinações de status/data.
- Rota do webhook — Supabase mockado, payloads simulados (padrão `route.test.ts` da UAZAPI).
- `getCurrentAccount({ allowBlocked })` — novos casos nos testes já existentes de `account.ts`.

## 5. Itens "confirmar na prática"

- Nome exato do header de autenticação da API do Asaas (`access_token` é o mais citado na documentação, mas confirmar).
- Mecanismo exato de autenticação do webhook do Asaas (token em header vs. query string).
- Nomes exatos dos eventos de webhook (`PAYMENT_CONFIRMED` vs. `PAYMENT_RECEIVED` — a doc do Asaas às vezes manda os dois pro mesmo pagamento; confirmar qual(is) tratar como "ativou").
- Confirmar se `billingType: UNDEFINED` de fato oferece PIX + cartão + boleto juntos no checkout hospedado (era a suposição-chave que motivou escolher o Asaas).
