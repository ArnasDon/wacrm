# Onda 1b-i — Plumbing de multi-conexão + transporte UAZAPI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar o caminho de envio pronto para duas conexões por account
— `TransportConnection` como união discriminada, `resolveConnection` em 3
níveis, eleição de `is_primary`, o sweep de `provider='meta'` nos call
sites Meta-específicos — e adicionar o transporte UAZAPI (`sendText` /
`sendMedia` / `sendReaction`) + a suíte de contrato. Sem superfície
UAZAPI visível ao usuário; nada cria linha `provider='uazapi'` ainda.

**Architecture:** `TransportConnection` vira `{provider:'meta', phoneNumberId}
| {provider:'uazapi', instanceId, baseUrl}`. `resolveConnection` resolve
conversa → `connectionId` → primária. `createUazapiTransport` faz `fetch`
direto contra `/send/text`, `/send/media`, `/message/react` do servidor
UAZAPI do operador. Uma suíte de contrato roda contra os dois transportes.
Zero migração — a 040 já criou todo o schema.

**Tech Stack:** TypeScript 6, Next.js 16.2.12 (App Router), Supabase JS
2.107, Vitest 4.1.10 (`environment: node`), `fetch` global. Prettier
(`semi: true`, `singleQuote: true`, `printWidth: 80`, `trailingComma:
es5`).

**Spec:** `docs/superpowers/specs/2026-08-28-uazapi-onda-1b-i-plumbing.md`
(spec-mãe: `docs/superpowers/specs/2026-08-27-uazapi-provider-design.md`
§4.2, §6; UAZAPI OpenAPI: `docs/uazapi-openapi-spec.yaml`)

## Global Constraints

- **Zero mudança observável para um account com só Meta.** Com uma linha
  Meta por account e nada arquivado: o sweep é no-op, `resolveConnection`
  resolve para a mesma linha primária, a eleição dá sempre `true`.
- **A suíte existente passa.** A única mudança permitida em testes é
  ajuste de forma: um `TransportConnection` literal / mock de
  `resolveConnection` que hoje é flat ganha a forma da variante
  (`provider: 'meta'` + `phoneNumberId`). **Exceção autorizada:** o teste
  `it('lança para um provider ainda não implementado')` em
  `providers/meta-transport.test.ts` — a 1b-i implementa `'uazapi'`, então
  esse teste passa a asseriar que `createTransport({…provider:'uazapi'})`
  devolve um transporte (Task 4).
- **Nenhuma migração.** Nenhum arquivo `supabase/migrations/*`.
- **Nenhuma env var nova, nenhuma rota nova, nenhuma mudança de UI.**
  Isso é 1b-ii. O transporte UAZAPI existe mas é inalcançável (nada
  resolve para uma conexão `uazapi`).
- **Sem `.eq('provider')` no caminho de envio.** `resolveConnection`
  resolve os 3 níveis e devolve qualquer provider; o `.eq('provider',
  'meta')` que a 1a colocou lá **sai**. Os call sites Meta-específicos
  (Task 6) é que ganham o filtro.
- Verificação: `npm test`, `npm run typecheck`, `npm run lint`,
  `npm run build`. `npx prettier --write <arquivos tocados>` antes de
  cada commit — **exceto** quando o arquivo não é prettier-clean no
  baseline e o reflow enterraria a mudança; nesse caso, diff cirúrgico
  (padrão das Ondas 1a Tasks 5/6).
- Baseline da suíte: **851 passando / 5 falhando** (locale/fuso
  pré-existente: `currency.test.ts` ×3, `dashboard/date-utils.test.ts`
  ×2). A 1b-i acrescenta testes que passam; as mesmas 5 seguem falhando.

---

## Estrutura de arquivos

