# Onda 1a — Migração 040 (rename puro) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Renomear `whatsapp_config` → `whatsapp_connections` (e a coluna
`access_token` → `credential`), adicionar as colunas/índices que a spec-mãe
§4.1 exige, e atualizar todos os call sites em lockstep — sem mudança de
comportamento observável, ainda só-Meta.

**Architecture:** A migração `040_whatsapp_connections.sql` renomeia a
tabela e a coluna, adiciona 10 colunas (usadas só na 1b/1c/Onda 3),
troca 3 índices, amplia o CHECK de `status`, e adiciona
`connection_id` a `conversations` e `broadcasts` com backfill para a
conexão única do account. O código muda por **rename mecânico** da string
literal `'whatsapp_config'` e da propriedade `.access_token` lida da
linha; `resolve-connection.ts` e `/api/whatsapp/config` ganham também
`.eq('provider', 'meta')` (a rota é específica da Meta). Não há tipos
gerados do Supabase — a rede de segurança é grep exaustivo + falha alta
em runtime + o rename da coluna que se autoverifica.

**Tech Stack:** TypeScript 6, Next.js 16.2.12 (App Router), Supabase JS
2.107, Postgres (migrações versionadas em `supabase/migrations/`),
Vitest 4.1.10 (`environment: node`), Prettier (`semi: true`,
`singleQuote: true`, `printWidth: 80`, `trailingComma: es5`).

**Spec:** `docs/superpowers/specs/2026-08-28-uazapi-onda-1a-migracao-040.md`
(spec-mãe: `docs/superpowers/specs/2026-08-27-uazapi-provider-design.md`,
§4.1 é a fonte do detalhe de schema)

## Global Constraints

- **Critério de aceite (spec 1a §5):** rename puro, zero mudança de
  comportamento observável. A suíte existente passa **inalterada**,
  exceto o rename mecânico do identificador `whatsapp_config` →
  `whatsapp_connections` e `access_token` → `credential` em fixtures e
  mocks. Qualquer teste cuja **asserção de comportamento** precise mudar
  é um defeito, não um ajuste. **Nenhum arquivo de teste novo, nenhum
  caso de teste novo** — os testes de cobertura da Onda 0 foram movidos
  para a 1b.
- **Regra de lockstep para mocks de teste:** um `.test.ts` cujo caminho
  mockado alcança `resolveConnection()` tem o rename do identificador do
  mock (`'whatsapp_config'` → `'whatsapp_connections'`, `access_token` →
  `credential` na fixture) feito **junto da Task 2**, não da Task 5 —
  senão a suíte fica vermelha entre as tasks. São
  `send/route.test.ts`, `broadcast-core.test.ts`,
  `broadcast-resume.test.ts`, `send-message.test.ts` (mais o próprio
  `resolve-connection.test.ts`). Os testes cujo arquivo de produção só é
  renomeado na Task 5 (`webhook/route.test.ts`,
  `resolve-conversation.test.ts`, `contacts.test.ts`) ficam na Task 5.
- **Contrato HTTP público inalterado byte a byte.** `/api/whatsapp/config`
  (GET/POST/DELETE), `/api/whatsapp/webhook`, `/api/whatsapp/templates/*`,
  `/api/whatsapp/media/*` — mesmos códigos, mensagens e formatos de
  resposta.
- **`.eq('provider', 'meta')` é adicionado em exatamente dois lugares:**
  `src/lib/whatsapp/resolve-connection.ts` e
  `src/app/api/whatsapp/config/route.ts` (a rota específica da Meta —
  spec-mãe §4.4). Todos os outros call sites recebem **só o rename**,
  sem filtro de provider (com uma linha por account o filtro é no-op; o
  hardening dos demais é da 1b).
- **Nenhum código, rota, env var ou UI de UAZAPI.** A coluna `provider`
  existe porque a migração a cria; nada a escreve com valor `'uazapi'`.
- **`access_token` → `credential` é por ocorrência, não find-replace.**
  Só renomeia a leitura da coluna da linha de config/conexão
  (`config.access_token` → `config.credential`) e o campo do tipo
  `WhatsAppConfig`. **Não** mexe no parâmetro `accessToken` (camelCase)
  das chamadas a `meta-api`, nem no `access_token` do upload resumível
  da Meta.
- **Nenhuma outra migração `supabase/migrations/*` é criada ou alterada.**
  Só a 040 e `supabase/ci/verify-schema.sql`.
- Comandos de verificação: `npm test`, `npm run typecheck`,
  `npm run lint`, `npm run build`. A migração é validada por
  `.github/workflows/migrations.yml` no PR (`supabase db reset --local`
  + `verify-schema.sql`); localmente não há Supabase CLI nem Docker.
- Rode `npx prettier --write <arquivos tocados>` antes de cada commit.
- Baseline da suíte: **851 passando / 5 falhando** (as 5 são locale/fuso
  pré-existentes em `currency.test.ts` ×3 e `dashboard/date-utils.test.ts`
  ×2). A 1a mantém **851 / 5** — só renames de identificador em mock, que
  não mudam contagem.

---

## Estrutura de arquivos

