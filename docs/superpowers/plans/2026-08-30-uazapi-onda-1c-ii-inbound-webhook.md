# UAZAPI Onda 1c-ii — Webhook de inbound + mídia + inbox — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ligar o recebimento de mensagens pela conexão UAZAPI — rota de webhook `POST /api/whatsapp/webhook/uazapi/[secret]` que traduz o envelope da UAZAPI para a forma canônica da 1c-i e chama o **mesmo** `processInboundMessage`/`processStatusUpdate` — mais `fetchMedia` UAZAPI, o handler do evento `connection`, o `configureWebhook` reconciliado + botão de re-registro, o fix do carry-forward do `resolveConversationByPhone`, e as pistas de canal na inbox.

**Architecture:** Um PR, **sem migração** (todas as colunas existem — 040/041). A rota nova espelha o adaptador de envelope da Meta (`processWebhook` em `webhook/route.ts`, 269 linhas). O adaptador UAZAPI espelha `meta-adapter.ts`. `fetchMedia` UAZAPI usa o `call()` já existente em `uazapi-transport.ts`. Zero mudança de comportamento observável para uma conta só-Meta.

**Tech Stack:** Next.js 16 (App Router, `after()`, route handlers com `params: Promise<…>`), TypeScript, Supabase (service-role client no webhook; RLS client nas rotas de conexão), `node:crypto` (sha256, `randomBytes`), Vitest, next-intl (`messages/en.json` + `messages/ko.json`).

**Spec:** `docs/superpowers/specs/2026-08-30-uazapi-onda-1c-ii-inbound-webhook.md` — leitura obrigatória. Apoio: `2026-08-30-uazapi-onda-1c-i-inbound-seam.md`, `2026-08-29-uazapi-onda-1b-ii-provisionamento.md`, `docs/uazapi-openapi-spec.yaml` §webhooks + `/message/download`.

## Global Constraints

- **Sem migração.** Nenhum arquivo em `supabase/`.
- **Zero mudança observável para conta só-Meta.** `webhook/route.ts` (Meta) **passa sem mudança de asserção**. O selo de canal só aparece quando há ≥2 canais ativos. `resolve-conversation.ts` com `.eq('is_primary', true)` resolve para a mesma (única) linha.
- **Parsing defensivo do envelope** (decisão 1cii-4): o adaptador aceita `payload.data ?? payload` como fonte da mensagem e `payload.EventType ?? payload.event` como tipo. A rota loga uma linha **distinguível** em cada rejeição (server-side, nunca na resposta): "hash não bateu", "instance não confere", "EventType não tratado".
- **`messageTimestamp` da UAZAPI é em milissegundos** — `new Date(m.messageTimestamp)`, **NÃO** `* 1000` (o adaptador da Meta usa `* 1000` porque a Meta manda segundos). Teste assere o `Date`.
- **Resposta do `/message/download`** (confirmada no yaml, linha ~7330): `{ fileURL, mimetype (sempre), base64Data (se return_base64), transcription }`. Sem campo de nome de arquivo. Campo do base64 = **`base64Data`**.
- **Item "confirmar na prática"** (como o `messageid` da 1b-ii): a forma exata do envelope de webhook (o yaml só tem `{EventType, token}` num exemplo de *log*), os valores de `messageType`, a estrutura de `content` para mídia, e o telefone dentro de `chatid`. Cada task que os toca parte de uma leitura do `docs/uazapi-openapi-spec.yaml`; o smoke manual pós-merge fixa contra um payload real.
- Prettier: `semi: true, singleQuote: true, printWidth: 80, trailingComma: es5` nos arquivos novos. `webhook/route.ts` e `message-composer.tsx` não são prettier-clean no baseline → diff cirúrgico.
- `messages.test.ts` exige paridade total de chaves entre `en.json` e `ko.json` — chave nova entra nos dois, com coreano real.
- Baseline: 5 falhas pré-existentes (`currency.test.ts` ×3, `dashboard/date-utils.test.ts` ×2). Nada novo.
- Portas por task: `npm run typecheck`, `npm run lint` (0 erros), `npm test` (baseline intacto). `npm run build` na última task de UI.

---

## File Structure

