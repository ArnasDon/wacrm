# Onda 1c-i — Migração `041` + extração do seam de inbound

**Data:** 2026-08-30
**Status:** design aprovado, aguardando plano de implementação
**Spec-mãe:** `docs/superpowers/specs/2026-08-27-uazapi-provider-design.md` (§4.1 schema, §4.3 inbound)
**Specs de apoio:** `2026-08-28-uazapi-onda-1a-migracao-040.md`, `2026-08-28-uazapi-onda-1b-i-plumbing.md`, `2026-08-29-uazapi-onda-1b-ii-provisionamento.md`

---

## 1. Contexto

A Onda 1c da spec-mãe ("pipeline de inbound + inbox") foi decomposta em duas sub-levas na sessão de brainstorming de 2026-08-30:

| Sub-leva | Conteúdo | Estado |
|---|---|---|
| **1c-i** (esta) | Migração `041` (quebra coordenada) + extração de `processInboundMessage()` da rota da Meta + resolução de conversa por `connection_id` + `fetchMedia` na interface (impl Meta, stub UAZAPI) + `is_primary` atômico (pendência C1) | Refactor puro, só Meta, merge sozinha |
| **1c-ii** | Rota `/api/whatsapp/webhook/uazapi/[secret]` + `fetchMedia` UAZAPI + reconciliar `configureWebhook` + evento `connection` + UI da inbox (selo de canal, cabeçalho, composer por `capabilities`) | própria spec |

**A 1c-i não muda nenhum comportamento observável para uma conta que só tem Meta.** É a "Onda 0 do inbound": extrai o seam que a 1c-ii vai reusar, e faz a migração de schema que a 1c-ii depende.

### Estado herdado (o que a 1b-ii deixou)

- `whatsapp_connections` com `provider`, `is_primary`, `uazapi_*`, `webhook_secret_hash`, `archived_at`. Índice parcial único `idx_connections_one_primary` em `(account_id) WHERE is_primary AND archived_at IS NULL`.
- `conversations.connection_id` e `broadcasts.connection_id` **nullable** (`ON DELETE SET NULL`), backfill único da 040. Desde então, **toda conversa criada pelo webhook da Meta ficou com `connection_id = NULL`** — `findOrCreateConversation` não seta a coluna.
- `WhatsAppTransport` com `sendText/sendMedia/sendInteractive/sendTemplate/sendReaction`, `capabilities`, `provider`. **Sem `fetchMedia`** (adiado desde a Onda 0).
- `PATCH /api/whatsapp/connections/[id]` promove `is_primary` com "limpa-as-outras-primeiro, depois marca o alvo" (dois `.update()` sequenciais; janela sub-ms com 0 primárias — correção parcial do C1).
- `webhook/route.ts` da Meta: **1250 linhas**, toda a lógica de inbound inline. `webhook/route.test.ts`: **550 linhas, ~20 testes** (idempotência, unread bump, botões de template, 8 casos de espelhamento de mídia, `after()` de automações).

---

## 2. Escopo

### Entrega

1. **Migração `041`** (§3.1) — quebra coordenada:
   - re-backfill + `SET NOT NULL` + `ON DELETE RESTRICT` em `conversations.connection_id`;
   - idem `broadcasts.connection_id`, e `CREATE OR REPLACE FUNCTION create_broadcast_with_recipients` setando `connection_id`;
   - guard in-transaction: `RAISE EXCEPTION` se sobrar `connection_id` NULL depois do backfill;
   - conversas órfãs (conta sem conexão meta) são **apagadas** no backfill (§3.1 decisão);
   - dropa `idx_connections_one_primary`; cria `EXCLUDE (account_id WITH =) WHERE (is_primary AND archived_at IS NULL) DEFERRABLE INITIALLY DEFERRED`;
   - `CREATE FUNCTION set_primary_connection(p_id, p_account_id)`;
   - `verify-schema.sql`: asserções do `NOT NULL`, do `ON DELETE RESTRICT`, e do EXCLUDE constraint.
