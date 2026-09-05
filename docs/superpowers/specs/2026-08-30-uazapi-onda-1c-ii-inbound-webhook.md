# Onda 1c-ii — Webhook de inbound UAZAPI + mídia + inbox

**Data:** 2026-08-30
**Status:** design aprovado, aguardando plano de implementação
**Spec-mãe:** `docs/superpowers/specs/2026-08-27-uazapi-provider-design.md` (§4.3 inbound, §4.5 UI)
**Specs de apoio:** `2026-08-29-uazapi-onda-1b-ii-provisionamento.md`, `2026-08-30-uazapi-onda-1c-i-inbound-seam.md`

---

## 1. Contexto

A Onda 1c foi decomposta em 1c-i (seam + migração `041`, **mergeada** — PR #5) e 1c-ii (esta). A 1c-i extraiu `processInboundMessage()` / `processStatusUpdate()` para `src/lib/whatsapp/inbound/` e adicionou `fetchMedia` à interface `WhatsAppTransport` (impl Meta pronta, **stub UAZAPI que lança**). A 1c-ii liga o recebimento:

- **Hoje** a conexão UAZAPI **envia** (provado no smoke da 1b-ii) mas não **recebe** — a URL de webhook registrada na criação (`<APP_URL>/api/whatsapp/webhook/uazapi/<secret>`) responde 404.
- A 1c-ii cria essa rota, o adaptador de envelope UAZAPI → forma canônica, a impl `fetchMedia` UAZAPI, o handler do evento `connection`, a lista de eventos corrigida do `configureWebhook` + o re-registro da instância já conectada, o fix do carry-forward do `resolveConversationByPhone`, e as pistas visuais de canal na inbox.

**Um PR** (decisão do brainstorming — a UI da inbox é baixo risco, não justifica leva própria).

**Zero mudança de comportamento observável para uma conta que só tem Meta.** O webhook UAZAPI é rota nova; o adaptador é módulo novo; o único toque em caminho compartilhado é `resolve-conversation.ts` (`.eq('is_primary', true)`, no-op numa conta de conexão única).

---

## 2. Escopo

### Entrega

1. **Rota `POST /api/whatsapp/webhook/uazapi/[secret]`** (§3.1) — auth por hash do segredo, defesa em profundidade por `uazapi_instance_id`, `after()` pro ack rápido, dispatch por `EventType`.
2. **`src/lib/whatsapp/inbound/uazapi-adapter.ts`** (§3.2) — `uazapiMessageToInbound`, `uazapiStatusToInbound`, `uazapiContent`. Espelha `meta-adapter.ts`. **Parsing defensivo** (`data ?? payload`, `EventType ?? event`).
3. **`fetchMedia` UAZAPI** (§3.3) — `createUazapiTransport.fetchMedia` deixa de lançar; chama `POST /message/download`. `ProviderMediaRef` ganha a variante real `{ provider: 'uazapi'; messageId: string }`.
4. **Evento `connection`** (§3.4) — atualiza `whatsapp_connections.status` + `display_phone` + `profile_name` sem polling (resolve o vazio do smoke da 1b-ii).
5. **`configureWebhook` reconciliado + botão de re-registro** (§3.5) — `WEBHOOK_EVENTS = ['messages','messages_update','connection']` + `excludeMessages: ['isGroupYes','fromMeYes']`; rota `POST /api/whatsapp/connections/[id]/reconfigure-webhook` + botão no card.
6. **Fix do carry-forward** (§3.6) — `resolve-conversation.ts` ganha `.eq('is_primary', true)`.
7. **Inbox** (§3.7) — selo de canal por conversa, cabeçalho com o número da conexão, composer por `capabilities` (sem template numa conversa UAZAPI). i18n en+ko.

### Fora de escopo

- **Sem migração** — todas as colunas existem (040/041).
- `sendTemplate` / `sendInteractive` reais na UAZAPI, broadcast por conexão específica — **Onda 3**.
- Histórico retroativo (evento `history`) — deliberadamente não assinado (despeja meses de conversa).
- Reconciliação de instâncias órfãs, pareamento por telefone — follow-ups sem onda.

---

## 3. Arquitetura

### 3.1 Rota `POST /api/whatsapp/webhook/uazapi/[secret]`

`src/app/api/whatsapp/webhook/uazapi/[secret]/route.ts`. Dynamic param `{ params }: { params: Promise<{ secret: string }> }`.

1. **Auth por hash.** `const hash = crypto.createHash('sha256').update(secret).digest('hex')`. `db.from('whatsapp_connections').select('*').eq('webhook_secret_hash', hash).eq('provider', 'uazapi').is('archived_at', null).maybeSingle()`. Sem linha → `console.warn('[uazapi webhook] secret hash matched no connection')` → **200** `{ status: 'ignored' }` (não vaza se o segredo existe; não faz a UAZAPI reenviar).
2. **Defesa em profundidade.** Extrai o `instance`/`token` do payload (`payload.instance ?? payload.token ?? payload.data?.instance` — defensivo). Se presente e `!== row.uazapi_instance_id` → `console.warn('[uazapi webhook] instance mismatch: payload=<x> row=<y>')` → **200** `{ status: 'ignored' }`.
3. **Ack rápido.** `after(async () => { try { await handleUazapiEvent(db, row, payload) } catch (e) { console.error(...) } })` → **200** `{ status: 'received' }`. (Mesmo motivo do webhook da Meta: a UAZAPI reenvia se o ack demora.)
4. **`handleUazapiEvent(db, row, payload)`** despacha por `const eventType = payload.EventType ?? payload.event`:
   - `'messages'` → `await processInboundMessage(db, uazapiMessageToInbound(payload, row))`.
   - `'messages_update'` → `await processStatusUpdate(db, uazapiStatusToInbound(payload, row))`.
   - `'connection'` → §3.4.
   - senão → `console.info('[uazapi webhook] unhandled EventType:', eventType)`.

**Log distinguível em cada rejeição** (server-side, nunca na resposta): "hash não bateu", "instance não confere", "EventType não tratado". Sem isso, debugar o smoke é às cegas (o 200-silencioso esconde tudo — foi o que fez o smoke da 1b-ii doer).

### 3.2 `uazapi-adapter.ts`

Espelha `meta-adapter.ts`. Fonte da mensagem: `const m = payload.data ?? payload` (defensivo — o OpenAPI mostra `{ EventType, token }` num exemplo de log, a spec-mãe fala em `{ event, instance, data }`; o adaptador aceita as duas).

- **`uazapiMessageToInbound(payload, row): InboundMessage`**
  - `connectionId: row.id`, `accountId: row.account_id`, `configOwnerUserId: row.user_id`
  - `providerMessageId: m.messageid`
  - `from: normalizePhone(<dígitos antes de '@' em m.chatid>)` (`m.chatid` = `<phone>@s.whatsapp.net`; grupos já filtrados por `isGroupYes`)
  - `senderName: m.senderName || undefined`
  - `timestamp: new Date(m.messageTimestamp)` — **`messageTimestamp` é em milissegundos**, NÃO `* 1000` (diferença do adaptador da Meta — teste assere o `Date`)
  - `replyToProviderMessageId: m.quoted || undefined`
  - `content: uazapiContent(m)`
- **`uazapiContent(m): InboundMessage['content']`** — mapa de `m.messageType` (valores exatos = item "confirmar na prática"):
  - texto → `{ kind: 'text', text: m.text ?? '' }`
  - imagem/vídeo/documento/áudio → `{ kind: 'media', mediaKind: <that>, caption: <legenda>, filename: <nome>, mimeType: <mime do content>, ref: { provider: 'uazapi', messageId: m.messageid } }`
  - `m.reaction` truthy → `{ kind: 'reaction', targetProviderMessageId: m.reaction, emoji: m.text ?? '' }` (o campo `reaction` carrega o id da msg reagida; o emoji vem em `text` — confirmar contra `messageType` no payload real)
  - `m.buttonOrListid` truthy → `{ kind: 'interactive_reply', replyId: m.buttonOrListid, title: m.text ?? '' }`
  - senão → `{ kind: 'unsupported', rawType: String(m.messageType ?? 'unknown') }`
- **`uazapiStatusToInbound(payload, row): InboundStatus`** — `{ connectionId: row.id, accountId: row.account_id, providerMessageId: m.messageid, status: mapStatus(m.status), timestamp: new Date(m.messageTimestamp) }`. `mapStatus`: `Sent→'sent'`, `Delivered→'delivered'`, `Read→'read'`, `Failed→'failed'`. **Valores não mapeados (`Queued`, `Canceled`, …) → retorna a string crua**, que o `isValidStatusTransition` da 1c-i rejeita (drop silencioso) — comportamento correto, mas o mapa é explícito para clareza.

### 3.3 `fetchMedia` UAZAPI

`ProviderMediaRef` em `src/lib/whatsapp/inbound/types.ts`:
```ts
export type ProviderMediaRef =
  | { provider: 'meta'; mediaId: string }
  | { provider: 'uazapi'; messageId: string };
```

`createUazapiTransport.fetchMedia` (era um stub que lança):
```ts
async fetchMedia(ref) {
  if (ref.provider !== 'uazapi') {
    throw new Error(`uazapi transport: unexpected media ref provider ${ref.provider}`);
  }
  const json = await call('/message/download', {
    id: ref.messageId,
    return_base64: true,
    return_link: false,
  });
  // campos exatos da resposta (file / base64 / mimetype / fileName) —
  // item "confirmar na prática"; o plano lê o yaml, o smoke fixa.
  const b64 = json.base64 ?? json.file ?? json.data;
  if (!b64) throw new Error('uazapi /message/download: no base64 in response');
  return {
    bytes: Uint8Array.from(Buffer.from(b64, 'base64')),
    mimeType: (json.mimetype ?? json.mimeType ?? 'application/octet-stream') as string,
    filename: (json.fileName ?? json.filename) as string | undefined,
  };
}
```
`call` = o wrapper `fetch` já existente no `uazapi-transport.ts` (header `token: conn.credential`). Erro não-`ok` → `throw` (o `processInboundMessage` da 1c-i já embrulha em best-effort → `media_url = null` + log).

`transport-contract.test.ts`: o caso `fetchMedia` do lado UAZAPI **deixa de** assertar `.rejects.toThrow(/1c-ii/)` e passa a assertar que chama `/message/download` e devolve `{ bytes, mimeType }`.

### 3.4 Evento `connection`

Dentro de `handleUazapiEvent`, `eventType === 'connection'`:
- `const ALLOWED = ['disconnected','connecting','connected','hibernated','banned'] as const`
- mapeia o estado do payload (`m.status ?? m.state ?? m.connection?.state` — defensivo) para um valor de `ALLOWED`; fora da lista → **não escreve `status`**, só loga.
- `connected` → `UPDATE { status: 'connected', display_phone: <jid.user / telefone do payload>, profile_name: <m.profileName ?? m.pushName>, last_connection_error: null }`.
- `disconnected`/`banned`/`hibernated` → `UPDATE { status: <mapeado>, last_connection_error: <m.reason ?? m.lastDisconnectReason ?? null> }`.
- **Resolve o `display_phone`/`profile_name` vazios do smoke da 1b-ii** — o WhatsApp libera esses dados 1-2s após conectar, e agora chegam por evento, sem polling.

### 3.5 `configureWebhook` reconciliado + re-registro

`src/lib/whatsapp/uazapi-admin.ts`:
- `WEBHOOK_EVENTS` → `['messages', 'messages_update', 'connection']` (remove `'history'` — despeja meses de conversa).
- `excludeMessages` no corpo → `['isGroupYes', 'fromMeYes']` (era `['wasSentByApi']`). `isGroupYes` = pula grupos (senão cada grupo vira um "contato" com telefone esdrúxulo). `fromMeYes` = pula tudo que sai do número — o eco dos envios via API **e** o que o operador digita no celular (decisão do brainstorming: a inbox espelha o comportamento da Meta — só o que o cliente mandou + o que o CRM enviou).

**Nova rota `POST /api/whatsapp/connections/[id]/reconfigure-webhook`** (`requireRole('admin')`, `toErrorResponse` no catch):
- carrega a linha (`id` + `account_id` + `provider='uazapi'` + não-arquivada), 404 se não for da conta;
- `decrypt(credential)` → token da instância;
- `secret = crypto.randomBytes(32).toString('hex')`, `hash = sha256(secret)`;
- `configureWebhook(baseUrl, token, resolveAppBaseUrl(request) + '/api/whatsapp/webhook/uazapi/' + secret)`;
- sucesso → `UPDATE { webhook_secret_hash: hash, last_connection_error: null }`, 200 `{ data: ConnectionDTO }`;
- erro → `UPDATE { last_connection_error: 'Webhook não configurado — tente de novo.' }`, 502.

**Card de Settings** (`uazapi-connection-card.tsx`): no estado `connected`, botão **"Re-registrar webhook"** ao lado de "Desconectar"/"Remover" → `POST .../reconfigure-webhook` → `onChanged()`. i18n `uazapiReconfigureWebhook`. Conexões novas já pegam a config certa (o `/connect` da 1b-ii chama `configureWebhook`).

### 3.6 Fix do carry-forward — `resolve-conversation.ts`

A busca de conexão em `resolveConversationByPhone` (`src/lib/whatsapp/resolve-conversation.ts:~57-63`):
```ts
const { data: config } = await db
  .from('whatsapp_connections')
  .select('id')
  .eq('account_id', accountId)
  .eq('is_primary', true)      // <-- ADICIONA
  .is('archived_at', null)
  .maybeSingle();
```
Sem o filtro, uma conta com Meta + UAZAPI (que a 1c-ii torna possível) tem 2 linhas → `.maybeSingle()` estoura `PGRST116`. **`.eq('provider','meta')` NÃO entra** — `POST /api/v1/messages` público tem que funcionar numa conta só-UAZAPI, e a primária pode ser de qualquer provedor. O INSERT de conversa já leva `connection_id = config.id` (fix da 1c-i FR-C2). O erro "sem conexão" (quando não há primária) fica byte a byte igual.

### 3.7 Inbox

- **Selo de canal** (`conversation-list.tsx`): a query da lista de conversas passa a trazer `connection:whatsapp_connections(provider)`. Selo pequeno por conversa: `provider === 'uazapi'` → **"QR"**, `'meta'` → **"Meta"**. **Omitido quando a conta tem só um canal ativo** (sem ruído visual sem ambiguidade) — a decisão sai da contagem de conexões ativas que o layout já pode carregar, ou de um flag do `useAuth`.
- **Cabeçalho da conversa**: mostra `display_phone` (ou `label`) da conexão daquela conversa — "por qual número esta conversa corre".
- **Composer** (`message-composer.tsx`): as affordances seguem `capabilities` da conexão da conversa. Na 1c-ii, concretamente: **sem botão de template numa conversa UAZAPI** (`capabilities.templates === false`). Texto e mídia iguais. As `capabilities` chegam já resolvidas (derivadas do `provider` da conexão da conversa) — sem chamada nova.
- **i18n**: toda string nova em `messages/en.json` **e** `messages/ko.json` sob `Inbox`/`Settings.whatsapp` (o `messages.test.ts` exige paridade).

---

## 4. Decisões desta leva (brainstorming 2026-08-30)

| # | Decisão | Motivo |
|---|---|---|
| 1cii-1 | 1c-ii inteira num PR | A parte de servidor e a inbox são o mesmo objetivo ("UAZAPI recebe e você vê de qual canal"); a UI é baixo risco (sem lógica nova). Menos overhead. |
| 1cii-2 | `excludeMessages: ['isGroupYes', 'fromMeYes']` | Espelha a Meta: a inbox mostra só o que o cliente mandou + o que o CRM enviou. Sem risco de dupla persistência, sem mensagem órfã sem autor. Filtra grupos (senão viram contatos esdrúxulos). |
| 1cii-3 | Instância já conectada corrigida por botão "Re-registrar webhook" | Explícito, funciona pra a instância atual e pra qualquer futura. Alternativa "automático no polling" põe efeito colateral numa rota de leitura; "só via Reconnect" força desconectar+reconectar um número que funciona. |
| 1cii-4 | Parsing defensivo do envelope (`data ?? payload`, `EventType ?? event`) + log distinguível em cada rejeição + smoke obrigatório | O OpenAPI e a spec-mãe divergem na forma do envelope; não há payload real pra codar em cima. Chute errado = inbound silenciosamente não faz nada. O 200-silencioso esconde tudo — o log server-side é a única pista pra debugar o smoke. |
| 1cii-5 | `resolve-conversation.ts` ganha `.eq('is_primary', true)`, não `.eq('provider','meta')` | `POST /api/v1/messages` tem que funcionar numa conta só-UAZAPI; a primária pode ser de qualquer provedor. Filtrar por meta quebraria isso. |
| 1cii-6 | Sem migração | Todas as colunas existem (040/041). |

---

## 5. Testes e critério de aceite

- **Zero mudança pra conta só-Meta:** selo não aparece (canal único), cabeçalho mostra o mesmo número, composer inalterado, `webhook/route.ts` (Meta) **passa sem mudança de asserção**, `resolve-conversation.ts` com `.eq('is_primary', true)` resolve pra mesma (única) linha.
- **+ testes novos:**
  - `src/lib/whatsapp/inbound/uazapi-adapter.test.ts` — envelope `data ?? payload` e `EventType ?? event`; `messageTimestamp` em ms → `Date` correto; `chatid` → telefone (com um `chatid` brasileiro realista); reação; `interactive_reply`; status não mapeado → drop; `unsupported`.
  - `src/app/api/whatsapp/webhook/uazapi/[secret]/route.test.ts` — hash não bate → 200 `{status:'ignored'}` + `console.warn`; instance não confere → 200 + warn; `messages` → `processInboundMessage` chamado com o `InboundMessage` normalizado; `messages_update` → `processStatusUpdate`; `connection` connected → UPDATE `status`/`display_phone`/`profile_name`; `after()` usado (ack antes do processamento).
  - `transport-contract.test.ts` — `fetchMedia` UAZAPI: chama `/message/download` com `{ id, return_base64: true, return_link: false }`, devolve `{ bytes: Uint8Array, mimeType }`.
  - `src/app/api/whatsapp/connections/[id]/reconfigure-webhook/route.test.ts` — 403 agent; happy (configureWebhook chamado, `webhook_secret_hash` atualizado 64-hex, 200); erro → `last_connection_error` + 502; 404 linha alheia.
  - `resolve-conversation.test.ts` — 2 conexões ativas (meta + uazapi) → resolve a `is_primary`, não estoura; sem primária → mesmo erro "não configurado".
- `npm run typecheck` / `lint` / `build` limpos. Baseline segue 5 (`currency` ×3, `dashboard/date-utils` ×2). `messages.test.ts` verde (paridade en/ko).
- **Smoke manual pós-merge — OBRIGATÓRIO** (a única validação real do envelope):
  1. deploy (sem migração) → **"Re-registrar webhook"** no card UAZAPI;
  2. mandar **texto** de outro WhatsApp **pro** número UAZAPI → contato + conversa na inbox, selo "QR";
  3. mandar **mídia** → aparece e é espelhada;
  4. responder pela inbox → cliente recebe;
  5. `display_phone` / `profile_name` preenchidos (evento `connection`).
  Divergência de campo (envelope, `messageType`, resposta do `/message/download`) → follow-up rápido.

---

## 6. Riscos

| Risco | Mitigação |
|---|---|
| A forma real do envelope de webhook diverge do assumido → inbound silenciosamente não processa nada | Parsing defensivo (`data ?? payload`, `EventType ?? event`); log distinguível em cada rejeição; o smoke manda uma mensagem real e confirma que cai. O plano lê o `docs/uazapi-openapi-spec.yaml` a fundo antes de escrever o adaptador. |
| `messageType` da UAZAPI tem valores inesperados → tudo vira `unsupported` | O adaptador loga `rawType` em cada `unsupported`; o smoke com texto/mídia/reação cobre os principais; divergência → follow-up. |
| `messageTimestamp` tratado como segundos (copiando o adaptador da Meta) → datas em 1970 ou 55000 | Comentário explícito + teste assere o `Date` resultante de um timestamp em ms conhecido. |
| A resposta do `/message/download` não tem `base64` no campo assumido → toda mídia recebida cai com `media_url = null` | `fetchMedia` tenta `base64 ?? file ?? data`; lança com mensagem clara se nenhum; o `processInboundMessage` já é best-effort (log + null); o smoke com mídia fixa o campo. |
| Re-registrar o webhook gira o segredo e a instância fica sem webhook por um instante se o `configureWebhook` falhar no meio | `configureWebhook` é uma chamada só (create-or-update no "modo simples"); em falha, grava `last_connection_error` e o botão continua disponível pra tentar de novo. O hash antigo já não vale (segredo novo gerado antes da chamada) — aceitável, o operador re-tenta. |
| O selo de canal aparece numa conta só-Meta (ruído) | A regra é "omitir quando só há um canal ativo"; teste do componente / lógica pura do predicado. |

---

## 7. Fora de escopo desta leva

- `sendTemplate` / `sendInteractive` reais na UAZAPI (`/send/menu`, `/send/carousel`); broadcast por conexão específica — **Onda 3**.
- Evento `history` (histórico retroativo) — deliberadamente não assinado.
- Reconciliação de instâncias órfãs (via `GET /instance/all`); pareamento por número de telefone — follow-ups sem onda.
- Refresh de `capabilities` / UI dinâmica além do gate de template — a 1c-ii só esconde o botão de template numa conversa UAZAPI.