**Criados**

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/040_whatsapp_connections.sql` | O rename da tabela + coluna, as 10 colunas novas, os 3 índices trocados, o CHECK de `status` ampliado, `conversations.connection_id` e `broadcasts.connection_id` com backfill. |

**Modificados**

| Arquivo | Mudança |
|---|---|
| `supabase/ci/verify-schema.sql` | `to_regclass('public.whatsapp_config')` → `'public.whatsapp_connections'`. |
| `src/lib/whatsapp/resolve-connection.ts` | Rename da tabela (×2) + `.eq('provider','meta')` no select + `credential` (×3) + comentário de cabeçalho no presente. |
| `src/lib/whatsapp/resolve-connection.test.ts` | Rename do identificador no mock. |
| `src/app/api/whatsapp/send/route.test.ts` | Rename do identificador no mock DB (`case 'whatsapp_config'` + `access_token`) — o caminho passa por `resolveConnection`. |
| `src/lib/whatsapp/broadcast-core.test.ts` | Idem (`if (table === 'whatsapp_config')` + `access_token`). |
| `src/lib/whatsapp/broadcast-resume.test.ts` | Idem (`CONFIG` fixture + qualquer check de tabela no mock). |
| `src/lib/whatsapp/send-message.test.ts` | Idem (`if (table === 'whatsapp_config')` + `access_token`). |
| `src/types/index.ts` | `WhatsAppConfig.access_token` → `credential`; `status` ampliado; `+ provider`. |
| `src/app/api/whatsapp/config/route.ts` | Rename (×6 `.from`) + `.eq('provider','meta')` em select/update/delete + `provider: 'meta'` no insert + `credential` nos objetos + strings de log. |
| `src/lib/whatsapp/resolve-conversation.ts` | Rename da tabela (×1). |
| `src/lib/whatsapp/resolve-conversation.test.ts` | Rename do identificador no mock. |
| `src/lib/api/v1/contacts.ts` | Rename da tabela (×1) em `resolveAuditUserId`. |
| `src/lib/api/v1/contacts.test.ts` | Rename do identificador no mock (se houver). |
| `src/app/api/whatsapp/webhook/route.ts` | Rename da tabela (×3) + `decrypt(config.access_token)` → `.credential`. |
| `src/app/api/whatsapp/webhook/route.test.ts` | Rename do identificador no mock. |
| `src/app/api/whatsapp/templates/[id]/route.ts` | Rename da tabela (×2). |
| `src/app/api/whatsapp/templates/submit/route.ts` | Rename da tabela (×1). |
| `src/app/api/whatsapp/templates/sync/route.ts` | Rename da tabela (×1). |
| `src/app/api/whatsapp/media/[mediaId]/route.ts` | Rename da tabela (×1). |
| `src/app/api/whatsapp/config/verify-registration/route.ts` | Rename da tabela (×1). |
| `src/app/(dashboard)/inbox/page.tsx` | Rename da tabela (×1). |
| `src/components/settings/settings-overview.tsx` | Rename da tabela (×1). |
| `src/components/settings/whatsapp-config.tsx` | Rename da tabela (×2) + `.access_token` → `.credential` se lido da linha. |
| Sweep de comentários / strings de log | `encryption.ts`, `meta-api.ts`, `ai/auto-reply.ts`, `automations/meta-send.ts`, `send-core.ts` e os comentários/logs nos arquivos acima. |

**Deliberadamente fora da 1a** (spec 1a §2, §8): resolução em 3 níveis,
união discriminada em `TransportConnection`, mover `mirror_inbound_media`
para rota, qualquer código UAZAPI, o pipeline de inbound, os testes de
cobertura adiados da Onda 0 (movidos para a 1b).

---

## Task 1: Migração `040_whatsapp_connections.sql` + `verify-schema.sql`

**Files:**
- Create: `supabase/migrations/040_whatsapp_connections.sql`
- Modify: `supabase/ci/verify-schema.sql`

**Interfaces:**
- Consumes: o schema atual — tabela `whatsapp_config` (001), coluna
  `access_token NOT NULL`, `phone_number_id NOT NULL`, CHECK
  `whatsapp_config_status_check` (`'connected'|'disconnected'`),
  constraint `whatsapp_config_account_id_key` (017), constraint
  `whatsapp_config_phone_number_id_key` (013), índices
  `idx_whatsapp_config_account` (017) e `idx_whatsapp_config_registered_at`
  (015), políticas `whatsapp_config_{select,insert,update,delete}` (017),
  trigger `set_updated_at` (001); índice
  `idx_conversations_account_contact` (036); índice
  `idx_one_active_run_per_contact` em `flow_runs(account_id, contact_id)
  WHERE status='active'` (017).
- Produces: tabela `whatsapp_connections` com coluna `credential` e as
  10 colunas novas; `conversations.connection_id` e
  `broadcasts.connection_id` **nullable** (`ON DELETE SET NULL`,
  backfilled); `redeem_invitation()` re-criada apontando para o nome
  novo.

> **Verificação:** não há Supabase CLI nem Docker nesta máquina. A
> migração é validada por `.github/workflows/migrations.yml` quando o
> branch é pushado (roda `supabase db reset --local --no-seed` +
> `verify-schema.sql` num Postgres limpo). O Step 4 desta task é uma
> revisão de SQL contra um checklist; o portão de CI é a Task 7.

- [ ] **Step 1: Reler §4.1 da spec-mãe e o schema atual**

Leia:
- `docs/superpowers/specs/2026-08-27-uazapi-provider-design.md` §4.1
  inteira.
- `supabase/migrations/001_initial_schema.sql` — o `CREATE TABLE
  whatsapp_config` (linhas ~189-206) e o `CREATE TRIGGER set_updated_at`
  (~364).
- `supabase/migrations/013_whatsapp_config_phone_number_id_unique.sql`,
  `015_whatsapp_config_registration.sql`, `017_account_sharing.sql`
  (linhas 181, 281, 299-300, 312-326, 337-340, 419-424),
  `036_conversation_contact_dedup.sql` (~125-128),
  `039_inbound_media_mirror.sql` (~64-71).
- Um par de migrações recentes (`038_*`, `039_*`) para o **estilo** do
  repo: cabeçalho em bloco `-- ===`, guardas `IF NOT EXISTS` /
  `DO $$ … pg_constraint`, `COMMENT ON COLUMN`.

- [ ] **Step 2: Escrever `040_whatsapp_connections.sql`**

Crie o arquivo com este conteúdo (ajuste só se o Step 1 revelar um
nome de objeto diferente do assumido — anote qualquer ajuste no report):

```sql
-- ============================================================
-- 040 — whatsapp_config → whatsapp_connections
--
-- Onda 1a do suporte a segundo provedor (UAZAPI). Rename puro: nenhuma
-- linha de código UAZAPI acompanha esta migração; a coluna `provider`
-- nasce com toda linha existente em 'meta'.
--
-- QUEBRA COORDENADA: código que aponta para `whatsapp_config` para de
-- funcionar no instante em que esta migração roda. Migração e aplicação
-- sobem juntas (spec §6).
--
-- Spec: docs/superpowers/specs/2026-08-28-uazapi-onda-1a-migracao-040.md
-- Spec-mãe §4.1: docs/superpowers/specs/2026-08-27-uazapi-provider-design.md
-- ============================================================

