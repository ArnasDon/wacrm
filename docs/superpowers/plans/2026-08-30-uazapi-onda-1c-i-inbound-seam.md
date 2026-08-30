# UAZAPI Onda 1c-i — Migração 041 + extração do seam de inbound — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extrair um `processInboundMessage()` compartilhado da rota de webhook da Meta (1250 linhas), tornar a resolução de conversa `connection_id`-aware, adicionar `fetchMedia` à interface de transporte, e migrar `conversations`/`broadcasts` para `connection_id NOT NULL` + `is_primary` atômico — tudo sem mudar comportamento observável para uma conta só-Meta.

**Architecture:** Refactor puro + uma migração de quebra coordenada. O novo módulo `src/lib/whatsapp/inbound/` recebe: a escada de status e os helpers de contato/fan-out **quase verbatim**; a cabeça do orquestrador e o caminho de mídia **reescritos** contra a fronteira `InboundMessage`. A rota da Meta encolhe para HTTP + verificação de assinatura + um adaptador de envelope que normaliza para `InboundMessage`/`InboundStatus`. A migração 041 sobe junto com o código (código antes da migração: ok; migração antes do código: o próximo INSERT de conversa viola `NOT NULL`).

**Tech Stack:** Next.js 16 (App Router, `after()`), TypeScript, Supabase (`@supabase/supabase-js`, service-role client + RLS client), Vitest, Postgres 17 (EXCLUDE constraint DEFERRABLE, plpgsql).

**Spec:** `docs/superpowers/specs/2026-08-30-uazapi-onda-1c-i-inbound-seam.md` — leitura obrigatória, autoridade. Apoio: `2026-08-27-uazapi-provider-design.md` §4.1/§4.3, `2026-08-29-uazapi-onda-1b-ii-provisionamento.md`.

## Global Constraints

- **Migração:** um arquivo `supabase/migrations/041_*.sql`. Validada **só** pelo `.github/workflows/migrations.yml` no PR (replay 001→041 em Postgres 17 limpo + `supabase/ci/verify-schema.sql`). **Não roda localmente** (sem Docker/CLI). `supabase/ci/verify-schema.sql` continua sendo **exatamente um** `DO $$ … $$;` top-level.
- **Quebra coordenada:** a migração e o código (`findOrCreateConnectionAwareConversation` setando `connection_id`) formam uma unidade. Não faseie.
- **`webhook/route.test.ts` (~20 testes) passa sem mudança de asserção.** Único ajuste permitido: o mock do Supabase devolver uma linha de conexão bem-formada pro `createTransport` no caminho de mídia (enabler; regra herdada da 1b-i). Qualquer asserção de comportamento que precise mudar = defeito.
- **`[id]/route.test.ts`:** os 3 testes de ordenação de `is_primary` (`FIX 1`) são **reescritos** para a RPC `set_primary_connection` — pré-autorizado por este plano, não é defeito.
- **Verbatim onde dá** (decisão 1ci-6): a escada de status, `findOrCreateContact`, `flagBroadcastReplyIfAny`, `lookupInternalIdByMetaId`, e o bloco de fan-out (Flows→Automations→AI→`message.received`, ~125 linhas com os comentários de ordenação) movem com mudança **só** de `import` e da origem das variáveis locais. A cabeça do orquestrador (`switch` por tipo → `switch (msg.content.kind)`) e o caminho de mídia são reescrita coberta por teste.
- Prettier: `semi: true, singleQuote: true, printWidth: 80, trailingComma: es5` nos arquivos novos. `webhook/route.ts` **não é** prettier-clean no baseline — diff cirúrgico, toca só o que sai/fica.
- Baseline de testes: 5 falhas pré-existentes (`currency.test.ts` ×3, `dashboard/date-utils.test.ts` ×2). Nada novo.
- Portas por task: `npm run typecheck`, `npm run lint` (0 erros), `npm test` (baseline intacto). `npm run build` na última task de rota.

---

## File Structure

