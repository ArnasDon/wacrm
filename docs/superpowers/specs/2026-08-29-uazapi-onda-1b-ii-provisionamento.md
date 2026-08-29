# Onda 1b-ii — Provisionamento UAZAPI + rotas de conexão + card de QR

**Data:** 2026-08-29
**Status:** design aprovado, aguardando plano de implementação
**Spec-mãe:** `docs/superpowers/specs/2026-08-27-uazapi-provider-design.md`
(§4.4 provisionamento/QR, §4.5 UI)
**Spec 1a:** `docs/superpowers/specs/2026-08-28-uazapi-onda-1a-migracao-040.md`
(a 040 já criou todo o schema que esta leva usa)
**Spec 1b-i:** `docs/superpowers/specs/2026-08-28-uazapi-onda-1b-i-plumbing.md`
(plumbing de multi-conexão, transporte UAZAPI, união `TransportConnection`,
§7 lista os follow-ups que esta leva absorve)

---

## 1. Contexto

A Onda 1 da spec-mãe foi decomposta em 1a / 1b / 1c; a 1b foi dividida em
1b-i (plumbing + transporte, **mergeada** — PR #3) e 1b-ii (esta).

| Sub-leva | Conteúdo | Estado |
|---|---|---|
| **1a** | Migração 040 — rename `whatsapp_config` → `whatsapp_connections` | mergeada (PR #2) |
| **1b-i** | Plumbing de multi-conexão + transporte UAZAPI + suíte de contrato | mergeada (PR #3) |
| **1b-ii** (esta) | Env `UAZAPI_*`, client de provisionamento, 7 endpoints `/api/whatsapp/connections/*` (5 arquivos de rota), card de Settings + fluxo de QR, hardening do `resolveConnection`, envio provado por teste + smoke manual | Sozinha |
| **1c** | Handler de inbound `/api/whatsapp/webhook/uazapi/[secret]` + mudanças de inbox + `SET NOT NULL` em `connection_id` | própria spec |

Depois da 1b-ii o UAZAPI fica **alcançável de ponta a ponta**: o operador
conecta um número por QR Code em Configurações e envia mensagens por ele
via `POST /api/v1/messages`. Inbound (receber mensagens) continua sendo a
1c.

O operador tem `UAZAPI_ADMIN_TOKEN` do servidor — o fluxo da spec-mãe
§4.4 (o CRM cria instâncias, o operador nunca vê token) vale como está.

---

## 2. Escopo

### Entrega

1. **Módulo de env** `src/lib/whatsapp/uazapi-env.ts` — lê
   `UAZAPI_BASE_URL` e `UAZAPI_ADMIN_TOKEN`, **só no servidor**; lança um
   erro claro se faltarem quando uma rota de provisionamento é chamada.
   Ambas entram no `.env.example`.
2. **Client de provisionamento** `src/lib/whatsapp/uazapi-admin.ts` —
   wrapper `fetch` fino (mesmo estilo do `uazapi-transport.ts`), sem SDK:
   `createInstance`, `configureWebhook`, `connectInstance`,
   `instanceStatus`, `disconnectInstance`, `deleteInstance`.
3. **7 endpoints HTTP** em 5 arquivos de rota sob
   `src/app/api/whatsapp/connections/`:
   `GET|POST /connections` (1 arquivo), `PATCH|DELETE /connections/[id]`
   (1 arquivo), `POST /connections/[id]/connect`,
   `GET /connections/[id]/status`, `POST /connections/[id]/disconnect`.
4. **Geração + hash do segredo de webhook** — na criação da conexão; só o
   hash é persistido (`webhook_secret_hash`); a URL registrada na UAZAPI
   é `<APP_URL>/api/whatsapp/webhook/uazapi/<secret>` (handler 404 até a
   1c).
5. **UI** — `Configurações → WhatsApp` vira dois cards fixos:
   - `<WhatsAppConfig />` (Meta) — intocado, exceto o toggle de
     `mirror_inbound_media`, que passa a ir por `PATCH /connections/[id]`.
   - `<UazapiConnectionCard />` (novo) — conectar/QR/polling/status/
     desconectar/remover + aviso de API não-oficial.
   - Seletor de **canal padrão** quando as duas conexões estão
     `connected`.
6. **i18n** — toda string nova em `messages/en.json` **e**
   `messages/ko.json` sob `Settings.whatsapp` (o `messages.test.ts` exige
   paridade de chaves; sem fallback por-chave — ver §4.5 da spec-mãe).
7. **Hardening do `resolveConnection`** (follow-ups da 1b-i §7):
   - guard contra `uazapi_instance_id` / `uazapi_base_url` NULL;
   - `react/route.ts` e os caminhos de broadcast passam `conversationId`.
8. **Prova de envio** — teste de integração da cadeia
   `POST /api/v1/messages` → `resolveConnection` (variante `uazapi`) →
   `createTransport` → `dispatchSend` → `POST {baseUrl}/send/text`, com
   `fetch` global mockado. Smoke manual real fica com o operador,
   pós-merge, **não bloqueia o merge**.

### Sem migração

A 040 já criou `uazapi_instance_id`, `uazapi_base_url`,
`webhook_secret_hash`, `is_primary`, `label`, `archived_at`,
`display_phone`, `profile_name`, `last_connection_error` e os índices
parciais. **PR code-only.**

### Defere para a 1c

Handler de inbound `/api/whatsapp/webhook/uazapi/[secret]`; qualquer
mudança de inbox (selo de canal por conversa, cabeçalho, composer por
`capabilities`); `SET NOT NULL` + `ON DELETE RESTRICT` em
`conversations.connection_id`; `fetchMedia` na interface de transporte.

### Fora (Onda 3+)

`sendTemplate` / `sendInteractive` reais na UAZAPI; broadcast por UAZAPI.

### Follow-ups sem onda

- Reconciliação de instâncias órfãs (processo morre entre
  `createInstance` e o `INSERT`) — via `GET /instance/all` (admin).
- Pareamento por número de telefone (`phone` no `/instance/connect`) —
  a 1b-ii é QR-only.

---

## 3. Arquitetura

### 3.1 Env — `uazapi-env.ts`

```ts
export function uazapiEnv(): { baseUrl: string; adminToken: string } {
  const baseUrl = process.env.UAZAPI_BASE_URL?.replace(/\/$/, '');
  const adminToken = process.env.UAZAPI_ADMIN_TOKEN;
  if (!baseUrl || !adminToken) {
    throw new Error(
      'UAZAPI_BASE_URL and UAZAPI_ADMIN_TOKEN must be set to provision UAZAPI connections',
    );
  }
  return { baseUrl, adminToken };
}
```

- Chamado **só** dentro das rotas de provisionamento (nunca em import de
  módulo, nunca no cliente).
- O `baseUrl` sem barra final (o `uazapi-transport.ts` da 1b-i já faz o
  mesmo `.replace(/\/$/, '')`).
- `.env.example` ganha as duas com comentário: *"Servidor WhatsApp
  não-oficial (UAZAPI). Opcional — só o card 'QR Code' em
  Configurações → WhatsApp depende delas. O admin token governa todas as
  instâncias do servidor; nunca é enviado ao cliente."*

### 3.2 Client de provisionamento — `uazapi-admin.ts`

`fetch` direto, sem estado. Erros não-`ok` →
`throw new Error(json.error || json.message || 'UAZAPI <op> falhou (<status>)')`.

| Função | Chamada UAZAPI | Header | Corpo → resposta usada |
|---|---|---|---|
| `createInstance(baseUrl, adminToken, name)` | `POST /instance/create` | `admintoken` | `{ name }` → `{ token, instance: { id } }` |
| `configureWebhook(baseUrl, instanceToken, url)` | `POST /webhook` | `token` | `{ url, events: ['messages','messages_update','connection','history'], excludeMessages: ['wasSentByApi'] }` → ignora corpo |
| `connectInstance(baseUrl, instanceToken)` | `POST /instance/connect` | `token` | `{}` (sem `phone`) → `{ instance: { qrcode, paircode } }` |
| `instanceStatus(baseUrl, instanceToken)` | `GET /instance/status` | `token` | — → `{ instance: { qrcode, profileName, status }, status: { connected, loggedIn, jid } }` |
| `disconnectInstance(baseUrl, instanceToken)` | `POST /instance/disconnect` | `token` | `{}` → ignora corpo |
| `deleteInstance(baseUrl, instanceToken)` | `DELETE /instance` | `token` | — → ignora corpo |

- `name` da instância = `wacrm-<accountId>` (rastreável no painel do
  operador).
- Campos da resposta conferidos contra `docs/uazapi-openapi-spec.yaml`
  (schema `Instance`, linhas 63-175): `qrcode` é data URI PNG,
  `status.jid` pode ser `null` **ou** `{ user, agent, device, server }`.
- O `POST /instance/create` no servidor `free.uazapi.com` "desconecta e
  deleta a instância após 1 hora" — é restrição do servidor demo; o
  operador usa o servidor pago (`UAZAPI_BASE_URL`). Não é tratado no
  código.

### 3.3 Provisionamento não-atômico — decisão

`POST /connections` executa: (1) `createInstance` → (2) gerar segredo +
hash → (3) `INSERT` na `whatsapp_connections` → (4) `configureWebhook`.

- **Falha no passo 1:** devolve 502, nada foi criado.
- **Falha no passo 3 (INSERT):** best-effort `deleteInstance` no que o
  passo 1 criou, devolve 502.
- **Falha no passo 4 (webhook):** **não** derruba a criação — grava
  `last_connection_error = 'webhook não configurado'` e devolve a linha.
  A UI mostra o estado e oferece reconectar (que re-tenta o webhook).
- **Processo morre entre 1 e 3:** instância órfã no servidor do operador,
  invisível ao CRM. O guard 409 (§3.4) impede uma 2ª tentativa de criar
  linha; a reconciliação via `GET /instance/all` é follow-up sem onda.
  Vazamento pequeno e conhecido, não resolvido nesta leva.

### 3.4 Rotas

Todas: gate `canEditSettings` (mesmo do `config/route.ts`), `accountId`
do auth, **nunca** devolvem `credential` nem token ao cliente. A forma
saneada de uma conexão exposta ao cliente:

```ts
type ConnectionDTO = {
  id: string;
  provider: 'meta' | 'uazapi';
  label: string | null;
  status: 'connected' | 'connecting' | 'disconnected' | 'hibernated' | 'banned';
  is_primary: boolean;
  display_phone: string | null;
  profile_name: string | null;
  last_connection_error: string | null;
  created_at: string;
};
```

#### `GET /api/whatsapp/connections`

Lista as conexões **não-arquivadas** do account, ambos os provedores,
como `ConnectionDTO[]`. Usada pela UI para montar os dois cards e o
seletor de canal padrão, e pelo `<WhatsAppConfig />` para descobrir o
`id` da linha Meta (toggle de mídia).

#### `POST /api/whatsapp/connections`

Cria a conexão UAZAPI.

1. 409 se já existe linha `provider='uazapi'` não-arquivada do account
   (o índice `idx_connections_account_provider` também protege).
2. `uazapiEnv()` → `{ baseUrl, adminToken }`.
3. `createInstance(baseUrl, adminToken, 'wacrm-' + accountId)` →
   `{ token, instance }`.
4. `secret = crypto.randomUUID()` (ou 32 bytes hex);
   `webhook_secret_hash = sha256(secret)` — mesmo algoritmo que o
   `webhook-signature.ts` usa, se aplicável; senão `node:crypto`
   `createHash('sha256')`.
5. `INSERT`: `account_id`, `provider='uazapi'`,
   `credential = encrypt(token)`, `uazapi_instance_id = instance.id`,
   `uazapi_base_url = baseUrl`, `status='disconnected'`,
   `is_primary = false`, `webhook_secret_hash`. Erro aqui →
   `deleteInstance` best-effort + 502.
6. `configureWebhook(baseUrl, token, APP_URL + '/api/whatsapp/webhook/uazapi/' + secret)`.
   Erro aqui → grava `last_connection_error`, **não** falha a request.
7. 201 com o `ConnectionDTO` da linha nova.

`APP_URL` — a mesma origem que o `config/route.ts` já usa para montar a
`webhookUrl` da Meta (reusar o helper existente).

#### `POST /api/whatsapp/connections/[id]/connect`

1. Carrega a linha (`id` + `account_id` + `provider='uazapi'` +
   `archived_at IS NULL`); 404 se não for do account.
2. `decrypt(credential)` → instance token.
3. `connectInstance(baseUrl, token)` → `{ instance: { qrcode, paircode } }`.
4. `UPDATE status='connecting'`.
5. 200 `{ qrcode, paircode, expiresInSeconds: 120 }`.

#### `GET /api/whatsapp/connections/[id]/status`

1. Carrega a linha (como acima).
2. `instanceStatus(baseUrl, token)` →
   `{ instance: { qrcode, profileName }, status: { connected, jid } }`.
3. Mapeia e persiste:
   - `status.connected === true` → `UPDATE status='connected'`,
     `display_phone = status.jid?.user ?? null`,
     `profile_name = instance.profileName ?? null`,
     `last_connection_error = null`.
   - senão → `UPDATE status = instance.status` (um de
     `disconnected|connecting|hibernated`).
4. 200 `{ status, display_phone, profile_name, qrcode? }` — repassa
   `instance.qrcode` fresco enquanto `connecting`, para a UI trocar a
   imagem sem novo `/connect`.

Polling é só da UI, no momento da conexão. Depois disso o evento
`connection` do webhook (1c) mantém o status.

#### `PATCH /api/whatsapp/connections/[id]`

Body parcial `{ label?, is_primary?, mirror_inbound_media? }` — todos por
`id`, aceita qualquer provedor. Carrega a linha do account (404 se não
for). Aplica só os campos presentes:

- `label` → `UPDATE label`.
- `mirror_inbound_media` → `UPDATE mirror_inbound_media` (é isto que
  substitui o `.update().eq('account_id')` client-side do
  `whatsapp-config.tsx`).
- `is_primary: true` → **set-new-primeiro**: `UPDATE ... SET is_primary=true
  WHERE id=?` e **depois** `UPDATE ... SET is_primary=false WHERE
  account_id=? AND id<>? AND archived_at IS NULL`. A janela entre os dois
  tem 2 linhas primárias; o `resolveConnection` nível 4 pega uma via
  `.limit(1)` — inofensivo. A ordem inversa deixaria 0 primárias e um
  envio nesse instante daria "não configurado". Sem RPC porque a 1b-ii
  não tem migração.
- `is_primary: false` explícito → 400 se for a única conexão ativa do
  account ("o account precisa de um canal padrão"); senão `UPDATE
  is_primary=false`.

200 com o `ConnectionDTO` atualizado.

#### `POST /api/whatsapp/connections/[id]/disconnect`

Desconecta **sem** arquivar. Carrega a linha (`provider='uazapi'`),
`disconnectInstance(baseUrl, token)` best-effort, `UPDATE
status='disconnected'`. 200 com o `ConnectionDTO`. Reconectar reabre o QR
(`/connect`).

#### `DELETE /api/whatsapp/connections/[id]`

Arquiva (não apaga — respeita o futuro `ON DELETE RESTRICT` da 1c).

1. Carrega a linha do account (404 se não for).
2. Se `provider='uazapi'`: `disconnectInstance` best-effort →
   `deleteInstance(baseUrl, token)` (senão a cota do operador vaza; erro
   aqui é logado, não impede o arquivamento).
3. `UPDATE archived_at = now()`, `status='disconnected'`,
   `is_primary = false`.
4. **Repasse do primary:** se a linha arquivada era `is_primary` e sobra
   **exatamente uma** conexão ativa (`archived_at IS NULL`), `UPDATE
   is_primary = true` nessa. Zero ou 2+ restantes → ninguém herda (fecha
   o follow-up 1b-i "o `DELETE` não re-aponta `is_primary`").

**Por que o `DELETE` é obrigatório nesta leva:** o índice único parcial
`(account_id, provider) WHERE archived_at IS NULL` trava a criação de uma
segunda linha UAZAPI. Um QR escaneado no número errado, sem caminho de
arquivo, deixaria o account permanentemente sem poder reconfigurar o
UAZAPI.

### 3.5 Hardening do `resolveConnection`

`resolve-connection.ts` — assinatura inalterada.

- **Guard de NULL:** depois de carregar a linha resolvida, se
  `row.provider === 'uazapi'` e (`!row.uazapi_instance_id` ||
  `!row.uazapi_base_url`) → `throw new SendMessageError(
  'whatsapp_not_configured', <mesma mensagem/status de "sem conexão">)`.
  Fecha a simetria com o `phone_number_id ?? ''` do ramo Meta e evita
  montar uma `TransportConnection` inválida que viraria `TypeError` no
  `fetch` do transporte.
- **`conversationId` nos call sites:** `react/route.ts` e os caminhos de
  broadcast (`broadcast-core.ts`, `broadcast-resume.ts` — confirmar no
  plano) passam `{ conversationId }` ao `resolveConnection`, hoje omitido
  → sempre nível 4 (primária). *Alcance real nesta onda:* reação em
  conversa UAZAPI só existe na 1c (precisa de inbound); broadcast UAZAPI
  é Onda 3 — então é correção preventiva, verificada por teste, não
  exercida em produção na 1b-ii. **Se o plano achar que fica grande,
  corta para a 1c** e registra na §7.
- **`config/route.ts` count query:** a query de contagem da eleição de
  `is_primary` (1b-i §3.2) passa a checar `error` e falhar a request se
  não conseguir contar (hoje ignora). Junto do trabalho de `PATCH`.

### 3.6 UI

O slot `settings/page.tsx:77` (hoje `<WhatsAppConfig />`) passa a
renderizar um contêiner com os dois cards + o seletor.

#### `<WhatsAppConfig />` (Meta) — mudança mínima

O toggle `mirrorMedia` (`whatsapp-config.tsx:~215`) para de fazer
`supabase.from('whatsapp_connections').update({ mirror_inbound_media })
.eq('account_id', ...)` e passa a `fetch('/api/whatsapp/connections/' +
metaId, { method: 'PATCH', body: { mirror_inbound_media: next } })`. O
`metaId` vem de `GET /api/whatsapp/connections` (a linha `provider='meta'`).
Nada mais no componente muda.

#### `<UazapiConnectionCard />` (novo)

`src/components/settings/uazapi-connection-card.tsx`, client component,
consome `GET /api/whatsapp/connections`:

- **Sem linha UAZAPI:** botão "Conectar via QR Code" → `POST /connections`
  → `POST /connections/[id]/connect` → renderiza `qrcode` (data URI) +
  contador de 120 s.
- **`connecting`:** polling `GET /connections/[id]/status` a cada ~3 s
  **só durante a janela**; troca a imagem do QR se vier `qrcode` novo; ao
  virar `connected`, para o polling.
- **QR expirado (120 s sem conectar):** "Gerar novo QR" → re-chama
  `/connect`.
- **`connected`:** mostra `profile_name` + `display_phone`, botões
  "Desconectar" (`POST .../disconnect`) e "Remover" (`DELETE`).
- **`disconnected` / `banned` / `hibernated` com linha existente:** mostra
  `last_connection_error` se houver, botão "Reconectar" (`/connect`) e
  "Remover".
- **Aviso fixo, sempre visível:** *"API não-oficial. O número pode ser
  bloqueado pelo WhatsApp a qualquer momento."*

#### Seletor de canal padrão

Aparece **só** quando as duas conexões estão `connected`. Segmented/radio
"Canal padrão para broadcast, Flows e API pública: ( ) API Oficial (Meta)
( ) QR Code (UAZAPI)" → `PATCH /connections/[id]` com `is_primary: true`.
Reflete `is_primary` atual.

#### i18n

Chaves novas em `messages/en.json` **e** `messages/ko.json` sob
`Settings.whatsapp`, com coreano de verdade. O `messages.test.ts` falha
se faltar qualquer chave em `ko.json` ou sobrar chave órfã.

---

## 4. Decisões desta leva (brainstorming 2026-08-29)

| # | Decisão | Motivo |
|---|---|---|
| 1bii-1 | Webhook registrado já na criação da conexão, mesmo com o handler 404 até a 1c | A 1c só liga o handler — sem varrer/reconfigurar instâncias existentes. Eventos perdidos no intervalo não importam (a 1c não depende de histórico retroativo). |
| 1bii-2 | "Envio provado" = teste de integração com `fetch` mockado + smoke manual do operador pós-merge; **não bloqueia o merge** | CI não tem servidor UAZAPI nem número real. O teste prova a fiação; a divergência de campo real (ex: `messageid` vs `id`) vira follow-up rápido. |
| 1bii-3 | Toggle de `mirror_inbound_media` migra para `PATCH /connections/[id]` (por id), não stopgap `.eq('provider','meta')` | Assim que a 1ª linha `uazapi` existe, o `.update().eq('account_id')` client-side atinge as duas linhas. A rota por id é a correção definitiva e a `PATCH` já existe nesta leva. |
| 1bii-4 | Conexão UAZAPI nasce `is_primary=false`; ao arquivar a primária, se sobra **exatamente uma** ativa, ela herda | Sem trocas silenciosas de canal em broadcast/Flows/API. Fecha o follow-up 1b-i do `DELETE` não re-apontar `is_primary`. |
| 1bii-5 | Sem migração | A 040 criou todas as colunas e índices. |
| 1bii-6 | `is_primary` via dois `UPDATE` sequenciais, set-new-primeiro (sem RPC) | A 1b-ii não tem migração para criar função. A janela com 2 primárias é inofensiva (`.limit(1)`); a ordem inversa (0 primárias) quebraria um envio concorrente. |
| 1bii-7 | Provisionamento não-atômico com rollback best-effort; instância órfã por crash entre passos é follow-up sem onda | Transação distribuída real (CRM + servidor UAZAPI) não se justifica; o guard 409 + `GET /instance/all` cobrem a reconciliação. |
| 1bii-8 | QR-only; sem pareamento por número de telefone | Menor superfície; a spec-mãe §4.4 descreve "Conectar via QR Code". |
| 1bii-9 | Rotas dedicadas `/disconnect` e `DELETE` separadas | Coerente com o ciclo de vida da spec-mãe §4.4 (desconectar mantém a linha; remover arquiva + `DELETE /instance`). |

---

## 5. Testes e critério de aceite

### Automatizados (nesta leva)

- **`uazapi-admin.test.ts`** — `fetch` global mockado, uma caixa por
  função: header certo (`admintoken` vs `token`), corpo certo, resposta
  não-`ok` vira `throw` com a mensagem do corpo.
- **`route.test.ts` por arquivo de rota** (5 arquivos, um por rota;
  endpoints que compartilham arquivo — `GET|POST`, `PATCH|DELETE` —
  ficam no mesmo teste): gate de auth (401/403 sem `canEditSettings`); happy path com
  `uazapi-admin` mockado; `POST /connections` — 409 de duplicata,
  rollback (`deleteInstance` chamado quando o `INSERT` falha), webhook
  falho não derruba a criação; `PATCH` — `is_primary:true` zera as
  outras, `is_primary:false` na única ativa dá 400, `mirror_inbound_media`
  grava; `DELETE` — arquiva, chama `deleteInstance`, repassa `is_primary`
  quando sobra uma; `[id]` de outro account → 404.
- **`resolve-connection.test.ts`** — linha `uazapi` com
  `uazapi_base_url` NULL (ou `uazapi_instance_id` NULL) →
  `SendMessageError('whatsapp_not_configured')`, código/mensagem/status
  inalterados.
- **Prova de envio** — teste de integração (em
  `src/app/api/whatsapp/send/route.test.ts` ou vizinho): conta com
  conexão `provider='uazapi'` primária + conversa; `POST /api/v1/messages`
  com `fetch` global mockado; asserção: `dispatchSend` faz **um**
  `POST {baseUrl}/send/text` com header `token` e `{ number, text }`
  corretos, e o `providerMessageId` da resposta é persistido em
  `messages`.
- **Fakes Supabase vizinhos** — se a mudança do guard no
  `resolveConnection` alterar a cadeia de query, os fakes irmãos que a
   1b-i tornou chain-aware acompanham (regra herdada: "mudança de query no
  `resolveConnection` carrega os fakes irmãos"). Só enabler, nenhuma
  asserção de comportamento muda.
- **`messages.test.ts`** — continua verde: toda chave nova de
  `Settings.whatsapp` presente em `en.json` **e** `ko.json`, sem órfã.
- `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`
  limpos. As 5 falhas de baseline de locale/fuso seguem as mesmas 5.

### Manual (operador, pós-merge — não bloqueia)

Com `UAZAPI_BASE_URL` / `UAZAPI_ADMIN_TOKEN` reais: conectar um número
por QR em Configurações → WhatsApp; confirmar `profile_name` /
`display_phone` preenchidos; enviar uma mensagem real por
`POST /api/v1/messages` sobre esse número; confirmar entrega no WhatsApp.
Divergência de campo (ex: id da mensagem na resposta de `/send/text`) →
follow-up rápido.

### Zero mudança para quem só tem Meta

Sem linha `provider='uazapi'`: o card UAZAPI aparece vazio com o botão
"Conectar", o seletor de canal padrão não aparece, `resolveConnection`
resolve para a primária Meta como antes, o toggle de mídia passa a ir por
`PATCH` mas com o mesmo efeito. Nenhuma rota nova é exercida.

---

## 6. Riscos

| Risco | Mitigação |
|---|---|
| A forma real da resposta da UAZAPI (`/instance/create`, `/instance/connect`, `/instance/status`) diverge do assumido em §3.2 | O plano lê os schemas em `docs/uazapi-openapi-spec.yaml` (linhas 63-175 `Instance`, 1466 `create`, 1641 `connect`, 2008 `status`); `uazapi-admin.test.ts` fixa a forma. O smoke manual do operador é a validação real. |
| Processo morre entre `createInstance` e o `INSERT` → instância órfã | Guard 409 impede 2ª tentativa; reconciliação via `GET /instance/all` é follow-up sem onda. Aceito como vazamento pequeno (decisão 1bii-7). |
| `is_primary` sem transação real deixa 0 primárias por um instante | Ordem set-new-primeiro (decisão 1bii-6): a janela tem 2 primárias, não 0; `resolveConnection` nível 4 usa `.limit(1)`. |
| Webhook registrado aponta para endpoint 404 até a 1c; a UAZAPI pode marcar o webhook como falho | A UAZAPI apenas entrega e ignora a resposta; sem retry-storm documentado. Se virar problema, a 1c registra o handler e o próximo evento `connection` normaliza. |
| `mirror_inbound_media` via `PATCH` muda o caminho de escrita do toggle Meta | Mesma coluna, mesmo efeito; `route.test.ts` do `PATCH` cobre. O componente Meta só troca o `supabase.update()` por `fetch(PATCH)`. |
| `ko.json` fica com chave faltando e `messages.test.ts` quebra | O plano trata `en.json` e `ko.json` no mesmo passo, com tradução coreana real, e roda `messages.test.ts` antes do commit. |

---

## 7. Fora de escopo desta leva

- Handler de inbound `/api/whatsapp/webhook/uazapi/[secret]`; mudanças de
  inbox (selo de canal, cabeçalho da conversa, composer por
  `capabilities`); `SET NOT NULL` + `ON DELETE RESTRICT` em
  `conversations.connection_id`; `fetchMedia` na interface de transporte
  — **1c**.
- `sendTemplate` / `sendInteractive` reais na UAZAPI; broadcast por
  UAZAPI — **Onda 3**.
- Reconciliação de instâncias órfãs (via `GET /instance/all`);
  pareamento por número de telefone — **follow-up sem onda**.
- Se o plano cortar o `conversationId` de `react/route.ts` / broadcast
  para a 1c por tamanho, registrar aqui na revisão do plano.