**Criados:**

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/whatsapp/inbound/uazapi-adapter.ts` | `uazapiMessageToInbound`, `uazapiStatusToInbound`, `uazapiContent` — envelope UAZAPI → `InboundMessage`/`InboundStatus`. |
| `src/lib/whatsapp/inbound/uazapi-adapter.test.ts` | — |
| `src/app/api/whatsapp/webhook/uazapi/[secret]/route.ts` | `POST` — hash auth + instance check + `after()` + `handleUazapiEvent`. |
| `src/app/api/whatsapp/webhook/uazapi/[secret]/route.test.ts` | — |
| `src/app/api/whatsapp/connections/[id]/reconfigure-webhook/route.ts` | `POST` — regenera segredo + hash, `configureWebhook`, `UPDATE webhook_secret_hash`. |
| `src/app/api/whatsapp/connections/[id]/reconfigure-webhook/route.test.ts` | — |

**Modificados:**

| Arquivo | Mudança |
|---|---|
| `src/lib/whatsapp/inbound/types.ts` | `ProviderMediaRef` variante uazapi: `{ provider: 'uazapi'; [k: string]: unknown }` → `{ provider: 'uazapi'; messageId: string }`. |
| `src/lib/whatsapp/providers/uazapi-transport.ts` | `fetchMedia` deixa de lançar — chama `/message/download`. |
| `src/lib/whatsapp/providers/transport-contract.test.ts` | caso `fetchMedia` UAZAPI: não lança mais; chama `/message/download`, devolve `{ bytes, mimeType }`. |
| `src/lib/whatsapp/uazapi-admin.ts` | `WEBHOOK_EVENTS` sem `'history'`; `excludeMessages` → `['isGroupYes', 'fromMeYes']`. |
| `src/lib/whatsapp/uazapi-admin.test.ts` | asserções do `events`/`excludeMessages` acompanham. |
| `src/lib/whatsapp/resolve-conversation.ts` | o lookup de `config` ganha `.eq('is_primary', true)`. |
| `src/lib/whatsapp/resolve-conversation.test.ts` | + caso: 2 conexões ativas → resolve a primária, não estoura. |
| `src/lib/inbox/conversations.ts` | `CONVERSATION_SELECT` + `connection:whatsapp_connections(provider, display_phone, label)`; `normalizeConversation` achata. |
| `src/types/index.ts` (ou onde vive `Conversation`) | `Conversation` ganha `connection?: { provider: 'meta'|'uazapi'; display_phone: string|null; label: string|null } \| null`. |
| `src/components/inbox/conversation-list.tsx` | selo de canal por conversa (omitido com 1 canal ativo). |
| `src/components/inbox/message-thread.tsx` | passa `templatesEnabled` ao `MessageComposer` (derivado do `provider` da conexão da conversa) + o número da conexão no cabeçalho. |
| `src/components/inbox/message-composer.tsx` | `templatesEnabled?: boolean` na `MessageComposerProps`; esconde/desabilita o botão de template quando `false`. |
| `src/components/settings/uazapi-connection-card.tsx` | botão **"Re-registrar webhook"** no estado `connected`. |
| `messages/en.json` + `messages/ko.json` | + `Settings.whatsapp.uazapiReconfigureWebhook`, + chave(s) do selo/cabeçalho na inbox. |

---

## Pre-flight (controlador, antes da Task 1)

| Par | Interface | Nota |
|---|---|---|
| T1 → T3 | `uazapiMessageToInbound` / `uazapiStatusToInbound` | T3 (rota) consome. T1 antes de T3. |
| T1 → T2 | `ProviderMediaRef` variante uazapi (`{ provider:'uazapi'; messageId }`) | T1 aperta o tipo; T2 (`fetchMedia`) lê `ref.messageId`. T1 antes de T2. Ripple: `metaContent` monta `{ provider:'meta', mediaId }` — não afetado. Qualquer outro consumidor de `ProviderMediaRef` que assumisse `[k:string]:unknown` no ramo uazapi quebra o typecheck — T1 trata (só `uazapi-transport.ts` stub e testes). |
| T2 → T3 | `fetchMedia` real | T3's `processInboundMessage` no caminho de mídia chama `createTransport(uazapiConn).fetchMedia`. Se T2 não fez, mídia de entrada cai com `media_url = null` (best-effort da 1c-i) — T3 pode ser testada só com texto, mas os testes de mídia da T3 dependem de T2. T2 antes de T3. |
| T4 → T5 | `WEBHOOK_EVENTS` / `excludeMessages` novos | T5 (`reconfigure-webhook`) chama `configureWebhook`, que já usa os novos valores após T4. Sem acoplamento de código; T4 só muda constantes + teste. |
| T5 → card | rota `reconfigure-webhook` | o botão do card chama a rota. Mesma task. |
| T3 ↔ `webhook/route.ts` (Meta) | nenhum — arquivo diferente | A rota UAZAPI é `webhook/uazapi/[secret]/route.ts`, separada. `webhook/route.ts` (Meta) **não é tocado**. |
| T6 → T7 | `resolve-conversation.ts` | independentes (T6 = backend send-path, T7 = inbox UI). Ordem livre. |
| T7 → `CONVERSATION_SELECT` consumers | `src/app/(dashboard)/inbox/page.tsx`, `src/app/api/v1/conversations/route.ts`, `.../[id]/route.ts` | acrescentar o embed a `CONVERSATION_SELECT` afeta esses 3 sites de leitura + `normalizeConversation`. T7 confirma que o `RawConversation`/`Conversation` type acomoda e que o v1 API não regride (os testes de `conversations` v1). |

**Rulings do controlador:**

- **PF-A (envelope defensivo):** o adaptador T1 e a rota T3 **não** assumem uma forma única de envelope. `const m = payload.data ?? payload`; `const eventType = payload.EventType ?? payload.event`. Cada `unsupported`/rejeição loga `rawType`/motivo. Sem isso, o smoke debuga às cegas (o 200-silencioso esconde tudo). Custo se errado: o adaptador aceita duas formas onde só uma existe — inofensivo.
- **PF-B (mídia depende de T2):** T3 é ordenada **depois** de T2. Os testes de mídia de entrada da T3 mockam `fetchMedia`; o de texto não precisa. Se T2 escorregar, T3 reporta e os testes de mídia ficam para um fix round.
- **PF-C (`messageType` desconhecido):** valores de `messageType` da UAZAPI = item "confirmar na prática". O adaptador mapeia os conhecidos (texto/imagem/vídeo/documento/áudio/reação/interativo) e cai em `unsupported` com `rawType` logado para o resto. O smoke com texto/mídia/reação cobre os principais; divergência → follow-up rápido, não bloqueia.

---

## Task 1: `uazapi-adapter.ts` + aperto do `ProviderMediaRef`

**Files:**
- Modify: `src/lib/whatsapp/inbound/types.ts`
- Create: `src/lib/whatsapp/inbound/uazapi-adapter.ts`, `.../uazapi-adapter.test.ts`

**Interfaces:**
- Consumes: `normalizePhone` (`@/lib/whatsapp/phone-utils`), `MediaKind` (`@/lib/whatsapp/meta-api`), `InboundMessage`/`InboundStatus` (`./types`).
- Produces:
  - `types.ts`: `ProviderMediaRef` ramo uazapi vira `{ provider: 'uazapi'; messageId: string }` (era `{ provider: 'uazapi'; [k: string]: unknown }`).
  - `uazapiMessageToInbound(payload: Record<string, unknown>, row: UazapiConnectionRowLite): InboundMessage`
  - `uazapiStatusToInbound(payload: Record<string, unknown>, row: UazapiConnectionRowLite): InboundStatus`
  - `export interface UazapiConnectionRowLite { id: string; account_id: string; user_id: string; uazapi_instance_id: string | null }` (o `uazapi_instance_id` é para a checagem de defesa em profundidade da T3 — a T3 pode carregar o row completo; este lite é o que o adaptador estampa).

- [ ] **Step 1: `types.ts`** — trocar o ramo uazapi do `ProviderMediaRef`:

```ts
export type ProviderMediaRef =
  | { provider: 'meta'; mediaId: string }
  | { provider: 'uazapi'; messageId: string };