-- ------------------------------------------------------------
-- 1. Tabela: rename + coluna credential
-- ------------------------------------------------------------
ALTER TABLE whatsapp_config RENAME TO whatsapp_connections;
ALTER TABLE whatsapp_connections RENAME COLUMN access_token TO credential;

-- ------------------------------------------------------------
-- 2. Colunas novas (não usadas na 1a; ver spec-mãe §4.1)
-- ------------------------------------------------------------
ALTER TABLE whatsapp_connections
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'meta'
    CHECK (provider IN ('meta', 'uazapi')),
  ADD COLUMN IF NOT EXISTS label TEXT,
  ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS display_phone TEXT,
  ADD COLUMN IF NOT EXISTS profile_name TEXT,
  ADD COLUMN IF NOT EXISTS webhook_secret_hash TEXT,
  ADD COLUMN IF NOT EXISTS uazapi_instance_id TEXT,
  ADD COLUMN IF NOT EXISTS uazapi_base_url TEXT,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_connection_error TEXT;

COMMENT ON COLUMN whatsapp_connections.credential IS
  'Meta: access token. UAZAPI: instance token. Mesmo encrypt()/decrypt().';
COMMENT ON COLUMN whatsapp_connections.provider IS
  'Backfill 040: toda linha pré-existente = meta. 1b acrescenta uazapi.';

-- ------------------------------------------------------------
-- 3. Colunas Meta que passam a ser nullable
-- ------------------------------------------------------------
ALTER TABLE whatsapp_connections ALTER COLUMN phone_number_id DROP NOT NULL;
-- waba_id, verify_token, registered_at, subscribed_apps_at,
-- last_registration_error já são nullable.

-- ------------------------------------------------------------
-- 4. CHECK de status ampliado
-- ------------------------------------------------------------
ALTER TABLE whatsapp_connections
  DROP CONSTRAINT IF EXISTS whatsapp_config_status_check;
ALTER TABLE whatsapp_connections
  ADD CONSTRAINT whatsapp_connections_status_check
  CHECK (status IN (
    'disconnected', 'connecting', 'connected', 'hibernated', 'banned'
  ));

-- ------------------------------------------------------------
-- 5. Constraints / índices
-- ------------------------------------------------------------
-- Some o "um por account" (017).
ALTER TABLE whatsapp_connections
  DROP CONSTRAINT IF EXISTS whatsapp_config_account_id_key;

-- Some o UNIQUE(phone_number_id) rígido (013); vira índice parcial.
ALTER TABLE whatsapp_connections
  DROP CONSTRAINT IF EXISTS whatsapp_config_phone_number_id_key;

-- Fase 1: dois canais fixos, um por provedor.
CREATE UNIQUE INDEX IF NOT EXISTS idx_connections_account_provider
  ON whatsapp_connections (account_id, provider)
  WHERE archived_at IS NULL;

-- Preserva a regra da 013, agora escopada a meta e a não-arquivadas.
CREATE UNIQUE INDEX IF NOT EXISTS idx_connections_phone_number_id
  ON whatsapp_connections (phone_number_id)
  WHERE provider = 'meta' AND archived_at IS NULL;

-- No máximo uma primária por account.
CREATE UNIQUE INDEX IF NOT EXISTS idx_connections_one_primary
  ON whatsapp_connections (account_id)
  WHERE is_primary AND archived_at IS NULL;

-- Lookup do webhook UAZAPI (usado só na 1c).
CREATE UNIQUE INDEX IF NOT EXISTS idx_connections_webhook_secret_hash
  ON whatsapp_connections (webhook_secret_hash)
  WHERE webhook_secret_hash IS NOT NULL;

-- Índices antigos: o RENAME TO não renomeia índices. Alinhe os nomes.
ALTER INDEX IF EXISTS idx_whatsapp_config_account
  RENAME TO idx_connections_account;
ALTER INDEX IF EXISTS idx_whatsapp_config_registered_at
  RENAME TO idx_connections_registered_at;

-- ------------------------------------------------------------
-- 6. Backfill dos flags de provider
-- ------------------------------------------------------------
UPDATE whatsapp_connections
  SET provider = 'meta', is_primary = true
  WHERE provider IS DISTINCT FROM 'meta' OR is_primary = false;

-- ------------------------------------------------------------
-- 7. RLS: nomes acompanham o rename (regras iguais)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS whatsapp_config_select ON whatsapp_connections;
DROP POLICY IF EXISTS whatsapp_config_insert ON whatsapp_connections;
DROP POLICY IF EXISTS whatsapp_config_update ON whatsapp_connections;
DROP POLICY IF EXISTS whatsapp_config_delete ON whatsapp_connections;
CREATE POLICY whatsapp_connections_select ON whatsapp_connections
  FOR SELECT USING (is_account_member(account_id));
CREATE POLICY whatsapp_connections_insert ON whatsapp_connections
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY whatsapp_connections_update ON whatsapp_connections
  FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY whatsapp_connections_delete ON whatsapp_connections
  FOR DELETE USING (is_account_member(account_id, 'admin'));

-- ------------------------------------------------------------
-- 8. conversations.connection_id  (NULLABLE na 1a — decisão 1a-6.
--    SET NOT NULL + ON DELETE RESTRICT + ciclo de arquivo vão para a
--    1b/1c junto dos paths de criação de conversa que populam a coluna.)
-- ------------------------------------------------------------
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS connection_id UUID
  REFERENCES whatsapp_connections(id) ON DELETE SET NULL;

UPDATE conversations c
  SET connection_id = wc.id
  FROM whatsapp_connections wc
  WHERE wc.account_id = c.account_id
    AND c.connection_id IS NULL;

DROP INDEX IF EXISTS idx_conversations_account_contact;
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_account_contact_connection
  ON conversations (account_id, contact_id, connection_id);

-- ------------------------------------------------------------
-- 9. flow_runs: run ativo passa a ser por conversa
-- ------------------------------------------------------------
DROP INDEX IF EXISTS idx_one_active_run_per_contact;
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_run_per_conversation
  ON flow_runs (account_id, conversation_id)
  WHERE status = 'active' AND conversation_id IS NOT NULL;

