-- ============================================================
-- 933 — Gatilho de automação por ETAPA DO FUNIL
--
-- O módulo de automações nasceu no upstream sem funis. Hoje o CB tem funis
-- (908/911) e a automação não sabe nada sobre eles: não há gatilho, condição
-- nem ação de etapa. Esta migration traz a metade do BANCO do gatilho
-- "quando o card entrar nesta etapa" — o padrão central do Kommo, onde cada
-- coluna do quadro carrega suas automações.
--
-- ⚠️ POR QUE UMA CAIXA DE SAÍDA, E NÃO UM ENXERTO NO CÓDIGO
--
-- Quem move card não é um lugar só. Medido em 2026-08-03: `deals.stage_id` é
-- escrito por DOIS caminhos de navegador sob RLS — o arrastar do Kanban
-- (`src/app/(dashboard)/pipelines/page.tsx`) e o formulário de negócio
-- (`src/components/pipelines/deal-form.tsx`) — mais três caminhos de servidor
-- de criação. Não existe função compartilhada por onde todos passem. Enxertar
-- o disparo em cada call site é a receita da feature que vale para metade dos
-- caminhos e quebra em silêncio no próximo que alguém escrever — foi
-- exatamente o raciocínio que levou a 912 a pôr a auditoria num trigger.
--
-- ⚠️ POR QUE UMA TABELA NOVA, E NÃO REUSAR `cb_lead_events`
--
-- A 912 já calcula de/para de etapa, posições, ator e origem. Tentador. Mas
-- ela é tabela de AUDITORIA: tem linhas `reconstructed` (semeadas
-- retroativamente), linhas de etiqueta que já têm caminho de disparo próprio
-- (`tag_added`), e CHECKs de forma por tipo de evento. Enfiar estado de fila
-- ali (processado/tentativas/erro) distorce o significado dela e faz cada
-- consulta de histórico ter de lembrar de filtrar. Fila é fila.
--
-- ⚠️ LATÊNCIA É O PONTO. O agendador da VPS bate nas rotas de cron de 15 em
-- 15 minutos (`docker-stack.yml`). Isso serve para o passo "esperar" e é
-- inaceitável para "moveu o card → manda a mensagem". Por isso a drenagem tem
-- DUAS pontas: um aviso imediato disparado por quem escreveu (segundos) e o
-- cron como rede de segurança (pega aba fechada, rede caindo, SQL na mão).
-- A reivindicação em dois passos impede que as duas disparem o mesmo evento.
-- ============================================================

-- ------------------------------------------------------------
-- 1) A fila
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cb_automation_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  tipo         text NOT NULL CHECK (tipo IN (
                 'deal_stage_changed',
                 'deal_status_changed'
               )),

  -- Sem FK para `deals`: apagar um negócio não pode derrubar o evento que
  -- conta o que aconteceu com ele, e RESTRICT faria a exclusão falhar. Mesma
  -- decisão que a 932 tomou para `reply_to_message_id`, pelo mesmo motivo.
  deal_id      uuid,
  contact_id   uuid REFERENCES contacts(id) ON DELETE SET NULL,
  -- Canal da CONVERSA do contato (D9), resolvido no trigger. NÃO é
  -- `deals.channel_id`, que é o canal do NASCIMENTO do card: o operador
  -- decidiu que o recorte por conexão deve responder "por onde este contato
  -- fala hoje", não "por onde ele chegou meses atrás".
  channel_id   uuid REFERENCES cb_channels(id) ON DELETE SET NULL,

  from_pipeline_id uuid,
  to_pipeline_id   uuid,
  from_stage_id    uuid,
  to_stage_id      uuid,
  from_status      text,
  to_status        text,

  -- Quem causou. Mesma derivação da 912: `auth.uid()` presente = gente.
  origem       text NOT NULL CHECK (origem IN
                 ('usuario', 'conexao', 'automacao', 'sistema')),

  criado_em    timestamptz NOT NULL DEFAULT now(),
  -- NULL = pendente. É o que a reivindicação em dois passos testa.
  processado_em timestamptz,
  tentativas   integer NOT NULL DEFAULT 0,
  erro         text
);