```

Rodar `npm run typecheck` — deve acusar **um** erro em `providers/uazapi-transport.ts` (o stub `fetchMedia` cujo tipo de retorno não usa `ref`) — nenhum, na verdade, o stub ignora `ref`. Se algum teste tiver um `ProviderMediaRef` uazapi literal com campos extras, ajustar (enabler). Confirmar 0 erros antes de seguir.

- [ ] **Step 2: teste que falha** — `uazapi-adapter.test.ts`. Ler `docs/uazapi-openapi-spec.yaml` (schema `Message`, ~linha 512; exemplos de webhook) primeiro. Casos:
  - envelope `{ EventType:'messages', data:{ …Message } }` e envelope achatado `{ EventType:'messages', messageid, chatid, … }` → **ambos** produzem o mesmo `InboundMessage` (o `m = payload.data ?? payload`).
  - `eventType` de `payload.event` quando não há `payload.EventType`.
  - `messageTimestamp: 1735689600000` (ms) → `timestamp.getTime() === 1735689600000` (NÃO `* 1000`).
  - `chatid: '5541999998888@s.whatsapp.net'` → `from === normalizePhone('5541999998888')`.
  - texto → `{ kind:'text', text }`.
  - `messageType` de imagem (o valor exato do yaml) + `content` com mime → `{ kind:'media', mediaKind:'image', mimeType, ref:{ provider:'uazapi', messageId } }`.
  - `reaction: '<id>'` truthy + `text:'👍'` → `{ kind:'reaction', targetProviderMessageId:'<id>', emoji:'👍' }`.
  - `buttonOrListid: 'opt_1'` + `text:'Sim'` → `{ kind:'interactive_reply', replyId:'opt_1', title:'Sim' }`.
  - `messageType` desconhecido → `{ kind:'unsupported', rawType:'<valor>' }`.
  - `uazapiStatusToInbound`: `status:'Delivered'` → `.status === 'delivered'`; `status:'Queued'` → `.status === 'Queued'` (cru — o `isValidStatusTransition` da 1c-i descarta).

- [ ] **Step 3: implementar `uazapi-adapter.ts`**

```ts
import { normalizePhone } from '@/lib/whatsapp/phone-utils';
import type { MediaKind } from '@/lib/whatsapp/meta-api';
import type { InboundMessage, InboundStatus } from './types';

export interface UazapiConnectionRowLite {
  id: string;
  account_id: string;
  user_id: string;
  uazapi_instance_id: string | null;
}

type Json = Record<string, unknown>;

/** Fonte da mensagem: o envelope pode vir como `{ …, data: {msg} }`
 *  ou achatado. Aceita as duas (item "confirmar na prática"). */
function msgOf(payload: Json): Json {
  const data = payload.data;
  return data && typeof data === 'object' ? (data as Json) : payload;
}

export function eventTypeOf(payload: Json): string {
  return String(payload.EventType ?? payload.event ?? '');
}

const STATUS_MAP: Record<string, string> = {
  Sent: 'sent',
  Delivered: 'delivered',
  Read: 'read',
  Failed: 'failed',
};

const MEDIA_KINDS: Record<string, MediaKind> = {
  image: 'image',
  video: 'video',
  document: 'document',
  audio: 'audio',
  // stickers → image (paridade com o adaptador da Meta)
  sticker: 'image',
  ptt: 'audio',
};

function phoneFromChatId(chatid: unknown): string {
  const raw = String(chatid ?? '').split('@')[0];
  return normalizePhone(raw);
}