**Criados:**

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/041_connection_id_not_null.sql` | Migração de quebra coordenada (§3.1 da spec). |
| `src/lib/whatsapp/inbound/types.ts` | `InboundMessage`, `InboundStatus`, `ProviderMediaRef`. |
| `src/lib/whatsapp/inbound/find-or-create.ts` | `findOrCreateContact` (verbatim), `findOrCreateConnectionAwareConversation` (connection-aware). |
| `src/lib/whatsapp/inbound/process-status-update.ts` | `processStatusUpdate` + `RECIPIENT_STATUS_LADDER` + `ladderLevel` + `isValidStatusTransition` (verbatim). |
| `src/lib/whatsapp/inbound/process-inbound-message.ts` | `processInboundMessage(db, msg)` — orquestrador reescrito + fan-out quase-verbatim + `handleReaction` + `lookupInternalIdByMetaId` + `flagBroadcastReplyIfAny`. |
| `src/lib/whatsapp/inbound/meta-adapter.ts` | `metaMessageToInbound(...)`, `metaStatusToInbound(...)` — raw Meta → `InboundMessage`/`InboundStatus`. Envolve a lógica de `parseMessageContent` (decisão de `kind`/caption/filename/`ref`), **sem** a busca de bytes. |
| `src/lib/whatsapp/inbound/process-status-update.test.ts` | A escada, isolada. |
| `src/lib/whatsapp/inbound/process-inbound-message.test.ts` | O core com `InboundMessage` direto. |
| `src/lib/whatsapp/inbound/meta-adapter.test.ts` | O adaptador de envelope. |

**Modificados:**

| Arquivo | Mudança |
|---|---|
| `src/lib/whatsapp/providers/types.ts` | `WhatsAppTransport` ganha `fetchMedia(ref): Promise<{ bytes: Uint8Array; mimeType: string; filename?: string }>`. |
| `src/lib/whatsapp/providers/meta-transport.ts` | Implementa `fetchMedia` via `getMediaUrl` + `downloadMedia`. |
| `src/lib/whatsapp/providers/uazapi-transport.ts` | `fetchMedia` stub que lança `'uazapi fetchMedia: Onda 1c-ii'`. |
| `src/lib/whatsapp/providers/transport-contract.test.ts` | `fetchMedia`: Meta delega, UAZAPI lança. |
| `src/lib/whatsapp/mirror-inbound-media.ts` | `MirrorInboundMediaArgs` troca `downloadUrl`+`accessToken` por `bytes: Uint8Array`; remove o fetch interno. |
| `src/lib/whatsapp/mirror-inbound-media.test.ts` | Ajusta os args (passa `bytes`), asserções de comportamento intactas. |
| `src/app/api/whatsapp/webhook/route.ts` | Encolhe: `GET`/`POST`/assinatura/`processWebhook` viram só o adaptador de envelope → chama o módulo compartilhado. |
| `src/app/api/whatsapp/webhook/route.test.ts` | Só o enabler do mock (linha de conexão pro `createTransport`). |
| `src/app/api/whatsapp/connections/[id]/route.ts` | Ramo `is_primary: true` do PATCH → `supabase.rpc('set_primary_connection', …)`. |
| `src/app/api/whatsapp/connections/[id]/route.test.ts` | Reescreve os 3 testes `FIX 1` pra RPC; remove o mock `simulateOnePrimaryIndex`. |
| `supabase/ci/verify-schema.sql` | + asserções do `NOT NULL`, `ON DELETE RESTRICT`, EXCLUDE deferível. |

---

## Pre-flight (controlador, antes da Task 1)

| Par | Interface | Nota |
|---|---|---|
| T1 → T7 | RPC `set_primary_connection` | T7 mocka `supabase.rpc` — não depende da migração aplicada. Ordem T1-antes-de-T7 não obrigatória. |
| T2 → T5 | `fetchMedia` na interface + `MirrorInboundMediaArgs.bytes` | T5 (caminho de mídia) consome. T2 obrigatória antes de T5. |
| T2 → T6 | `webhook/route.test.ts` media mocks | T2 muda `mirror-inbound-media.ts` → os 8 testes de mídia de `route.test.ts` podem precisar do enabler (a linha de conexão) já na T2 ou na T6. Ruling PF-A. |
| T3, T4 → T5 | exports de `process-status-update.ts` / `find-or-create.ts` | T5 importa. T3/T4 antes de T5. |
| T5 → T6 | `processInboundMessage` / `processStatusUpdate` exports | A rota importa. T5 antes de T6. |
| T5 ↔ T6 | `webhook/route.ts` | T5 **cria** os módulos e deixa a rota ainda chamando o código velho; T6 **remove** o código velho da rota e liga no módulo novo. Alternativa: T5 já faz o corte. Ruling PF-B. |
| T2/T5/T6 → `transport-contract.test.ts`, `meta-transport.test.ts` | `fetchMedia` | Mocks de `WhatsAppTransport` em qualquer teste ganham `fetchMedia`. |

**Rulings do controlador:**

- **PF-A:** a mudança de assinatura do `mirrorInboundMedia` (T2) já força ajuste-enabler nos 8 testes de mídia de `webhook/route.test.ts` (eles hoje esperam o fluxo `getMediaUrl`→`downloadUrl`→`mirror`). T2 faz esse ajuste-enabler **e** o de `mirror-inbound-media.test.ts`, mantendo toda asserção de comportamento. Se algum teste de mídia de `route.test.ts` só passar com asserção mudada, é sinal de que a T2 quebrou o contrato — para e reporta.
- **PF-B:** T5 cria os módulos novos **e** já reescreve `webhook/route.ts` pra usá-los (o "corte" é atômico — deixar as duas cópias vivas por uma task gera drift e um estado que os testes não cobrem bem). T6 então é **só** a limpeza final da rota (remover imports mortos, encolher tipos locais, `npm run build`) + confirmar os ~20 testes. Se T5 ficar grande demais, ela reporta `DONE_WITH_CONCERNS` e T6 vira a metade de rota.
- **PF-C (decisão 1ci-6 amendada):** verbatim para escada de status + `findOrCreateContact` + `flagBroadcastReplyIfAny` + `lookupInternalIdByMetaId` + bloco de fan-out. Reescrita coberta por teste para: cabeça do orquestrador, caminho de mídia (`parseMessageContent` → adaptador + `fetchMedia`), assinatura do `mirrorInboundMedia`.

---

## Task 1: Migração 041 + verify-schema

**Files:**
- Create: `supabase/migrations/041_connection_id_not_null.sql`
- Modify: `supabase/ci/verify-schema.sql`

**Interfaces:**
- Produces: coluna `conversations.connection_id` `NOT NULL` + FK `ON DELETE RESTRICT`; idem `broadcasts.connection_id`; constraint `whatsapp_connections_one_primary` (EXCLUDE, deferível) no lugar do índice `idx_connections_one_primary`; função `public.set_primary_connection(p_id uuid, p_account_id uuid) RETURNS void`; `create_broadcast_with_recipients` reescrita setando `connection_id`.

- [ ] **Step 1: Escrever `041_connection_id_not_null.sql`**

```sql
-- ============================================================
-- 041 — connection_id NOT NULL + is_primary atômico
--
-- Onda 1c-i. QUEBRA COORDENADA: sobe junto com
-- findOrCreateConnectionAwareConversation setando connection_id.
-- Spec: docs/superpowers/specs/2026-08-30-uazapi-onda-1c-i-inbound-seam.md
-- ============================================================