2. **Módulo `src/lib/whatsapp/inbound/`** (§3.2) — `types.ts`, `process-inbound-message.ts`, `process-status-update.ts`, `find-or-create.ts`. Recorte-e-cola **verbatim** de `webhook/route.ts`; só mudam os `import`.
3. **`webhook/route.ts` da Meta** (§3.3) — encolhe para ~350 linhas: `GET`, `POST`, `verifyMetaWebhookSignature`, e o **adaptador de envelope** (`entry[].changes[].value` → `InboundMessage`/`InboundStatus` → módulo compartilhado).
4. **`findOrCreateConversation` vira connection-aware** (§3.3) — busca e INSERT por `(account_id, contact_id, connection_id)`; resolve a conexão `provider='meta'` não-arquivada da conta.
5. **`fetchMedia` na interface `WhatsAppTransport`** (§3.4) — impl Meta (embrulha `getMediaUrl`+`downloadMedia`), stub UAZAPI que lança.
6. **RPC `set_primary_connection`** substitui os dois `.update()` no ramo `is_primary: true` do `PATCH /connections/[id]` (§3.5).

### Fora de escopo (é 1c-ii)

Rota `/api/whatsapp/webhook/uazapi/[secret]`; `fetchMedia` UAZAPI (`POST /message/download`); reconciliar `configureWebhook` (hoje `['messages','messages_update','connection','history']` + `excludeMessages:['wasSentByApi']`; §4.3 quer `['messages','messages_update','connection']` + `excludeMessages:['isGroupYes','fromMeYes']`) + re-registrar a instância já conectada; handler do evento `connection` (status sem polling + refresh de `display_phone`/`profile_name`); UI da inbox.

### Fora (Onda 3+)

`sendTemplate`/`sendInteractive` reais na UAZAPI; broadcast por conexão específica.

---

## 3. Arquitetura

### 3.1 Migração `041`

Ordem, tudo num arquivo (o CI replica 001→041 num Postgres limpo):

**1. `is_primary` atômico**
```sql
DROP INDEX IF EXISTS idx_connections_one_primary;
ALTER TABLE whatsapp_connections
  ADD CONSTRAINT whatsapp_connections_one_primary
  EXCLUDE (account_id WITH =) WHERE (is_primary AND archived_at IS NULL)
  DEFERRABLE INITIALLY DEFERRED;

CREATE OR REPLACE FUNCTION public.set_primary_connection(
  p_id UUID, p_account_id UUID
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_account_member(p_account_id, 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE whatsapp_connections
    SET is_primary = (id = p_id)
    WHERE account_id = p_account_id AND archived_at IS NULL;
  IF NOT EXISTS (
    SELECT 1 FROM whatsapp_connections
    WHERE id = p_id AND account_id = p_account_id
      AND archived_at IS NULL AND is_primary
  ) THEN
    RAISE EXCEPTION 'connection not found' USING ERRCODE = 'P0002';
  END IF;
END $$;
```
Com o EXCLUDE `INITIALLY DEFERRED`, o `UPDATE … SET is_primary = (id = p_id)` num statement só é seguro — a exclusão só é checada no COMMIT, quando exatamente uma linha é `is_primary`.

**2. `conversations.connection_id`**
```sql
-- backfill: conversa órfã (conta sem conexão meta ativa) é apagada
DELETE FROM conversations c
  WHERE c.connection_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM whatsapp_connections wc
      WHERE wc.account_id = c.account_id AND wc.provider = 'meta'
        AND wc.archived_at IS NULL
    );

UPDATE conversations c
  SET connection_id = wc.id
  FROM whatsapp_connections wc
  WHERE c.connection_id IS NULL
    AND wc.account_id = c.account_id AND wc.provider = 'meta'
    AND wc.archived_at IS NULL;

DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM conversations WHERE connection_id IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'migration 041: % conversations still have NULL connection_id after backfill', n;
  END IF;
END $$;

ALTER TABLE conversations ALTER COLUMN connection_id SET NOT NULL;
ALTER TABLE conversations DROP CONSTRAINT conversations_connection_id_fkey;
ALTER TABLE conversations ADD CONSTRAINT conversations_connection_id_fkey
  FOREIGN KEY (connection_id) REFERENCES whatsapp_connections(id) ON DELETE RESTRICT;
```
(o nome real do constraint FK sai de `\d conversations` — o plano confere.)