**Criados**

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/whatsapp/providers/uazapi-transport.ts` | `createUazapiTransport(conn)` — `fetch` direto contra `/send/text`, `/send/media`, `/message/react`; `sendTemplate`/`sendInteractive` lançam `UnsupportedCapabilityError`. |
| `src/lib/whatsapp/providers/uazapi-transport.test.ts` | Mapeamento de corpo/resposta de cada método; os dois não-cobertos lançam. |
| `src/lib/whatsapp/providers/transport-contract.test.ts` | Suíte parametrizada rodada contra Meta e UAZAPI (spec-mãe §6). |

**Modificados**

| Arquivo | Mudança |
|---|---|
| `src/lib/whatsapp/providers/types.ts` | `TransportConnection` vira união discriminada por `provider`. |
| `src/lib/whatsapp/providers/meta-transport.ts` | `createMetaTransport` tipa o parâmetro como a variante `'meta'`. |
| `src/lib/whatsapp/providers/meta-transport.test.ts` | `conn` literal tipado como a variante; o teste "não implementado" vira "devolve transporte UAZAPI" (Task 4). |
| `src/lib/whatsapp/providers/index.ts` | `createTransport` ganha `case 'uazapi'`; o `default: throw` some. |
| `src/lib/whatsapp/resolve-connection.ts` | Resolução em 3 níveis; monta a variante certa; perde `.eq('provider','meta')`. |
| `src/lib/whatsapp/resolve-connection.test.ts` | Casos dos 3 níveis. |
| `src/app/api/whatsapp/config/route.ts` | INSERT: `is_primary: true` fixo → eleição por contagem. |
| **Sweep de provider** (Task 6): `webhook/route.ts`, `templates/[id]/route.ts`, `templates/submit/route.ts`, `templates/sync/route.ts`, `media/[mediaId]/route.ts`, `config/verify-registration/route.ts`, `resolve-conversation.ts`, `api/v1/contacts.ts`, `inbox/page.tsx`, `settings-overview.tsx`, `whatsapp-config.tsx`, e `config/route.ts` (só `+ .is('archived_at', null)`) | `+ .eq('provider','meta') + .is('archived_at', null)` em cada `.single()/.maybeSingle()` que filtra por `account_id`/`phone_number_id`. |

---

## Task 1: `TransportConnection` como união discriminada

**Files:**
- Modify: `src/lib/whatsapp/providers/types.ts`
- Modify: `src/lib/whatsapp/providers/meta-transport.ts`
- Modify: `src/lib/whatsapp/providers/meta-transport.test.ts`
- Modify: `src/lib/whatsapp/resolve-connection.ts` (só a forma do objeto de retorno — a lógica de 3 níveis é a Task 3)

**Interfaces:**
- Consumes: nada novo.
- Produces: `type TransportConnection = MetaConnection | UazapiConnection`,
  discriminado por `provider`. `createMetaTransport` recebe
  `MetaConnection`.

- [ ] **Step 1: `types.ts` — a união**

Substitua a `interface TransportConnection` (linhas ~30-42) por:

```ts
/**
 * Linha de conexão com a credencial JÁ DECRIPTADA. Produzida por
 * `resolveConnection()`; consumida só por transportes. União
 * discriminada por `provider` — cada variante carrega só os campos que
 * seu transporte usa.
 */
interface TransportConnectionBase {
  id: string;
  accountId: string;
  /** Meta: access token. UAZAPI: instance token. */
  credential: string;
}

export type TransportConnection =
  | (TransportConnectionBase & {
      provider: 'meta';
      /** `phone_number_id`. Sempre presente numa linha Meta real. */
      phoneNumberId: string;
    })
  | (TransportConnectionBase & {
      provider: 'uazapi';
      /** `uazapi_instance_id`. */
      instanceId: string;
      /** `uazapi_base_url` — raiz da API do servidor UAZAPI do operador. */
      baseUrl: string;
    });
```

Nada mais em `types.ts` muda (`WhatsAppTransport`,
`UnsupportedCapabilityError`, os `Transport*Args`).

- [ ] **Step 2: `meta-transport.ts` — tipar o parâmetro**

Na assinatura de `createMetaTransport` (linha ~71):

```ts
import type {
  TransportConnection,
  // ... resto igual
} from './types';

export function createMetaTransport(
  conn: Extract<TransportConnection, { provider: 'meta' }>
): WhatsAppTransport {
  const phoneNumberId = conn.phoneNumberId; // agora `string`
  if (!phoneNumberId) {
    throw new Error('Meta transport requires a phone_number_id');
  }
  // ... resto idêntico
}
```

O `if (!phoneNumberId) throw` fica — vira guarda defensiva contra
`''` (a variante garante não-`null`, não não-vazio). Nada mais no
arquivo muda.

- [ ] **Step 3: `resolve-connection.ts` — o objeto de retorno**

Só a montagem do retorno (linhas ~76-84). Troque:

```ts
  return {
    id: config.id,
    accountId,
    // Backfill da 040: toda linha existente é 'meta'. ...
    provider: 'meta',
    phoneNumberId: config.phone_number_id ?? null,
    credential,
  };
```

por:

```ts
  return {
    id: config.id,
    accountId,
    credential,
    provider: 'meta',
    phoneNumberId: config.phone_number_id ?? '',
  };