COMMENT ON TABLE cb_automation_events IS
  'Fila de eventos de funil que o motor de automações drena. Escrita por '
  'trigger (há escritores no navegador, sob RLS, sem ponto único no servidor). '
  'Drenada pelo aviso imediato de quem escreveu e pelo cron de 15 min.';

-- Índice PARCIAL só nos pendentes: a fila é lida sempre com o mesmo recorte,
-- e o acervo processado (que só existe para depuração e é podado) não precisa
-- entrar no índice.
CREATE INDEX IF NOT EXISTS cb_automation_events_pendentes_idx
  ON cb_automation_events (criado_em)
  WHERE processado_em IS NULL;

CREATE INDEX IF NOT EXISTS cb_automation_events_conta_idx
  ON cb_automation_events (account_id, criado_em DESC);

-- ------------------------------------------------------------
-- 2) Fechada por padrão (lição da 931)
--
-- Tabela `cb_*` nova nasce sem NADA para `anon`. A 901, a 906 e a 912
-- deixaram concessão aberta e a única coisa entre um pedido anônimo e o dado
-- era a RLS — uma barreira onde deveria haver duas. Fila é assunto de
-- service_role: nem `authenticated` precisa ler.
-- ------------------------------------------------------------

ALTER TABLE cb_automation_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE cb_automation_events FROM anon, authenticated;
GRANT ALL ON TABLE cb_automation_events TO service_role;
-- Sem policy nenhuma: com RLS ligada e sem policy, ninguém além de
-- service_role (que a ignora) enxerga linha.

-- ------------------------------------------------------------
-- 3) O trigger que enche a fila
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION cb_enfileira_evento_de_funil()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor    uuid := auth.uid();
  v_origem   text;
  v_canal    uuid;
