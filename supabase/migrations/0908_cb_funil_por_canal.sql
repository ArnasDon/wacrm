-- ============================================================
-- 908_cb_funil_por_canal.sql — Cada conexão de WhatsApp entra num funil
--
-- POR QUE ESTA MIGRATION EXISTE
-- O escritório atende por vários números, e cada número corresponde a uma
-- área: um para o Trabalhista, outro para o Bancário. Hoje não há como dizer
-- "quem chega neste número vira card naquele funil" — o operador cadastra
-- tudo à mão, ou monta uma automação por número.
--
-- POR QUE A AUTOMAÇÃO NÃO RESOLVE (e por isso o vínculo mora no canal)
-- O gatilho `first_inbound_message` é contado por CONVERSA
-- (src/app/api/whatsapp/webhook/route.ts, espelho em inbound-store.ts) e
-- existe UMA conversa por contato por conta (`idx_conversations_account_contact`,
-- 036; reafirmado como decisão de produto em 903). Ou seja: o cliente que já
-- falou no número Trabalhista e um mês depois escreve no Bancário NÃO dispara
-- nada. É exatamente o caso central que se quer cobrir.
--
-- Daí o desenho: o gatilho é por ESTADO ("este contato ainda não tem card
-- neste funil"), não por borda ("é a primeira mensagem"). Estado é
-- convergente — se o insert falhar, a próxima mensagem tenta de novo; borda
-- consumida não volta, e o cliente ficaria fora do funil para sempre.
--
-- ⚠️ A ETAPA DE ENTRADA É EXPLÍCITA, NÃO `MIN(position)`.
-- Tentador resolver a etapa pela menor `position` e poupar uma coluna. Mas o
-- funil real desta conta tem position 0 = "Contato Avulso" e 1 =
-- "Desqualificado"; a entrada de verdade é "Lead", na posição 2. A regra de
-- posição despejaria todo cliente novo numa faixa de estacionamento, e o
-- operador só poderia corrigir distorcendo a ordem do Kanban. Pior: com
-- negócio parado lá, `deals_stage_pipeline_fkey` (NO ACTION) e a própria tela
-- de Funis passam a impedir reestruturar aquela etapa.
-- A coluna aponta a etapa; `ON DELETE SET NULL` cuida do ponteiro morto, e o
-- código cai em MIN(position) quando ela for nula.
--
-- FKs COMPOSTAS — a mesma forma que a 903 adotou para `conversations`.
-- A ingestão roda com service-role e ignora RLS, então a barreira de tenancy
-- tem de estar no banco. FK simples só garante "existe uma linha com esse
-- id", não "é uma linha DESTA conta". Aqui isso vale para os dois lados:
-- o funil padrão do canal e o funil/etapa/canal do próprio negócio.
--
-- Idempotente — seguro rodar mais de uma vez.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Alvos das FKs compostas
--    (`cb_channels_id_account_key` já existe, criado pela 903.)
-- ------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS pipelines_id_account_key
  ON pipelines (id, account_id);

-- `pipeline_stages` não tem `account_id` — a tenancy dela é indireta, via
-- `pipeline_id`. Então o par que garante "esta etapa é deste funil" é
-- (id, pipeline_id).
CREATE UNIQUE INDEX IF NOT EXISTS pipeline_stages_id_pipeline_key
  ON pipeline_stages (id, pipeline_id);

-- ------------------------------------------------------------
-- 2. O vínculo: conexão → funil + etapa de entrada
-- ------------------------------------------------------------
ALTER TABLE cb_channels ADD COLUMN IF NOT EXISTS default_pipeline_id uuid;
ALTER TABLE cb_channels ADD COLUMN IF NOT EXISTS default_stage_id    uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cb_channels_default_pipeline_fkey'
  ) THEN
    -- ⚠️ A forma POR COLUNA do SET NULL (PG 15+) é obrigatória: `account_id`
    -- é NOT NULL, e um SET NULL simples tentaria zerar as DUAS colunas,
    -- derrubando o DELETE do funil com erro de not-null. Mesma pegadinha
    -- documentada na 903 para `conversations.channel_id`.
    ALTER TABLE cb_channels
      ADD CONSTRAINT cb_channels_default_pipeline_fkey
      FOREIGN KEY (default_pipeline_id, account_id)
      REFERENCES pipelines (id, account_id)
      ON DELETE SET NULL (default_pipeline_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cb_channels_default_stage_fkey'
  ) THEN
    -- Amarra a etapa ao funil configurado: trocar o funil sem trocar a etapa
    -- passa a ser IMPOSSÍVEL no banco, não só desaconselhado no código.
    --
    -- ⚠️ Apagar o FUNIL, porém, NÃO limpa esta coluna. O Postgres enfileira
    -- o CASCADE de `pipeline_stages` e o SET NULL de `default_pipeline_id` na
    -- mesma passada; quando o SET NULL desta FK é avaliado, `default_pipeline_id`
    -- já é NULL, e MATCH SIMPLE dá a constraint por satisfeita com uma coluna
    -- nula. Resultado: `default_stage_id` fica apontando para uma etapa que
    -- não existe mais.
    -- É inofensivo, e de propósito: o roteador decide por `default_pipeline_id`
    -- (guarda 3 de pipeline-routing.ts), que ficou NULL, então o roteamento
    -- para como deve; e o PATCH da rota zera a etapa junto sempre que o funil
    -- muda. O lixo some no próximo "Configurar". Não vale uma trigger.
    ALTER TABLE cb_channels
      ADD CONSTRAINT cb_channels_default_stage_fkey
      FOREIGN KEY (default_stage_id, default_pipeline_id)
      REFERENCES pipeline_stages (id, pipeline_id)
      ON DELETE SET NULL (default_stage_id);
  END IF;