export function uazapiMessageToInbound(
  payload: Json,
  row: UazapiConnectionRowLite
): InboundMessage {
  const m = msgOf(payload);
  return {
    connectionId: row.id,
    accountId: row.account_id,
    configOwnerUserId: row.user_id,
    providerMessageId: String(m.messageid ?? ''),
    from: phoneFromChatId(m.chatid),
    senderName: (m.senderName as string) || undefined,
    // messageTimestamp é EM MILISSEGUNDOS — sem * 1000.
    timestamp: new Date(Number(m.messageTimestamp ?? 0)),
    replyToProviderMessageId: (m.quoted as string) || undefined,
    content: uazapiContent(m),
  };
}

export function uazapiContent(m: Json): InboundMessage['content'] {
  // Reação: o campo `reaction` carrega o id da msg reagida; o emoji vem
  // em `text`. (Confirmar contra `messageType` no payload real.)
  if (m.reaction) {
    return {
      kind: 'reaction',
      targetProviderMessageId: String(m.reaction),
      emoji: (m.text as string) ?? '',
    };
  }
  if (m.buttonOrListid) {
    return {
      kind: 'interactive_reply',
      replyId: String(m.buttonOrListid),
      title: (m.text as string) ?? String(m.buttonOrListid),
    };
  }
  const mt = String(m.messageType ?? '').toLowerCase();
  const mediaKind = MEDIA_KINDS[mt];
  if (mediaKind) {
    const content = (m.content as Json | undefined) ?? {};
    return {
      kind: 'media',
      mediaKind,
      caption: (m.text as string) || undefined,
      filename:
        (content.fileName as string) ?? (content.filename as string) ?? undefined,
      mimeType:
        (content.mimetype as string) ?? (content.mimeType as string) ?? undefined,
      ref: { provider: 'uazapi', messageId: String(m.messageid ?? '') },
    };
  }
  if (mt === 'text' || mt === 'conversation' || (!mt && typeof m.text === 'string')) {
    return { kind: 'text', text: (m.text as string) ?? '' };
  }
  return { kind: 'unsupported', rawType: String(m.messageType ?? 'unknown') };
}

export function uazapiStatusToInbound(
  payload: Json,
  row: UazapiConnectionRowLite
): InboundStatus {
  const m = msgOf(payload);
  return {
    connectionId: row.id,
    accountId: row.account_id,
    providerMessageId: String(m.messageid ?? ''),
    status: STATUS_MAP[String(m.status ?? '')] ?? String(m.status ?? ''),
    timestamp: new Date(Number(m.messageTimestamp ?? Date.now())),
  };
}
```

> Nota: os nomes exatos (`messageType` values, `content.mimetype` vs outro, o telefone em `chatid` vs `sender`) saem da leitura do yaml + o smoke. O `MEDIA_KINDS` e o mapa de texto cobrem os candidatos; `unsupported` com `rawType` logado é a rede.

- [ ] **Step 4: rodar** `npx vitest run src/lib/whatsapp/inbound/uazapi-adapter.test.ts` → verde. `npm run typecheck && npm run lint`. `npx vitest run` → baseline 5.
- [ ] **Step 5: Commit** `git commit -m "feat(uazapi): inbound envelope adapter (uazapiMessageToInbound / status / content)"`

---

## Task 2: `fetchMedia` UAZAPI

**Files:**
- Modify: `src/lib/whatsapp/providers/uazapi-transport.ts`, `src/lib/whatsapp/providers/transport-contract.test.ts`

**Interfaces:**
- Consumes: o `call()` já existente no closure de `createUazapiTransport`; `ProviderMediaRef` (Task 1, ramo uazapi = `{ provider:'uazapi'; messageId }`).
- Produces: `fetchMedia(ref)` real (era stub que lança).

- [ ] **Step 1: teste que falha** — em `transport-contract.test.ts`, o caso `fetchMedia` do lado UAZAPI hoje assere `.rejects.toThrow(/1c-ii/)`. Trocar por: `fetch` mockado devolve `{ mimetype: 'image/jpeg', base64Data: Buffer.from('abc').toString('base64') }`; `await t.fetchMedia({ provider:'uazapi', messageId:'3EB0X' })` → `{ bytes: expect.any(Uint8Array), mimeType: 'image/jpeg' }`, e o `fetch` foi chamado em `…/message/download` com body `{ id:'3EB0X', return_base64:true, return_link:false }` e header `token`.

- [ ] **Step 2: implementar** — substituir o stub por:

```ts
    async fetchMedia(ref): Promise<{
      bytes: Uint8Array;
      mimeType: string;
      filename?: string;
    }> {
      if (ref.provider !== 'uazapi') {
        throw new Error(
          `uazapi transport: unexpected media ref provider ${ref.provider}`
        );
      }
      const json = await call('/message/download', {
        id: ref.messageId,
        return_base64: true,
        return_link: false,
      });
      // Resposta (yaml ~7330): { mimetype (sempre), base64Data (se
      // return_base64), fileURL, transcription }. Defensivo no campo do
      // base64 — o nome exato o smoke confirma.
      const b64 =
        (json.base64Data as string) ??
        (json.base64 as string) ??
        (json.file as string);
      if (!b64) {
        throw new Error('uazapi /message/download: no base64 in response');
      }
      return {
        bytes: Uint8Array.from(Buffer.from(b64, 'base64')),
        mimeType: (json.mimetype as string) ?? 'application/octet-stream',
        filename: (json.fileName as string) ?? (json.filename as string) ?? undefined,
      };
    },