-- ------------------------------------------------------------
-- 10. broadcasts.connection_id  (NULLABLE na 1a — ver seção 8)
-- ------------------------------------------------------------
ALTER TABLE broadcasts
  ADD COLUMN IF NOT EXISTS connection_id UUID
  REFERENCES whatsapp_connections(id) ON DELETE SET NULL;

UPDATE broadcasts b
  SET connection_id = wc.id
  FROM whatsapp_connections wc
  WHERE wc.account_id = b.account_id
    AND b.connection_id IS NULL;
-- broadcasts.template_name NOT NULL FICA (relaxar é Onda 3).

-- ------------------------------------------------------------
-- 11. redeem_invitation() referencia `whatsapp_config` pelo nome no
--     corpo; plpgsql resolve em runtime e o rename não reescreve
--     funções. Corpo byte-idêntico a 019, só a tabela muda.
--     (Copie o CREATE OR REPLACE inteiro de
--     supabase/migrations/019_invitation_rpcs.sql e troque só o
--     `whatsapp_config` do `UNION ALL SELECT 1 FROM ...`.)
-- ------------------------------------------------------------
-- CREATE OR REPLACE FUNCTION public.redeem_invitation(...) ... $$
--   ... FROM whatsapp_connections WHERE account_id = v_old_account_id ...
-- $$ ...;
```

> Se o Step 1 mostrar que o CHECK de `status` de 001 tem outro nome
> (ex.: gerado como `whatsapp_config_status_check1`), use o nome real no
> `DROP CONSTRAINT IF EXISTS`. Se `is_account_member` não for a helper de
> RLS usada em 017, use a que o arquivo 017 usa nas políticas
> `whatsapp_config_*`.

- [ ] **Step 3: Atualizar `verify-schema.sql`**

Em `supabase/ci/verify-schema.sql`, dentro do bloco `DO $$`, troque:

```sql
  IF to_regclass('public.whatsapp_config') IS NULL THEN
    RAISE EXCEPTION 'public.whatsapp_config is missing — migrations did not apply';
  END IF;
```

por:

```sql
  IF to_regclass('public.whatsapp_connections') IS NULL THEN
    RAISE EXCEPTION 'public.whatsapp_connections is missing — migrations did not apply';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'whatsapp_connections_status_check'
  ) THEN
    RAISE EXCEPTION 'the 040 status CHECK (whatsapp_connections_status_check) was not installed';
  END IF;
```

As duas asserções ficam **dentro** do bloco `DO $$ … END $$;` existente.
Não adicione statement top-level novo (o arquivo tem que ter
**exatamente um** — ver o comentário no fim dele).

- [ ] **Step 4: Revisão de SQL contra checklist**

Confirme, relendo o arquivo:
- [ ] `RENAME TO` e `RENAME COLUMN` vêm **antes** de qualquer referência
  a `whatsapp_connections`.
- [ ] Toda coluna de §4.1 está: `provider`, `label`, `is_primary`,
  `display_phone`, `profile_name`, `webhook_secret_hash`,
  `uazapi_instance_id`, `uazapi_base_url`, `archived_at`,
  `last_connection_error`.
- [ ] `phone_number_id` perde `NOT NULL`.
- [ ] CHECK de `status` cobre os 5 valores; o `DROP CONSTRAINT` usa o
  nome real do constraint de 001.
- [ ] `whatsapp_config_account_id_key` e
  `whatsapp_config_phone_number_id_key` são dropados; os 4 índices
  parciais novos são criados.
- [ ] `idx_whatsapp_config_account` e `idx_whatsapp_config_registered_at`
  são renomeados (não recriados).
- [ ] As 4 políticas RLS são dropadas pelo nome antigo e recriadas pelo
  novo, com a **mesma** cláusula `USING`/`WITH CHECK`.
- [ ] `conversations.connection_id`: add **nullable** + UPDATE backfill,
  **SEM `SET NOT NULL`**, FK `ON DELETE SET NULL`. Idem
  `broadcasts.connection_id`.
- [ ] `idx_conversations_account_contact` dropado, o novo com 3 colunas
  criado. `idx_one_active_run_per_contact` → `_per_conversation` com
  predicado `... AND conversation_id IS NOT NULL`.
- [ ] `broadcasts.template_name` **não** é tocado.
- [ ] Seção 11: `CREATE OR REPLACE FUNCTION public.redeem_invitation`
  presente, corpo copiado de 019, só `whatsapp_config` →
  `whatsapp_connections` no `UNION ALL`. Nada mais mudou na função.
- [ ] `verify-schema.sql` continua com **um** statement top-level; a
  asserção do CHECK de `status` está dentro do `DO $$`.

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck`
Expected: sem erros (nenhum arquivo `.ts` mudou ainda; sanity check).

Run: `npm test`
Expected: **851 passando / 5 falhando** — inalterado (só SQL mudou).

```bash
npx prettier --write supabase/ci/verify-schema.sql
git add supabase/migrations/040_whatsapp_connections.sql supabase/ci/verify-schema.sql
git commit -m "feat(db): migration 040 — whatsapp_config becomes whatsapp_connections"
```

> A partir daqui, rodar `supabase db reset` local (se alguém instalar o
> CLI) quebra o app até a Task 6 terminar. Os testes unitários mockam o
> Supabase e não são afetados.

---

## Task 2: `resolve-connection.ts` + teste

**Files:**
- Modify: `src/lib/whatsapp/resolve-connection.ts`
- Modify: `src/lib/whatsapp/resolve-connection.test.ts`
- Modify (rename de identificador no mock DB — o caminho passa por
  `resolveConnection`): `src/app/api/whatsapp/send/route.test.ts`,
  `src/lib/whatsapp/broadcast-core.test.ts`,
  `src/lib/whatsapp/broadcast-resume.test.ts`,
  `src/lib/whatsapp/send-message.test.ts`.

**Interfaces:**
- Consumes: a tabela `whatsapp_connections` (Task 1) com coluna
  `credential` e `provider`.
- Produces: `resolveConnection()` com assinatura e tipo de retorno
  **inalterados** (`TransportConnection` continua flat). A suíte
  continua **851/5** ao fim desta task.