```

(A resolução de 3 níveis e a variante `uazapi` vêm na Task 3. Nesta task
`resolveConnection` ainda tem o `.eq('provider','meta').single()` e só
devolve a variante `meta`.)

- [ ] **Step 4: `meta-transport.test.ts` — o literal**

O `const conn: TransportConnection = { ... }` (linha ~20) já tem
`provider: 'meta'` e `phoneNumberId`; com a união ele passa a casar a
variante `meta` sem mudança de valor. Se o typecheck reclamar de um
campo a mais/menos, ajuste **a forma, não o valor**. **Não** toque no
teste `it('lança para um provider ainda não implementado')` — Task 4.

- [ ] **Step 5: typecheck + suíte**

Run: `npm run typecheck`
Expected: erros **apenas** onde algo lê `conn.phoneNumberId` sem
estreitar `provider` primeiro. Pelo grep de baseline, o único consumidor
de `TransportConnection.phoneNumberId` é `meta-transport.ts` (tratado no
Step 2). Se o typecheck acusar outro arquivo, pare e reporte — é um call
site que o plano não previu.

Run: `npm test -- src/lib/whatsapp/providers`
Expected: PASS, contagem inalterada.

- [ ] **Step 6: Commit**

```bash
npx prettier --write src/lib/whatsapp/providers/types.ts src/lib/whatsapp/providers/meta-transport.ts src/lib/whatsapp/providers/meta-transport.test.ts src/lib/whatsapp/resolve-connection.ts
git add src/lib/whatsapp/providers/types.ts src/lib/whatsapp/providers/meta-transport.ts src/lib/whatsapp/providers/meta-transport.test.ts src/lib/whatsapp/resolve-connection.ts
git commit -m "refactor(whatsapp): TransportConnection becomes a discriminated union"
```

---

## Task 2: Eleição de `is_primary`

**Files:**
- Modify: `src/app/api/whatsapp/config/route.ts`

**Interfaces:**
- Consumes: nada.
- Produces: nada novo. Contrato HTTP inalterado (`is_primary` nunca
  entra num corpo de resposta).

> Não há `route.test.ts` para esta rota. Verificação = typecheck +
> leitura.

- [ ] **Step 1: Contagem antes do INSERT**

No handler `POST`, no ramo `else` que faz o INSERT (linhas ~397-413),
antes do `.insert({...})`:

```ts
    } else {
      // Primeira conexão não-arquivada do account (qualquer provider) =
      // primária. As seguintes entram como não-primária; a promoção é
      // via PATCH /api/whatsapp/connections/[id] (Onda 1b-ii). Na 1b-i
      // nenhuma linha `uazapi` existe, então isto é sempre `true`.
      const { count: existingCount } = await supabase
        .from('whatsapp_connections')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId)
        .is('archived_at', null);

      const { error: insertError } = await supabase
        .from('whatsapp_connections')
        .insert({
          account_id: accountId,
          user_id: user.id,
          provider: 'meta',
          is_primary: (existingCount ?? 0) === 0,
          ...baseRow,
        });
```

O comentário `// Insert with both columns...` existente é substituído
pelo novo. O `UPDATE` de config existente (ramo `if`) **não** toca
`is_primary`.

- [ ] **Step 2: typecheck + suíte**

Run: `npm run typecheck`
Expected: limpo.

Run: `npm test`
Expected: **851 / 5** — nada exercita esta rota.

- [ ] **Step 3: Commit**

```bash
npx prettier --write src/app/api/whatsapp/config/route.ts
git add src/app/api/whatsapp/config/route.ts
git commit -m "fix(whatsapp): config route elects is_primary by connection count"
```

---

## Task 3: `resolveConnection` em 3 níveis

**Files:**
- Modify: `src/lib/whatsapp/resolve-connection.ts`
- Modify: `src/lib/whatsapp/resolve-connection.test.ts`

**Interfaces:**
- Consumes: `TransportConnection` união (Task 1).
- Produces: `resolveConnection(db, accountId, options)` — **mesma
  assinatura**; resolve conversa → `connectionId` → primária; devolve a
  variante conforme `row.provider`.

- [ ] **Step 1: Reescrever o corpo de `resolveConnection`**

Substitua o corpo inteiro da função (do `const { data: config, error }`
até o `return`) por:

```ts
export async function resolveConnection(
  db: SupabaseClient,
  accountId: string,
  options: ResolveConnectionOptions = {}
): Promise<TransportConnection> {
  // Nível 1: a conexão da conversa de origem, se houver e não for NULL.
  let targetId: string | undefined;
  if (options.conversationId) {
    const { data: conv } = await db
      .from('conversations')
      .select('connection_id')
      .eq('id', options.conversationId)
      .eq('account_id', accountId)
      .maybeSingle();
    if (conv?.connection_id) targetId = conv.connection_id as string;
  }
  // Nível 2: connectionId explícito.
  if (!targetId && options.connectionId) targetId = options.connectionId;

  // Carrega o alvo (nível 1/2) ou a primária (nível 3).
  const query = db
    .from('whatsapp_connections')
    .select('*')
    .eq('account_id', accountId)
    .is('archived_at', null);
  const { data: row } = targetId
    ? await query.eq('id', targetId).maybeSingle()
    : await query.eq('is_primary', true).maybeSingle();

  // Alvo que não carregou (arquivado / id inválido) → cai para a primária.
  const resolved =
    row ??
    (targetId
      ? (
          await db
            .from('whatsapp_connections')
            .select('*')
            .eq('account_id', accountId)
            .is('archived_at', null)
            .eq('is_primary', true)
            .maybeSingle()
        ).data
      : null);

  if (!resolved) {
    throw new SendMessageError(
      'whatsapp_not_configured',
      'WhatsApp not configured. Please set up your WhatsApp integration first.',
      400,
      { reason: 'not_configured' }
    );
  }

  const credential = decrypt(resolved.credential);

  // Auto-cura de ciphertexts CBC legados. Fire-and-forget, idempotente.
  if (options.selfHeal && isLegacyFormat(resolved.credential)) {
    void db
      .from('whatsapp_connections')
      .update({ credential: encrypt(credential) })
      .eq('id', resolved.id)
      .then(
        ({ error: upgradeError }: { error: { message: string } | null }) => {
          if (upgradeError) {
            console.warn(
              '[resolve-connection] credential GCM upgrade failed:',
              upgradeError.message
            );
          }
        }
      );
  }

  if (resolved.provider === 'uazapi') {
    return {
      id: resolved.id,
      accountId,
      credential,
      provider: 'uazapi',
      instanceId: resolved.uazapi_instance_id,
      baseUrl: resolved.uazapi_base_url,
    };
  }
  return {
    id: resolved.id,
    accountId,
    credential,
    provider: 'meta',
    phoneNumberId: resolved.phone_number_id ?? '',
  };
}
```