```

Remover o comentário do stub ("implementado na Onda 1c-ii").

- [ ] **Step 3: rodar** `npx vitest run src/lib/whatsapp/providers/transport-contract.test.ts src/lib/whatsapp/providers/uazapi-transport.test.ts` → verde. Portas + `npx vitest run` baseline 5.
- [ ] **Step 4: Commit** `git commit -m "feat(uazapi): fetchMedia via /message/download"`

---

## Task 3: Rota `POST /api/whatsapp/webhook/uazapi/[secret]`

**Files:**
- Create: `src/app/api/whatsapp/webhook/uazapi/[secret]/route.ts`, `.../route.test.ts`

**Interfaces:**
- Consumes: `processInboundMessage` (`@/lib/whatsapp/inbound/process-inbound-message`), `processStatusUpdate` (`@/lib/whatsapp/inbound/process-status-update`), `uazapiMessageToInbound`/`uazapiStatusToInbound`/`eventTypeOf` (Task 1), `createClient` (`@supabase/supabase-js`, service-role — mesmo padrão do `supabaseAdmin()` em `webhook/route.ts:27-35`), `after` (`next/server`), `node:crypto`.
- Produces: a rota. Sem exports.

- [ ] **Step 1: teste que falha** — `route.test.ts`. Mock: `vi.mock('@/lib/whatsapp/inbound/process-inbound-message')`, `vi.mock('.../process-status-update')`, `vi.mock('@supabase/supabase-js')` (chainable, `whatsapp_connections` por `webhook_secret_hash`). Casos:
  - hash não bate nenhuma linha → **200** `{ status: 'ignored' }`, `console.warn` com "secret hash", `processInboundMessage` NÃO chamado.
  - linha achada mas `payload.instance` (ou `payload.token`) `!== row.uazapi_instance_id` → **200** `{ status: 'ignored' }`, `console.warn` "instance mismatch".
  - `EventType:'messages'` com envelope válido → 200 `{ status:'received' }`, e (após o `after()` resolver) `processInboundMessage` chamado **uma vez** com o `InboundMessage` de `uazapiMessageToInbound`.
  - `EventType:'messages_update'` → `processStatusUpdate` chamado.
  - `EventType:'connection'` com estado `connected` → `UPDATE whatsapp_connections` com `{ status:'connected', display_phone, profile_name, last_connection_error: null }`.
  - `EventType:'connection'` com estado inesperado (`'weird'`) → **não** escreve `status`.
  - `EventType` desconhecido → 200, nada acontece, `console.info`.
  - o `after()` é usado (o 200 volta antes de `processInboundMessage` resolver).

- [ ] **Step 2: implementar `route.ts`**

```ts
import { NextResponse, after } from 'next/server';
import crypto from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { processInboundMessage } from '@/lib/whatsapp/inbound/process-inbound-message';
import { processStatusUpdate } from '@/lib/whatsapp/inbound/process-status-update';
import {
  uazapiMessageToInbound,
  uazapiStatusToInbound,
  eventTypeOf,
} from '@/lib/whatsapp/inbound/uazapi-adapter';

export const maxDuration = 60;

let _admin: SupabaseClient | null = null;
function admin(): SupabaseClient {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _admin;
}

const CONNECTION_STATES = [
  'disconnected',
  'connecting',
  'connected',
  'hibernated',
  'banned',
] as const;

type Json = Record<string, unknown>;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ secret: string }> }
) {
  const { secret } = await params;
  const hash = crypto.createHash('sha256').update(secret).digest('hex');

  const payload = (await request.json().catch(() => ({}))) as Json;
  const db = admin();

  const { data: row } = await db
    .from('whatsapp_connections')
    .select('*')
    .eq('webhook_secret_hash', hash)
    .eq('provider', 'uazapi')
    .is('archived_at', null)
    .maybeSingle();

  if (!row) {
    console.warn('[uazapi webhook] secret hash matched no connection');
    return NextResponse.json({ status: 'ignored' }, { status: 200 });
  }

  // Defesa em profundidade: o instance/token do payload tem que bater.
  const payloadInstance =
    payload.instance ??
    payload.token ??
    (payload.data as Json | undefined)?.instance;
  if (payloadInstance && payloadInstance !== row.uazapi_instance_id) {
    console.warn(
      `[uazapi webhook] instance mismatch: payload=${String(payloadInstance)} row=${row.uazapi_instance_id}`
    );
    return NextResponse.json({ status: 'ignored' }, { status: 200 });
  }

  // Ack rápido — a UAZAPI reenvia se o ack demora (igual à Meta).
  after(async () => {
    try {
      await handleUazapiEvent(db, row, payload);
    } catch (err) {
      console.error('[uazapi webhook] processing error:', err);
    }
  });

  return NextResponse.json({ status: 'received' }, { status: 200 });
}

async function handleUazapiEvent(
  db: SupabaseClient,
  row: Json,
  payload: Json
): Promise<void> {
  const eventType = eventTypeOf(payload);
  const lite = {
    id: row.id as string,
    account_id: row.account_id as string,
    user_id: row.user_id as string,
    uazapi_instance_id: row.uazapi_instance_id as string | null,
  };

  switch (eventType) {
    case 'messages':
      await processInboundMessage(db, uazapiMessageToInbound(payload, lite));
      return;
    case 'messages_update':
      await processStatusUpdate(db, uazapiStatusToInbound(payload, lite));
      return;
    case 'connection':
      await handleConnectionEvent(db, row, payload);
      return;
    default:
      console.info('[uazapi webhook] unhandled EventType:', eventType);
  }
}