- [ ] **Step 1: Editar `resolve-connection.ts`**

Aplique exatamente:

1. Cabeçalho (linhas ~4-8) — o rename deixou de ser futuro. Troque:

```ts
// O ÚNICO lugar do caminho de envio que lê a tabela de configuração e
// decripta a credencial. Toda a Onda 1 (rename para
// `whatsapp_connections`, `access_token` → `credential`, resolução em
// três níveis) cabe dentro deste arquivo: nada acima dele conhece o nome
// da tabela ou o formato do ciphertext.
```

por:

```ts
// O ÚNICO lugar do caminho de envio que lê a tabela de conexões e
// decripta a credencial. A resolução em três níveis (conversa →
// explícito → primária) entra na Onda 1b; a 1a só fez o rename da
// tabela. Nada acima deste arquivo conhece o nome da tabela ou o
// formato do ciphertext.
```

2. O `select` (linhas ~41-45) — rename + filtro de provider:

```ts
  const { data: config, error } = await db
    .from('whatsapp_connections')
    .select('*')
    .eq('account_id', accountId)
    .eq('provider', 'meta')
    .single();
```

3. `decrypt(config.access_token)` (linha ~56) → `decrypt(config.credential)`.

4. O bloco de self-heal (linhas ~59-63):

```ts
  if (options.selfHeal && isLegacyFormat(config.credential)) {
    void db
      .from('whatsapp_connections')
      .update({ credential: encrypt(credential) })
      .eq('id', config.id)
```

5. O comentário nas linhas ~79-80 (`// Onda 0: a tabela não tem coluna
   provider ainda…`) — troque por:

```ts
    // Backfill da 040: toda linha existente é 'meta'. A 1b acrescenta o
    // ramo 'uazapi' e a resolução em três níveis.
```

Nada mais muda: `ResolveConnectionOptions`, o `SendMessageError`, o
objeto de retorno (fora o comentário), tudo igual.

- [ ] **Step 2: Editar `resolve-connection.test.ts`**

Rename mecânico do identificador no mock: toda ocorrência de
`'whatsapp_config'` → `'whatsapp_connections'`, e — se o mock devolve
uma linha com `access_token` — o campo vira `credential`. Se algum teste
assere `isLegacyFormat(...)` / `encrypt(...)` recebendo `access_token`,
ajuste o nome do campo. **Nenhuma asserção de comportamento muda**
(mesmos códigos de erro, mesmas mensagens, mesmo self-heal on/off).

Se o mock não filtra por `provider`, o novo `.eq('provider', 'meta')` no
código precisa continuar resolvendo: garanta que o builder falso ignora
`.eq()` desconhecido (a maioria dos mocks do repo faz `eq: () =>
builder`). Se o teste montar a linha sem `provider`, adicione
`provider: 'meta'` à fixture.

- [ ] **Step 3: Renomear o mock DB nos 4 testes que passam por `resolveConnection`**

Esses testes mockam o Supabase com o nome antigo da tabela e seus
caminhos chamam `resolveConnection` — sem o rename, a suíte fica
vermelha. Só identificador (rename permitido pelas Global Constraints):

- `src/app/api/whatsapp/send/route.test.ts` (~:53 `case 'whatsapp_config':`,
  ~:59 `access_token:` na linha mockada).
- `src/lib/whatsapp/broadcast-core.test.ts` (~:63
  `if (table === 'whatsapp_config')`, ~:69 `access_token:`).
- `src/lib/whatsapp/broadcast-resume.test.ts` (~:173 `const CONFIG = {
  … access_token: 'tok' }` + qualquer outro check de tabela no mock;
  **não** toque na asserção `plan.connection.credential`).
- `src/lib/whatsapp/send-message.test.ts` (~:218 `access_token:`, ~:239
  `if (table === 'whatsapp_config')`).

Em cada um: `'whatsapp_config'` → `'whatsapp_connections'`,
`access_token` → `credential` **só onde representa a coluna do mock**.
Se um teste precisar de mais que rename de identificador (uma asserção
muda), pare e reporte.

- [ ] **Step 4: Rodar a suíte**

Run: `npm test -- src/lib/whatsapp/resolve-connection.test.ts`
Expected: PASS, **mesma contagem de antes**. Output limpo.

Run: `npm test`
Expected: **851 passando / 5 falhando** (as 5 de baseline). Zero
regressão.

Run: `npm run typecheck`
Expected: sem erros (nenhuma mudança de tipo nesta task).

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/lib/whatsapp/resolve-connection.ts src/lib/whatsapp/resolve-connection.test.ts src/app/api/whatsapp/send/route.test.ts src/lib/whatsapp/broadcast-core.test.ts src/lib/whatsapp/broadcast-resume.test.ts src/lib/whatsapp/send-message.test.ts
git add src/lib/whatsapp/resolve-connection.ts src/lib/whatsapp/resolve-connection.test.ts src/app/api/whatsapp/send/route.test.ts src/lib/whatsapp/broadcast-core.test.ts src/lib/whatsapp/broadcast-resume.test.ts src/lib/whatsapp/send-message.test.ts
git commit -m "refactor(whatsapp): resolveConnection reads whatsapp_connections"
```

---

## Task 3: Tipo `WhatsAppConfig`

**Files:**
- Modify: `src/types/index.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `WhatsAppConfig` com `credential` (não `access_token`),
  `status` de 5 valores, `+ provider`. O **nome do tipo continua
  `WhatsAppConfig`** (renomear para `WhatsAppConnection` é 1b).

- [ ] **Step 1: Editar a interface**

Em `src/types/index.ts` (interface `WhatsAppConfig`, ~linha 275):

- `access_token: string;` → `credential: string;`
- `status: 'connected' | 'disconnected';` →
  `status: 'disconnected' | 'connecting' | 'connected' | 'hibernated' | 'banned';`
- Acrescente, após `id`:
  `provider: 'meta' | 'uazapi';`

Não adicione as outras 9 colunas novas da migração — a 1a não as lê;
entram no tipo na 1b, quando forem usadas. `user_id`, `phone_number_id`,
`waba_id`, etc. ficam como estão.