-- ------------------------------------------------------------
-- 1. is_primary atômico: índice parcial → EXCLUDE deferível
-- ------------------------------------------------------------
DROP INDEX IF EXISTS idx_connections_one_primary;

ALTER TABLE whatsapp_connections
  ADD CONSTRAINT whatsapp_connections_one_primary
  EXCLUDE (account_id WITH =) WHERE (is_primary AND archived_at IS NULL)
  DEFERRABLE INITIALLY DEFERRED;

CREATE OR REPLACE FUNCTION public.set_primary_connection(
  p_id UUID,
  p_account_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_account_member(p_account_id, 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Um statement só: com o EXCLUDE INITIALLY DEFERRED, a checagem roda
  -- no COMMIT, quando exatamente uma linha é is_primary.
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
END;
$$;

REVOKE ALL ON FUNCTION public.set_primary_connection(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_primary_connection(UUID, UUID) TO service_role;

-- ------------------------------------------------------------
-- 2. conversations.connection_id
-- ------------------------------------------------------------
-- Órfã: conta sem conexão meta ativa. connection_id não tem a quem
-- pertencer; o inbound desse contato já falha hoje. Apaga (messages
-- via cascade).
DELETE FROM conversations c
  WHERE c.connection_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM whatsapp_connections wc
      WHERE wc.account_id = c.account_id
        AND wc.provider = 'meta' AND wc.archived_at IS NULL
    );

UPDATE conversations c
  SET connection_id = wc.id
  FROM whatsapp_connections wc
  WHERE c.connection_id IS NULL
    AND wc.account_id = c.account_id
    AND wc.provider = 'meta' AND wc.archived_at IS NULL;

DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM conversations WHERE connection_id IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION '041: % conversations still NULL connection_id after backfill', n;
  END IF;
END $$;

ALTER TABLE conversations ALTER COLUMN connection_id SET NOT NULL;
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_connection_id_fkey;
ALTER TABLE conversations
  ADD CONSTRAINT conversations_connection_id_fkey
  FOREIGN KEY (connection_id) REFERENCES whatsapp_connections(id)
  ON DELETE RESTRICT;

-- ------------------------------------------------------------
-- 3. broadcasts.connection_id (mesma estrutura)
-- ------------------------------------------------------------
DELETE FROM broadcasts b
  WHERE b.connection_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM whatsapp_connections wc
      WHERE wc.account_id = b.account_id
        AND wc.provider = 'meta' AND wc.archived_at IS NULL
    );

UPDATE broadcasts b
  SET connection_id = wc.id
  FROM whatsapp_connections wc
  WHERE b.connection_id IS NULL
    AND wc.account_id = b.account_id
    AND wc.provider = 'meta' AND wc.archived_at IS NULL;

DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM broadcasts WHERE connection_id IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION '041: % broadcasts still NULL connection_id after backfill', n;
  END IF;
END $$;

ALTER TABLE broadcasts ALTER COLUMN connection_id SET NOT NULL;
ALTER TABLE broadcasts DROP CONSTRAINT IF EXISTS broadcasts_connection_id_fkey;
ALTER TABLE broadcasts
  ADD CONSTRAINT broadcasts_connection_id_fkey
  FOREIGN KEY (connection_id) REFERENCES whatsapp_connections(id)
  ON DELETE RESTRICT;

-- ------------------------------------------------------------
-- 4. create_broadcast_with_recipients: setar connection_id
--    Corpo byte-idêntico ao da 038 exceto o INSERT em broadcasts.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_broadcast_with_recipients(
  p_account_id        UUID,
  p_user_id           UUID,
  p_name              TEXT,
  p_template_name     TEXT,
  p_template_language TEXT,
  p_total_recipients  INTEGER,
  p_contact_ids       UUID[],
  p_template_params   JSONB[]
)
RETURNS TABLE(broadcast_id UUID, recipient_id UUID, contact_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_broadcast_id UUID;
  v_connection_id UUID;
BEGIN
  SELECT id INTO v_connection_id
  FROM whatsapp_connections
  WHERE account_id = p_account_id AND is_primary AND archived_at IS NULL;

  IF v_connection_id IS NULL THEN
    RAISE EXCEPTION 'no primary WhatsApp connection for account %', p_account_id
      USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO broadcasts (
    account_id, user_id, name, template_name,
    template_language, status, total_recipients, connection_id
  )
  VALUES (
    p_account_id, p_user_id, p_name, p_template_name,
    p_template_language, 'sending', p_total_recipients, v_connection_id
  )
  RETURNING id INTO v_broadcast_id;

  RETURN QUERY
  WITH ins AS (
    INSERT INTO broadcast_recipients (
      broadcast_id, contact_id, status, template_params
    )
    SELECT v_broadcast_id, t.cid, 'pending', t.prm
    FROM unnest(p_contact_ids, p_template_params) AS t(cid, prm)
    RETURNING id, contact_id
  )
  SELECT v_broadcast_id, ins.id, ins.contact_id
  FROM ins;
END;
$$;

REVOKE ALL ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[]) TO service_role;
```

> Nota ao implementador: o nome do constraint FK (`conversations_connection_id_fkey` / `broadcasts_connection_id_fkey`) é o default do Postgres para FK inline em `ADD COLUMN` (migração 040). `DROP CONSTRAINT IF EXISTS` tolera nome errado; se o `migrations.yml` reclamar de constraint não removido, o log do CI dá o nome real — ajuste e recommit. `is_account_member` tem assinatura `(UUID, account_role_enum)` — `'admin'` faz cast implícito.

- [ ] **Step 2: `verify-schema.sql`** — dentro do único `DO $$ … $$;`, acrescentar (seguindo o estilo das asserções existentes):

```sql
  -- 041: conversations.connection_id NOT NULL
  IF (SELECT is_nullable FROM information_schema.columns
      WHERE table_name = 'conversations' AND column_name = 'connection_id') <> 'NO' THEN
    RAISE EXCEPTION 'verify-schema: conversations.connection_id is nullable';
  END IF;

  -- 041: FK ON DELETE RESTRICT
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'conversations_connection_id_fkey' AND confdeltype = 'r'
  ) THEN
    RAISE EXCEPTION 'verify-schema: conversations FK is not ON DELETE RESTRICT';
  END IF;

  -- 041: is_primary EXCLUDE constraint, deferível
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'whatsapp_connections_one_primary'
      AND contype = 'x' AND condeferrable
  ) THEN
    RAISE EXCEPTION 'verify-schema: one_primary is not a deferrable exclusion constraint';
  END IF;