async function handleConnectionEvent(
  db: SupabaseClient,
  row: Json,
  payload: Json
): Promise<void> {
  const m = ((payload.data as Json | undefined) ?? payload) as Json;
  const raw = String(m.status ?? m.state ?? '').toLowerCase();
  const status = (CONNECTION_STATES as readonly string[]).includes(raw)
    ? raw
    : null;
  if (!status) {
    console.info('[uazapi webhook] connection event, unmapped state:', raw);
    return;
  }
  const patch: Json = { status };
  if (status === 'connected') {
    patch.display_phone =
      (m.phone as string) ??
      ((m.jid as Json | undefined)?.user as string) ??
      null;
    patch.profile_name = (m.profileName as string) ?? (m.pushName as string) ?? null;
    patch.last_connection_error = null;
  } else {
    patch.last_connection_error =
      (m.reason as string) ?? (m.lastDisconnectReason as string) ?? null;
  }
  const { error } = await db
    .from('whatsapp_connections')
    .update(patch)
    .eq('id', row.id as string);
  if (error) {
    console.error('[uazapi webhook] connection UPDATE failed:', error);
  }
}
```

> Envelope shape (`payload.instance` vs `.token` vs `.data.instance`; `messageType` values; `connection` state field) = "confirmar na prática" — o parsing é defensivo e o smoke fixa.

- [ ] **Step 3: rodar** os testes → verde. Portas + `npx vitest run` baseline 5. Confirmar `webhook/route.test.ts` (Meta) **intacto** (rota diferente, não deve nem tocar).
- [ ] **Step 4: Commit** `git commit -m "feat(uazapi): inbound webhook route /api/whatsapp/webhook/uazapi/[secret]"`

---

## Task 4: `configureWebhook` reconciliado

**Files:**
- Modify: `src/lib/whatsapp/uazapi-admin.ts`, `src/lib/whatsapp/uazapi-admin.test.ts`

- [ ] **Step 1:** `uazapi-admin.ts`:
  - `const WEBHOOK_EVENTS = ['messages', 'messages_update', 'connection'];` (remove `'history'`).
  - no corpo de `configureWebhook`, `excludeMessages: ['isGroupYes', 'fromMeYes']` (era `['wasSentByApi']`).
  - Comentário curto: *"`isGroupYes` pula grupos (senão cada grupo vira um contato); `fromMeYes` pula tudo que sai do número — o eco dos envios via API e o que o operador digita no celular. `history` não é assinado (despeja meses de conversa)."*
- [ ] **Step 2:** `uazapi-admin.test.ts` — o teste de `configureWebhook` assere o body. Atualizar a asserção para `events: ['messages','messages_update','connection']` e `excludeMessages: ['isGroupYes','fromMeYes']`. Nenhuma outra mudança.
- [ ] **Step 3:** `npx vitest run src/lib/whatsapp/uazapi-admin.test.ts` → verde. Portas. `npx vitest run` baseline 5. (Os testes de `connect/route.test.ts` que mockam `configureWebhook` não asseram o body — confirmar que passam.)
- [ ] **Step 4: Commit** `git commit -m "feat(uazapi): webhook subscribes messages/messages_update/connection, filters groups + own sends"`

---

## Task 5: Rota `reconfigure-webhook` + botão no card

**Files:**
- Create: `src/app/api/whatsapp/connections/[id]/reconfigure-webhook/route.ts`, `.../route.test.ts`
- Modify: `src/components/settings/uazapi-connection-card.tsx`, `messages/en.json`, `messages/ko.json`

**Interfaces:**
- Consumes: `requireRole`/`toErrorResponse` (`@/lib/auth/account`), `decrypt` (`@/lib/whatsapp/encryption`), `resolveAppBaseUrl` (`@/lib/whatsapp/uazapi-env`), `configureWebhook` (`@/lib/whatsapp/uazapi-admin`), `loadUazapiConnectionRow` (`@/lib/whatsapp/uazapi-connection-row`), `toConnectionDTO` (`@/lib/whatsapp/uazapi-connection-dto`), `node:crypto`.

- [ ] **Step 1: `route.ts`** — mesmo esqueleto do `connect/route.ts` menos o `connectInstance` e a mudança de `status`:

```ts
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { decrypt } from '@/lib/whatsapp/encryption';
import { resolveAppBaseUrl } from '@/lib/whatsapp/uazapi-env';
import { configureWebhook } from '@/lib/whatsapp/uazapi-admin';
import { loadUazapiConnectionRow } from '@/lib/whatsapp/uazapi-connection-row';
import { toConnectionDTO } from '@/lib/whatsapp/uazapi-connection-dto';