BEGIN
  -- Cascata de conta: a `accounts` já saiu e esta tabela está sendo apagada
  -- junto. Mesma guarda da 912.
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- ⚠️ `UPDATE OF` dispara quando a coluna é MENCIONADA, mesmo sem mudar
    -- de valor, e `deal-form.tsx` manda as três em todo save — inclusive
    -- quando o operador só editou a anotação. Sem esta saída, cada save
    -- enfileiraria um evento falso e a automação mandaria mensagem ao
    -- cliente por causa de uma anotação. A 912 pagou para aprender isto.
    IF NEW.pipeline_id IS NOT DISTINCT FROM OLD.pipeline_id
       AND NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id
       AND NEW.status   IS NOT DISTINCT FROM OLD.status THEN
      RETURN NEW;
    END IF;
  END IF;

  v_origem := CASE
    WHEN v_actor IS NOT NULL THEN 'usuario'
    WHEN TG_OP = 'INSERT' AND NEW.source = 'channel'    THEN 'conexao'
    WHEN TG_OP = 'INSERT' AND NEW.source = 'automation' THEN 'automacao'
    ELSE 'sistema'
  END;

  -- ⚠️ LAÇO. Card criado POR automação não re-entra na fila enquanto não
  -- existir guarda de cadeia. Hoje o passo `create_deal` já existe, e uma
  -- automação "quando criar card na etapa X → criar negócio" giraria para
  -- sempre criando cards e mandando mensagem ao cliente a cada volta. Quando
  -- as ações de funil chegarem (com a cadeia anti-ciclo que o operador pediu
  -- em vez de teto de profundidade), esta linha sai e a cadeia assume.
  IF TG_OP = 'INSERT' AND NEW.source = 'automation' THEN
    RETURN NEW;
  END IF;

  -- ⚠️ A busca do canal fica DENTRO do bloco protegido, junto dos INSERTs.
  -- Fora dele, um erro aqui (conversa em estado esquisito, coluna futura,
  -- lock) derrubaria o arrastar do card — justamente o que a política de
  -- falha abaixo existe para impedir. Já estava fora numa primeira escrita.
  BEGIN
    -- Canal da CONVERSA do contato, não o do nascimento do card (D9).
    -- Conversa de grupo não entra: ela tem `contact_id` NULO (CHECK XOR da
    -- 906), então este filtro por contato nunca a alcança — e ainda bem,
    -- porque grupo tem `conversations.channel_id` NULO e o número real mora
    -- em `cb_groups`.
    IF NEW.contact_id IS NOT NULL THEN
      SELECT c.channel_id INTO v_canal
        FROM conversations c
       WHERE c.account_id = NEW.account_id
         AND c.contact_id = NEW.contact_id
         AND c.channel_id IS NOT NULL
       ORDER BY c.last_message_at DESC NULLS LAST
       LIMIT 1;
    END IF;

    IF TG_OP = 'INSERT' THEN
      -- "Movido para OU CRIADO nesta etapa" é literal do Kommo, e é o que o
      -- roteador de entrada precisa: o lead que chega pelo WhatsApp vira card
      -- na etapa de entrada e tem de acionar a esteira.
      INSERT INTO cb_automation_events (
        account_id, tipo, deal_id, contact_id, channel_id,
        to_pipeline_id, to_stage_id, to_status, origem
      ) VALUES (
        NEW.account_id, 'deal_stage_changed', NEW.id, NEW.contact_id, v_canal,
        NEW.pipeline_id, NEW.stage_id, NEW.status, v_origem
      );
      RETURN NEW;
    END IF;

    -- UPDATE. Etapa e status são eventos SEPARADOS, e os dois podem sair do
    -- mesmo save: "ganhou" é mudança de status, e arrastar para a coluna
    -- Ganho costuma mudar as duas coisas. Fundir num evento só obrigaria toda
    -- automação a saber desembrulhar.
    IF NEW.pipeline_id IS DISTINCT FROM OLD.pipeline_id
       OR NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
      -- ⚠️ Troca de FUNIL conta como mudança de etapa. A 912 emite
      -- `pipeline_changed` e NUNCA `stage_changed` nesse caso; um gatilho que
      -- só escutasse "mudou de etapa" não dispararia quando o card viesse de
      -- outro funil — que é justamente o movimento que o operador mais
      -- comenta ("Trabalhista → descarte").
      INSERT INTO cb_automation_events (
        account_id, tipo, deal_id, contact_id, channel_id,
        from_pipeline_id, to_pipeline_id, from_stage_id, to_stage_id, origem
      ) VALUES (
        NEW.account_id, 'deal_stage_changed', NEW.id, NEW.contact_id, v_canal,
        OLD.pipeline_id, NEW.pipeline_id, OLD.stage_id, NEW.stage_id, v_origem
      );
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
      INSERT INTO cb_automation_events (
        account_id, tipo, deal_id, contact_id, channel_id,
        to_pipeline_id, to_stage_id, from_status, to_status, origem
      ) VALUES (
        NEW.account_id, 'deal_status_changed', NEW.id, NEW.contact_id, v_canal,
        NEW.pipeline_id, NEW.stage_id, OLD.status, NEW.status, v_origem
      );
    END IF;

  EXCEPTION WHEN OTHERS THEN
    -- ⚠️ POLÍTICA DE FALHA DIFERENTE DA 912, DE PROPÓSITO. Lá, erro ao gravar
    -- re-levanta quando há `auth.uid()`, porque perder auditoria é grave. Aqui
    -- re-levantar faria o ARRASTAR DO CARD falhar na cara do operador por
    -- causa de uma automação. A fila perder um evento é ruim; o Kanban parar
    -- de funcionar é pior. Engole sempre, com aviso no log do Postgres.
    RAISE WARNING 'cb_enfileira_evento_de_funil falhou para deal %: %',
      NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

-- Fecha as DUAS metades (a forma da concessão varia por função conforme o
-- ALTER DEFAULT PRIVILEGES vigente quando ela nasceu; este erro já foi
-- cometido três vezes neste banco — 903, 912 e 914).
REVOKE EXECUTE ON FUNCTION cb_enfileira_evento_de_funil()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS cb_deals_enfileira_evento ON deals;
CREATE TRIGGER cb_deals_enfileira_evento
  AFTER INSERT ON deals
  FOR EACH ROW EXECUTE FUNCTION cb_enfileira_evento_de_funil();