```

- [ ] **Step 3: Commit** `git add supabase/migrations/041_connection_id_not_null.sql supabase/ci/verify-schema.sql && git commit -m "feat(db): migration 041 — connection_id NOT NULL + deferrable one-primary + set_primary_connection RPC"`

> Sem gate local (a migração só roda no CI). `npm run typecheck && npm run lint` mesmo assim (não deve tocar TS, mas confirma que nada quebrou).

---

## Task 2: `fetchMedia` na interface de transporte + `mirrorInboundMedia` por bytes

**Files:**
- Modify: `src/lib/whatsapp/providers/types.ts`, `providers/meta-transport.ts`, `providers/uazapi-transport.ts`, `providers/transport-contract.test.ts`
- Modify: `src/lib/whatsapp/mirror-inbound-media.ts`, `mirror-inbound-media.test.ts`
- Create: `src/lib/whatsapp/inbound/types.ts` (só `ProviderMediaRef` aqui; `InboundMessage`/`InboundStatus` na T3/T5 — ou tudo aqui, ver Step 1)

**Interfaces:**
- Consumes: `getMediaUrl`, `downloadMedia` (`@/lib/whatsapp/meta-api`).
- Produces:
  - `type ProviderMediaRef = { provider: 'meta'; mediaId: string } | { provider: 'uazapi'; [k: string]: unknown }` em `src/lib/whatsapp/inbound/types.ts`.
  - `WhatsAppTransport.fetchMedia(ref: ProviderMediaRef): Promise<{ bytes: Uint8Array; mimeType: string; filename?: string }>`.
  - `MirrorInboundMediaArgs`: remove `downloadUrl` e `accessToken`; adiciona `bytes: Uint8Array`.

- [ ] **Step 1: `src/lib/whatsapp/inbound/types.ts`** — criar com **só** `ProviderMediaRef` (o resto entra na T3/T5; mas se preferir, defina `InboundMessage`/`InboundStatus` aqui já — a spec §3.2 tem a forma exata. O plano assume que a T5 os cria; se a T2 os criar, a T5 só importa).

```ts
import type { MediaKind } from '@/lib/whatsapp/meta-api';

export type ProviderMediaRef =
  | { provider: 'meta'; mediaId: string }
  | { provider: 'uazapi'; [k: string]: unknown };
```

- [ ] **Step 2: `providers/types.ts`** — adicionar à interface `WhatsAppTransport`, depois de `sendReaction`:

```ts
  /**
   * Baixa os bytes de uma mídia recebida. Meta: getMediaUrl + downloadMedia.
   * UAZAPI: POST /message/download (Onda 1c-ii — hoje lança).
   */
  fetchMedia(ref: ProviderMediaRef): Promise<{
    bytes: Uint8Array;
    mimeType: string;
    filename?: string;
  }>;