**Decisão 1ci-1 — conversa órfã é apagada.** Uma conversa com `connection_id` NULL cuja conta não tem nenhuma conexão `provider='meta'` ativa só existe por um "Reset Configuration" que apagou a config depois de já haver conversas. Não há conexão a que atribuí-la; o inbound daquele contato hoje já falha ("não configurado"). Apagar (com seus `messages` via cascade) é o mínimo. Custo se errado: perda de histórico de uma conta que, na prática, não tem WhatsApp configurado. Alternativa rejeitada: conexão sintética "meta órfã" — carrega complexidade pra um estado degenerado.

**3. `broadcasts.connection_id`** — mesma estrutura das conversas:
```sql
-- órfão: broadcast de conta sem conexão meta ativa é apagado
DELETE FROM broadcasts b
  WHERE b.connection_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM whatsapp_connections wc
      WHERE wc.account_id = b.account_id AND wc.provider = 'meta'
        AND wc.archived_at IS NULL
    );

UPDATE broadcasts b SET connection_id = wc.id
  FROM whatsapp_connections wc
  WHERE b.connection_id IS NULL AND wc.account_id = b.account_id
    AND wc.provider = 'meta' AND wc.archived_at IS NULL;

-- guard NULL idêntico ao das conversas (RAISE EXCEPTION se n > 0)
ALTER TABLE broadcasts ALTER COLUMN connection_id SET NOT NULL;
ALTER TABLE broadcasts DROP CONSTRAINT broadcasts_connection_id_fkey;
ALTER TABLE broadcasts ADD CONSTRAINT broadcasts_connection_id_fkey
  FOREIGN KEY (connection_id) REFERENCES whatsapp_connections(id) ON DELETE RESTRICT;
```
(um broadcast tem exatamente uma conexão `provider='meta'` por conta pra atribuir; se um dia houver duas conexões meta a coluna já existe pra desambiguar — Onda 3.)

**4. `CREATE OR REPLACE FUNCTION create_broadcast_with_recipients(...)`** — corpo byte-idêntico ao da migração 038 exceto: o INSERT em `broadcasts` passa a incluir `connection_id`, resolvido como `(SELECT id FROM whatsapp_connections WHERE account_id = <acct> AND is_primary AND archived_at IS NULL)`. Se a RPC recebe um `connection_id` como parâmetro no futuro (Onda 3), fica; por ora resolve a primária internamente. **Sem essa reescrita, toda criação de broadcast dá 500 após o `SET NOT NULL`.**

**5. `verify-schema.sql`** — `+` asserções: `conversations.connection_id` é `NOT NULL`; o FK é `ON DELETE RESTRICT` (`confdeltype = 'r'`); `whatsapp_connections_one_primary` é um constraint do tipo `x` (exclusion) e `condeferrable`.

### 3.2 Módulo `src/lib/whatsapp/inbound/`

- **`types.ts`**
  ```ts
  export type ProviderMediaRef =
    | { provider: 'meta'; mediaId: string }
    | { provider: 'uazapi'; /* preenchido na 1c-ii */ [k: string]: unknown };

  export interface InboundMessage {
    connectionId: string;
    accountId: string;
    configOwnerUserId: string;
    providerMessageId: string;
    from: string;                 // telefone já normalizado
    senderName?: string;
    timestamp: Date;
    replyToProviderMessageId?: string;
    content:
      | { kind: 'text'; text: string }
      | { kind: 'media'; mediaKind: MediaKind; caption?: string;
          filename?: string; mimeType?: string; ref: ProviderMediaRef }
      | { kind: 'location'; latitude: number; longitude: number; name?: string; address?: string }
      | { kind: 'interactive_reply'; replyId: string; title: string }
      | { kind: 'reaction'; targetProviderMessageId: string; emoji: string }
      | { kind: 'unsupported'; rawType: string };
  }

  export interface InboundStatus {
    connectionId: string;
    accountId: string;
    providerMessageId: string;
    status: string;               // 'sent' | 'delivered' | 'read' | 'failed' | ...
    timestamp: Date;
  }
  ```