- [ ] **Step 2: Achar consumidores quebrados**

Run: `npm run typecheck`
Expected: erros **apenas** onde algo lê `.access_token` de um valor
tipado como `WhatsAppConfig`. Anote cada um. O esperado é
`src/components/settings/whatsapp-config.tsx` (tratado na Task 6) e
possivelmente `src/app/api/whatsapp/config/route.ts` (Task 4). Se o
typecheck acusar um arquivo **fora** da lista da Estrutura de arquivos,
pare e reporte — é um call site que o plano não previu.

> O typecheck pode ficar vermelho ao fim desta task se Task 4/6 ainda
> não rodaram. Isso é esperado: a 1a é um rename em lockstep e o verde
> só é exigido no portão (Task 7). Registre os erros como "esperados,
> cobertos pelas Tasks 4 e 6".

- [ ] **Step 3: Commit**

```bash
npx prettier --write src/types/index.ts
git add src/types/index.ts
git commit -m "refactor(types): WhatsAppConfig gains credential/provider, wider status"
```

---

## Task 4: `/api/whatsapp/config/route.ts`

**Files:**
- Modify: `src/app/api/whatsapp/config/route.ts`

**Interfaces:**
- Consumes: `whatsapp_connections` (Task 1), tipo `WhatsAppConfig`
  (Task 3).
- Produces: nada novo. **Contrato HTTP byte a byte inalterado.**

> Não há `route.test.ts` para este arquivo. A verificação é typecheck +
> leitura contra o checklist do Step 3.

- [ ] **Step 1: Rename + escopo de provider**

Aplique, em todas as ocorrências do handler (`GET`, `POST`, `DELETE`):

1. `.from('whatsapp_config')` → `.from('whatsapp_connections')` (×6:
   linhas ~89, ~214, ~276, ~371, ~388, ~463).
2. Nos selects/updates/deletes que filtram por `account_id` — GET
   (~90), o lookup "existing" (~276), o UPDATE (~371-373), o DELETE
   (~463-465) — acrescente `.eq('provider', 'meta')` após
   `.eq('account_id', accountId)`.
   O check "claimed" (~214, filtra por `phone_number_id` + `.neq
   ('account_id')`) **não** recebe o filtro — `phone_number_id` já é
   Meta-only.
3. GET select: `.select('phone_number_id, access_token, status')` →
   `.select('phone_number_id, credential, status')`.
4. O `baseRow` (~352-361): `access_token: encryptedAccessToken` →
   `credential: encryptedAccessToken`.
5. O INSERT (~388-392): acrescente `provider: 'meta',` **e**
   `is_primary: true,` ao objeto (junto de `account_id`, `user_id`,
   antes do `...baseRow`). Motivo do `is_primary`: a 040 backfilla toda
   linha existente para `true`; esta rota é o único lugar que cria linha
   de conexão Meta, e na 1a há uma por account (logo, é a primária).
   Também: atualize o comentário ~398-401 que diz que `account_id` é
   "UNIQUE" — a 040 dropa esse constraint e o substitui pelo índice
   parcial `(account_id, provider) WHERE archived_at IS NULL`.
6. Se qualquer ponto lê `config.access_token` / `existing.access_token`
   / `data.access_token` de uma linha da tabela, renomeie para
   `.credential`. **Não** toque: o parâmetro `access_token` do corpo do
   request (`const { … access_token … } = body`, ~188), a variável
   `encryptedAccessToken`, nem `accessToken: access_token` passado a
   `verifyPhoneNumber` (~245) / `encrypt(access_token)` (~258) — esses
   são o token cru vindo do cliente, não a coluna.
7. Strings de log: `'Error fetching whatsapp_config:'` →
   `'Error fetching whatsapp_connections:'` (e as análogas em ~376,
   ~396, ~468).

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: este arquivo sem erros. (Outros arquivos podem seguir
vermelhos até a Task 6 — anote.)

- [ ] **Step 3: Checklist de contrato HTTP**

Releia o arquivo e confirme, byte a byte:
- [ ] GET: mesmos `{ connected, reason, message }` e status 200 em todos
  os ramos.
- [ ] POST: mesmas mensagens de erro e status (`409` de número já
  reivindicado; `400` de `Meta API error:`; `500` de encryption; `500`
  de update/insert falho; `200`/sucesso).
- [ ] DELETE: `{ success: true }` / `{ error: 'Failed to delete
  configuration' }` 500.
- [ ] Nenhum campo novo no corpo de nenhuma resposta.

- [ ] **Step 4: Commit**

```bash
npx prettier --write src/app/api/whatsapp/config/route.ts
git add src/app/api/whatsapp/config/route.ts
git commit -m "refactor(whatsapp): config route reads/writes the meta connection row"
```

---

## Task 5: Rename em lote — libs e rotas de API

**Files:**
- Modify: `src/lib/whatsapp/resolve-conversation.ts` + `.test.ts`
- Modify: `src/lib/api/v1/contacts.ts` + `src/lib/api/v1/contacts.test.ts`
- Modify: `src/app/api/whatsapp/webhook/route.ts` + `.test.ts`
- Modify: `src/app/api/whatsapp/templates/[id]/route.ts`
- Modify: `src/app/api/whatsapp/templates/submit/route.ts`
- Modify: `src/app/api/whatsapp/templates/sync/route.ts`
- Modify: `src/app/api/whatsapp/media/[mediaId]/route.ts`
- Modify: `src/app/api/whatsapp/config/verify-registration/route.ts`

**Interfaces:**
- Consumes: `whatsapp_connections` (Task 1).
- Produces: nada. **Rename mecânico, zero mudança de comportamento.**

> Estas são todas a mesma transformação. Sem filtro de provider (com uma
> conexão por account, `.eq('account_id').maybeSingle()` /
> `.eq('phone_number_id')` devolvem exatamente o que devolviam). O
> hardening é da 1b.

- [ ] **Step 1: Transformação, arquivo por arquivo**

Para cada arquivo da lista:

a. Toda string literal `'whatsapp_config'` em `.from('whatsapp_config')`
   → `.from('whatsapp_connections')`.