END $$;

-- ------------------------------------------------------------
-- 3. `deals`: de onde veio o negócio, e por qual número
-- ------------------------------------------------------------
ALTER TABLE deals ADD COLUMN IF NOT EXISTS channel_id uuid;

-- `source` separa quem criou o card. Serve para escopar a trava
-- anti-duplicata SÓ às linhas que a regra automática criou: o formulário
-- manual e o passo de automação continuam livres para abrir dois cards do
-- mesmo cliente no mesmo funil, que é caso real de escritório (dois
-- processos). A regra semântica de "já está no funil" mora no código e é
-- mais ampla — ver src/lib/cb-channels/pipeline-routing.ts.
ALTER TABLE deals ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deals_source_check') THEN
    ALTER TABLE deals
      ADD CONSTRAINT deals_source_check
      CHECK (source IN ('manual', 'automation', 'channel'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deals_channel_account_fkey') THEN
    ALTER TABLE deals
      ADD CONSTRAINT deals_channel_account_fkey
      FOREIGN KEY (channel_id, account_id)
      REFERENCES cb_channels (id, account_id)
      ON DELETE SET NULL (channel_id);
  END IF;
END $$;

-- ------------------------------------------------------------
-- 4. FKs simples de `deals` viram compostas
--
-- Antes desta migration era possível, no nível do banco, um negócio da conta
-- A morar num funil da conta B e numa etapa de um terceiro funil. A única
-- barreira era o código — e o roteador de entrada escreve com service-role.
-- `deals` está vazia em produção, então a troca não tem custo de validação.
-- ------------------------------------------------------------
ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_pipeline_id_fkey;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deals_pipeline_account_fkey') THEN
    -- CASCADE preservado: apagar o funil apaga os negócios dele, que é o
    -- comportamento que a tela de Funis já assume.
    ALTER TABLE deals
      ADD CONSTRAINT deals_pipeline_account_fkey
      FOREIGN KEY (pipeline_id, account_id)
      REFERENCES pipelines (id, account_id)
      ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_stage_id_fkey;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deals_stage_pipeline_fkey') THEN
    -- NO ACTION preservado (era assim antes): etapa com negócio dentro não
    -- pode ser apagada, e a tela de Funis já avisa disso. O ganho é o par —
    -- a etapa passa a ter de pertencer ao funil do próprio negócio.
    ALTER TABLE deals
      ADD CONSTRAINT deals_stage_pipeline_fkey
      FOREIGN KEY (stage_id, pipeline_id)
      REFERENCES pipeline_stages (id, pipeline_id);
  END IF;
END $$;

-- ------------------------------------------------------------
-- 5. `deals.user_id` deixa de apagar o funil quando alguém sai
--
-- Era `NOT NULL` + `ON DELETE CASCADE` para auth.users — a única coluna de
-- `deals` que ainda apagava histórico. As vizinhas já foram suavizadas de
-- propósito: `assigned_to` virou SET NULL na 002 e `contact_id` na 004, cujo
-- cabeçalho registra "CASCADE é o wrong fix — apagaria linhas de histórico".
--
-- Isso passa a importar muito mais agora: os cards criados automaticamente
-- pertencem todos ao MESMO usuário (o dono da conta), então remover essa
-- pessoa do `auth.users` apagaria o funil inteiro de uma vez.
-- Nenhuma policy de RLS de `deals` lê `user_id` (todas usam
-- `is_account_member(account_id, …)`), então afrouxar não abre brecha.
-- ------------------------------------------------------------
ALTER TABLE deals ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_user_id_fkey;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deals_user_id_fkey') THEN
    ALTER TABLE deals
      ADD CONSTRAINT deals_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 6. Índices
-- ------------------------------------------------------------
-- Trava anti-duplicata do roteador. É rede contra CORRIDA, não a regra de
-- negócio: duas mensagens do mesmo cliente chegando juntas (e a Meta
-- reentrega o webhook quando não recebe 200 a tempo) fariam dois inserts
-- simultâneos passarem pela mesma checagem. O segundo bate aqui e vira
-- sucesso idempotente no código.
CREATE UNIQUE INDEX IF NOT EXISTS cb_deals_canal_idx
  ON deals (account_id, contact_id, pipeline_id)
  WHERE source = 'channel' AND contact_id IS NOT NULL;

-- A checagem "este contato já tem card?" roda em TODA mensagem de entrada de
-- canal configurado. Sem este índice ela é seq scan.
CREATE INDEX IF NOT EXISTS idx_deals_contact
  ON deals (account_id, contact_id);

COMMENT ON COLUMN cb_channels.default_pipeline_id IS
  'Funil em que cai o cliente que escrever neste número. NULL = a conexão não '
  'roteia nada (estado de toda conexão até alguém configurar).';
COMMENT ON COLUMN cb_channels.default_stage_id IS
  'Etapa de entrada. NULL cai em MIN(position) no código — mas a etapa '
  'explícita é o caminho normal, porque a menor posição costuma ser uma faixa '
  'de estacionamento, não a entrada do processo.';
COMMENT ON COLUMN deals.source IS
  'Quem criou: manual (formulário), automation (passo create_deal) ou channel '
  '(roteador de entrada por conexão).';
COMMENT ON COLUMN deals.channel_id IS
  'Por qual número o cliente chegou. NULL em negócio criado à mão e em '
  'qualquer negócio anterior à 908.';