Atualize o comentário de cabeçalho (linhas ~1-9) para o presente: a
resolução em 3 níveis existe; a variante `uazapi` é montada aqui.

- [ ] **Step 2: `resolve-connection.test.ts` — casos novos**

O mock atual (`configDb(row, captured)`) devolve uma linha para
qualquer `.from('whatsapp_connections')`. Para os 3 níveis o fake
precisa distinguir `conversations` de `whatsapp_connections` e responder
a `.eq('id', …)` vs `.eq('is_primary', true)`. Reescreva o helper de
mock com um builder que acumula os `.eq()`/`.is()` e resolve conforme
linhas passadas ao helper. Esqueleto (adapte ao estilo do arquivo):

```ts
function db({
  conversations = {},
  connections = [],
  captured = { updates: [] as Record<string, unknown>[] },
}: {
  conversations?: Record<string, { connection_id: string | null }>;
  connections?: Array<Record<string, unknown>>;
  captured?: { updates: Record<string, unknown>[] };
}) {
  return {
    from(table: string) {
      const filt: Record<string, unknown> = {};
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (k: string, v: unknown) => ((filt[k] = v), b),
        is: (k: string, v: unknown) => ((filt[`${k}__is`] = v), b),
        update: (patch: Record<string, unknown>) => (
          captured.updates.push(patch), b
        ),
        then: (r: (x: unknown) => unknown) =>
          Promise.resolve({ error: null }).then(r),
        maybeSingle: async () => {
          if (table === 'conversations') {
            return {
              data: conversations[filt.id as string] ?? null,
              error: null,
            };
          }
          const row = connections.find(
            (r) =>
              (filt.id === undefined || r.id === filt.id) &&
              (filt.account_id === undefined ||
                r.account_id === filt.account_id) &&
              (filt.is_primary === undefined ||
                r.is_primary === filt.is_primary) &&
              r.archived_at == null
          );
          return { data: row ?? null, error: null };
        },
      };
      return b;
    },
  } as unknown as import('@supabase/supabase-js').SupabaseClient;
}
```

O mock de `@/lib/whatsapp/encryption` fica igual ao de hoje. Casos:

1. **Primária** — sem `conversationId`/`connectionId`: devolve a linha
   `is_primary=true`, monta a variante `meta` com a credencial
   decriptada (o teste "devolve a conexão com a credencial decriptada"
   de hoje, adaptado).
2. **Por conversa** — `conversationId` cuja conversa tem
   `connection_id = 'cfg-uaz'`, e `cfg-uaz` é `provider='uazapi'`:
   devolve a variante `uazapi` (`instanceId`, `baseUrl`, `credential`).
3. **`connection_id` NULL** — `conversationId` cuja conversa tem
   `connection_id = null`: cai para a primária.
4. **Alvo arquivado** — `connectionId` de uma linha com `archived_at`
   setado: cai para a primária.
5. **`connectionId` explícito** válido, sem `conversationId`: devolve
   essa conexão.
6. **Nenhuma** — nenhuma linha: `rejects` com `SendMessageError`,
   `code === 'whatsapp_not_configured'`, `status === 400`,
   `reason === 'not_configured'`, mensagem idêntica.
7. **self-heal** — mantém os dois casos de hoje (on grava
   `{ credential: 'encrypted:decrypted:legacy-cipher' }`, off não
   grava), agora keyed na linha resolvida.

- [ ] **Step 3: Rodar**

Run: `npm test -- src/lib/whatsapp/resolve-connection.test.ts`
Expected: PASS, todos os casos.

Run: `npm run typecheck`
Expected: limpo.

Run: `npm test`
Expected: **851 + N** passando / 5 falhando, onde N são os casos novos.
Se um teste **existente** de outro arquivo (que mocka `resolveConnection`
ou monta a conexão) quebrar, é ajuste de forma da variante — trate;
se for asserção de comportamento, pare e reporte.

- [ ] **Step 4: Commit**

```bash
npx prettier --write src/lib/whatsapp/resolve-connection.ts src/lib/whatsapp/resolve-connection.test.ts
git add src/lib/whatsapp/resolve-connection.ts src/lib/whatsapp/resolve-connection.test.ts
git commit -m "feat(whatsapp): resolveConnection resolves conversation → explicit → primary"
```

---

## Task 4: Transporte UAZAPI + ramo no `createTransport`