- **`process-inbound-message.ts`** — `processInboundMessage(db, msg: InboundMessage): Promise<void>`. Move `processMessage` + `parseMessageContent` + `handleReaction` + `flagBroadcastReplyIfAny` + `lookupInternalIdByMetaId` **verbatim**. Despacha por `msg.content.kind`. O caminho de mídia monta `createTransport(connection)` (conexão carregada de `msg.connectionId`) e chama `transport.fetchMedia(msg.content.ref)` no lugar do `getMediaUrl`/`downloadMedia` inline — a **única** mudança de lógica nesse recorte, e mínima (`mirrorInboundMedia` recebe a mesma coisa).
- **`process-status-update.ts`** — `processStatusUpdate(db, s: InboundStatus)`. Move `handleStatusUpdate` + `ladderLevel` + `isValidStatusTransition` verbatim.
- **`find-or-create.ts`** — `findOrCreateContact` (verbatim) + `findOrCreateConnectionAwareConversation` (era `findOrCreateConversation`, agora por `(account_id, contact_id, connection_id)`).

**Regra de ouro (guardrail 1):** recorte-e-cola. Nada de "já que estou aqui". As ordenações que os comentários do código chamam a atenção — `conversation.created` emitido antes do short-circuit de reação; a fronteira do `after()` esperando automações — só sobrevivem se o código não for reescrito.

### 3.3 `webhook/route.ts` da Meta (encolhido)

Mantém: `GET` (hub challenge + verify token), `POST`, `verifyMetaWebhookSignature`, `supabaseAdmin()`.

**Adaptador de envelope** (novo, pequeno): para cada `entry[].changes[].value`:
- resolve a linha de conexão pelo `phone_number_id` (`.eq('provider','meta').is('archived_at', null)`) → `connectionId = row.id`, `accountId`, `configOwnerUserId = row.user_id`;
- para cada `value.messages[]`: normaliza para `InboundMessage` (incluindo `content.ref = { provider:'meta', mediaId }` para mídia, e `content.kind:'reaction'` para `message.type === 'reaction'`) → `await processInboundMessage(db, msg)`;
- para cada `value.statuses[]`: normaliza para `InboundStatus` → `await processStatusUpdate(db, s)`.

`findOrCreateConnectionAwareConversation`: a busca vira `.eq('account_id').eq('contact_id').eq('connection_id')`; o INSERT inclui `connection_id`. Numa conta só-Meta (uma conexão), é no-op — o backfill da `041` já pôs `connection_id` em toda conversa existente, e a resolução acha a mesma linha.

### 3.4 `fetchMedia` na interface

`src/lib/whatsapp/providers/types.ts`:
```ts
fetchMedia(ref: ProviderMediaRef): Promise<{ bytes: Uint8Array; mimeType: string; filename?: string }>;
```
- `createMetaTransport`: `fetchMedia({ provider: 'meta', mediaId })` → `const { url, mime_type } = await getMediaUrl({ mediaId, accessToken: conn.credential })` → `const bytes = await downloadMedia(url, conn.credential)` → `{ bytes, mimeType: mime_type }`. (Assinaturas exatas de `getMediaUrl`/`downloadMedia` saem de `meta-api.ts` no plano.)
- `createUazapiTransport`: `fetchMedia(): Promise<never> { throw new Error('uazapi fetchMedia: implementado na Onda 1c-ii'); }` — não-async ou async, o plano decide pela forma que o TS aceita na interface.
- `transport-contract.test.ts`: caso Meta assere que `fetchMedia` chama a API mockada e devolve `{ bytes, mimeType }`; caso UAZAPI assere que lança.

