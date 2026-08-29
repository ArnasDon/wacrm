# UAZAPI Onda 1b-ii — Provisionamento + rotas de conexão + card de QR — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar o provedor UAZAPI alcançável de ponta a ponta — o operador conecta um número por QR Code em Configurações → WhatsApp e envia por ele via `POST /api/v1/messages`.

**Architecture:** Wave code-only (a migração 040 já criou todo o schema). Um módulo de env server-only + um client `fetch` fino para a API de administração da UAZAPI alimentam 7 endpoints HTTP sob `/api/whatsapp/connections/*`. A UI de Settings vira dois cards fixos (Meta intocado + UAZAPI novo) com um seletor de canal padrão. O `resolveConnection` ganha um guard contra colunas `uazapi_*` NULL. O envio é provado por um teste de integração com `fetch` mockado; o smoke real fica com o operador pós-merge.

**Tech Stack:** Next.js 16.2 (App Router, route handlers com `params: Promise<…>`), TypeScript 6, Supabase (`@supabase/supabase-js`), Vitest, next-intl (`messages/en.json` + `messages/ko.json`), `node:crypto`.

**Spec:** `docs/superpowers/specs/2026-08-29-uazapi-onda-1b-ii-provisionamento.md` (a leitura obrigatória; o plano argumenta a partir dela). Specs de apoio: `docs/superpowers/specs/2026-08-27-uazapi-provider-design.md` §4.4/§4.5, `docs/superpowers/specs/2026-08-28-uazapi-onda-1b-i-plumbing.md` §7.

## Global Constraints

- **Sem migração.** A 040 já criou `uazapi_instance_id`, `uazapi_base_url`, `webhook_secret_hash`, `is_primary`, `label`, `archived_at`, `display_phone`, `profile_name`, `last_connection_error` e os índices parciais. Nenhum arquivo em `supabase/` é tocado.
- **`UAZAPI_ADMIN_TOKEN` e `UAZAPI_BASE_URL` são server-only.** Nunca importados por um client component, nunca em resposta de rota, nunca em log.
- **Nenhuma rota devolve `credential`, token de instância, `uazapi_instance_id` ou `webhook_secret_hash` ao cliente.** A forma exposta é o `ConnectionDTO` da spec §3.4.
- **Gate de autorização:** toda rota nova usa `requireRole('admin')` de `@/lib/auth/account` (equivalente server-side do `canEditSettings`, que é admin+) e `toErrorResponse(err)` no `catch`. Não reimplementar `supabase.auth.getUser()`.
- **AGENTS.md:** "This is NOT the Next.js you know" — antes de escrever um route handler, conferir `node_modules/next/dist/docs/01-app/` para a assinatura atual. Dynamic params são `{ params }: { params: Promise<{ id: string }> }` e precisam de `await`.
- **`decrypt` / `encrypt`** vêm de `@/lib/whatsapp/encryption` (`encrypt(text: string): string`, `decrypt(encryptedText: string): string`).
- **Prettier:** `semi: true, singleQuote: true, printWidth: 80, trailingComma: es5`. Arquivos novos saem prettier-clean; em arquivos existentes não-limpos, diff cirúrgico (só as linhas do escopo).
- **Baseline de testes:** 5 falhas pré-existentes de locale/fuso (`currency.test.ts` ×3, `dashboard/date-utils.test.ts` ×2). Não são desta wave; continuam sendo exatamente 5.
- **`messages.test.ts`** exige paridade total de chaves entre `en.json` e `ko.json` (sem fallback por-chave). Toda chave nova entra nos dois arquivos, com coreano real.
- **Portas de saída por task:** `npm run typecheck`, `npm run lint` (0 erros; warnings pré-existentes ok), e — nas tasks que tocam runtime — `npm test` com o baseline intacto. `npm run build` na última task de UI.

---

## File Structure