**Files:**
- Create: `src/lib/whatsapp/providers/uazapi-transport.ts`
- Create: `src/lib/whatsapp/providers/uazapi-transport.test.ts`
- Modify: `src/lib/whatsapp/providers/index.ts`
- Modify: `src/lib/whatsapp/providers/meta-transport.test.ts` (o teste "não implementado")

**Interfaces:**
- Consumes: `Extract<TransportConnection, { provider: 'uazapi' }>` (Task
  1); `WhatsAppTransport`, `UnsupportedCapabilityError`,
  `Transport*Args`, `TransportResult` de `./types`; `MediaKind` de
  `@/lib/whatsapp/meta-api` (`'image'|'video'|'document'|'audio'`).
- Produces: `createUazapiTransport(conn): WhatsAppTransport`.

- [ ] **Step 1: Ler os schemas da UAZAPI**

Em `docs/uazapi-openapi-spec.yaml`, leia (linhas aproximadas):
- `securitySchemes` (~54) — a auth de envio é o header `token: <instance
  token>`.
- `/send/text` (~4139) — body `{ number, text, replyid? }`; 200 é
  `allOf: [Message, { response: { status } }]`. **Ache o campo do id da
  mensagem enviada** no schema `Message` (procure `messageid` / o
  exemplo do 200) e use o nome real.
- `/send/media` (~4480) — body `{ number, type, file, text?, docName? }`;
  `type` ∈ `image|video|document|audio|...`; `file` = URL ou base64;
  `text` = caption.
- `/message/react` (~7801) — body `{ number, text: <emoji>, id:
  <targetMessageId> }`; resposta `{ success, message, reaction: { id,
  ... } }`.

Anote no report os campos exatos que você vai usar.

- [ ] **Step 2: Escrever `uazapi-transport.ts`**

```ts
// ============================================================
// Transporte UAZAPI (API não-oficial, conexão por QR).
//
// `fetch` direto contra os 3 endpoints de envio do servidor UAZAPI do
// operador. Sem retry de variante de telefone (gambiarra da Meta). Sem
// templates nem interativo nas Ondas 1–2 — a API tem `/send/menu` mas o
// transporte declara `interactive: false` até a Onda 3 implementá-lo.
// `fetchMedia` (inbound) entra na Onda 1c com a interface.
// ============================================================

import type { MediaKind } from '@/lib/whatsapp/meta-api';
import {
  UnsupportedCapabilityError,
  type TransportConnection,
  type TransportMediaArgs,
  type TransportReactionArgs,
  type TransportResult,
  type TransportTextArgs,
  type WhatsAppTransport,
} from './types';

type UazapiConnection = Extract<TransportConnection, { provider: 'uazapi' }>;

// MediaKind ('image'|'video'|'document'|'audio') já bate com os `type`
// da UAZAPI 1:1. Mapa explícito para não depender do acaso.
const MEDIA_TYPE: Record<MediaKind, string> = {
  image: 'image',
  video: 'video',
  document: 'document',
  audio: 'audio',
};

export function createUazapiTransport(
  conn: UazapiConnection
): WhatsAppTransport {
  const base = conn.baseUrl.replace(/\/$/, '');

  async function call(
    path: string,
    body: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        token: conn.credential,
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!res.ok) {
      const msg =
        (json.error as string) ||
        (json.message as string) ||
        `UAZAPI ${path} failed (${res.status})`;
      throw new Error(msg);
    }
    return json;
  }

  // AJUSTE o caminho do id conforme o schema Message lido no Step 1.
  const messageId = (json: Record<string, unknown>): string =>
    (json.messageid as string) ??
    (json.id as string) ??
    ((json.message as Record<string, unknown> | undefined)?.id as string) ??
    '';

  return {
    provider: 'uazapi',
    capabilities: {
      templates: false,
      media: true,
      reactions: true,
      interactive: false,
    },

    async sendText(args: TransportTextArgs): Promise<TransportResult> {
      const json = await call('/send/text', {
        number: args.to,
        text: args.text,
        ...(args.replyToProviderMessageId
          ? { replyid: args.replyToProviderMessageId }
          : {}),
      });
      return { providerMessageId: messageId(json) };
    },

    async sendMedia(args: TransportMediaArgs): Promise<TransportResult> {
      const json = await call('/send/media', {
        number: args.to,
        type: MEDIA_TYPE[args.mediaKind],
        file: args.link,
        ...(args.caption ? { text: args.caption } : {}),
        ...(args.filename ? { docName: args.filename } : {}),
        ...(args.replyToProviderMessageId
          ? { replyid: args.replyToProviderMessageId }
          : {}),
      });
      return { providerMessageId: messageId(json) };
    },

    async sendReaction(
      args: TransportReactionArgs
    ): Promise<TransportResult> {
      const json = await call('/message/react', {
        number: args.to,
        text: args.emoji,
        id: args.targetProviderMessageId,
      });
      // Uma reação não gera mensagem endereçável nova; devolve o id-alvo
      // (o caller não persiste este valor — paridade com o transporte Meta).
      const reaction = json.reaction as Record<string, unknown> | undefined;
      return {
        providerMessageId:
          (reaction?.id as string) ?? args.targetProviderMessageId,
      };
    },

    sendTemplate(): Promise<TransportResult> {
      throw new UnsupportedCapabilityError('uazapi', 'templates');
    },
    sendInteractive(): Promise<TransportResult> {
      throw new UnsupportedCapabilityError('uazapi', 'interactive');
    },
  };
}
```