b. Toda leitura da coluna renomeada numa linha da tabela:
   `config.access_token` → `config.credential`,
   `<row>.access_token` → `<row>.credential`.
   (`webhook/route.ts` ~298: `decrypt(config.access_token)` →
   `decrypt(config.credential)`.)
   **Não** toque em `access_token` que não seja a coluna (nenhum
   destes arquivos usa o upload resumível, mas confira).
c. Comentários e strings de log que citam `whatsapp_config` →
   `whatsapp_connections` (ex.: `webhook/route.ts` ~273
   `'Error fetching whatsapp_config for phone_number_id:'`).

Casos pontuais confirmados por leitura:
- `resolve-conversation.ts` ~58-60: `.from('whatsapp_config')
  .select('id').eq('account_id', accountId).maybeSingle()` — só (a).
- `contacts.ts` ~77-80 (`resolveAuditUserId`): `.from('whatsapp_config')
  .select('user_id')…` — só (a). A coluna lida é `user_id`, que não
  muda.
- `webhook/route.ts`: 3 `.from()` (~117 select `id, verify_token`;
  ~150; ~267 select `*` por `phone_number_id`) + (b) na ~298 + (c) na
  ~273. O ramo `configRows.length > 1` continua válido (o índice
  parcial `idx_connections_phone_number_id` ainda garante unicidade).
- `templates/[id]/route.ts` ~142, ~282: só (a).
- `templates/submit/route.ts` ~142, `templates/sync/route.ts` ~139,
  `media/[mediaId]/route.ts` ~53, `config/verify-registration/route.ts`
  ~59: só (a) (+ (c) nos comentários próximos).

- [ ] **Step 2: Renomear os mocks nos testes em lockstep**

Para cada `.test.ts` da lista (`resolve-conversation.test.ts`,
`contacts.test.ts`, `webhook/route.test.ts`):
- `table === 'whatsapp_config'` → `table === 'whatsapp_connections'`
- fixtures de linha: `access_token:` → `credential:` (só onde
  representa a coluna).
- **Nenhuma asserção de comportamento muda.** Se um teste precisar de
  mais que rename de identificador, pare e reporte — é sinal de que o
  rename não foi puro.

Se `contacts.test.ts` não mockar `whatsapp_config`, não há o que mudar
nele — remova-o do commit.

- [ ] **Step 3: Rodar os testes tocados**

Run: `npm test -- src/lib/whatsapp/resolve-conversation.test.ts src/lib/api/v1/contacts.test.ts src/app/api/whatsapp/webhook/route.test.ts`
Expected: PASS, mesma contagem de antes de cada arquivo. Output limpo.

Run: `npm run typecheck`
Expected: sem erros nos arquivos desta task.

- [ ] **Step 4: Commit**

```bash
npx prettier --write src/lib/whatsapp/resolve-conversation.ts src/lib/whatsapp/resolve-conversation.test.ts src/lib/api/v1/contacts.ts src/lib/api/v1/contacts.test.ts src/app/api/whatsapp/webhook/route.ts src/app/api/whatsapp/webhook/route.test.ts src/app/api/whatsapp/templates/[id]/route.ts src/app/api/whatsapp/templates/submit/route.ts src/app/api/whatsapp/templates/sync/route.ts src/app/api/whatsapp/media/[mediaId]/route.ts src/app/api/whatsapp/config/verify-registration/route.ts
git add -A
git commit -m "refactor(whatsapp): rename whatsapp_config table refs in libs and API routes"
```

---

## Task 6: Rename em lote — componentes/cliente + sweep de comentários

**Files:**
- Modify: `src/app/(dashboard)/inbox/page.tsx`
- Modify: `src/components/settings/settings-overview.tsx`
- Modify: `src/components/settings/whatsapp-config.tsx`
- Modify (comentários/logs apenas): `src/lib/whatsapp/encryption.ts`,
  `src/lib/whatsapp/meta-api.ts`, `src/lib/ai/auto-reply.ts`,
  `src/lib/automations/meta-send.ts`, `src/lib/whatsapp/send-core.ts`

**Interfaces:**
- Consumes: `whatsapp_connections` (Task 1), tipo `WhatsAppConfig`
  (Task 3).
- Produces: nada. Rename mecânico.

- [ ] **Step 1: Sites de query no cliente**

- `inbox/page.tsx` ~204: `.from('whatsapp_config')` →
  `.from('whatsapp_connections')`; comentário ~186 idem.
- `settings-overview.tsx` ~125: `.from('whatsapp_config')` →
  `.from('whatsapp_connections')`.
- `whatsapp-config.tsx` ~124, ~215: `.from('whatsapp_config')` →
  `.from('whatsapp_connections')`. Se o componente lê `.access_token`
  do objeto tipado `WhatsAppConfigType` (o typecheck da Task 3 apontou),
  renomeie para `.credential`. Comentários ~43, ~84, ~243, ~260 que
  citam `whatsapp_config` / `access_token` (a coluna) → nomes novos;
  **não** toque em texto que fala do token que o usuário digita.

- [ ] **Step 2: Sweep de comentários (sem mudança de código)**

Nestes arquivos, só comentários/JSDoc mencionam a tabela. Atualize a
string `whatsapp_config` → `whatsapp_connections` onde se refere à
tabela:
- `encryption.ts` ~14 (`rows to \`whatsapp_config\``).
- `meta-api.ts` ~72 (`Saving a phone_number_id + access_token to
  whatsapp_config`). **Não** toque a linha ~456 (`access_token` na URL
  do upload resumível).
- `ai/auto-reply.ts` ~14, `automations/meta-send.ts` ~26,
  `send-core.ts` ~270 — trocar `whatsapp_config` → `whatsapp_connections`
  na frase do comentário.

- [ ] **Step 3: Typecheck + suíte parcial**

Run: `npm run typecheck`
Expected: **verde** agora (todas as Tasks 2-6 aplicadas).

Run: `npm test -- src/components/settings`
Expected: PASS (se houver testes ali).

- [ ] **Step 4: Commit**

