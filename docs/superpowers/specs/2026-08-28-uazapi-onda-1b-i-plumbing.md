# Onda 1b-i — Plumbing de multi-conexão + transporte UAZAPI

**Data:** 2026-08-28
**Status:** design aprovado, aguardando plano de implementação
**Spec-mãe:** `docs/superpowers/specs/2026-08-27-uazapi-provider-design.md`
(§4.2 seam/capacidades, §6 estratégia de testes)
**Spec 1a:** `docs/superpowers/specs/2026-08-28-uazapi-onda-1a-migracao-040.md`
(a 040 já criou todo o schema que esta leva usa)

---

## 1. Contexto

A Onda 1 da spec-mãe ("migração 040 + conexão por QR + inbox") foi
decomposta em três sub-levas na sessão de brainstorming de 2026-08-28:

| Sub-leva | Conteúdo | Estado |
|---|---|---|
| **1a** | Migração 040 — rename `whatsapp_config` → `whatsapp_connections` | **mergeada** (PR #2) |
| **1b** | Transporte UAZAPI + provisionamento + QR + envio provado por API | decomposta em 1b-i / 1b-ii |
| **1c** | Pipeline de inbound + inbox (selo de canal, composer por `capabilities`) | própria spec |

E a **1b** foi dividida em:

| Sub-leva | Conteúdo | Merge |
|---|---|---|
| **1b-i** (esta) | Plumbing de multi-conexão (sweep de provider, eleição de `is_primary`, `resolveConnection` em 3 níveis, união `TransportConnection`) + o transporte UAZAPI + a suíte de contrato | Sozinha. Invisível ao usuário — nada cria linha `provider='uazapi'` ainda. |
| **1b-ii** | Env vars `UAZAPI_*`, client da API UAZAPI, as 6 rotas `/api/whatsapp/connections/*`, card de Settings + fluxo de QR, envio provado por `POST /api/v1/messages` real, geração/hash do segredo de webhook | Sozinha. |

A **fronteira 1b/1c** (decisão do brainstorming): 1b entrega
provisionamento + transporte + envio provado por chamada de API; **inbox
e inbound são 1c**. Não há afordância de "nova conversa" na inbox deste
repo — mandar a 1ª mensagem para um número novo é via API pública, e é
assim que a 1b-ii prova o envio.

O usuário tem `UAZAPI_ADMIN_TOKEN` do servidor, então o fluxo de
provisionamento da spec-mãe §4.4 (o CRM cria instâncias via
`POST /instance/create`, o usuário nunca vê token) vale como está — mas
isso é 1b-ii.

---

## 2. Escopo

### Entrega

1. **Sweep de provider** nos ~12 arquivos que a 1a deixou com rename
   puro: `.eq('provider', 'meta')` + `.is('archived_at', null)` em cada
   `.from('whatsapp_connections')…single()/.maybeSingle()` que filtra por
   `account_id` (ou `phone_number_id`). São todas superfícies
   Meta-específicas (config, templates, verificação de registro, webhook
   por `phone_number_id`) — continuam Meta-scoped.
2. **Eleição de `is_primary`** em `config/route.ts`: o INSERT para de
   setar `is_primary: true` incondicional; passa a `is_primary =
   (contagem de conexões não-arquivadas do account) === 0`.
3. **`resolveConnection` em 3 níveis** (`resolve-connection.ts`, mesma
   assinatura): conversa → `connectionId` explícito → primária. Perde o
   `.eq('provider', 'meta')` que a 1a adicionou.
4. **`TransportConnection` como união discriminada** por `provider`.
5. **Transporte UAZAPI** — `providers/uazapi-transport.ts`:
   `createUazapiTransport(conn)` com `sendText`, `sendMedia`,
   `sendReaction`; `sendTemplate`/`sendInteractive` lançam
   `UnsupportedCapabilityError`; capacidades `{templates: false,
   media: true, reactions: true, interactive: false}`. Ramo `'uazapi'`
   no `createTransport`.
6. **Suíte de contrato de transporte** (spec-mãe §6) — uma suíte
   parametrizada rodada contra Meta e UAZAPI.

### Defere para a 1b-ii

Env vars `UAZAPI_BASE_URL` / `UAZAPI_ADMIN_TOKEN`; o **client de
provisionamento** da API UAZAPI (`instance/create`, `instance/connect`,
`instance/status`, `instance/disconnect`, `DELETE /instance`, registro
de `POST /webhook`); as 6 rotas `/api/whatsapp/connections/*`; o card de
Settings + QR + polling; a promoção de `is_primary` via `PATCH`; o
toggle de `mirror_inbound_media` por conexão; geração e hash do segredo
de webhook; o envio provado por `POST /api/v1/messages`.

Nota: o transporte UAZAPI da 1b-i faz `fetch` direto contra os 3
endpoints de envio (`/send/text`, `/send/media`, `/message/react`) — não
depende do client de provisionamento. A 1b-ii pode extrair um client
compartilhado se fizer sentido, mas não é pré-requisito.

### Defere para a 1c

`SET NOT NULL` em `conversations.connection_id` + `ON DELETE RESTRICT`
(pacote com os paths de criação de conversa do inbound); `fetchMedia` na
interface `WhatsAppTransport` e na implementação de cada transporte; o
pipeline de inbound; qualquer mudança de inbox.

### Fora (Onda 3+)

`sendTemplate`/`sendInteractive` reais na UAZAPI (`/send/menu`,
`/send/carousel`); broadcast por UAZAPI.

---

## 3. Arquitetura

### 3.1 Sweep de provider

Os call sites confirmados por grep (`.from('whatsapp_connections')` em
`src/`, não-comentário, não-teste), com a transformação por site:

| Arquivo | Ocorrências | Transformação |
|---|---|---|
| `src/app/api/whatsapp/config/route.ts` | 89, 224, 288, 385, 405, 485 | 4 já têm `.eq('provider','meta')` (1a Task 4) — só acrescentar `.is('archived_at', null)`. O check "claimed" (224, por `phone_number_id`) ganha `.is('archived_at', null)`. |
| `src/app/api/whatsapp/webhook/route.ts` | 117, 150, 267 | `+ .eq('provider','meta') + .is('archived_at', null)` |
| `src/app/api/whatsapp/templates/[id]/route.ts` | 142, 282 | idem |
| `src/app/api/whatsapp/templates/submit/route.ts` | 142 | idem |
| `src/app/api/whatsapp/templates/sync/route.ts` | 139 | idem |
| `src/app/api/whatsapp/media/[mediaId]/route.ts` | 53 | idem |
| `src/app/api/whatsapp/config/verify-registration/route.ts` | 59 | idem |
| `src/lib/whatsapp/resolve-conversation.ts` | 59 | idem |
| `src/lib/api/v1/contacts.ts` | 78 (`resolveAuditUserId`) | idem |
| `src/app/(dashboard)/inbox/page.tsx` | 204 | idem (client) |
| `src/components/settings/settings-overview.tsx` | 125 | idem (client) |
| `src/components/settings/whatsapp-config.tsx` | 124, 215 | idem (client) |

`src/lib/whatsapp/resolve-connection.ts` (42, 62) **não** entra no sweep
— vira 3 níveis (§3.3).

**Por que `archived_at IS NULL` também:** os índices únicos parciais da
040 (`idx_connections_account_provider`, `idx_connections_phone_number_id`)
são `WHERE archived_at IS NULL`. Uma conexão arquivada + reconexão do
mesmo provider produz duas linhas Meta para o account; sem o filtro, um
`.single()` daria `PGRST116`. Inerte na 1b-i (nada arquiva), mas o
arquivo é a superfície que a 1b-ii/1c vão exercitar.

**Comportamento na 1b-i:** com no máximo uma linha Meta por account e
nada arquivado, os dois filtros são no-op — o `.single()` devolve
exatamente o que devolvia.

### 3.2 Eleição de `is_primary`

`config/route.ts`, no INSERT (hoje `is_primary: true` fixo, herança da
1a Task 4):

```ts
const { count } = await supabase
  .from('whatsapp_connections')
  .select('id', { count: 'exact', head: true })
  .eq('account_id', accountId)
  .is('archived_at', null);
// ... no objeto do insert:
is_primary: (count ?? 0) === 0,
```

1ª conexão não-arquivada do account (qualquer provider) = primária; as
seguintes = `false`. A promoção explícita é `PATCH` (1b-ii). O `UPDATE`
de config existente **não** toca `is_primary` — uma linha que já é
primária continua primária.

Na 1b-i: nenhuma linha `uazapi` existe, então salvar a config Meta pela
1ª vez sempre acha `count === 0` → `is_primary: true` → zero mudança.
Quando a 1b-ii deixar criar uma conexão UAZAPI primeiro, salvar Meta
depois pega `is_primary: false` corretamente.

### 3.3 `resolveConnection` em 3 níveis

`resolve-connection.ts` — assinatura **inalterada**
(`resolveConnection(db, accountId, options)`, `ResolveConnectionOptions`
já tem `connectionId`, `conversationId`, `selfHeal`). Lógica nova:

1. **Alvo por conversa:** se `options.conversationId`,
   `SELECT connection_id FROM conversations WHERE id = ? AND account_id = ?`.
   Se a linha existe e `connection_id` não é NULL → esse é o `targetId`.
2. **Alvo explícito:** senão, se `options.connectionId` → `targetId`.
3. **Carrega o alvo:** se há `targetId`,
   `SELECT * FROM whatsapp_connections WHERE id = ? AND account_id = ?
   AND archived_at IS NULL`.
4. **Primária:** se não há `targetId` (ou o alvo não carregou — ver
   ruling abaixo), `SELECT * FROM whatsapp_connections WHERE
   account_id = ? AND is_primary AND archived_at IS NULL`.
5. **Nenhuma:** `throw new SendMessageError('whatsapp_not_configured',
   'WhatsApp not configured. Please set up your WhatsApp integration
   first.', 400, { reason: 'not_configured' })` — mensagem/código/status
   idênticos aos de hoje.
6. **`selfHeal`** — igual, keyed no `id` da linha resolvida.
7. **Monta a variante da união** conforme `row.provider`:
   - `meta` → `{ id, accountId, credential, provider: 'meta',
     phoneNumberId: row.phone_number_id }`
   - `uazapi` → `{ id, accountId, credential, provider: 'uazapi',
     instanceId: row.uazapi_instance_id, baseUrl: row.uazapi_base_url }`

**Ruling — alvo que não carrega cai para a primária.** Se
`conversationId` aponta para uma conversa com `connection_id` de uma
conexão arquivada (ou o `connectionId` explícito é inválido), o passo 3
não devolve linha. Decisão: cair para o passo 4 (primária), não
lançar. Custo se errado: um envio para uma conexão arquivada iria pela
primária em vez de falhar — aceitável e provavelmente desejável; a
1b-ii/1c refina se preciso.

**Correção (revisão da Task 3):** o texto original dizia que "uma
conversa com `connection_id` NULL (todas, até a 1c)" seria o caso
comum. **Falso** — a migração 040 backfilla `conversations.connection_id`
para a linha de conexão do account. Na prática, o caminho de envio
(`send-core` passa `conversationId`) exercita o **nível 1**: a conversa
tem um `connection_id` não-NULL apontando para a linha primária, que é
carregada por id. Com um account só-Meta o resultado é a mesma
`TransportConnection` de sempre; o custo é uma query a mais
(`conversations` + `whatsapp_connections` vs 1). `connection_id` NULL só
aparece em conversa órfã do botão "Reset Configuration" (pré-1c). O
fallthrough para a primária continua sendo a rede para esse caso e para
o alvo arquivado.

### 3.4 União `TransportConnection`

`providers/types.ts`:

```ts
interface TransportConnectionBase {
  id: string;
  accountId: string;
  /** Credencial já decriptada. Meta: access token. UAZAPI: instance token. */
  credential: string;
}
export type TransportConnection =
  | (TransportConnectionBase & {
      provider: 'meta';
      /** `phone_number_id`. Sempre presente numa linha Meta. */
      phoneNumberId: string;
    })
  | (TransportConnectionBase & {
      provider: 'uazapi';
      /** `uazapi_instance_id`. */
      instanceId: string;
      /** `uazapi_base_url` — a raiz da API do servidor UAZAPI do operador. */
      baseUrl: string;
    });
```

`createTransport` estreita:

```ts
export function createTransport(conn: TransportConnection): WhatsAppTransport {
  switch (conn.provider) {
    case 'meta':   return createMetaTransport(conn);   // conn: variante meta
    case 'uazapi': return createUazapiTransport(conn); // conn: variante uazapi
  }
}
```

`createMetaTransport` passa a tipar o parâmetro como a variante `'meta'`
(hoje lê `conn.phoneNumberId` e trata `null` — com a variante, o campo é
`string`, então a guarda `if (!phoneNumberId) throw` vira código morto
mas fica, defensiva). **Ripple:** qualquer leitura não-estreitada de
`conn.phoneNumberId` quebra o typecheck — o plano parte de
`git grep 'phoneNumberId'` e trata cada uma. `send-core.ts` e os call
sites de broadcast passam a conexão opaca ao `createTransport` sem ler
campo de provider (design da Onda 0) — o plano confirma.

### 3.5 Transporte UAZAPI

`providers/uazapi-transport.ts` — `createUazapiTransport(conn)` recebe a
variante `'uazapi'` (`instanceId`, `baseUrl`, `credential`). Faz `fetch`
direto contra `{baseUrl}` com header de autenticação da instância
(`token: credential` — o campo/header exatos saem do
`docs/uazapi-openapi-spec.yaml` no plano).

| Método | Endpoint UAZAPI | Corpo (esboço) |
|---|---|---|
| `sendText({ to, text })` | `POST /send/text` | `{ number: to, text }` |
| `sendMedia({ to, mediaKind, link, caption, filename })` | `POST /send/media` | `{ number, type, file, text, docName }` |
| `sendReaction({ to, targetProviderMessageId, emoji })` | `POST /message/react` | `{ number, text: emoji, id: targetProviderMessageId }` |
| `sendTemplate` / `sendInteractive` | — | `throw new UnsupportedCapabilityError('uazapi', 'templates' \| 'interactive')` |

- `capabilities = { templates: false, media: true, reactions: true, interactive: false }`.
- `provider = 'uazapi'`.
- **Sem retry de variante de telefone** — é gambiarra do sandbox da Meta
  e do trunk 0 brasileiro (spec-mãe §4.2). `normalizedRecipient` sempre
  `undefined`.
- `providerMessageId` vem do corpo da resposta (campo exato no plano).
- Erro HTTP da UAZAPI → propaga como `Error` cru; o núcleo já embrulha
  em `meta_error`/502 (nome herdado; a spec-mãe deixa a convergência
  do vocabulário para depois).
- **Sem `fetchMedia`** — a interface `WhatsAppTransport` não o declara
  ainda (Onda 0 o adiou; entra na 1c com o inbound).

Ramo no `createTransport` (§3.4); o `default: throw "No transport
implemented"` some.

### 3.6 Suíte de contrato

`providers/transport-contract.test.ts` (spec-mãe §6) — parametrizada
sobre `[{ name: 'meta', make: () => createMetaTransport(metaConn) },
{ name: 'uazapi', make: () => createUazapiTransport(uazapiConn) }]`,
mockando `@/lib/whatsapp/meta-api` (lado Meta) e `fetch` global
(lado UAZAPI — `vi.stubGlobal('fetch', …)` ou equivalente).
Asserções por transporte:

- expõe `provider` (bate com o nome) e `capabilities` (os 4 booleanos).
- `sendText` devolve `{ providerMessageId: string, normalizedRecipient?:
  string }` — forma idêntica nos dois.
- para cada capacidade `false`, o método correspondente lança
  `UnsupportedCapabilityError` com `provider` e `capability` corretos.
- para cada capacidade `true`, o método faz uma chamada à API mockada
  com o telefone/id certos e devolve o `providerMessageId` do corpo.
- pula asserção de método cuja capacidade o transporte não cobre.

Os testes específicos de cada transporte (`meta-transport.test.ts`,
`uazapi-transport.test.ts`) cobrem o que é próprio de cada um (retry de
variante da Meta; mapeamento de corpo da UAZAPI).

---

## 4. Decisões desta leva (brainstorming 2026-08-28)

| # | Decisão | Motivo |
|---|---|---|
| 1bi-1 | 1b dividida em 1b-i (plumbing + transporte) / 1b-ii (provisionamento + UI) | O plumbing mexe em ~12 arquivos vivos e é a parte arriscada; isolá-lo do client HTTP + rotas + React dá uma unidade de review coesa. 1b-i é invisível ao usuário (nada cria linha `uazapi`), então merge sozinha sem flag. |
| 1bi-2 | Fronteira 1b/1c: 1b = provisionar + transporte + envio provado por API; inbox e inbound são 1c | Não há "nova conversa" na inbox; a 1ª mensagem sai por `POST /api/v1/messages`. Juntar inbox aqui traria conversa sem histórico de entrada. |
| 1bi-3 | Sweep = `provider='meta'` + `archived_at IS NULL`, não 3-níveis | Os ~12 sites são superfícies Meta (config, templates, webhook por phone_number_id). Escopá-los a Meta é correto e mecânico; 3-níveis é só do caminho de envio (`resolveConnection`). |
| 1bi-4 | Alvo de conexão que não carrega → cai para a primária, não lança | Preserva o comportamento de hoje para o único caso alcançável na 1b-i (conversa com `connection_id` NULL). |
| 1bi-5 | `TransportConnection` vira união discriminada agora | A variante `uazapi` tem campos reais (`instanceId`, `baseUrl`) que a Meta não tem; flat com nullable esconderia bug. |
| 1bi-6 | Sem migração | A 040 já criou `provider`, `is_primary`, `uazapi_instance_id`, `uazapi_base_url`, `archived_at` e os índices parciais. |

---

## 5. Testes e critério de aceite

- **A suíte existente passa.** A única mudança permitida em arquivos de
  teste é ajuste de forma: um `TransportConnection` literal ou um mock
  de `resolveConnection` que hoje é flat ganha a forma da variante
  (`provider: 'meta'` + `phoneNumberId`) — a maioria já tem, da Onda
  0/1a. Qualquer teste cuja **asserção de comportamento** precise mudar
  é defeito.
- **+ testes de `resolveConnection`:** os 3 níveis; `conversationId` com
  `connection_id` NULL → primária; alvo arquivado → primária; nenhuma
  conexão → `SendMessageError` (código/mensagem/status inalterados).
- **+ testes do transporte UAZAPI** (`uazapi-transport.test.ts`): cada
  método mapeia o corpo certo e devolve o `providerMessageId`; os dois
  não-cobertos lançam `UnsupportedCapabilityError`.
- **+ a suíte de contrato** (`transport-contract.test.ts`) rodando
  contra os dois transportes.
- Com só uma conexão Meta por account: sweep no-op, 3-níveis resolve
  para a mesma linha primária, eleição sempre `true` → **zero mudança
  observável** para quem tem só Meta.
- `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`
  limpos. As 5 falhas de baseline de locale/fuso seguem as mesmas 5.

---

## 6. Riscos

| Risco | Mitigação |
|---|---|
| Uma leitura não-estreitada de `conn.phoneNumberId` quebra o typecheck após a união | É o efeito desejado — o plano parte de `git grep 'phoneNumberId'` e trata cada uma; `createMetaTransport` recebe a variante, os demais não tocam o campo. |
| O sweep esquece um call site e um `.single()` dá PGRST116 quando surgir a 2ª linha | Inerte na 1b-i (nada cria linha `uazapi`). O portão de aceite greps `.from('whatsapp_connections')` e confere que todo `.single()`/`.maybeSingle()` de fora do caminho de envio tem `.eq('provider')` + `.is('archived_at', null)`. |
| A forma real do corpo/resposta da API UAZAPI diverge do assumido em §3.5 | O plano lê os schemas dos 3 endpoints em `docs/uazapi-openapi-spec.yaml` e escreve o transporte contra eles; `uazapi-transport.test.ts` fixa a forma. Validação real de ponta a ponta é 1b-ii (envio provado). |
| `resolveConnection` 3-níveis muda a resolução para um account com só Meta | Passo 4 (primária) resolve para a linha `is_primary=true` que a 040 backfillou — a mesma que o `.eq('provider','meta').single()` de hoje devolve. Testado. |

---

## 7. Fora de escopo desta leva

- Env vars `UAZAPI_*`, client HTTP, as 6 rotas de conexão, o card de
  Settings, o fluxo de QR, o envio provado por API — **1b-ii**.
- `SET NOT NULL` / `ON DELETE RESTRICT` em `conversations.connection_id`,
  `fetchMedia`, pipeline de inbound, mudanças de inbox — **1c**.
- `sendTemplate`/`sendInteractive` reais na UAZAPI, broadcast UAZAPI —
  **Onda 3**.