### 3.5 `PATCH /connections/[id]` → RPC

No ramo `body.is_primary === true`: troca

```ts
// hoje: dois .update() (clear-others-first, depois set-target)
```
por
```ts
const { error } = await supabase.rpc('set_primary_connection', {
  p_id: id, p_account_id: accountId,
});
if (error) { /* mapeia P0002 → 404, 42501 → 403, resto → 500 */ }
```
O ramo `body.is_primary === false` (rebaixar) fica igual (single `.update()`, guardado pelo `activeCount`).

---

## 4. Decisões desta leva (brainstorming 2026-08-30)

| # | Decisão | Motivo |
|---|---|---|
| 1ci-1 | 1c dividida em 1c-i (seam + migração) / 1c-ii (webhook UAZAPI + mídia + inbox) | O seam sai de um arquivo de 1250 linhas — refactor de alto risco, análogo à Onda 0. Isolá-lo do código novo de UAZAPI dá uma unidade de review coesa e merge sozinho (invisível ao usuário). |
| 1ci-2 | `is_primary` atômico via `EXCLUDE … DEFERRABLE` + RPC | A 1c-i já tem migração. O EXCLUDE deferível permite o `SET is_primary = (id = p_id)` num statement só, sem janela de 0 primárias. Um índice parcial único **não** pode ser deferível; um `EXCLUDE … WHERE` pode. |
| 1ci-3 | `fetchMedia` entra na interface já na 1c-i (impl Meta, stub UAZAPI) | O seam nasce provider-agnóstico no caminho de mídia; a 1c-ii só preenche a impl UAZAPI sem re-mexer no seam. Mesmo padrão dos stubs da 1b-i. |
| 1ci-4 | Conversa órfã (conta sem conexão meta ativa) é apagada no backfill | Não há conexão a que atribuí-la; o inbound daquele contato já falha hoje. Conexão sintética carrega complexidade pra um estado degenerado. |
| 1ci-5 | `broadcasts.connection_id` também vira `NOT NULL` + `create_broadcast_with_recipients` reescrita na mesma migração | `SET NOT NULL` sem reescrever a RPC = toda criação de broadcast dá 500. Coordenação dentro do arquivo. |
| 1ci-6 | Verbatim **onde dá**; a cabeça do orquestrador e o caminho de mídia são refactor coberto por teste | O `processMessage` de hoje opera em cima da mensagem crua da Meta (`message.type`, `message.image.id`, `message.context.id`). Consumir `InboundMessage` exige reescrever o `switch` por tipo e o caminho de mídia — não é verbatim. **~60% move quase-verbatim** (escada de status, `findOrCreateContact`, `flagBroadcastReplyIfAny`, `lookupInternalIdByMetaId`, o bloco de fan-out de ~125 linhas com os comentários de ordenação); **~40% é refactor** (cabeça do orquestrador → `switch(msg.content.kind)`; `parseMessageContent` dividido em adaptador-Meta + `transport.fetchMedia` no core). Ordenações sutis (o `conversation.created` antes da reação, a fronteira do `after()`) preservadas na reescrita e verificadas pelos ~20 testes de `webhook/route.test.ts` + `process-inbound-message.test.ts`. |

---

## 5. Testes e critério de aceite