```bash
npx prettier --write src/app/(dashboard)/inbox/page.tsx src/components/settings/settings-overview.tsx src/components/settings/whatsapp-config.tsx src/lib/whatsapp/encryption.ts src/lib/whatsapp/meta-api.ts src/lib/ai/auto-reply.ts src/lib/automations/meta-send.ts src/lib/whatsapp/send-core.ts
git add -A
git commit -m "refactor(whatsapp): rename whatsapp_config refs in UI and comments"
```

---

## Task 7: Portão de aceite da 1a

**Files:** nenhum novo.

- [ ] **Step 1: Grep — nenhuma referência sobrando à tabela antiga**

Run: `git grep -n "whatsapp_config" -- 'src/**' 'supabase/ci/**'`
Expected: **zero linhas.** Qualquer sobra (código, comentário, log,
fixture, `verify-schema.sql`) é defeito — trate antes de seguir. (O
nome aparece legitimamente só no histórico de migrações 001-039, que
não se toca — por isso o grep exclui `supabase/migrations/`.)

Run: `git grep -n "access_token" -- 'src/lib/whatsapp/**' 'src/app/api/whatsapp/**'`
Expected: só ocorrências que **não** são a coluna — o parâmetro
`accessToken`/`access_token` de chamadas a `meta-api`, o upload
resumível, o corpo de request em `config/route.ts`. Nenhuma leitura de
`.access_token` de uma linha da tabela.

- [ ] **Step 2: Suíte, typecheck, lint, build**

Run: `npm test`
Expected: **851 passando / 5 falhando** (as 5 de baseline: `currency`
×3, `date-utils` ×2). Nenhum teste existente mudou de resultado; nenhum
teste novo.

Run: `npm run typecheck`
Expected: sem erros.

Run: `npm run lint`
Expected: 0 erros (os 37 warnings pré-existentes seguem; nenhum novo
nos arquivos tocados).

Run: `npm run build`
Expected: sucesso.

- [ ] **Step 3: Diff da suíte vs `main`**

Run: `git diff main --stat -- '*.test.ts' '*.test.tsx'`
Expected: só renames de identificador em
`resolve-connection.test.ts`, `resolve-conversation.test.ts`,
`webhook/route.test.ts` (e `contacts.test.ts` se aplicável) — poucas
linhas cada, todas trocando `whatsapp_config`/`access_token`. **Zero
arquivo de teste novo. Zero caso de teste novo.** Qualquer outra
mudança em teste é violação do critério de aceite — reporte.

- [ ] **Step 4: Migração — CI**

O branch precisa de `.github/workflows/migrations.yml` verde. O
controller faz o push e confere o run (`supabase db reset --local
--no-seed` + `verify-schema.sql` num Postgres limpo). Se falhar, o log
do job aponta o statement — corrija a 040 e re-push.

- [ ] **Step 5: Relatório final da leva**

No report: contagem da suíte antes/depois (851/5 → 851/5), saída dos
greps do Step 1, resultado do `migrations.yml`, e a lista de arquivos
tocados vs a Estrutura de arquivos deste plano.

---

## Follow-ups (fora da 1a, registrar)

- **1b:** os 3 testes de cobertura adiados da Onda 0 (`deliverBroadcast`,
  `broadcast/route.ts`, `react/route.ts`) — movidos para cá porque não
  protegem o rename da 1a (esses caminhos não tocam `whatsapp_config`) e
  sim o `providers/` quando a 1b acrescenta o transporte UAZAPI. Exigem
  montar um mock de `createTransport` do zero em `broadcast-core.test.ts`.
- **1b:** `.eq('provider', ...)` nos call sites que na 1a ficaram com
  rename puro (`webhook`, `resolve-conversation`, `templates/*`,
  `media`, `verify-registration`, `inbox/page`, `settings-*`) — passam
  a importar quando existe a segunda conexão.
- **1b/1c:** filtro `archived_at IS NULL` nas 4 queries escopadas de
  `config/route.ts` (GET select, lookup "existing", UPDATE, DELETE) e no
  check "claimed" — os índices únicos da 040 são parciais nisso; inerte
  na 1a (nada arquiva), mas necessário quando o ciclo de arquivo existir.
- **1b (achados da revisão final da 1a):**
  - `config/route.ts:410` seta `is_primary: true` incondicional. Quando
    uma conexão UAZAPI puder ser primária, salvar a config Meta pela
    primeira vez viola `idx_connections_one_primary` (500 genérico). A 1b
    precisa de regra de eleição de primária ao inserir.
  - Órfãos de `connection_id`: o `DELETE` do botão "Reset Configuration"
    → `ON DELETE SET NULL` → conversas perdem `connection_id` sem nada
    re-popular. O backfill do `SET NOT NULL` da 1b/1c tem que tratar
    essas linhas (ou o botão vira arquivo, como já previsto).
  - `WhatsAppConfig.phone_number_id: string` no tipo diverge da coluna
    agora nullable (`040:46`) — Meta sempre tem, UAZAPI não; marcar
    `string | null` junto da união `TransportConnection`. Idem as 10
    colunas novas da 040 que a 1a não pôs no tipo.
  - Varrer `.eq('provider', ...)` / `archived_at IS NULL` nos 21 call
    sites que a 1a deixou com rename puro **antes** da primeira linha
    `provider='uazapi'` — `templates/*`, `media/*`, `verify-registration`
    usam `.single()` e dão PGRST116 no instante que surge a 2ª linha.
- **1b:** renomear a interface `WhatsAppConfig` → `WhatsAppConnection` e
  adicionar ao tipo as 9 colunas que a 040 criou mas a 1a não lê.
- **1b:** mover o toggle `mirror_inbound_media` do cliente para
  `PATCH /api/whatsapp/connections/[id]`.
- **1b/1c:** resolução de conexão em 3 níveis em `resolveConnection`;
  união discriminada em `TransportConnection`.
- **1b/1c:** `SET NOT NULL` em `conversations.connection_id` /
  `broadcasts.connection_id` + `ON DELETE RESTRICT` + o ciclo de arquivo
  (`archived_at` via `PATCH`/`DELETE`, trocar o `DELETE` do botão "Reset
  Configuration" por arquivo), junto dos paths de criação de conversa
  (inbound webhook, `resolve-conversation`) que passam a popular
  `connection_id`. Pacote único — decisão 1a-6.