> Se o Step 1 mostrar que o id vem noutro campo, corrija `messageId()`.
> Se a auth não for o header `token`, corrija `call()`.

- [ ] **Step 3: `index.ts` — o ramo**

```ts
import { createMetaTransport } from './meta-transport';
import { createUazapiTransport } from './uazapi-transport';
import type { TransportConnection, WhatsAppTransport } from './types';

export * from './types';
export { createMetaTransport } from './meta-transport';
export { createUazapiTransport } from './uazapi-transport';

export function createTransport(conn: TransportConnection): WhatsAppTransport {
  switch (conn.provider) {
    case 'meta':
      return createMetaTransport(conn);
    case 'uazapi':
      return createUazapiTransport(conn);
  }
}
```

O `default: throw` some — a união é exaustiva (`meta | uazapi`), o
typecheck garante.

- [ ] **Step 4: `uazapi-transport.test.ts`**

`vi.stubGlobal('fetch', vi.fn())`. `const conn` = variante `uazapi`
(`{ id, accountId, provider: 'uazapi', credential: 'tok', instanceId:
'i-1', baseUrl: 'https://uazapi.example' }`). Casos:

1. `capabilities` = `{ templates:false, media:true, reactions:true,
   interactive:false }`; `provider === 'uazapi'`.
2. `sendText({to:'5511…', text:'oi'})` → `fetch` chamado com
   `https://uazapi.example/send/text`, header `token: 'tok'`, body
   `{ number:'5511…', text:'oi' }`; devolve
   `{ providerMessageId: <id da resposta mockada> }`,
   `normalizedRecipient` undefined.
3. `sendText` com `replyToProviderMessageId` → body inclui `replyid`.
4. `sendMedia({to, mediaKind:'image', link:'https://x/y.jpg', caption:'c',
   filename:'y.jpg'})` → body `{ number, type:'image', file:'https://x/y.jpg',
   text:'c', docName:'y.jpg' }`.
5. `sendReaction({to, targetProviderMessageId:'m-1', emoji:'👍'})` → body
   `{ number, text:'👍', id:'m-1' }`.
6. `fetch` devolve `{ ok:false, status:400, json:()=>({error:'Missing number'}) }`
   → `sendText` rejeita com `Error('Missing number')`.
7. `sendTemplate()` lança `UnsupportedCapabilityError` com
   `provider==='uazapi'`, `capability==='templates'`.
8. `sendInteractive()` lança idem com `capability==='interactive'`.

- [ ] **Step 5: `meta-transport.test.ts` — o teste "não implementado"**

O teste `it('lança para um provider ainda não implementado')` (linha
~117) assere que `createTransport({ ...conn, provider: 'uazapi' })`
lança. A 1b-i implementa `'uazapi'`. Troque por:

```ts
  it('devolve o transporte UAZAPI para provider="uazapi"', () => {
    const uaz = createTransport({
      id: 'cfg-2',
      accountId: 'acct-1',
      credential: 'tok',
      provider: 'uazapi',
      instanceId: 'i-1',
      baseUrl: 'https://uazapi.example',
    });
    expect(uaz.provider).toBe('uazapi');
    expect(uaz.capabilities.templates).toBe(false);
  });
```

- [ ] **Step 6: Rodar**

Run: `npm test -- src/lib/whatsapp/providers`
Expected: PASS.

Run: `npm run typecheck && npm run lint`
Expected: limpos.

- [ ] **Step 7: Commit**

```bash
npx prettier --write src/lib/whatsapp/providers/uazapi-transport.ts src/lib/whatsapp/providers/uazapi-transport.test.ts src/lib/whatsapp/providers/index.ts src/lib/whatsapp/providers/meta-transport.test.ts
git add src/lib/whatsapp/providers/
git commit -m "feat(whatsapp): UAZAPI transport (text, media, reaction)"
```

---

## Task 5: Suíte de contrato de transporte

**Files:**
- Create: `src/lib/whatsapp/providers/transport-contract.test.ts`

**Interfaces:**
- Consumes: `createMetaTransport`, `createUazapiTransport`,
  `UnsupportedCapabilityError`, `WhatsAppTransport` de `./`; os mocks de
  `@/lib/whatsapp/meta-api` e `fetch`.

- [ ] **Step 1: Escrever a suíte parametrizada**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendTextMessage = vi.fn();
const sendMediaMessage = vi.fn();
const sendReactionMessage = vi.fn();
vi.mock('@/lib/whatsapp/meta-api', async (io) => ({
  ...(await io<Record<string, unknown>>()),
  sendTextMessage: (...a: unknown[]) => sendTextMessage(...a),
  sendMediaMessage: (...a: unknown[]) => sendMediaMessage(...a),
  sendReactionMessage: (...a: unknown[]) => sendReactionMessage(...a),
}));