- **`webhook/route.test.ts` (~20 testes) passa sem mudança de asserção.** Único ajuste permitido: o mock do Supabase devolver uma linha de conexão bem-formada pro `createTransport` no caminho de mídia (enabler, regra herdada da 1b-i). Qualquer asserção que precise mudar = defeito.
- **`[id]/route.test.ts` (1b-ii):** os 2 testes de ordenação de `is_primary` (incluindo o que simula o índice único rejeitando um 2º `true`) são **reescritos** para a nova realidade — o PATCH chama `set_primary_connection`. Asserção nova, **pré-declarada** aqui: não é defeito, o comportamento mudou de propósito.
- **+ testes novos:**
  - `src/lib/whatsapp/inbound/process-inbound-message.test.ts` — exercita o módulo direto com `InboundMessage` normalizado: texto, mídia (com `fetchMedia` mockado), reação, `unsupported`, dedup por `(conversation_id, message_id)`, resolução de conversa por `connection_id` (dois `connection_id` diferentes → duas conversas para o mesmo contato).
  - `src/lib/whatsapp/inbound/process-status-update.test.ts` — a escada `pending→sent→delivered→read→replied` + `failed` terminal.
  - `transport-contract.test.ts` — `fetchMedia`: Meta delega, UAZAPI lança.
  - `[id]/route.test.ts` — `set_primary_connection` chamado com `{ p_id, p_account_id }`; `P0002` → 404.
- `npm run typecheck` / `lint` / `build` limpos. Baseline segue 5 falhas (`currency` ×3, `dashboard/date-utils` ×2).
- **Migração `041` validada só pelo `migrations.yml` no PR** (sem Docker local). Pontos de risco sinalizados: (a) o guard in-transaction de `connection_id` NULL; (b) a reescrita da `create_broadcast_with_recipients`; (c) o nome real do constraint FK de `conversations`/`broadcasts`.
- **Zero mudança observável pra conta só-Meta:** mesmas conversas, mesmo processamento, mesmo fan-out; `connection_id` populado mas a resolução escolhe a mesma (única) conexão; `set_primary_connection` produz o mesmo estado final do PATCH de hoje.
- Smoke manual opcional pós-merge: mandar uma mensagem pro número Meta, confirmar que cai na inbox como antes.

---

## 6. Riscos

| Risco | Mitigação |
|---|---|
| A extração regride uma ordenação sutil do caminho da Meta que os ~20 testes não cobrem | Recorte-e-cola verbatim (decisão 1ci-6); os testes são a rede; o plano parte de um diff função-a-função mostrando que só os `import` mudaram. |
| O backfill de `connection_id` deixa linhas NULL e o `SET NOT NULL` quebra o CI | Guard in-transaction (`RAISE EXCEPTION`) antes do `SET NOT NULL`; conversas órfãs apagadas explicitamente (decisão 1ci-4). |
| `create_broadcast_with_recipients` não reescrita → criação de broadcast 500 | `CREATE OR REPLACE` na mesma migração `041` (decisão 1ci-5); teste de criação de broadcast, se existir, roda no CI. |
| O `EXCLUDE … DEFERRABLE` interage mal com algum caminho que faz `UPDATE is_primary` fora da RPC | Grep por `is_primary` em `src/`: só o `PATCH` e o `DELETE` (repasse) e o INSERT do `POST /connections` escrevem a coluna. O `DELETE` repasse seta uma linha `true` quando resta exatamente uma ativa — nunca cria conflito. O plano confere cada um. |
| `fetchMedia` na interface quebra o typecheck de algum consumidor de `WhatsAppTransport` | É o efeito desejado; o plano parte de `git grep 'WhatsAppTransport'` e adiciona `fetchMedia` a cada impl (Meta real, UAZAPI stub) e a cada mock de teste. |
| O nome do constraint FK difere de `conversations_connection_id_fkey` | O plano roda `\d conversations` / consulta `pg_constraint` no CI e usa o nome real; `DROP CONSTRAINT IF EXISTS` com o nome provável + fallback. |

---

## 7. Fora de escopo desta leva

- Rota `/api/whatsapp/webhook/uazapi/[secret]`, `fetchMedia` UAZAPI, reconciliar + re-registrar `configureWebhook`, handler do evento `connection`, UI da inbox — **1c-ii**.
- `sendTemplate`/`sendInteractive` reais na UAZAPI, broadcast por conexão específica — **Onda 3**.
- Refresh de `display_phone`/`profile_name` (ficaram vazios no smoke da 1b-ii porque o WhatsApp libera os dados 1–2s após conectar) — **1c-ii**, junto do handler do evento `connection`.