DROP TRIGGER IF EXISTS cb_deals_enfileira_evento_update ON deals;
CREATE TRIGGER cb_deals_enfileira_evento_update
  AFTER UPDATE OF pipeline_id, stage_id, status ON deals
  FOR EACH ROW EXECUTE FUNCTION cb_enfileira_evento_de_funil();

-- ------------------------------------------------------------
-- 4) Recorte por ETAPA na automação
--
-- Mesmo molde de `channel_ids` (903): array, e VAZIO/NULL = TODAS as etapas,
-- nunca "nenhuma". A convenção vale no projeto inteiro (`channelInScope`,
-- `findEntryFlow`, `FILTROS_VAZIOS` do inbox) e uma tela que disser "nenhuma"
-- onde o motor lê "todas" faz o operador desativar a regra errada.
--
-- Etapa basta, funil é redundante: `(stage_id, pipeline_id)` é único (908),
-- então a etapa já identifica o funil.
-- ------------------------------------------------------------

ALTER TABLE automations
  ADD COLUMN IF NOT EXISTS stage_ids uuid[];

COMMENT ON COLUMN automations.stage_ids IS
  'Etapas em que esta automação vale. NULL/vazio = todas (nunca "nenhuma").';

CREATE INDEX IF NOT EXISTS automations_stage_ids_idx
  ON automations USING GIN (stage_ids)
  WHERE stage_ids IS NOT NULL;

-- Limpeza ao apagar etapa, no molde de `cb_channels_drop_from_automations`
-- (903). Sem isto sobra UUID órfão no array e a automação passa a valer para
-- uma etapa que não existe — recorte que nunca casa, sem nada dizendo por quê.
CREATE OR REPLACE FUNCTION cb_stages_drop_from_automations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE automations
     SET stage_ids = nullif(array_remove(stage_ids, OLD.id), '{}'),
         -- Ficou sem etapa nenhuma? O array vazio viraria "todas", que é o
         -- OPOSTO do que o operador pediu: ele restringiu a automação a
         -- etapas específicas e todas sumiram. Desativa e deixa para decisão
         -- de gente — mesma escolha da 903 para o escopo de canal.
         is_active = CASE
           WHEN array_remove(stage_ids, OLD.id) = '{}' THEN false
           ELSE is_active
         END
   WHERE stage_ids @> ARRAY[OLD.id];
  RETURN OLD;
END;
$$;

REVOKE EXECUTE ON FUNCTION cb_stages_drop_from_automations()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS cb_stages_drop_from_automations_trg ON pipeline_stages;
CREATE TRIGGER cb_stages_drop_from_automations_trg
  BEFORE DELETE ON pipeline_stages
  FOR EACH ROW EXECUTE FUNCTION cb_stages_drop_from_automations();

-- ------------------------------------------------------------
-- 5) Conferência — o RESULTADO, nunca a intenção
--
-- Só o teste pegou os enganos de REVOKE das migrations 903, 912 e 914.
-- ------------------------------------------------------------

-- ⚠️ O acesso do `service_role` tem de ser ESCRITO, não herdado (achado pelo CI
-- de migrations, 2026-08-26 — mesma causa da 919). Ele vinha do *default
-- privilege* do Supabase, que num banco novo não se repete, e a conferência
-- abaixo reprovaria por um motivo que não é o que ela investiga. Concedido o
-- que a produção já tem; lá é no-op.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cb_automation_events TO service_role;

DO $$
BEGIN
  IF has_function_privilege('anon', 'cb_enfileira_evento_de_funil()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon ainda executa cb_enfileira_evento_de_funil';
  END IF;
  IF has_function_privilege('authenticated', 'cb_stages_drop_from_automations()', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated ainda executa cb_stages_drop_from_automations';
  END IF;
  IF has_table_privilege('anon', 'cb_automation_events', 'SELECT') THEN
    RAISE EXCEPTION 'anon ainda lê cb_automation_events';
  END IF;
  IF NOT has_table_privilege('service_role', 'cb_automation_events', 'INSERT') THEN
    RAISE EXCEPTION 'service_role NAO escreve cb_automation_events';
  END IF;
END $$;