const SELECT_COLS =
  'id, provider, label, status, is_primary, display_phone, profile_name, last_connection_error, created_at';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { supabase, accountId } = await requireRole('admin');
    const row = await loadUazapiConnectionRow(supabase, accountId, id);
    if (!row || !row.uazapi_base_url) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 });
    }

    const baseUrl = row.uazapi_base_url;
    const token = decrypt(row.credential);
    const secret = crypto.randomBytes(32).toString('hex');
    const webhookSecretHash = crypto
      .createHash('sha256')
      .update(secret)
      .digest('hex');
    const webhookUrl = `${resolveAppBaseUrl(request)}/api/whatsapp/webhook/uazapi/${secret}`;

    try {
      await configureWebhook(baseUrl, token, webhookUrl);
    } catch (err) {
      console.error('[reconfigure-webhook] configureWebhook failed', err);
      await supabase
        .from('whatsapp_connections')
        .update({ last_connection_error: 'Webhook não configurado — tente de novo.' })
        .eq('id', id)
        .eq('account_id', accountId);
      return NextResponse.json({ error: 'Failed to configure webhook' }, { status: 502 });
    }

    const { data: fresh } = await supabase
      .from('whatsapp_connections')
      .update({ webhook_secret_hash: webhookSecretHash, last_connection_error: null })
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

- [ ] **Step 2: `route.test.ts`** — 403 `callerRole='agent'`; happy (`configureWebhook` chamado com uma URL terminando em `/api/whatsapp/webhook/uazapi/<64hex>`; `webhook_secret_hash` no UPDATE = 64 hex; 200 `{ data }`); `configureWebhook` rejeita → `last_connection_error` gravado + 502; `id` de outra conta → 404. Modelar no mock de `connect/route.test.ts`.

- [ ] **Step 3: `uazapi-connection-card.tsx`** — no bloco `view === 'connected'` (~linha 304-334), ao lado de "Desconectar"/"Remover", um botão **`t('uazapiReconfigureWebhook')`** → `runAction(() => fetch('/api/whatsapp/connections/' + row.id + '/reconfigure-webhook', { method: 'POST' }))` → `onChanged()`. Desabilitado quando `!canEditSettings`. (Reusar o `runAction`/`toast` que o card já tem.)

- [ ] **Step 4: i18n** — `messages/en.json` sob `Settings.whatsapp`: `"uazapiReconfigureWebhook": "Re-register webhook"`. `messages/ko.json`: coreano real (ex. `"웹훅 다시 등록"`). Rodar `npx vitest run messages.test.ts` → verde.

- [ ] **Step 5:** Portas + `npx vitest run src/app/api/whatsapp/connections messages.test.ts` verde + `npx vitest run` baseline 5.
- [ ] **Step 6: Commit** `git commit -m "feat(uazapi): POST reconfigure-webhook + Settings card button"`

---

## Task 6: Fix do carry-forward — `resolve-conversation.ts`

**Files:**
- Modify: `src/lib/whatsapp/resolve-conversation.ts`, `src/lib/whatsapp/resolve-conversation.test.ts`

- [ ] **Step 1: teste que falha** — em `resolve-conversation.test.ts`, caso novo: o mock de `whatsapp_connections` devolve **duas** linhas ativas (uma `meta` `is_primary:false`, uma `uazapi` `is_primary:true`) para o mesmo account. Hoje o `.maybeSingle()` sem filtro estoura (`PGRST116` → o mock devolve `{data:null}` ou erro conforme o fake). Após o fix: `resolveConversationByPhone` resolve para a linha `is_primary` e o INSERT de conversa leva `connection_id = <id da uazapi>`. Também: mock com **zero** linhas → mesmo `SendMessageError('whatsapp_not_configured', …, 400)` de hoje.

- [ ] **Step 2: implementar** — no lookup de `config` (~linha 58-63), acrescentar `.eq('is_primary', true)`:

```ts
  const { data: config } = await db
    .from('whatsapp_connections')
    .select('id')
    .eq('account_id', accountId)
    .eq('is_primary', true)
    .is('archived_at', null)
    .maybeSingle();
```

Atualizar o comentário logo acima ("Fail fast … when the account has no WhatsApp connected") para "… no **primary** WhatsApp connection". **Não** adicionar `.eq('provider','meta')` — `POST /api/v1/messages` tem que funcionar numa conta só-UAZAPI.

- [ ] **Step 3:** `npx vitest run src/lib/whatsapp/resolve-conversation.test.ts` verde. Portas. `npx vitest run` baseline 5. Confirmar `src/lib/whatsapp/uazapi-send-proof.test.ts` (da 1c-i) ainda passa.
- [ ] **Step 4: Commit** `git commit -m "fix(whatsapp): resolveConversationByPhone resolves the primary connection (2+ connections no longer PGRST116)"`

---

## Task 7: Inbox — selo de canal, cabeçalho, composer

**Files:**
- Modify: `src/lib/inbox/conversations.ts`, `src/types/index.ts` (ou onde vive `Conversation`), `src/components/inbox/conversation-list.tsx`, `src/components/inbox/message-thread.tsx`, `src/components/inbox/message-composer.tsx`, `messages/en.json`, `messages/ko.json`

**Interfaces:**
- `CONVERSATION_SELECT` passa a incluir `connection:whatsapp_connections(provider, display_phone, label)`.
- `Conversation.connection?: { provider: 'meta'|'uazapi'; display_phone: string|null; label: string|null } | null`.
- `MessageComposerProps.templatesEnabled?: boolean` (default `true` — comportamento atual).