import { createMetaTransport } from './meta-transport';
import { createUazapiTransport } from './uazapi-transport';
import { UnsupportedCapabilityError } from './types';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const CASES = [
  {
    name: 'meta',
    make: () =>
      createMetaTransport({
        id: 'c1',
        accountId: 'a1',
        credential: 'tok',
        provider: 'meta',
        phoneNumberId: 'pn-1',
      }),
    arm: () => {
      sendTextMessage.mockResolvedValue({ messageId: 'wamid.1' });
      sendMediaMessage.mockResolvedValue({ messageId: 'wamid.2' });
      sendReactionMessage.mockResolvedValue({ messageId: 'wamid.3' });
    },
  },
  {
    name: 'uazapi',
    make: () =>
      createUazapiTransport({
        id: 'c2',
        accountId: 'a1',
        credential: 'tok',
        provider: 'uazapi',
        instanceId: 'i-1',
        baseUrl: 'https://uaz.example',
      }),
    arm: () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ messageid: 'uaz.1' }),
      });
    },
  },
] as const;

describe.each(CASES)('contrato de transporte — $name', ({ make, arm }) => {
  beforeEach(() => {
    sendTextMessage.mockReset();
    sendMediaMessage.mockReset();
    sendReactionMessage.mockReset();
    fetchMock.mockReset();
    arm();
  });

  it('expõe provider e as 4 capacidades booleanas', () => {
    const t = make();
    expect(typeof t.provider).toBe('string');
    for (const k of ['templates', 'interactive', 'reactions', 'media'] as const) {
      expect(typeof t.capabilities[k]).toBe('boolean');
    }
  });

  it('sendText devolve { providerMessageId: string, normalizedRecipient? }', async () => {
    const r = await make().sendText({ to: '5511999998888', text: 'oi' });
    expect(typeof r.providerMessageId).toBe('string');
    expect(r.providerMessageId.length).toBeGreaterThan(0);
    expect(
      r.normalizedRecipient === undefined ||
        typeof r.normalizedRecipient === 'string'
    ).toBe(true);
  });

  it('cada método coberto por capabilities faz uma chamada e devolve id; cada não-coberto lança UnsupportedCapabilityError', async () => {
    const t = make();
    const caps = t.capabilities;

    if (caps.media) {
      const r = await t.sendMedia({
        to: '5511999998888',
        mediaKind: 'image',
        link: 'https://x/y.jpg',
      });
      expect(typeof r.providerMessageId).toBe('string');
    }
    if (caps.reactions) {
      const r = await t.sendReaction({
        to: '5511999998888',
        targetProviderMessageId: 'm-1',
        emoji: '👍',
      });
      expect(typeof r.providerMessageId).toBe('string');
    }
    if (!caps.templates) {
      expect(() =>
        t.sendTemplate({ to: '5511999998888', templateName: 'x' })
      ).toThrow(UnsupportedCapabilityError);
    }
    if (!caps.interactive) {
      expect(() =>
        t.sendInteractive({
          to: '5511999998888',
          payload: { kind: 'buttons', body: 'b', buttons: [] } as never,
        })
      ).toThrow(UnsupportedCapabilityError);
    }
  });
});
```

> Ajuste os campos de resposta mockados (`messageId` vs `messageid`,
> `.reaction.id`) conforme o que as Tasks 4 leram da API real.

- [ ] **Step 2: Rodar**

Run: `npm test -- src/lib/whatsapp/providers/transport-contract.test.ts`
Expected: PASS nos dois parâmetros.

- [ ] **Step 3: Commit**

```bash
npx prettier --write src/lib/whatsapp/providers/transport-contract.test.ts
git add src/lib/whatsapp/providers/transport-contract.test.ts
git commit -m "test(whatsapp): transport contract suite over both providers"
```

---

## Task 6: Sweep de `provider='meta'` + `archived_at IS NULL`

**Files:**
- Modify: `src/app/api/whatsapp/webhook/route.ts`
- Modify: `src/app/api/whatsapp/templates/[id]/route.ts`
- Modify: `src/app/api/whatsapp/templates/submit/route.ts`
- Modify: `src/app/api/whatsapp/templates/sync/route.ts`
- Modify: `src/app/api/whatsapp/media/[mediaId]/route.ts`
- Modify: `src/app/api/whatsapp/config/verify-registration/route.ts`
- Modify: `src/app/api/whatsapp/config/route.ts` (só `+ .is('archived_at', null)`)
- Modify: `src/lib/whatsapp/resolve-conversation.ts`
- Modify: `src/lib/api/v1/contacts.ts`
- Modify: `src/app/(dashboard)/inbox/page.tsx`
- Modify: `src/components/settings/settings-overview.tsx`
- Modify: `src/components/settings/whatsapp-config.tsx`
- Modify: os `.test.ts` correspondentes que mockam `whatsapp_connections`
  (`webhook/route.test.ts`, `resolve-conversation.test.ts`) — só se um
  teste passar a falhar por causa do filtro; o mock ignora `.eq()`
  desconhecido na maioria dos casos.

**Interfaces:**
- Consumes: nada.
- Produces: nada. **Zero mudança de comportamento** — com uma linha Meta
  por account e nada arquivado, os filtros são no-op.

- [ ] **Step 1: A transformação, por arquivo**

Para cada `.from('whatsapp_connections')…` que termina em `.single()` ou
`.maybeSingle()` e filtra por `account_id` (ou por `phone_number_id`),
acrescente na cadeia, **antes** do terminador:

```ts
  .eq('provider', 'meta')
  .is('archived_at', null)