**Criados:**

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/whatsapp/uazapi-env.ts` | Ler `UAZAPI_BASE_URL` / `UAZAPI_ADMIN_TOKEN` (lança se faltarem); resolver a base URL pública do app a partir do request. |
| `src/lib/whatsapp/uazapi-env.test.ts` | Cobre os dois helpers. |
| `src/lib/whatsapp/uazapi-admin.ts` | Client `fetch` da API de administração da UAZAPI: `createInstance`, `configureWebhook`, `connectInstance`, `instanceStatus`, `disconnectInstance`, `deleteInstance`. |
| `src/lib/whatsapp/uazapi-admin.test.ts` | `fetch` mockado; header/corpo/erro por função. |
| `src/lib/whatsapp/uazapi-connection-dto.ts` | `toConnectionDTO(row)` — a projeção saneada única, reusada por todas as rotas. |
| `src/lib/whatsapp/uazapi-connection-dto.test.ts` | Garante que campos sensíveis nunca vazam. |
| `src/app/api/whatsapp/connections/route.ts` | `GET` (lista) + `POST` (cria conexão UAZAPI). |
| `src/app/api/whatsapp/connections/route.test.ts` | — |
| `src/app/api/whatsapp/connections/[id]/route.ts` | `PATCH` (`label`/`is_primary`/`mirror_inbound_media`) + `DELETE` (arquiva). |
| `src/app/api/whatsapp/connections/[id]/route.test.ts` | — |
| `src/app/api/whatsapp/connections/[id]/connect/route.ts` | `POST` → `/instance/connect`, devolve QR. |
| `src/app/api/whatsapp/connections/[id]/connect/route.test.ts` | — |
| `src/app/api/whatsapp/connections/[id]/status/route.ts` | `GET` → `/instance/status`, persiste o mapeamento. |
| `src/app/api/whatsapp/connections/[id]/status/route.test.ts` | — |
| `src/app/api/whatsapp/connections/[id]/disconnect/route.ts` | `POST` → `/instance/disconnect`, sem arquivar. |
| `src/app/api/whatsapp/connections/[id]/disconnect/route.test.ts` | — |
| `src/lib/whatsapp/uazapi-send-proof.test.ts` | Prova a cadeia `sendViaConnection` → transporte UAZAPI real → `fetch` mockado. |
| `src/components/settings/uazapi-connection-card.tsx` | Card "QR Code (UAZAPI)": conectar/QR/polling/status/desconectar/remover + aviso. |
| `src/components/settings/whatsapp-connections-panel.tsx` | Contêiner: renderiza `<WhatsAppConfig />` + `<UazapiConnectionCard />` + o seletor de canal padrão. |
| `src/components/settings/default-channel-selector.tsx` | Seletor "canal padrão" + o predicado puro `shouldShowChannelSelector(connections)`. |
| `src/components/settings/default-channel-selector.test.ts` | Cobre o predicado. |

**Modificados:**

| Arquivo | Mudança |
|---|---|
| `src/lib/whatsapp/resolve-connection.ts` | Guard: linha `uazapi` com `uazapi_instance_id`/`uazapi_base_url` NULL → `SendMessageError('whatsapp_not_configured')`. |
| `src/lib/whatsapp/resolve-connection.test.ts` | + casos do guard. |
| `src/app/api/whatsapp/react/route.ts` | `resolveConnection(supabase, accountId, { conversationId: conversation.id })`. |
| `src/app/api/whatsapp/config/route.ts` | A count-query da eleição de `is_primary` passa a checar `error`. |
| `src/components/settings/whatsapp-config.tsx` | `handleToggleMirrorMedia` deixa de escrever direto na tabela; passa a `PATCH /api/whatsapp/connections/<metaId>`. |
| `src/app/(dashboard)/settings/page.tsx` | O slot `whatsapp:` renderiza `<WhatsAppConnectionsPanel />` em vez de `<WhatsAppConfig />`. |
| `messages/en.json` | + chaves sob `Settings.whatsapp` (lista na Task 9/10). |
| `messages/ko.json` | As mesmas chaves, em coreano. |
| `.env.local.example` | + bloco UAZAPI. |
| `docs/superpowers/specs/2026-08-29-uazapi-onda-1b-ii-provisionamento.md` | §7: registrar que broadcast NÃO recebe `conversationId` nesta wave (Task 8). |

---

## Pre-flight (para o controlador, antes da Task 1)

Tasks que compartilham arquivo/interface:

| Par | Interface | Nota |
|---|---|---|
| T2 → T4/T5/T6 | `uazapi-admin.ts` exports | T4-T6 consomem as 6 funções que a T2 produz. Assinaturas fixadas na seção "Interfaces" da T2. |
| T1 → T4/T6 | `uazapiEnv()`, `resolveAppBaseUrl(req)` | idem. |
| T3 → T7 | guard do `resolveConnection` | T7 mocka `resolveConnection`, então não depende do guard; ordem T3-antes-de-T7 não é obrigatória, mas mantida. |
| T3 → T4/T5/T6 | cadeia de query do `resolveConnection` | T3 acrescenta um branch **depois** do `.maybeSingle()` — não muda a cadeia de query em si, então os fakes irmãos (send-core, broadcast-*, send/route) **não** precisam mudar. Confirmar no diff da T3; se algum fake quebrar, é enabler-only (regra herdada da 1b-i). |
| T4/T5/T6 | `src/app/api/whatsapp/connections/**` | Arquivos distintos por task; sem colisão. |
| T9 → T10 | `<UazapiConnectionCard />` | T10 monta o painel que embrulha o card da T9. |
| T9/T10 → `messages/*.json` | chaves i18n | T9 e T10 acrescentam chaves ao MESMO par de arquivos. Sequenciais (nunca em paralelo). Cada uma roda `messages.test.ts` antes de commitar. |

Rulings do controlador:
- **Broadcast não recebe `conversationId` nesta wave.** Um broadcast fan-out não tem uma conversa única; o alvo correto seria `{ connectionId: broadcast.connection_id }`, o que exige threading por `deliverBroadcast`/`resumeBroadcast` e só importa quando broadcast-sobre-UAZAPI existir (Onda 3). A Task 8 cobre só `react/route.ts` (que já tem a conversa carregada) e o `config/route.ts`. Registrar na §7 da spec.
- **Sem testes de componente.** O repo não tem `@testing-library` nem infra de render (3 `.test.tsx` no total). As tasks de UI (T9/T10) são verificadas por `npm run typecheck` + `npm run lint` + `npm run build` + `messages.test.ts`, e por extrair a lógica testável para helpers puros (`shouldShowChannelSelector`).

---

## Task 1: Módulo de env UAZAPI + `.env.local.example`

**Files:**
- Create: `src/lib/whatsapp/uazapi-env.ts`
- Test: `src/lib/whatsapp/uazapi-env.test.ts`
- Modify: `.env.local.example` (após a linha `WHATSAPP_TEMPLATES_DRY_RUN=true`, antes do bloco `# AI reply assistant`)

**Interfaces:**
- Produces:
  - `uazapiEnv(): { baseUrl: string; adminToken: string }` — lê `process.env.UAZAPI_BASE_URL` (com barra final removida) e `process.env.UAZAPI_ADMIN_TOKEN`; lança `Error` se qualquer um faltar/for vazio.
  - `resolveAppBaseUrl(request: Request): string` — base URL pública do app, sem barra final. Precedência: `process.env.NEXT_PUBLIC_SITE_URL` → header `x-forwarded-host` (+ `x-forwarded-proto`, default `https`) → header `host` (+ proto). Lança `Error('cannot resolve app base URL')` se nenhum resolver.

- [ ] **Step 1: Escrever os testes que falham**

```ts
// src/lib/whatsapp/uazapi-env.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uazapiEnv, resolveAppBaseUrl } from './uazapi-env';

const OLD = { ...process.env };
afterEach(() => {
  process.env = { ...OLD };
  vi.unstubAllEnvs();
});

describe('uazapiEnv', () => {
  it('devolve baseUrl sem barra final e o admin token', () => {
    vi.stubEnv('UAZAPI_BASE_URL', 'https://api.uazapi.com/');
    vi.stubEnv('UAZAPI_ADMIN_TOKEN', 'admin-xyz');
    expect(uazapiEnv()).toEqual({
      baseUrl: 'https://api.uazapi.com',
      adminToken: 'admin-xyz',
    });
  });

  it('lança quando UAZAPI_BASE_URL falta', () => {
    vi.stubEnv('UAZAPI_BASE_URL', '');
    vi.stubEnv('UAZAPI_ADMIN_TOKEN', 'admin-xyz');
    expect(() => uazapiEnv()).toThrow(/UAZAPI_BASE_URL/);
  });

  it('lança quando UAZAPI_ADMIN_TOKEN falta', () => {
    vi.stubEnv('UAZAPI_BASE_URL', 'https://api.uazapi.com');
    vi.stubEnv('UAZAPI_ADMIN_TOKEN', '');
    expect(() => uazapiEnv()).toThrow(/UAZAPI_ADMIN_TOKEN/);
  });
});

describe('resolveAppBaseUrl', () => {
  it('prioriza NEXT_PUBLIC_SITE_URL', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://crm.example.com/');
    const req = new Request('https://ignored.local/api/x', {
      headers: { host: 'ignored.local' },
    });
    expect(resolveAppBaseUrl(req)).toBe('https://crm.example.com');
  });

  it('cai para x-forwarded-host + x-forwarded-proto', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    const req = new Request('http://internal/api/x', {
      headers: { 'x-forwarded-host': 'crm.proxy.com', 'x-forwarded-proto': 'https' },
    });
    expect(resolveAppBaseUrl(req)).toBe('https://crm.proxy.com');
  });

  it('cai para host com https como proto default', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    const req = new Request('http://internal/api/x', {
      headers: { host: 'crm.bare.com' },
    });
    expect(resolveAppBaseUrl(req)).toBe('https://crm.bare.com');
  });

  it('lança quando nada resolve', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    const req = new Request('http://internal/api/x');
    expect(() => resolveAppBaseUrl(req)).toThrow(/app base URL/);
  });
});
```

- [ ] **Step 2: Rodar — deve falhar** `npx vitest run src/lib/whatsapp/uazapi-env.test.ts` → FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

```ts
// src/lib/whatsapp/uazapi-env.ts
// ============================================================
// Env e resolução de URL para o provisionamento UAZAPI.
//
// server-only por construção: só as rotas de `/api/whatsapp/connections`
// chamam estes helpers, e nunca em import de módulo (para não derrubar o
// build de quem não usa UAZAPI). O admin token governa TODAS as
// instâncias do servidor do operador — nunca é enviado ao cliente nem
// logado.
// ============================================================

export function uazapiEnv(): { baseUrl: string; adminToken: string } {
  const baseUrl = process.env.UAZAPI_BASE_URL?.trim().replace(/\/+$/, '');
  const adminToken = process.env.UAZAPI_ADMIN_TOKEN?.trim();
  if (!baseUrl) {
    throw new Error(
      'UAZAPI_BASE_URL is not set — required to provision UAZAPI connections',
    );
  }
  if (!adminToken) {
    throw new Error(
      'UAZAPI_ADMIN_TOKEN is not set — required to provision UAZAPI connections',
    );
  }
  return { baseUrl, adminToken };
}

export function resolveAppBaseUrl(request: Request): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  const headers = request.headers;
  const fwdHost = headers.get('x-forwarded-host');
  const host = fwdHost || headers.get('host');
  if (!host) throw new Error('cannot resolve app base URL: no host header');

  const proto =
    headers.get('x-forwarded-proto')?.split(',')[0].trim() || 'https';
  return `${proto}://${host}`.replace(/\/+$/, '');
}
```

- [ ] **Step 4: Rodar — deve passar** `npx vitest run src/lib/whatsapp/uazapi-env.test.ts` → PASS.

- [ ] **Step 5: `.env.local.example`** — inserir o bloco:

```
# ------------------------------------------------------------------
# UAZAPI — WhatsApp por QR Code (API NÃO-OFICIAL, opcional)
# ------------------------------------------------------------------
# Só o card "QR Code (UAZAPI)" em Configurações → WhatsApp depende
# destas. Deixe em branco para rodar só com a API Oficial (Meta).
#
# O admin token governa TODAS as instâncias do servidor UAZAPI do
# operador. Nunca é enviado ao navegador nem persistido por conta —
# o CRM cria uma instância por conexão e guarda só o token daquela
# instância, AES-256-GCM-encriptado com ENCRYPTION_KEY.
# UAZAPI_BASE_URL=https://api.uazapi.com
# UAZAPI_ADMIN_TOKEN=your-uazapi-server-admin-token
```

- [ ] **Step 6: Portas** `npm run typecheck && npm run lint && npx vitest run src/lib/whatsapp/uazapi-env.test.ts`.

- [ ] **Step 7: Commit** `git add src/lib/whatsapp/uazapi-env.ts src/lib/whatsapp/uazapi-env.test.ts .env.local.example && git commit -m "feat(uazapi): env module + app base URL resolver for provisioning"`

---

## Task 2: Client de provisionamento `uazapi-admin.ts`

**Files:**
- Create: `src/lib/whatsapp/uazapi-admin.ts`
- Test: `src/lib/whatsapp/uazapi-admin.test.ts`

**Interfaces:**
- Consumes: nada (só `fetch` global).
- Produces (todas `async`, todas recebem `baseUrl` já sem barra final):
  - `createInstance(baseUrl: string, adminToken: string, name: string): Promise<{ token: string; instanceId: string }>` — `POST {baseUrl}/instance/create`, header `admintoken`, body `{ name }`. Lê `json.token` e `json.instance.id`.
  - `configureWebhook(baseUrl: string, instanceToken: string, url: string): Promise<void>` — `POST {baseUrl}/webhook`, header `token`, body `{ url, events: ['messages', 'messages_update', 'connection', 'history'], excludeMessages: ['wasSentByApi'] }`.
  - `connectInstance(baseUrl: string, instanceToken: string): Promise<{ qrcode: string | null; paircode: string | null }>` — `POST {baseUrl}/instance/connect`, header `token`, body `{}`. Lê `json.instance.qrcode` / `json.instance.paircode`.
  - `instanceStatus(baseUrl: string, instanceToken: string): Promise<UazapiStatus>` — `GET {baseUrl}/instance/status`, header `token`.
  - `disconnectInstance(baseUrl: string, instanceToken: string): Promise<void>` — `POST {baseUrl}/instance/disconnect`, header `token`, body `{}`.
  - `deleteInstance(baseUrl: string, instanceToken: string): Promise<void>` — `DELETE {baseUrl}/instance`, header `token`.
  - `type UazapiStatus = { connected: boolean; loggedIn: boolean; phone: string | null; profileName: string | null; instanceStatus: 'disconnected' | 'connecting' | 'connected' | 'hibernated' | null; qrcode: string | null }` — projeção achatada de `{ instance: { qrcode, profileName, status }, status: { connected, loggedIn, jid } }`; `phone` vem de `status.jid?.user ?? null` (`jid` pode ser `null` OU objeto — ver `docs/uazapi-openapi-spec.yaml` linha ~2060).
- Erro: qualquer resposta não-`ok` → `throw new Error(json.error || json.message || 'UAZAPI <path> failed (<status>)')`. Segue o padrão de `src/lib/whatsapp/providers/uazapi-transport.ts:56-62`.

- [ ] **Step 1: Testes que falham**

```ts
// src/lib/whatsapp/uazapi-admin.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createInstance,
  configureWebhook,
  connectInstance,
  instanceStatus,
  disconnectInstance,
  deleteInstance,
} from './uazapi-admin';

const BASE = 'https://api.uazapi.com';
let fetchMock: ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as unknown as Response;
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('createInstance', () => {
  it('POSTa /instance/create com header admintoken e devolve token + instanceId', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ token: 'inst-tok', instance: { id: 'inst-id' } }),
    );
    const out = await createInstance(BASE, 'admin-tok', 'wacrm-acct-1');
    expect(out).toEqual({ token: 'inst-tok', instanceId: 'inst-id' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.uazapi.com/instance/create');
    expect(init.method).toBe('POST');
    expect(init.headers.admintoken).toBe('admin-tok');
    expect(init.headers.token).toBeUndefined();
    expect(JSON.parse(init.body)).toEqual({ name: 'wacrm-acct-1' });
  });

  it('lança com a mensagem do corpo quando não-ok', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'quota exceeded' }, false, 429));
    await expect(createInstance(BASE, 'admin-tok', 'x')).rejects.toThrow('quota exceeded');
  });
});

describe('configureWebhook', () => {
  it('POSTa /webhook com header token e o payload de modo simples', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    await configureWebhook(BASE, 'inst-tok', 'https://crm.example.com/api/whatsapp/webhook/uazapi/sek');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.uazapi.com/webhook');
    expect(init.headers.token).toBe('inst-tok');
    expect(JSON.parse(init.body)).toEqual({
      url: 'https://crm.example.com/api/whatsapp/webhook/uazapi/sek',
      events: ['messages', 'messages_update', 'connection', 'history'],
      excludeMessages: ['wasSentByApi'],
    });
  });
});

describe('connectInstance', () => {
  it('devolve qrcode e paircode do sub-objeto instance', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ instance: { qrcode: 'data:image/png;base64,AAA', paircode: '1234-5678' } }),
    );
    const out = await connectInstance(BASE, 'inst-tok');
    expect(out).toEqual({ qrcode: 'data:image/png;base64,AAA', paircode: '1234-5678' });
    expect(fetchMock.mock.calls[0][1].headers.token).toBe('inst-tok');
  });

  it('devolve nulls quando o corpo não traz qr', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ instance: {} }));
    expect(await connectInstance(BASE, 'inst-tok')).toEqual({ qrcode: null, paircode: null });
  });
});

describe('instanceStatus', () => {
  it('achata instance + status; jid objeto vira phone', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        instance: { qrcode: null, profileName: 'Loja ABC', status: 'connected' },
        status: { connected: true, loggedIn: true, jid: { user: '5511999998888' } },
      }),
    );
    expect(await instanceStatus(BASE, 'inst-tok')).toEqual({
      connected: true,
      loggedIn: true,
      phone: '5511999998888',
      profileName: 'Loja ABC',
      instanceStatus: 'connected',
      qrcode: null,
    });
  });

  it('jid null vira phone null; repassa qrcode fresco', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        instance: { qrcode: 'data:image/png;base64,BBB', profileName: null, status: 'connecting' },
        status: { connected: false, loggedIn: false, jid: null },
      }),
    );
    const out = await instanceStatus(BASE, 'inst-tok');
    expect(out.phone).toBeNull();
    expect(out.qrcode).toBe('data:image/png;base64,BBB');
    expect(out.instanceStatus).toBe('connecting');
  });
});

describe('disconnectInstance / deleteInstance', () => {
  it('disconnect POSTa /instance/disconnect com token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ response: 'Disconnected' }));
    await disconnectInstance(BASE, 'inst-tok');
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.uazapi.com/instance/disconnect');
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
  });

  it('delete usa método DELETE em /instance com token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ response: 'Instance Deleted' }));
    await deleteInstance(BASE, 'inst-tok');
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.uazapi.com/instance');
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
    expect(fetchMock.mock.calls[0][1].headers.token).toBe('inst-tok');
  });

  it('delete lança quando não-ok', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'not found' }, false, 404));
    await expect(deleteInstance(BASE, 'inst-tok')).rejects.toThrow('not found');
  });
});
```

- [ ] **Step 2: Rodar — FAIL** `npx vitest run src/lib/whatsapp/uazapi-admin.test.ts`.

- [ ] **Step 3: Implementar**

```ts
// src/lib/whatsapp/uazapi-admin.ts
// ============================================================
// Client da API de administração da UAZAPI (API não-oficial).
//
// `fetch` direto, sem estado, sem SDK — mesmo estilo de
// `providers/uazapi-transport.ts`. Auth por header: `admintoken` para
// criar instância (governa o servidor todo), `token` da instância para
// tudo depois. Só as rotas de `/api/whatsapp/connections` chamam isto.
// ============================================================

const WEBHOOK_EVENTS = ['messages', 'messages_update', 'connection', 'history'];

type Json = Record<string, unknown>;

async function call(
  url: string,
  init: RequestInit & { headers: Record<string, string> },
): Promise<Json> {
  const res = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
  const json = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok) {
    const path = new URL(url).pathname;
    const msg =
      (json.error as string) ||
      (json.message as string) ||
      `UAZAPI ${path} failed (${res.status})`;
    throw new Error(msg);
  }
  return json;
}

export async function createInstance(
  baseUrl: string,
  adminToken: string,
  name: string,
): Promise<{ token: string; instanceId: string }> {
  const json = await call(`${baseUrl}/instance/create`, {
    method: 'POST',
    headers: { admintoken: adminToken },
    body: JSON.stringify({ name }),
  });
  const instance = (json.instance as Json | undefined) ?? {};
  const token = json.token as string | undefined;
  const instanceId = instance.id as string | undefined;
  if (!token || !instanceId) {
    throw new Error('UAZAPI /instance/create response missing token or instance id');
  }
  return { token, instanceId };
}

export async function configureWebhook(
  baseUrl: string,
  instanceToken: string,
  url: string,
): Promise<void> {
  await call(`${baseUrl}/webhook`, {
    method: 'POST',
    headers: { token: instanceToken },
    body: JSON.stringify({
      url,
      events: WEBHOOK_EVENTS,
      excludeMessages: ['wasSentByApi'],
    }),
  });
}

export async function connectInstance(
  baseUrl: string,
  instanceToken: string,
): Promise<{ qrcode: string | null; paircode: string | null }> {
  const json = await call(`${baseUrl}/instance/connect`, {
    method: 'POST',
    headers: { token: instanceToken },
    body: JSON.stringify({}),
  });
  const instance = (json.instance as Json | undefined) ?? {};
  return {
    qrcode: (instance.qrcode as string) ?? null,
    paircode: (instance.paircode as string) ?? null,
  };
}

export type UazapiStatus = {
  connected: boolean;
  loggedIn: boolean;
  phone: string | null;
  profileName: string | null;
  instanceStatus:
    | 'disconnected'
    | 'connecting'
    | 'connected'
    | 'hibernated'
    | null;
  qrcode: string | null;
};

export async function instanceStatus(
  baseUrl: string,
  instanceToken: string,
): Promise<UazapiStatus> {
  const json = await call(`${baseUrl}/instance/status`, {
    method: 'GET',
    headers: { token: instanceToken },
  });
  const instance = (json.instance as Json | undefined) ?? {};
  const status = (json.status as Json | undefined) ?? {};
  const jid = status.jid as Json | null | undefined;
  return {
    connected: status.connected === true,
    loggedIn: status.loggedIn === true,
    phone: (jid && typeof jid === 'object' ? (jid.user as string) : null) ?? null,
    profileName: (instance.profileName as string) ?? null,
    instanceStatus: (instance.status as UazapiStatus['instanceStatus']) ?? null,
    qrcode: (instance.qrcode as string) ?? null,
  };
}

export async function disconnectInstance(
  baseUrl: string,
  instanceToken: string,
): Promise<void> {
  await call(`${baseUrl}/instance/disconnect`, {
    method: 'POST',
    headers: { token: instanceToken },
    body: JSON.stringify({}),
  });
}

export async function deleteInstance(
  baseUrl: string,
  instanceToken: string,
): Promise<void> {
  await call(`${baseUrl}/instance`, {
    method: 'DELETE',
    headers: { token: instanceToken },
  });
}
```

- [ ] **Step 4: Rodar — PASS**.
- [ ] **Step 5: Portas** `npm run typecheck && npm run lint && npx vitest run src/lib/whatsapp/uazapi-admin.test.ts`.
- [ ] **Step 6: Commit** `git commit -m "feat(uazapi): provisioning API client (instance create/connect/status/disconnect/delete + webhook)"`

---

## Task 3: Guard de `uazapi_*` NULL em `resolveConnection`

**Files:**
- Modify: `src/lib/whatsapp/resolve-connection.ts:113-122` (o bloco `if (resolved.provider === 'uazapi')`)
- Test: `src/lib/whatsapp/resolve-connection.test.ts`

**Interfaces:**
- Consumes: `SendMessageError` (já importado no arquivo), `resolved` row.
- Produces: nenhuma mudança de assinatura. Um novo caminho de erro: linha `provider='uazapi'` com `uazapi_instance_id` ou `uazapi_base_url` falsy → `SendMessageError('whatsapp_not_configured', <mesma mensagem/status de "sem conexão">, 400, { reason: 'not_configured' })`.

- [ ] **Step 1: Testes que falham** — acrescentar a `resolve-connection.test.ts` (seguir o padrão de mock do arquivo; um `describe` novo):

```ts
describe('guard de linha uazapi incompleta', () => {
  it('lança whatsapp_not_configured quando uazapi_base_url é NULL', async () => {
    const db = makeDb({
      // a linha primária resolvida é uazapi mas sem base_url
      primary: {
        id: 'c-uaz', provider: 'uazapi', credential: encFixture,
        uazapi_instance_id: 'inst-1', uazapi_base_url: null,
        archived_at: null, is_primary: true,
      },
    });
    await expect(resolveConnection(db, 'acct-1')).rejects.toMatchObject({
      code: 'whatsapp_not_configured',
      status: 400,
    });
  });

  it('lança quando uazapi_instance_id é NULL', async () => {
    const db = makeDb({
      primary: {
        id: 'c-uaz', provider: 'uazapi', credential: encFixture,
        uazapi_instance_id: null, uazapi_base_url: 'https://api.uazapi.com',
        archived_at: null, is_primary: true,
      },
    });
    await expect(resolveConnection(db, 'acct-1')).rejects.toMatchObject({
      code: 'whatsapp_not_configured',
    });
  });

  it('resolve normal quando ambos presentes', async () => {
    const db = makeDb({
      primary: {
        id: 'c-uaz', provider: 'uazapi', credential: encFixture,
        uazapi_instance_id: 'inst-1', uazapi_base_url: 'https://api.uazapi.com',
        archived_at: null, is_primary: true,
      },
    });
    const conn = await resolveConnection(db, 'acct-1');
    expect(conn).toMatchObject({
      provider: 'uazapi', instanceId: 'inst-1', baseUrl: 'https://api.uazapi.com',
    });
  });
});
```

> Nota ao implementador: adapte `makeDb` / `encFixture` ao que `resolve-connection.test.ts` já usa (ler o arquivo primeiro). Se o helper de mock atual não permite injetar a linha primária diretamente, estenda-o de forma enabler-only — sem tocar asserções de testes existentes.

- [ ] **Step 2: Rodar — FAIL** `npx vitest run src/lib/whatsapp/resolve-connection.test.ts`.

- [ ] **Step 3: Implementar** — substituir o bloco `if (resolved.provider === 'uazapi') { return {…} }` por:

```ts
  if (resolved.provider === 'uazapi') {
    // Uma linha uazapi sem instância/base URL é um provisionamento
    // pela metade (criação interrompida antes do UPDATE de status, ou
    // linha inserida à mão). Falha como "não configurado" — o mesmo
    // 400 de "sem conexão" — em vez de montar uma TransportConnection
    // inválida que viraria TypeError no primeiro fetch do transporte.
    if (!resolved.uazapi_instance_id || !resolved.uazapi_base_url) {
      throw new SendMessageError(
        'whatsapp_not_configured',
        'WhatsApp not configured. Please set up your WhatsApp integration first.',
        400,
        { reason: 'not_configured' }
      );
    }
    return {
      id: resolved.id,
      accountId,
      credential,
      provider: 'uazapi',
      instanceId: resolved.uazapi_instance_id,
      baseUrl: resolved.uazapi_base_url,
    };
  }
```

- [ ] **Step 4: Rodar — PASS** o arquivo + a suíte inteira `npx vitest run` (confirmar baseline = 5 falhas, e que os fakes irmãos de `send-core`/`broadcast-*`/`send/route` NÃO quebraram — o guard roda depois do `.maybeSingle()`, a cadeia de query é idêntica).
- [ ] **Step 5: Portas** `npm run typecheck && npm run lint`.
- [ ] **Step 6: Commit** `git commit -m "fix(whatsapp): resolveConnection guards against a half-provisioned uazapi row"`

---

## Task 4: `GET | POST /api/whatsapp/connections`

**Files:**
- Create: `src/lib/whatsapp/uazapi-connection-dto.ts`, `src/lib/whatsapp/uazapi-connection-dto.test.ts`
- Create: `src/app/api/whatsapp/connections/route.ts`
- Test: `src/app/api/whatsapp/connections/route.test.ts`

**Interfaces:**
- Consumes: `requireRole`, `toErrorResponse` (`@/lib/auth/account`); `uazapiEnv`, `resolveAppBaseUrl` (`@/lib/whatsapp/uazapi-env`); `createInstance`, `configureWebhook`, `deleteInstance` (`@/lib/whatsapp/uazapi-admin`); `encrypt` (`@/lib/whatsapp/encryption`); `node:crypto`.
- Produces:
  - `toConnectionDTO(row): ConnectionDTO` em `uazapi-connection-dto.ts` — projeta só `{ id, provider, label, status, is_primary, display_phone, profile_name, last_connection_error, created_at }`. **Type export:** `ConnectionDTO`.
  - `GET /api/whatsapp/connections` → `200 { data: ConnectionDTO[] }` — conexões do account com `archived_at IS NULL`, ambos os provedores, ordenadas por `created_at asc`.
  - `POST /api/whatsapp/connections` → `201 { data: ConnectionDTO }` (cria conexão UAZAPI) | `409` (já existe uazapi ativa) | `502` (falha de provisionamento).

- [ ] **Step 1: DTO + teste**

```ts
// src/lib/whatsapp/uazapi-connection-dto.ts
export type ConnectionDTO = {
  id: string;
  provider: 'meta' | 'uazapi';
  label: string | null;
  status: string;
  is_primary: boolean;
  display_phone: string | null;
  profile_name: string | null;
  last_connection_error: string | null;
  created_at: string;
};

export function toConnectionDTO(row: Record<string, unknown>): ConnectionDTO {
  return {
    id: row.id as string,
    provider: row.provider as 'meta' | 'uazapi',
    label: (row.label as string) ?? null,
    status: (row.status as string) ?? 'disconnected',
    is_primary: row.is_primary === true,
    display_phone: (row.display_phone as string) ?? null,
    profile_name: (row.profile_name as string) ?? null,
    last_connection_error: (row.last_connection_error as string) ?? null,
    created_at: row.created_at as string,
  };
}
```

```ts
// src/lib/whatsapp/uazapi-connection-dto.test.ts
import { describe, expect, it } from 'vitest';
import { toConnectionDTO } from './uazapi-connection-dto';

it('nunca inclui campos sensíveis', () => {
  const dto = toConnectionDTO({
    id: 'c1', provider: 'uazapi', label: null, status: 'connected',
    is_primary: true, display_phone: '5511999998888', profile_name: 'Loja',
    last_connection_error: null, created_at: '2026-08-29T00:00:00Z',
    credential: 'enc-secret', uazapi_instance_id: 'inst-1',
    webhook_secret_hash: 'hash', phone_number_id: 'PN1',
  });
  expect(Object.keys(dto).sort()).toEqual([
    'created_at', 'display_phone', 'id', 'is_primary', 'label',
    'last_connection_error', 'profile_name', 'provider', 'status',
  ]);
  expect(JSON.stringify(dto)).not.toContain('enc-secret');
  expect(JSON.stringify(dto)).not.toContain('inst-1');
});
```

- [ ] **Step 2: Teste de rota que falha** — `src/app/api/whatsapp/connections/route.test.ts`. Seguir o padrão de `src/app/api/whatsapp/send/route.test.ts` (mock chainable de Supabase via `vi.mock('@/lib/supabase/server')`, `callerRole` para `requireRole`). Mockar `@/lib/whatsapp/uazapi-admin` e `@/lib/whatsapp/uazapi-env`. Casos:

```
GET
 - 403 quando callerRole = 'agent'
 - 200 devolve as linhas não-arquivadas do account como ConnectionDTO[] (sem credential)

POST
 - 403 quando callerRole = 'agent'
 - 409 quando já existe linha provider='uazapi' archived_at IS NULL
 - happy: chama createInstance('…','…','wacrm-acct-1'); INSERT com
   provider='uazapi', credential encriptado, uazapi_instance_id='inst-id',
   uazapi_base_url='https://api.uazapi.com', status='disconnected',
   is_primary=false, webhook_secret_hash setado (64 hex);
   chama configureWebhook com url terminando em /api/whatsapp/webhook/uazapi/<hex>;
   201 devolve o ConnectionDTO
 - rollback: quando o INSERT devolve error → deleteInstance é chamado com o token
   da instância criada; resposta 502
 - webhook não-fatal: quando configureWebhook rejeita → a linha É criada,
   last_connection_error é gravado, resposta 201
```

- [ ] **Step 3: Implementar `route.ts`**

```ts
// src/app/api/whatsapp/connections/route.ts
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { encrypt } from '@/lib/whatsapp/encryption';
import { uazapiEnv, resolveAppBaseUrl } from '@/lib/whatsapp/uazapi-env';
import {
  createInstance,
  configureWebhook,
  deleteInstance,
} from '@/lib/whatsapp/uazapi-admin';
import { toConnectionDTO } from '@/lib/whatsapp/uazapi-connection-dto';

const SELECT_COLS =
  'id, provider, label, status, is_primary, display_phone, profile_name, last_connection_error, created_at';

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const { data, error } = await supabase
      .from('whatsapp_connections')
      .select(SELECT_COLS)
      .eq('account_id', accountId)
      .is('archived_at', null)
      .order('created_at', { ascending: true });
    if (error) {
      console.error('[connections GET]', error);
      return NextResponse.json({ error: 'Failed to load connections' }, { status: 500 });
    }
    return NextResponse.json({ data: (data ?? []).map(toConnectionDTO) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');

    // Uma conexão UAZAPI ativa por conta (o índice parcial
    // idx_connections_account_provider também trava no banco; este
    // check dá o 409 amigável).
    const { data: existing } = await supabase
      .from('whatsapp_connections')
      .select('id')
      .eq('account_id', accountId)
      .eq('provider', 'uazapi')
      .is('archived_at', null)
      .maybeSingle();
    if (existing) {
      return NextResponse.json(
        { error: 'This account already has a UAZAPI connection.' },
        { status: 409 },
      );
    }

    const { baseUrl, adminToken } = uazapiEnv();

    // 1. Cria a instância no servidor do operador.
    let instance: { token: string; instanceId: string };
    try {
      instance = await createInstance(baseUrl, adminToken, `wacrm-${accountId}`);
    } catch (err) {
      console.error('[connections POST] createInstance failed', err);
      return NextResponse.json(
        { error: 'Could not create a UAZAPI instance. Check UAZAPI_BASE_URL / UAZAPI_ADMIN_TOKEN.' },
        { status: 502 },
      );
    }

    // 2. Segredo do webhook — só o hash é persistido.
    const secret = crypto.randomBytes(32).toString('hex');
    const webhookSecretHash = crypto.createHash('sha256').update(secret).digest('hex');

    // 3. Grava a linha.
    const { data: inserted, error: insertError } = await supabase
      .from('whatsapp_connections')
      .insert({
        account_id: accountId,
        user_id: userId,
        provider: 'uazapi',
        credential: encrypt(instance.token),
        uazapi_instance_id: instance.instanceId,
        uazapi_base_url: baseUrl,
        status: 'disconnected',
        is_primary: false,
        webhook_secret_hash: webhookSecretHash,
      })
      .select(SELECT_COLS)
      .single();

    if (insertError || !inserted) {
      console.error('[connections POST] insert failed, rolling back instance', insertError);
      await deleteInstance(baseUrl, instance.token).catch((e) =>
        console.error('[connections POST] rollback deleteInstance failed', e),
      );
      return NextResponse.json({ error: 'Failed to save the connection.' }, { status: 502 });
    }

    // 4. Registra o webhook (não-fatal).
    const webhookUrl = `${resolveAppBaseUrl(request)}/api/whatsapp/webhook/uazapi/${secret}`;
    try {
      await configureWebhook(baseUrl, instance.token, webhookUrl);
    } catch (err) {
      console.error('[connections POST] configureWebhook failed (non-fatal)', err);
      await supabase
        .from('whatsapp_connections')
        .update({ last_connection_error: 'Webhook não configurado — reconecte.' })
        .eq('id', inserted.id);
      const withErr = { ...inserted, last_connection_error: 'Webhook não configurado — reconecte.' };
      return NextResponse.json({ data: toConnectionDTO(withErr) }, { status: 201 });
    }

    return NextResponse.json({ data: toConnectionDTO(inserted) }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
```

- [ ] **Step 4: Rodar** os dois arquivos de teste → PASS.
- [ ] **Step 5: Portas** `npm run typecheck && npm run lint && npx vitest run src/app/api/whatsapp/connections src/lib/whatsapp/uazapi-connection-dto.test.ts`.
- [ ] **Step 6: Commit** `git commit -m "feat(uazapi): GET/POST /api/whatsapp/connections — list + provision"`

---

## Task 5: `PATCH | DELETE /api/whatsapp/connections/[id]`

**Files:**
- Create: `src/app/api/whatsapp/connections/[id]/route.ts`
- Test: `src/app/api/whatsapp/connections/[id]/route.test.ts`

**Interfaces:**
- Consumes: `requireRole`, `toErrorResponse`; `uazapiEnv`; `disconnectInstance`, `deleteInstance` (`uazapi-admin`); `decrypt` (`encryption`); `toConnectionDTO`.
- Produces:
  - `PATCH` body `{ label?: string; is_primary?: boolean; mirror_inbound_media?: boolean }` → `200 { data: ConnectionDTO }` | `400` (`is_primary:false` na única conexão ativa) | `404`.
  - `DELETE` → `200 { data: ConnectionDTO }` (linha arquivada) | `404`.

- [ ] **Step 1: Teste que falha** — casos:

```
comum
 - 403 quando callerRole = 'agent'
 - 404 quando o id não é do account (row não carrega com account_id)

PATCH
 - label: grava label, devolve DTO
 - mirror_inbound_media: grava a coluna
 - is_primary:true → faz UPDATE is_primary=true no id ALVO primeiro,
   depois UPDATE is_primary=false nas OUTRAS linhas ativas do account
   (asserir a ordem das duas chamadas)
 - is_primary:false quando é a única linha ativa → 400
 - is_primary:false quando há 2+ ativas → grava false

DELETE
 - provider='uazapi': chama disconnectInstance e deleteInstance com o token
   decriptado; UPDATE archived_at + status='disconnected' + is_primary=false
 - repasse: quando a linha arquivada era is_primary e resta exatamente 1
   ativa → essa recebe is_primary=true
 - quando restam 0 ou 2+ ativas → ninguém recebe is_primary
 - deleteInstance rejeita → o arquivamento ACONTECE mesmo assim (erro logado)
```

- [ ] **Step 2: Implementar**

```ts
// src/app/api/whatsapp/connections/[id]/route.ts
import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { decrypt } from '@/lib/whatsapp/encryption';
import { uazapiEnv } from '@/lib/whatsapp/uazapi-env';
import { disconnectInstance, deleteInstance } from '@/lib/whatsapp/uazapi-admin';
import { toConnectionDTO } from '@/lib/whatsapp/uazapi-connection-dto';

const SELECT_COLS =
  'id, provider, label, status, is_primary, display_phone, profile_name, last_connection_error, created_at';

type RowLite = {
  id: string;
  provider: 'meta' | 'uazapi';
  is_primary: boolean;
  credential: string;
  uazapi_base_url: string | null;
};

async function loadRow(
  supabase: Awaited<ReturnType<typeof requireRole>>['supabase'],
  accountId: string,
  id: string,
): Promise<RowLite | null> {
  const { data } = await supabase
    .from('whatsapp_connections')
    .select('id, provider, is_primary, credential, uazapi_base_url')
    .eq('id', id)
    .eq('account_id', accountId)
    .is('archived_at', null)
    .maybeSingle();
  return (data as RowLite) ?? null;
}

async function activeCount(
  supabase: Awaited<ReturnType<typeof requireRole>>['supabase'],
  accountId: string,
): Promise<number> {
  const { count } = await supabase
    .from('whatsapp_connections')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .is('archived_at', null);
  return count ?? 0;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { supabase, accountId } = await requireRole('admin');
    const row = await loadRow(supabase, accountId, id);
    if (!row) return NextResponse.json({ error: 'Connection not found' }, { status: 404 });

    const body = (await request.json().catch(() => ({}))) as {
      label?: string;
      is_primary?: boolean;
      mirror_inbound_media?: boolean;
    };

    const patch: Record<string, unknown> = {};
    if (typeof body.label === 'string') patch.label = body.label;
    if (typeof body.mirror_inbound_media === 'boolean') {
      patch.mirror_inbound_media = body.mirror_inbound_media;
    }

    if (body.is_primary === true) {
      // set-new-primeiro: a janela entre os dois UPDATEs tem 2 linhas
      // primárias (resolveConnection nível 4 usa .limit(1) — inofensivo);
      // a ordem inversa deixaria 0 e quebraria um envio concorrente.
      patch.is_primary = true;
    } else if (body.is_primary === false) {
      if ((await activeCount(supabase, accountId)) <= 1) {
        return NextResponse.json(
          { error: 'The account needs a default channel — promote another connection first.' },
          { status: 400 },
        );
      }
      patch.is_primary = false;
    }

    if (Object.keys(patch).length > 0) {
      const { error } = await supabase
        .from('whatsapp_connections')
        .update(patch)
        .eq('id', id)
        .eq('account_id', accountId);
      if (error) {
        console.error('[connections PATCH]', error);
        return NextResponse.json({ error: 'Failed to update connection' }, { status: 500 });
      }
    }

    if (body.is_primary === true) {
      await supabase
        .from('whatsapp_connections')
        .update({ is_primary: false })
        .eq('account_id', accountId)
        .is('archived_at', null)
        .neq('id', id);
    }

    const { data: fresh } = await supabase
      .from('whatsapp_connections')
      .select(SELECT_COLS)
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle();
    return NextResponse.json({ data: toConnectionDTO(fresh ?? {}) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { supabase, accountId } = await requireRole('admin');
    const row = await loadRow(supabase, accountId, id);
    if (!row) return NextResponse.json({ error: 'Connection not found' }, { status: 404 });

    if (row.provider === 'uazapi' && row.uazapi_base_url) {
      try {
        const token = decrypt(row.credential);
        const { baseUrl } = uazapiEnv();
        await disconnectInstance(baseUrl, token).catch(() => {});
        await deleteInstance(baseUrl, token);
      } catch (err) {
        // A cota do operador pode vazar uma instância; ainda assim
        // arquivamos a linha — o operador não fica preso ao índice único.
        console.error('[connections DELETE] remote cleanup failed', err);
      }
    }

    const { data: archived, error } = await supabase
      .from('whatsapp_connections')
      .update({ archived_at: new Date().toISOString(), status: 'disconnected', is_primary: false })
      .eq('id', id)
      .eq('account_id', accountId)
      .select(SELECT_COLS)
      .single();
    if (error) {
      console.error('[connections DELETE]', error);
      return NextResponse.json({ error: 'Failed to archive connection' }, { status: 500 });
    }

    // Repasse do primary: se a arquivada era primária e resta exatamente
    // uma ativa, ela herda. 0 ou 2+ → ninguém herda (escolha explícita).
    if (row.is_primary) {
      const { data: remaining } = await supabase
        .from('whatsapp_connections')
        .select('id')
        .eq('account_id', accountId)
        .is('archived_at', null);
      if (remaining && remaining.length === 1) {
        await supabase
          .from('whatsapp_connections')
          .update({ is_primary: true })
          .eq('id', remaining[0].id);
      }
    }

    return NextResponse.json({ data: toConnectionDTO(archived) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
```

- [ ] **Step 3: Rodar → PASS. Step 4: Portas. Step 5: Commit** `git commit -m "feat(uazapi): PATCH/DELETE /api/whatsapp/connections/[id] — label/primary/mirror + archive"`

---

## Task 6: `connect` + `status` + `disconnect`

**Files:**
- Create: `src/app/api/whatsapp/connections/[id]/connect/route.ts` + `.test.ts`
- Create: `src/app/api/whatsapp/connections/[id]/status/route.ts` + `.test.ts`
- Create: `src/app/api/whatsapp/connections/[id]/disconnect/route.ts` + `.test.ts`

**Interfaces:**
- Consumes: `requireRole`, `toErrorResponse`; `uazapiEnv`; `connectInstance`, `instanceStatus`, `disconnectInstance` (`uazapi-admin`); `decrypt`.
- Produces:
  - `POST …/connect` → `200 { qrcode: string | null, paircode: string | null, expiresInSeconds: 120 }`. Efeito: `UPDATE status='connecting'`.
  - `GET …/status` → `200 { status, display_phone, profile_name, qrcode }`. Efeito: persiste o mapeamento (`connected` → grava `display_phone`/`profile_name`, limpa `last_connection_error`; senão grava `status`).
  - `POST …/disconnect` → `200 { data: ConnectionDTO }`. Efeito: `disconnectInstance` best-effort + `UPDATE status='disconnected'`.
- Todas: carregam a linha por `id` + `account_id` + `provider='uazapi'` + `archived_at IS NULL`; `404` se não for do account. Helper compartilhado — duplicar o `loadUazapiRow` pequeno em cada arquivo (3 linhas) OU extrair para `uazapi-connection-dto.ts`. **Decisão:** extrair `loadUazapiConnectionRow(supabase, accountId, id)` para um novo `src/lib/whatsapp/uazapi-connection-row.ts` e reusar nas 3 + na Task 5.

> Implementador: se a Task 5 já foi feita, refatore o `loadRow` dela para importar de `uazapi-connection-row.ts` (diff cirúrgico). Se ainda não, a Task 5 importa daqui.

- [ ] **Step 1** — `src/lib/whatsapp/uazapi-connection-row.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

export type UazapiConnectionRow = {
  id: string;
  provider: 'meta' | 'uazapi';
  is_primary: boolean;
  status: string;
  credential: string;
  uazapi_base_url: string | null;
  uazapi_instance_id: string | null;
};

export async function loadUazapiConnectionRow(
  db: SupabaseClient,
  accountId: string,
  id: string,
): Promise<UazapiConnectionRow | null> {
  const { data } = await db
    .from('whatsapp_connections')
    .select(
      'id, provider, is_primary, status, credential, uazapi_base_url, uazapi_instance_id',
    )
    .eq('id', id)
    .eq('account_id', accountId)
    .eq('provider', 'uazapi')
    .is('archived_at', null)
    .maybeSingle();
  return (data as UazapiConnectionRow) ?? null;
}
```

- [ ] **Step 2: connect/route.ts**

```ts
import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { decrypt } from '@/lib/whatsapp/encryption';
import { uazapiEnv } from '@/lib/whatsapp/uazapi-env';
import { connectInstance } from '@/lib/whatsapp/uazapi-admin';
import { loadUazapiConnectionRow } from '@/lib/whatsapp/uazapi-connection-row';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { supabase, accountId } = await requireRole('admin');
    const row = await loadUazapiConnectionRow(supabase, accountId, id);
    if (!row || !row.uazapi_base_url) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 });
    }
    const { baseUrl } = uazapiEnv();
    const { qrcode, paircode } = await connectInstance(baseUrl, decrypt(row.credential));
    await supabase
      .from('whatsapp_connections')
      .update({ status: 'connecting', last_connection_error: null })
      .eq('id', id)
      .eq('account_id', accountId);
    return NextResponse.json({ qrcode, paircode, expiresInSeconds: 120 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
```

- [ ] **Step 3: status/route.ts**

```ts
import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { decrypt } from '@/lib/whatsapp/encryption';
import { uazapiEnv } from '@/lib/whatsapp/uazapi-env';
import { instanceStatus } from '@/lib/whatsapp/uazapi-admin';
import { loadUazapiConnectionRow } from '@/lib/whatsapp/uazapi-connection-row';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { supabase, accountId } = await requireRole('admin');
    const row = await loadUazapiConnectionRow(supabase, accountId, id);
    if (!row || !row.uazapi_base_url) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 });
    }
    const { baseUrl } = uazapiEnv();
    const st = await instanceStatus(baseUrl, decrypt(row.credential));

    const patch: Record<string, unknown> = st.connected
      ? {
          status: 'connected',
          display_phone: st.phone,
          profile_name: st.profileName,
          last_connection_error: null,
        }
      : { status: st.instanceStatus ?? 'disconnected' };

    await supabase
      .from('whatsapp_connections')
      .update(patch)
      .eq('id', id)
      .eq('account_id', accountId);

    return NextResponse.json({
      status: patch.status,
      display_phone: st.connected ? st.phone : null,
      profile_name: st.connected ? st.profileName : null,
      qrcode: st.qrcode,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
```

- [ ] **Step 4: disconnect/route.ts**

```ts
import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { decrypt } from '@/lib/whatsapp/encryption';
import { uazapiEnv } from '@/lib/whatsapp/uazapi-env';
import { disconnectInstance } from '@/lib/whatsapp/uazapi-admin';
import { loadUazapiConnectionRow } from '@/lib/whatsapp/uazapi-connection-row';
import { toConnectionDTO } from '@/lib/whatsapp/uazapi-connection-dto';

const SELECT_COLS =
  'id, provider, label, status, is_primary, display_phone, profile_name, last_connection_error, created_at';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { supabase, accountId } = await requireRole('admin');
    const row = await loadUazapiConnectionRow(supabase, accountId, id);
    if (!row || !row.uazapi_base_url) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 });
    }
    try {
      const { baseUrl } = uazapiEnv();
      await disconnectInstance(baseUrl, decrypt(row.credential));
    } catch (err) {
      console.error('[connections disconnect] remote disconnect failed', err);
    }
    const { data: fresh } = await supabase
      .from('whatsapp_connections')
      .update({ status: 'disconnected' })
      .eq('id', id)
      .eq('account_id', accountId)
      .select(SELECT_COLS)
      .single();
    return NextResponse.json({ data: toConnectionDTO(fresh ?? {}) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
```

- [ ] **Step 5: Testes** para os 3 (403 agent / 404 outro account / happy com `uazapi-admin` mockado / efeito de UPDATE). **Step 6: Portas. Step 7: Commit** `git commit -m "feat(uazapi): connect / status / disconnect connection routes"`

---

## Task 7: Prova de envio — teste de integração

**Files:**
- Create: `src/lib/whatsapp/uazapi-send-proof.test.ts`

**Interfaces:**
- Consumes: `sendViaConnection` (`@/lib/whatsapp/send-core`), o transporte UAZAPI **real** (não mockar `@/lib/whatsapp/providers`), `fetch` global stubbed.
- Produces: nada de runtime — só a garantia de que a cadeia variante-`uazapi` → `createUazapiTransport` → `POST {baseUrl}/send/text` funciona fim-a-fim sem rede.

- [ ] **Step 1: Escrever o teste**

```ts
// src/lib/whatsapp/uazapi-send-proof.test.ts
// Prova a fiação UAZAPI de ponta a ponta pelo núcleo de envio:
// resolveConnection devolve a variante 'uazapi' → createTransport monta
// o transporte real → dispatchSend faz UM POST /send/text no baseUrl da
// conexão, com header `token` e { number, text } corretos, e o
// providerMessageId da resposta volta ao chamador. O smoke real (número
// de verdade) fica com o operador, pós-merge.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const resolveConnection = vi.fn();
vi.mock('@/lib/whatsapp/resolve-connection', () => ({
  resolveConnection: (...a: unknown[]) => resolveConnection(...a),
}));
// IMPORTANTE: NÃO mockar '@/lib/whatsapp/providers' — queremos o
// createUazapiTransport real.

import { sendViaConnection } from './send-core';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as unknown as Response;
}

// Supabase fake mínimo: contato/telefone + inserts de mensagem. Modele
// só o que sendViaConnection toca (ver src/lib/whatsapp/send-core.ts:
// loadContact, e a persistência pós-envio). O implementador ajusta os
// nós conforme o send-core real exigir — o objetivo é chegar em
// dispatchSend com um TransportConnection uazapi.
function makeDb() {
  /* … chainable mock: conversations→{id, contact:{phone:'+5511999998888'}},
     messages insert→{id:'m1'}, message idempotency lookups→null … */
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(
    jsonResponse({ messageid: '3EB0ABC123', id: 'uazapi-row-1' }),
  );
  vi.stubGlobal('fetch', fetchMock);
  resolveConnection.mockResolvedValue({
    id: 'c-uaz',
    accountId: 'acct-1',
    credential: 'inst-token-plain',
    provider: 'uazapi',
    instanceId: 'inst-1',
    baseUrl: 'https://api.uazapi.com',
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('envio de texto sobre uma conexão UAZAPI', () => {
  it('faz um POST /send/text com token e { number, text }, e propaga o messageid', async () => {
    const db = makeDb();
    const result = await sendViaConnection(db as never, 'acct-1', {
      conversationId: 'conv-1',
      message: { kind: 'text', text: 'Olá do CRM' },
      // demais params conforme SendViaConnectionParams
    } as never);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.uazapi.com/send/text');
    expect(init.method).toBe('POST');
    expect(init.headers.token).toBe('inst-token-plain');
    expect(JSON.parse(init.body)).toMatchObject({
      number: '5511999998888',
      text: 'Olá do CRM',
    });
    expect(result).toMatchObject({ /* providerMessageId / whatsappMessageId */ '' : '' });
  });
});
```

> Implementador: este é o único teste da wave que precisa modelar o `send-core` de verdade. Leia `src/lib/whatsapp/send-core.ts` (`sendViaConnection`, `loadContact`, a persistência) e `src/lib/whatsapp/send-core.test.ts` para o formato do fake e dos `params`. Se modelar o fake do `send-core` inteiro ficar desproporcional, é aceitável provar a cadeia um nível abaixo — chamando `createTransport(uazapiVariant)` do módulo **real** `@/lib/whatsapp/providers` e exercitando `transport.sendText(...)` com `fetch` stubbed — desde que a asserção continue sendo "um POST /send/text, header token, corpo {number,text}, id propagado". Registre no relatório qual nível usou e por quê.

- [ ] **Step 2: Rodar → PASS. Step 3: Portas** `npm run typecheck && npm run lint && npx vitest run src/lib/whatsapp/uazapi-send-proof.test.ts`.
- [ ] **Step 4: Rodar `npx vitest run`** — baseline intacto (5 falhas).
- [ ] **Step 5: Commit** `git commit -m "test(uazapi): prove the send path end-to-end over a UAZAPI connection (mocked fetch)"`

---

## Task 8: Hardening de call sites (`react` + `config` count)

**Files:**
- Modify: `src/app/api/whatsapp/react/route.ts:105`
- Modify: `src/app/api/whatsapp/config/route.ts:407-411`
- Modify: `src/app/api/whatsapp/react/route.test.ts` (se um teste asseriar os args de `resolveConnection`)
- Modify: `docs/superpowers/specs/2026-08-29-uazapi-onda-1b-ii-provisionamento.md` §7

- [ ] **Step 1: `react/route.ts`** — a conversa já está carregada (`conversation.id`). Trocar:

```ts
      connection = await resolveConnection(supabase, accountId);
```

por:

```ts
      // Passa a conversa de origem para que a reação respeite a conexão
      // daquela conversa (nível 1 do resolveConnection) em vez de sempre
      // cair na primária. Broadcast fica de fora desta wave (fan-out não
      // tem conversa única) — ver spec §7.
      connection = await resolveConnection(supabase, accountId, {
        conversationId: conversation.id,
      });
```

- [ ] **Step 2: `config/route.ts`** — a count-query da eleição de `is_primary` (linhas ~407-411) passa a checar `error`:

```ts
      const { count: existingCount, error: countError } = await supabase
        .from('whatsapp_connections')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId)
        .is('archived_at', null);

      if (countError) {
        console.error('Error counting whatsapp_connections:', countError);
        return NextResponse.json(
          { error: 'Failed to save configuration' },
          { status: 500 }
        );
      }
```

- [ ] **Step 3: Testes** — rodar `npx vitest run src/app/api/whatsapp/react src/app/api/whatsapp/config`. Ajustar mocks se algum quebrar (enabler-only). Se `react/route.test.ts` não asseria os args de `resolveConnection`, adicionar um `expect(resolveConnection).toHaveBeenCalledWith(expect.anything(), 'acct-…', { conversationId: 'conv-…' })`.

- [ ] **Step 4: spec §7** — na seção "Fora de escopo", trocar a linha sobre broadcast/`conversationId` por:

```
- **Broadcast NÃO recebe `conversationId`/`connectionId` nesta wave.** Um
  broadcast fan-out não tem conversa única; o alvo correto é
  `{ connectionId: broadcast.connection_id }`, que exige threading por
  `deliverBroadcast`/`resumeBroadcast` e só importa com broadcast-sobre-
  UAZAPI — Onda 3. `react/route.ts` (que já tem a conversa) foi feito na
  Task 8; broadcast fica para a Onda 3.
```

- [ ] **Step 5: Portas + Commit** `git commit -m "fix(whatsapp): react passes conversationId to resolveConnection; config count-query checks error"`

---

## Task 9: `<UazapiConnectionCard />` + i18n

**Files:**
- Create: `src/components/settings/uazapi-connection-card.tsx`
- Modify: `messages/en.json` (bloco `Settings.whatsapp`)
- Modify: `messages/ko.json` (as mesmas chaves)

**Interfaces:**
- Consumes: `GET/POST /api/whatsapp/connections`, `POST …/[id]/connect`, `GET …/[id]/status`, `POST …/[id]/disconnect`, `DELETE …/[id]`. `useTranslations('Settings.whatsapp')`. `useAuth` (para `canEditSettings`). Componentes `@/components/ui/{card,button,alert}` e `sonner` `toast` — seguir os imports de `whatsapp-config.tsx`.
- Produces: `export function UazapiConnectionCard(): JSX.Element`. Recebe via prop `connections: ConnectionDTO[]` e `onChanged: () => void` (o painel da Task 10 é dono do fetch e passa os dados + um refetch). **Assinatura:** `export function UazapiConnectionCard({ connections, onChanged }: { connections: ConnectionDTO[]; onChanged: () => void })`.

**Comportamento (estado derivado de `connections.find(c => c.provider === 'uazapi')`):**
- **sem linha uazapi:** botão `t('uazapiConnect')` → `POST /connections` → guarda o `id` → `POST /connections/[id]/connect` → renderiza `<img src={qrcode} />` + contador de 120 s a partir de `expiresInSeconds`.
- **`status === 'connecting'` (ou logo após connect):** `setInterval` de 3000 ms chamando `GET /connections/[id]/status`; se a resposta traz `qrcode` diferente, troca a imagem; quando `status === 'connected'`, `clearInterval` + `onChanged()`. Parar o polling no `unmount` e quando o contador zera.
- **contador zerou sem conectar:** botão `t('uazapiNewQr')` → re-`POST …/connect`.
- **`status === 'connected'`:** mostra `profile_name` + `display_phone`; botões `t('uazapiDisconnect')` (`POST …/disconnect` → `onChanged`) e `t('uazapiRemove')` (`DELETE` → `onChanged`).
- **`status` em `disconnected|banned|hibernated` com linha existente:** mostra `last_connection_error` se houver (via `<Alert variant="destructive">`), botões `t('uazapiReconnect')` (`…/connect`) e `t('uazapiRemove')`.
- **aviso fixo, sempre visível** (todos os estados): `<Alert variant="destructive">` com `t('uazapiUnofficialWarning')`.
- botões desabilitados quando `!canEditSettings`.
- toda chamada de rede com `try/catch` → `toast.error(t('uazapiActionFailed'))`.

- [ ] **Step 1: chaves i18n** — acrescentar a `messages/en.json` sob `Settings.whatsapp` (e as mesmas, traduzidas, em `messages/ko.json`):

```json
"uazapiCardTitle": "QR Code (UAZAPI)",
"uazapiCardDesc": "Connect a WhatsApp number by scanning a QR code. No Meta app required.",
"uazapiUnofficialWarning": "Unofficial API. WhatsApp can block this number at any time.",
"uazapiConnect": "Connect via QR code",
"uazapiNewQr": "Generate a new QR code",
"uazapiReconnect": "Reconnect",
"uazapiDisconnect": "Disconnect",
"uazapiRemove": "Remove",
"uazapiScanHint": "Open WhatsApp on your phone → Settings → Linked devices → Link a device, then scan this code.",
"uazapiQrExpired": "The QR code expired. Generate a new one.",
"uazapiConnecting": "Waiting for the scan…",
"uazapiConnectedAs": "Connected as {name} ({phone})",
"uazapiStatusDisconnected": "Disconnected",
"uazapiStatusConnecting": "Connecting",
"uazapiStatusConnected": "Connected",
"uazapiStatusHibernated": "Paused",
"uazapiStatusBanned": "Blocked by WhatsApp",
"uazapiActionFailed": "That didn't work. Try again.",
"channelSelectorTitle": "Default channel",
"channelSelectorDesc": "Broadcasts, Flows and the public API use this connection.",
"channelSelectorMeta": "Official API (Meta)",
"channelSelectorUazapi": "QR Code (UAZAPI)"
```

(Coreano: traduzir cada valor. Rodar `npx vitest run messages.test.ts` — deve passar.)

- [ ] **Step 2: implementar o componente.** Sem teste de render (o repo não tem infra). Extrair qualquer lógica não-trivial para função pura se surgir. Verificação = `npm run typecheck` + `npm run lint`.

- [ ] **Step 3: Portas** `npm run typecheck && npm run lint && npx vitest run messages.test.ts`.
- [ ] **Step 4: Commit** `git commit -m "feat(uazapi): UazapiConnectionCard — QR connect flow + i18n (en/ko)"`

---

## Task 10: Painel, seletor de canal padrão, migração do toggle de mídia, wiring

**Files:**
- Create: `src/components/settings/default-channel-selector.tsx` + `src/components/settings/default-channel-selector.test.ts`
- Create: `src/components/settings/whatsapp-connections-panel.tsx`
- Modify: `src/components/settings/whatsapp-config.tsx` (`handleToggleMirrorMedia`)
- Modify: `src/app/(dashboard)/settings/page.tsx` (slot `whatsapp:`)

**Interfaces:**
- `shouldShowChannelSelector(connections: ConnectionDTO[]): boolean` — `true` sse houver ≥1 `provider==='meta'` com `status==='connected'` **e** ≥1 `provider==='uazapi'` com `status==='connected'`. Pura, testada.
- `export function DefaultChannelSelector({ connections, onChanged })` — renderiza nada se `!shouldShowChannelSelector`; senão um radio Meta/UAZAPI refletindo `is_primary`, `onChange` → `PATCH /connections/[id] { is_primary: true }` → `onChanged()`.
- `export function WhatsAppConnectionsPanel()` — o novo dono do estado: faz `GET /api/whatsapp/connections` no mount (e expõe `refetch`), renderiza `<WhatsAppConfig />`, `<UazapiConnectionCard connections={…} onChanged={refetch} />`, `<DefaultChannelSelector connections={…} onChanged={refetch} />`.

- [ ] **Step 1: teste do predicado**

```ts
// src/components/settings/default-channel-selector.test.ts
import { describe, expect, it } from 'vitest';
import { shouldShowChannelSelector } from './default-channel-selector';

const c = (provider: string, status: string) =>
  ({ provider, status }) as never;

it('mostra só quando meta e uazapi estão ambos connected', () => {
  expect(shouldShowChannelSelector([c('meta', 'connected'), c('uazapi', 'connected')])).toBe(true);
  expect(shouldShowChannelSelector([c('meta', 'connected'), c('uazapi', 'connecting')])).toBe(false);
  expect(shouldShowChannelSelector([c('meta', 'connected')])).toBe(false);
  expect(shouldShowChannelSelector([])).toBe(false);
});
```

- [ ] **Step 2: implementar** `default-channel-selector.tsx` (predicado + componente), `whatsapp-connections-panel.tsx`.

- [ ] **Step 3: `whatsapp-config.tsx` — `handleToggleMirrorMedia`.** Trocar o bloco `supabase.from('whatsapp_connections').update({ mirror_inbound_media: next }).eq('account_id', accountId).eq('provider', 'meta').is('archived_at', null)` por:

```ts
      const res = await fetch(
        `/api/whatsapp/connections/${config.id}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ mirror_inbound_media: next }),
        },
      );
      if (!res.ok) throw new Error(`PATCH failed (${res.status})`);
```

> `config.id` já vem do `select('*')` do `fetchConfig`. Confirmar que `config` tem `id` (tem — é `select('*')`). O resto de `handleToggleMirrorMedia` (optimistic update, rollback, toast) fica igual.

> Nota: o `.eq('provider','meta')` que a 1b-i já pôs neste write torna o risco de "atinge as duas linhas" **já mitigado**; esta troca é consolidação arquitetural (cliente não escreve direto em `whatsapp_connections`), não um bugfix. Manter o escopo mínimo.

- [ ] **Step 4: `settings/page.tsx`** — trocar o import e o slot:

```ts
import { WhatsAppConnectionsPanel } from '@/components/settings/whatsapp-connections-panel';
// …
    whatsapp: <WhatsAppConnectionsPanel />,
```

(remover o import de `WhatsAppConfig` se ele não for mais usado diretamente no arquivo — o painel passa a importá-lo.)

- [ ] **Step 5: Portas completas** `npm run typecheck && npm run lint && npm run build && npx vitest run` (baseline = 5 falhas; `messages.test.ts` verde).
- [ ] **Step 6: Commit** `git commit -m "feat(uazapi): WhatsApp settings panel — two cards + default-channel selector; mirror toggle via PATCH"`

---

## Self-Review (executado pelo autor do plano)

**1. Cobertura da spec:**
- §2.1 env module → T1 ✓
- §2.2 client de provisionamento → T2 ✓
- §2.3 7 endpoints → T4 (GET/POST), T5 (PATCH/DELETE), T6 (connect/status/disconnect) ✓
- §2.4 segredo do webhook gen+hash → T4 Step 3 ✓
- §2.5 UI dois cards + seletor → T9, T10 ✓
- §2.6 i18n en+ko → T9 Step 1, T10 (chaves do seletor) ✓
- §2.7 hardening resolveConnection (guard NULL + conversationId) → T3 (guard), T8 (react conversationId; broadcast explicitamente cortado com ruling) ✓
- §2.8 prova de envio → T7 ✓
- §3.3 provisionamento não-atômico com rollback → T4 Step 3 ✓
- §3.4 todas as rotas: `requireRole('admin')`, sem vazar segredo → Global Constraints + `toConnectionDTO` (T4) ✓
- §3.4 `is_primary` set-new-primeiro → T5 ✓
- §3.4 DELETE repasse do primary → T5 ✓
- §5 critério de aceite (testes automatizados) → cada task tem testes; T7 é a prova de envio ✓
- §7 registrar corte de broadcast → T8 Step 4 ✓

**2. Placeholders:** o único `/* … */` deliberado é o fake do Supabase em T7 Step 1 e T10 — ambos com instrução explícita de "leia o arquivo de teste vizinho X e siga o padrão", que é o padrão herdado da 1b-i para fakes chainable. Aceito: escrever o fake completo aqui seria copiá-lo de `send/route.test.ts` (200+ linhas) sem ganho.

**3. Consistência de tipos:**
- `ConnectionDTO` definido em T4 (`uazapi-connection-dto.ts`), consumido por T5/T6/T9/T10 ✓
- `UazapiStatus` definido em T2, consumido por T6 status route ✓
- `loadUazapiConnectionRow` definido em T6 Step 1, consumido por T6 + retro-referenciado por T5 (com nota de ordem) — **risco:** se T5 rodar antes de T6, o import não existe. **Mitigação:** T5 define seu próprio `loadRow` local (está no código de T5); T6 extrai o helper compartilhado e a nota manda refatorar T5 com diff cirúrgico. Ambas as ordens funcionam. ✓
- `resolveAppBaseUrl` / `uazapiEnv` (T1) → T4/T6 ✓
- `toConnectionDTO` aceita `Record<string, unknown>` e é chamado com row parcial (`fresh ?? {}`) em T5/T6 — `created_at` pode ser `undefined`; o cast `as string` tolera em runtime mas o DTO fica com `created_at: undefined`. **Aceito:** os callers desses caminhos (`disconnect`, `PATCH`) sempre têm a row completa do `.select(SELECT_COLS)`; o `?? {}` é só guarda de tipo. Um reviewer pode pedir para tornar `toConnectionDTO` estrito — decisão do task reviewer.

**4. Ordem / dependências:** T1→T2→T3 independentes entre si mas baratas primeiro. T4 depende de T1+T2. T5,T6 dependem de T4 (DTO). T7 depende de T3 conceitualmente (mocka, então não trava). T8 independente. T9 depende de T4 (DTO type). T10 depende de T9. Sequência linear T1..T10 satisfaz tudo.

---

## Execution Handoff

Plano salvo em `docs/superpowers/plans/2026-08-29-uazapi-onda-1b-ii-provisionamento.md`. Duas opções de execução:

**1. Subagent-Driven (recomendado)** — um subagente fresco por task, review entre tasks, iteração rápida.

**2. Inline Execution** — tasks nesta sessão via executing-plans, execução em lote com checkpoints.

Qual?