- [ ] **Step 1: `conversations.ts`** — `CONVERSATION_SELECT` vira `"*, contact:contacts(*, contact_tags(tags(*))), connection:whatsapp_connections(provider, display_phone, label)"`. `RawConversation` ganha `connection?`. `normalizeConversation` passa `connection` adiante (achatar não precisa — já é objeto único). Rodar os testes de `conversations.ts` / v1 `conversations` — devem passar (embed a mais, sem quebrar o shape).

- [ ] **Step 2: `Conversation` type** — `+ connection?: { provider: 'meta' | 'uazapi'; display_phone: string | null; label: string | null } | null`.

- [ ] **Step 3: `conversation-list.tsx`** — helper puro `channelBadge(conversation, activeChannelCount): 'Meta' | 'QR' | null` — `null` quando `activeChannelCount <= 1` ou sem `connection`. `activeChannelCount` = nº de `provider` distintos nas conversas carregadas (ou um count de conexões ativas do `useAuth`, se disponível — o plano usa o distinct das conversas, sem query nova). Renderizar um `<span>` pequeno no `ConversationItem` quando não-null. i18n `Inbox.channelMeta` / `Inbox.channelQr` ("Meta" / "QR" — podem ser literais, mas passar por `t()` para o ko).

- [ ] **Step 4: `message-thread.tsx`** — deriva `const templatesEnabled = conversation.connection?.provider !== 'uazapi'` e passa como prop ao `<MessageComposer>`. No cabeçalho da conversa (onde já mostra o nome/telefone do contato), acrescentar uma linha discreta: `conversation.connection?.display_phone ?? conversation.connection?.label` quando `activeChannelCount > 1` — "via {número}". i18n `Inbox.viaNumber` (`"via {number}"`).

- [ ] **Step 5: `message-composer.tsx`** — `MessageComposerProps` ganha `templatesEnabled?: boolean`. Nos dois pontos que renderizam o botão de template (linhas ~558 e ~705), envolver em `{templatesEnabled !== false && ( … )}` (ou `disabled` + `title` explicando — o plano usa esconder, mais limpo). Diff cirúrgico (arquivo não é prettier-clean).

- [ ] **Step 6: i18n** — as 3 chaves novas (`channelMeta`, `channelQr`, `viaNumber`) em `messages/en.json` **e** `messages/ko.json` sob `Inbox`. `npx vitest run messages.test.ts` verde.

- [ ] **Step 7:** `npm run typecheck && npm run lint && npm run build && npx vitest run` (baseline 5; `messages.test.ts` verde). Sem teste de componente (o repo não tem infra) — o `channelBadge` puro tem teste unitário em `conversation-list` se der pra isolá-lo, senão typecheck + build são o gate.
- [ ] **Step 8: Commit** `git commit -m "feat(uazapi): inbox channel badge + conversation-header number + composer template gate"`

---

## Self-Review (autor do plano)

**1. Cobertura da spec:**
- §3.1 rota webhook → T3 ✓
- §3.2 adaptador → T1 ✓
- §3.3 fetchMedia + ProviderMediaRef → T1 (tipo) + T2 (impl) ✓
- §3.4 evento connection → T3 (`handleConnectionEvent`) ✓
- §3.5 configureWebhook + botão → T4 + T5 ✓
- §3.6 carry-forward → T6 ✓
- §3.7 inbox → T7 ✓
- §5 critério de aceite → cada task tem testes; `webhook/route.test.ts` (Meta) não é tocado (rota separada) ✓
- smoke manual pós-merge → responsabilidade do operador, listado na spec §5 ✓

**2. Placeholders:** os "confirmar na prática" (envelope shape, `messageType` values, `content` de mídia, campo do base64) são forward-refs deliberados, cada um com parsing defensivo + fallback `unsupported`/`throw` claro + coberto pelo smoke. Padrão herdado da 1b-ii (`messageid`). Nenhum TODO/TBD.

**3. Consistência de tipos:**
- `ProviderMediaRef` uazapi = `{ provider:'uazapi'; messageId }` — T1 define, T2 lê `ref.messageId`, T1's `uazapiContent` monta. ✓
- `UazapiConnectionRowLite` (T1) — a rota T3 monta `lite` do row completo. ✓
- `eventTypeOf` exportado por T1, usado por T3. ✓
- `InboundMessage`/`InboundStatus` (1c-i) — o adaptador T1 produz, `processInboundMessage`/`processStatusUpdate` (1c-i) consomem, assinaturas conferidas (`(db, msg)` / `(db, s)`). ✓
- `Conversation.connection` (T7) — `CONVERSATION_SELECT` embed + type + os 3 sites consumidores. ✓
- `MessageComposerProps.templatesEnabled` — T7 adiciona, `message-thread.tsx` passa, `message-composer.tsx` lê. Default `true` = sem regressão. ✓

**4. Ordem:** T1 → T2 → T3 (dep T1+T2) → T4 → T5 (dep T4) → T6 → T7. T6/T7 independentes entre si; podem trocar. T4 é 2 constantes + 1 asserção (pequena). T3 é a maior.

---

## Execution Handoff

Plano salvo em `docs/superpowers/plans/2026-08-30-uazapi-onda-1c-ii-inbound-webhook.md`. Duas opções:

**1. Subagent-Driven (recomendado)** — subagente fresco por task, review entre tasks.

**2. Inline** — tasks nesta sessão com checkpoints.

Qual?