```

Sites confirmados por grep:
- `config/route.ts`: linhas ~89 (GET), ~224 (claimed, por
  `phone_number_id`), ~288 (existing), ~385 (UPDATE), ~485 (DELETE) — as
  4 primeiras já têm `.eq('provider','meta')` (1a); só falta
  `.is('archived_at', null)`. A ~224 ganha as duas (`.eq('provider',
  'meta')` também — `phone_number_id` já é Meta-only, é defesa em
  profundidade). O INSERT (~405) não é query, não muda.
- `webhook/route.ts`: ~117 (`select('id, verify_token')`, GET verify —
  **sem** `account_id`; ganha só `.eq('provider','meta')`), ~150, ~267
  (por `phone_number_id`).
- `templates/[id]/route.ts` ~142, ~282; `templates/submit/route.ts`
  ~142; `templates/sync/route.ts` ~139; `media/[mediaId]/route.ts` ~53;
  `verify-registration/route.ts` ~59; `resolve-conversation.ts` ~59;
  `contacts.ts` ~78 (`resolveAuditUserId`); `inbox/page.tsx` ~204;
  `settings-overview.tsx` ~125; `whatsapp-config.tsx` ~124, ~215.

`resolve-connection.ts` **não** entra (Task 3 já resolveu por 3 níveis).

- [ ] **Step 2: Prettier — só onde não enterra a mudança**

Rode `npx prettier --check` em cada arquivo tocado. Onde já é
prettier-clean, `--write` normal. Onde não é (rotas antigas sem `;`),
**diff cirúrgico** — não rode `--write` (padrão das Tasks 5/6 da 1a).

- [ ] **Step 3: Rodar**

Run: `npm test`
Expected: **851 / 5 + os N das Tasks 3-5**. Zero regressão. Se um teste
que mocka `whatsapp_connections` quebrar, o fake builder não está
ignorando `.eq('provider')`/`.is('archived_at')` — ajuste o fake (não a
asserção).

Run: `npm run typecheck && npm run lint`
Expected: limpos.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(whatsapp): scope the Meta-specific call sites to provider=meta, non-archived"
```

---

## Task 7: Portão de aceite da 1b-i

**Files:** nenhum.

- [ ] **Step 1: Grep — sem `.eq('provider')` no caminho de envio; com filtro nos demais**

Run: `git grep -n "\.from('whatsapp_connections')" -- 'src/**' ':!*.test.*'`
Confira, arquivo por arquivo:
- `resolve-connection.ts` — **sem** `.eq('provider', …)` (resolve os 3
  níveis).
- Todo o resto que faz `.single()`/`.maybeSingle()` — **com**
  `.eq('provider', 'meta')` e `.is('archived_at', null)`.

- [ ] **Step 2: Suíte, typecheck, lint, build**

Run: `npm test`
Expected: **851 + N passando / 5 falhando** (as 5 de baseline). Nenhum
teste existente mudou de resultado, exceto o de "provider não
implementado" (agora "devolve transporte UAZAPI").

Run: `npm run typecheck` — limpo.
Run: `npm run lint` — 0 erros.
Run: `npm run build` — sucesso.

- [ ] **Step 3: Diff de testes vs `main`**

Run: `git diff main --stat -- '*.test.ts' '*.test.tsx'`
Expected: `uazapi-transport.test.ts` + `transport-contract.test.ts`
novos; `resolve-connection.test.ts` reescrito (3 níveis);
`meta-transport.test.ts` com a troca autorizada do teste
"não implementado"; ajustes de forma de variante onde outro teste monta
um `TransportConnection`. **Nenhuma outra asserção de comportamento
mudou.**

- [ ] **Step 4: Relatório final**

Contagem antes/depois, saída dos greps, lista de arquivos vs a Estrutura
de arquivos.

---

## Follow-ups (1b-ii / 1c — registrar)

- **1b-ii:** env `UAZAPI_BASE_URL`/`UAZAPI_ADMIN_TOKEN`; client de
  provisionamento; as 6 rotas `/api/whatsapp/connections/*`; card de
  Settings + QR; `PATCH` de `is_primary`/`label`/`mirror_inbound_media`;
  segredo de webhook (gerar + hash); envio provado por
  `POST /api/v1/messages`.
- **1c:** `SET NOT NULL` em `conversations.connection_id` + `ON DELETE
  RESTRICT` (com os paths de criação de conversa); `fetchMedia` na
  interface + nos dois transportes; pipeline de inbound; inbox (selo de
  canal, composer por `capabilities`).
- **Onda 3:** `sendTemplate`/`sendInteractive` reais na UAZAPI
  (`/send/menu`, `/send/carousel`); broadcast UAZAPI.