```

`import type { ProviderMediaRef } from '@/lib/whatsapp/inbound/types';` no topo.

- [ ] **Step 3: teste que falha** — em `transport-contract.test.ts`, dentro do `describe.each`, acrescentar (adaptando aos helpers do arquivo):

```ts
it('fetchMedia: meta delega para a API; uazapi lança', async () => {
  const t = make();
  if (name === 'meta') {
    // getMediaUrl/downloadMedia já são mockados no arquivo (vi.mock meta-api)
    const out = await t.fetchMedia({ provider: 'meta', mediaId: 'm-1' });
    expect(out).toMatchObject({ bytes: expect.any(Uint8Array), mimeType: expect.any(String) });
  } else {
    await expect(t.fetchMedia({ provider: 'uazapi' } as never)).rejects.toThrow(/1c-ii/);
  }
});
```

- [ ] **Step 4: `providers/meta-transport.ts`** — implementar:

```ts
async fetchMedia(ref) {
  if (ref.provider !== 'meta') {
    throw new Error(`meta transport: unexpected media ref provider ${ref.provider}`);
  }
  const info = await getMediaUrl({ mediaId: ref.mediaId, accessToken: conn.credential });
  const { buffer, contentType } = await downloadMedia({
    downloadUrl: info.url,
    accessToken: conn.credential,
  });
  return {
    bytes: new Uint8Array(buffer),
    mimeType: info.mimeType || contentType,
  };
},
```

(`getMediaUrl` retorna `{ url, mimeType, fileSize }`; `downloadMedia({ downloadUrl, accessToken })` retorna `{ buffer: Buffer, contentType }`.)

- [ ] **Step 5: `providers/uazapi-transport.ts`** — stub:

```ts
fetchMedia(): Promise<{ bytes: Uint8Array; mimeType: string; filename?: string }> {
  throw new Error('uazapi fetchMedia: implementado na Onda 1c-ii');
},
```

- [ ] **Step 6: `mirror-inbound-media.ts`** — `MirrorInboundMediaArgs`: remover `downloadUrl` e `accessToken`, adicionar `bytes: Uint8Array`. No corpo de `mirrorInboundMedia`, remover o `fetch(downloadUrl, { headers: Authorization })` e usar `args.bytes` direto (o resto — cálculo de path, checagem de `MEDIA_MAX_BYTES` contra `bytes.byteLength`, upload — fica igual). `fileSize` passa a ser `bytes.byteLength` quando não informado.

- [ ] **Step 7: `mirror-inbound-media.test.ts`** — trocar os args (`bytes: new Uint8Array([...])` no lugar de `downloadUrl`/`accessToken`); remover mocks do `fetch` de download. **Toda asserção de comportamento fica** (fallback em upload recusado, skip de arquivo grande, nome do objeto pelo filename, opt-out).

- [ ] **Step 8: rodar** `npx vitest run src/lib/whatsapp/providers/transport-contract.test.ts src/lib/whatsapp/providers/meta-transport.test.ts src/lib/whatsapp/mirror-inbound-media.test.ts` → verde. `npx vitest run src/app/api/whatsapp/webhook/route.test.ts` → os 8 testes de mídia **provavelmente falham aqui** porque a rota ainda chama o fluxo antigo. **Isso é esperado nesta task** — a rota só liga no novo na T5/T6. Registrar no report quais falham e confirmar que é só o esperado (mídia), não outros.

> **Ruling do controlador na dispatch:** a T2 deixa `webhook/route.ts` temporariamente quebrado no caminho de mídia (a rota chama `mirrorInboundMedia` com a assinatura antiga). Aceito — a T5 conserta ao reescrever o caminho de mídia. A T2 NÃO tenta remendar `webhook/route.ts`. Portas da T2: os 3 arquivos de teste do Step 8 + typecheck + lint. `npm test` inteiro fica com os 8 de mídia vermelhos até a T5.

- [ ] **Step 9: Commit** `git commit -m "feat(whatsapp): fetchMedia on the transport interface; mirrorInboundMedia takes bytes"`

---

## Task 3: Extrair `process-status-update.ts` (verbatim)

**Files:**
- Create: `src/lib/whatsapp/inbound/process-status-update.ts`, `.../process-status-update.test.ts`
- Modify: `src/lib/whatsapp/inbound/types.ts` (+ `InboundStatus`)

**Interfaces:**
- Consumes: `dispatchWebhookEvent` (`@/lib/webhooks/deliver`), um client Supabase service-role.
- Produces:
  - `InboundStatus = { connectionId: string; accountId: string; providerMessageId: string; status: string; timestamp: Date }`.
  - `processStatusUpdate(db: SupabaseClient, s: InboundStatus): Promise<void>` — move `handleStatusUpdate` **verbatim**, trocando: `status.id` → `s.providerMessageId`; `status.status` → `s.status`; `new Date(parseInt(status.timestamp) * 1000)` → `s.timestamp`; `supabaseAdmin()` → `db`. A resolução de `accountId` para o `dispatchWebhookEvent` continua sendo o `SELECT messages … conversations(account_id)` de hoje (o `s.accountId` é redundante mas mantido na interface por simetria com `InboundMessage`).
  - `RECIPIENT_STATUS_LADDER`, `ladderLevel`, `isValidStatusTransition` — movidos verbatim, exportados (o teste os usa).

- [ ] **Step 1: teste que falha** — `process-status-update.test.ts`: a escada `pending→sent→delivered→read→replied`; `failed` só a partir de `pending`/`sent`; `failed` é terminal; status desconhecido rejeitado; replay não regride. Mockar Supabase (chainable) + `@/lib/webhooks/deliver`. Modelar no shape de `webhook/route.test.ts`.
- [ ] **Step 2: implementar** — recorte de `webhook/route.ts:331-459` (o bloco `RECIPIENT_STATUS_LADDER` até o fim de `handleStatusUpdate`) para o módulo novo, com as substituições da seção Interfaces. **Sem** reescrever a lógica.
- [ ] **Step 3: rodar** o teste novo → verde. `npm run typecheck && npm run lint`.
- [ ] **Step 4: Commit** `git commit -m "refactor(whatsapp): extract processStatusUpdate to inbound/ (verbatim)"`

> A rota ainda tem a cópia de `handleStatusUpdate` — a T5/T6 remove. Sem drift porque a T3 não muda a lógica.

---

## Task 4: Extrair `find-or-create.ts`

**Files:**
- Create: `src/lib/whatsapp/inbound/find-or-create.ts`
- (teste: coberto indiretamente pela T5 e por `webhook/route.test.ts`)

**Interfaces:**
- Produces:
  - `findOrCreateContact(db, accountId, configOwnerUserId, phone, name): Promise<ContactOutcome | null>` — **verbatim** de `webhook/route.ts` (`supabaseAdmin()` → `db`).
  - `findOrCreateConnectionAwareConversation(db, accountId, configOwnerUserId, contactId, connectionId): Promise<{ conversation; created: boolean } | null>` — era `findOrCreateConversation`; a busca ganha `.eq('connection_id', connectionId)` e o INSERT inclui `connection_id: connectionId`. O fallback de race (`isUniqueViolation` → re-SELECT) também filtra por `connection_id`.
- Consumes: `ContactOutcome` type (mover junto ou re-declarar em `find-or-create.ts`).

- [ ] **Step 1: implementar** — recorte de `findOrCreateContact` (verbatim) + `findOrCreateConversation` (com a mudança de connection-aware) para o módulo. `ContactOutcome`/`ContactRow` types vão junto.
- [ ] **Step 2: rodar** `npm run typecheck && npm run lint`. (Sem teste dedicado — a T5's `process-inbound-message.test.ts` exercita `findOrCreateConnectionAwareConversation` com dois `connectionId` → duas conversas.)
- [ ] **Step 3: Commit** `git commit -m "refactor(whatsapp): extract find-or-create to inbound/; conversation lookup is connection-aware"`

---

## Task 5: `process-inbound-message.ts` + adaptador Meta + corte da rota

**Files:**
- Create: `src/lib/whatsapp/inbound/process-inbound-message.ts`, `.../meta-adapter.ts`, `.../process-inbound-message.test.ts`, `.../meta-adapter.test.ts`
- Modify: `src/lib/whatsapp/inbound/types.ts` (+ `InboundMessage`), `src/app/api/whatsapp/webhook/route.ts`, `src/app/api/whatsapp/webhook/route.test.ts`

**Interfaces:**
- Consumes: `processStatusUpdate` (T3), `findOrCreateContact` + `findOrCreateConnectionAwareConversation` (T4), `createTransport` (`@/lib/whatsapp/providers`), `resolveConnection`-style row load (ou o `db.from('whatsapp_connections').select('*').eq('id', connectionId)`), `mirrorInboundMedia` (T2, agora por `bytes`), `reopenClosedConversation`, `dispatchWebhookEvent`, `dispatchInboundToFlows`, `runAutomationsForTrigger`, `dispatchInboundToAiReply`, `bump_conversation_on_inbound` RPC.
- Produces:
  - `InboundMessage` (forma exata da spec §3.2).
  - `processInboundMessage(db: SupabaseClient, msg: InboundMessage): Promise<void>`.
  - `meta-adapter.ts`: `metaMessageToInbound(message: WhatsAppMessage, contact, row): InboundMessage`, `metaStatusToInbound(status, row): InboundStatus`.

- [ ] **Step 1: `types.ts` + `InboundMessage`** — colar a forma da spec §3.2 verbatim.

- [ ] **Step 2: `meta-adapter.ts` + teste que falha** — `metaMessageToInbound` reimplementa a decisão de `parseMessageContent` (`switch (message.type)`), mas em vez de `mediaUrl` produz `content.kind` + `content.ref = { provider:'meta', mediaId }` + `caption`/`filename`/`mimeType`/`mediaKind`. Mapeamentos preservados: `sticker`→`media`/`image`; `button`→`interactive_reply` com `replyId = payload || label`; `interactive`→`interactive_reply`; `reaction`→`reaction`; `location`→`location`; desconhecido→`unsupported` com `rawType`. `metaStatusToInbound`: `{ providerMessageId: status.id, status: status.status, timestamp: new Date(parseInt(status.timestamp)*1000), connectionId, accountId }`. Teste: uma caixa por `message.type`.

- [ ] **Step 3: `process-inbound-message.ts` + teste que falha.**
  - **Cabeça (reescrita):** `findOrCreateContact` → `findOrCreateConnectionAwareConversation(…, msg.connectionId)` → emitir `conversation.created` se `created` (ANTES do short-circuit de reação — comentário preservado) → se `msg.content.kind === 'reaction'`: `handleReaction`-equivalente (usa `msg.content.targetProviderMessageId` + `msg.content.emoji`) e `return` → resolver `replyToInternalId` de `msg.replyToProviderMessageId` via `lookupInternalIdByMetaId` → mapear `content_type` (de `msg.content.kind` + `mediaKind`) para o CHECK → insert idempotente (`upsert` `onConflict: 'conversation_id,message_id'`, `ignoreDuplicates`) → replay short-circuit → `bump_conversation_on_inbound`.
  - **Caminho de mídia (reescrito):** quando `msg.content.kind === 'media'` e a conta não optou-out: `const transport = createTransport(<conn do connectionId>)` → `const { bytes, mimeType, filename } = await transport.fetchMedia(msg.content.ref)` → `mirrorInboundMedia({ storage, accountId, mediaId: <ref.mediaId>, bytes, mimeType, fileName: filename ?? msg.content.filename, messageTimestamp, fileSize: bytes.byteLength })` → se der `null`, fallback `/api/whatsapp/media/${ref.mediaId}` (Meta) — para `provider:'uazapi'` o fallback é `null` (1c-ii resolve). Erro do `fetchMedia` → log + `mediaUrl = null` (best-effort, igual hoje).
  - **Fan-out (quase verbatim):** `reopenClosedConversation` → `flagBroadcastReplyIfAny` → `dispatchInboundToFlows` (montando `message` de `msg.content`) → `runAutomationsForTrigger` loop (mesma lista de triggers, mesma supressão por `flowConsumed`, `new_contact_created`/`first_inbound_message` iguais) → `dispatchInboundToAiReply` (mesmos gates) → `dispatchWebhookEvent('message.received', …)`. **Comentários de ordenação preservados.**
  - `handleReaction`, `lookupInternalIdByMetaId`, `flagBroadcastReplyIfAny` movidos verbatim (`supabaseAdmin()` → `db`).
  - **Teste `process-inbound-message.test.ts`:** texto (persiste + fan-out); replay (no-op); reação (upsert em `message_reactions`, sem `messages`); mídia (com `fetchMedia` mockado devolvendo bytes → `mirrorInboundMedia` mockado → `media_url` durável; e o caso de `mirrorInboundMedia` → `null` → fallback proxy); `unsupported`; **dois `connectionId` diferentes para o mesmo contato → duas conversas** (a asserção-chave da mudança).

- [ ] **Step 4: cortar `webhook/route.ts`** (ruling PF-B — a T5 faz o corte):
  - `processWebhook` vira: para cada `change`, resolver a linha de conexão por `phone_number_id` (query atual, já com `.eq('provider','meta').is('archived_at',null)`) → `connectionId = row.id`; para cada `value.statuses[]`: `await processStatusUpdate(db, metaStatusToInbound(status, row))`; para cada `value.messages[]`: `await processInboundMessage(db, metaMessageToInbound(message, contact, row))`.
  - Remover de `route.ts`: `processMessage`, `parseMessageContent`, `handleStatusUpdate`, `handleReaction`, `findOrCreate*`, `flagBroadcastReplyIfAny`, `lookupInternalIdByMetaId`, `ladderLevel`, `isValidStatusTransition`, `RECIPIENT_STATUS_LADDER`, `ContactOutcome`/`ContactRow`, e os imports que só eles usavam (`getMediaUrl`, `downloadMedia`, `mirrorInboundMedia`, engines, `dispatchWebhookEvent` se não usado noutro lugar). Manter: `GET`, `POST`, `verifyMetaWebhookSignature`, `supabaseAdmin`, `after`, `isTemplateWebhookField`/`handleTemplateWebhookChange` (template lifecycle — **não** faz parte do seam), tipos `WhatsAppWebhookEntry`/`WhatsAppMessage` (movê-los para `meta-adapter.ts` ou um `types` compartilhado se o adaptador precisar).
  - `webhook/route.test.ts`: **só** o enabler — o mock do Supabase, quando `.from('whatsapp_connections')`, devolve uma linha com `id`, `account_id`, `user_id`, `credential`, `provider: 'meta'`, `phone_number_id`, `mirror_inbound_media`, `uazapi_base_url: null` etc, para o `createTransport` no caminho de mídia funcionar. **Nenhuma** asserção muda.

- [ ] **Step 5: rodar** `npx vitest run src/lib/whatsapp/inbound src/app/api/whatsapp/webhook/route.test.ts` → tudo verde, **incluindo os 8 de mídia** (agora ligados no fluxo novo). `npx vitest run` → baseline 5.
- [ ] **Step 6:** `npm run typecheck && npm run lint`.
- [ ] **Step 7: Commit** `git commit -m "refactor(whatsapp): extract processInboundMessage + meta envelope adapter; connection-aware conversations"`

> Se o Step 4 (corte da rota) ficar desproporcional junto com o Step 3, reporta `DONE_WITH_CONCERNS` deixando o corte pra T6 e a T6 vira a metade de rota (ruling PF-B).

---

## Task 6: Limpeza final da rota + build

**Files:**
- Modify: `src/app/api/whatsapp/webhook/route.ts` (só se a T5 reportou o corte incompleto)

- [ ] **Step 1:** Se a T5 completou o corte: esta task é só verificação. `npm run build` → sucesso. `npx vitest run src/app/api/whatsapp/webhook/route.test.ts` → ~20 verdes. Confirmar `wc -l src/app/api/whatsapp/webhook/route.ts` ≈ 350.
- [ ] **Step 2:** Se a T5 deixou o corte pra cá: executar o Step 4 da T5 (remover funções mortas, encolher, enabler do mock), depois Step 1.
- [ ] **Step 3:** `npm run typecheck && npm run lint && npm run build && npx vitest run` (baseline 5).
- [ ] **Step 4: Commit** (só se tocou algo) `git commit -m "refactor(whatsapp): shrink the Meta webhook route to HTTP + envelope adapter"`

---

## Task 7: `PATCH /connections/[id]` → RPC `set_primary_connection`

**Files:**
- Modify: `src/app/api/whatsapp/connections/[id]/route.ts`, `.../route.test.ts`

**Interfaces:**
- Consumes: RPC `set_primary_connection(p_id, p_account_id)` (T1).

- [ ] **Step 1: `route.ts`** — no ramo `body.is_primary === true`, substituir o bloco `clearError` + `patch.is_primary = true` por:

```ts
    if (body.is_primary === true) {
      // Promoção atômica: a RPC faz UPDATE ... SET is_primary = (id = p_id)
      // num statement só; o EXCLUDE deferível (migração 041) checa no
      // COMMIT. Sem janela de 0 primárias.
      const { error: rpcError } = await supabase.rpc('set_primary_connection', {
        p_id: id,
        p_account_id: accountId,
      });
      if (rpcError) {
        const code = (rpcError as { code?: string }).code;
        if (code === 'P0002') {
          return NextResponse.json({ error: 'Connection not found' }, { status: 404 });
        }
        if (code === '42501') {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        console.error('[connections PATCH] set_primary_connection', rpcError);
        return NextResponse.json({ error: 'Failed to update connection' }, { status: 500 });
      }
      // is_primary já foi aplicado pela RPC — NÃO adicionar a `patch`.
    } else if (body.is_primary === false) {
      // …inalterado…
    }
```

> O `patch` genérico embaixo continua cuidando de `label`/`mirror_inbound_media`. Confirmar que `is_primary: true` **não** entra em `patch` (senão dois writes).

- [ ] **Step 2: `route.test.ts`** — reescrever os 3 testes `FIX 1`:
  - "is_primary:true → CLEARS the other active rows FIRST…" → **"is_primary:true → chama a RPC set_primary_connection com { p_id, p_account_id }"**. Mockar `supabase.rpc` (o mock do arquivo precisa ganhar um `rpc: vi.fn().mockResolvedValue({ error: null })`). Asserir a chamada e status 200.
  - "is_primary:true dodges the one-primary unique index…" → **remover** (o cenário não existe mais) ou converter em "a RPC retornando `{ error: null }` → 200".
  - "is_primary:true 500s if clearing the other primaries fails…" → **"is_primary:true: RPC com error code P0002 → 404; outro error → 500"**.
  - Remover o mock `simulateOnePrimaryIndex` / `primariesCleared` e o branch de UPDATE que os usa.
  - Os testes de `is_primary:false` (sole-connection 400; 2+ ativas → false) **ficam** (esse ramo não mudou).

- [ ] **Step 3: rodar** `npx vitest run src/app/api/whatsapp/connections` → verde. `npm run typecheck && npm run lint && npx vitest run` (baseline 5).
- [ ] **Step 4: Commit** `git commit -m "refactor(whatsapp): PATCH primary promotion via set_primary_connection RPC"`

---

## Self-Review (autor do plano)

**1. Cobertura da spec:**
- §2.1 migração 041 → T1 ✓ (backfill + guard + NOT NULL + RESTRICT + EXCLUDE + RPC + `create_broadcast_with_recipients` + verify-schema)
- §2.2 módulo `inbound/` → T3 (status), T4 (find-or-create), T5 (process-inbound + adapter) ✓
- §2.3 rota encolhida → T5 Step 4 + T6 ✓
- §2.4 conversa connection-aware → T4 + T5 ✓
- §2.5 `fetchMedia` → T2 ✓
- §2.6 RPC no PATCH → T7 ✓
- §5 critério de aceite → cada task tem testes; `webhook/route.test.ts` sem mudança de asserção (T5 Step 4); os 3 `FIX 1` reescritos (T7, pré-declarado) ✓

**2. Placeholders:** o único "a T5/T6 decide" é o corte da rota (ruling PF-B, com fallback explícito). `ProviderMediaRef` uazapi = `[k: string]: unknown` é forward-ref deliberado. Nomes de constraint FK = default do PG, com instrução de ajuste se o CI reclamar.

**3. Consistência de tipos:**
- `InboundMessage`/`InboundStatus`/`ProviderMediaRef` — `types.ts` criado na T2 (só `ProviderMediaRef`) e completado na T3 (`InboundStatus`) / T5 (`InboundMessage`). **Risco:** se T3 roda antes de T5 e T5 antes… ok, ordem T2→T3→T4→T5. Cada uma adiciona seu tipo. Sem colisão.
- `fetchMedia` retorno `{ bytes: Uint8Array; mimeType: string; filename? }` — consumido por T5 (`mirrorInboundMedia` agora quer `bytes`). Casam.
- `set_primary_connection(p_id, p_account_id)` — T1 define, T7 chama com `{ p_id, p_account_id }`. Casa.
- `MirrorInboundMediaArgs.bytes` (T2) ↔ T5 passa `bytes`. Casa.

**4. Ordem:** T1 (migração, independente) → T2 (`fetchMedia` + mirror; deixa a rota quebrada no caminho de mídia — aceito) → T3 (status verbatim) → T4 (find-or-create) → T5 (process-inbound + corte da rota; conserta o caminho de mídia) → T6 (limpeza/build) → T7 (PATCH RPC). T2 é a única com "baseline vermelho temporário" (8 testes de mídia), resolvido na T5.

---

## Execution Handoff

Plano salvo em `docs/superpowers/plans/2026-08-30-uazapi-onda-1c-i-inbound-seam.md`. Duas opções:

**1. Subagent-Driven (recomendado)** — subagente fresco por task, review entre tasks.

**2. Inline** — tasks nesta sessão com checkpoints.

Qual?
