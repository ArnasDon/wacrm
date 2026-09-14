-- ============================================================
-- 912 — Histórico de atividade do lead (trilha auditável)
--
-- Registra, de forma append-only e com QUEM / ANTES / DEPOIS:
--   • criação e exclusão de negócio;
--   • mudança de etapa dentro do funil (e se foi avanço ou retorno);
--   • transferência entre funis;
--   • ganho/perda/reabertura (status);
--   • tag aplicada e tag removida.
--
-- ⚠️ POR QUE TRIGGER NO BANCO, E NÃO UM LOGGER NA APLICAÇÃO
-- Hoje existem SEIS escritores de `deals` e NOVE de `contact_tags`, em três
-- clientes Supabase diferentes, e metade roda no NAVEGADOR direto contra a
-- tabela sob RLS:
--     deals          → pipelines/page.tsx:224 (arrastar no Kanban),
--                      deal-form.tsx:190/218/242/260, automations/engine.ts:631,
--                      deals/create-deal.ts:138
--     contact_tags   → contacts/page.tsx:190/234, tag-write.ts:61/82,
--                      resolve-import-tags.ts:131, api/v1/contacts.ts:196,
--                      automations/engine.ts:493/794, flows/engine.ts:516
-- Já existem dois helpers centrais de tag (`tag-write.ts`, `tag-events.ts`) e
-- TRÊS call sites de produção que passam por fora deles. "Esqueceram de chamar
-- o logger" aqui é histórico, não hipótese — por isso a trilha nasce no único
-- ponto por onde toda escrita passa obrigatoriamente.
--
-- ⚠️ POLÍTICA DE FALHA: TRAVA NA TELA, NUNCA NA ENTRADA
-- Se gravar o evento falhar (só por bug nosso — o usuário não tem como
-- provocar), a ação falha junto QUANDO PARTIU DE UMA PESSOA (`auth.uid()`
-- presente): o erro aparece na hora e a trilha nunca fica furada por ação
-- humana. Quando a escrita vem do servidor (ingestão de mensagem, automação),
-- o evento é abandonado com WARNING e a ação segue — perder a linha de
-- auditoria é ruim, perder o lead que acabou de escrever é pior.
-- ============================================================

-- ------------------------------------------------------------
-- 1) A tabela
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cb_lead_events (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),

  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,

  -- ⚠️ ANULÁVEL, e de propósito, por DOIS motivos independentes:
  --  (a) `deals.contact_id` é anulável desde a 004 — um card sem contato
  --      (conversa de grupo, contato apagado) gera evento sem contato, e
  --      NOT NULL aqui abortaria o arrasto no Kanban;
  --  (b) apagar contato faz SET NULL aqui em vez de CASCADE: a decisão do
  --      operador foi PRESERVAR o rastro. `deals.contact_id` também é SET
  --      NULL, então o card sobrevive ao contato — se o histórico morresse
  --      junto, sobraria card vivo, sem contato E sem nenhum registro de por
  --      onde passou. E apagar contato viraria o jeito de apagar o rastro.
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  contact_label text,

  -- SEM FK, nos dois. `deal_deleted` referencia um negócio que acabou de
  -- deixar de existir: com FK a linha seria impossível de gravar. Mesmo
  -- raciocínio para a conversa, que cascateia ao apagar contato.
  deal_id uuid,
  conversation_id uuid,

  event_type text NOT NULL CHECK (
    event_type IN (
      'deal_created',
      'stage_changed',
      'pipeline_changed',
      'status_changed',
      'deal_deleted',
      'tag_added',
      'tag_removed'
    )
  ),

  -- ⚠️ `clock_timestamp()`, NÃO `now()`. `now()` devolve o início da
  -- transação: dois eventos gravados na mesma transação (transferir de funil
  -- e marcar como ganho no mesmo save) sairiam com timestamp idêntico e a
  -- ordem viraria sorteio na hora de ler.
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),

  -- SET NULL, nunca CASCADE: quem saiu do escritório não leva a trilha junto.
  -- `actor_label` é a foto do nome no momento do evento, para a linha
  -- continuar dizendo QUEM depois que a conta some.
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_label text,

  -- 'sistema' = escrita server-side sem ator identificável (API pública,
  -- fluxo, manutenção). O trigger não tem como distinguir esses casos por
  -- dentro; prometer mais do que dá para saber seria mentir na auditoria.
  origin text NOT NULL CHECK (
    origin IN ('usuario', 'conexao', 'automacao', 'sistema', 'retroativo')
  ),

  -- ⚠️ ID **e** rótulo, em tudo. Uma etapa que o lead já deixou pode ser
  -- apagada (a FK `deals_stage_pipeline_fkey` é NO ACTION e só barra etapa
  -- que tenha negócio AGORA), e renomear uma etapa reescreveria o passado em
  -- silêncio. Trilha que muda sozinha não serve de prova.
  from_pipeline_id uuid,
  from_pipeline_label text,
  to_pipeline_id uuid,
  to_pipeline_label text,

  -- `position` responde "foi AVANÇO ou foi volta?" — que é a pergunta que o
  -- operador faz, e que os rótulos sozinhos não respondem.
  from_stage_id uuid,
  from_stage_label text,
  from_stage_position integer,
  to_stage_id uuid,
  to_stage_label text,
  to_stage_position integer,

  from_status text,
  to_status text,

  tag_id uuid,
  tag_label text,
  tag_color text,

  channel_id uuid,
  channel_label text,

  -- TRUE = linha reconstruída a partir do estado atual, não observada
  -- acontecendo. A trilha precisa dizer o que ela mesma não viu.
  reconstructed boolean NOT NULL DEFAULT false,

  details jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),

  -- Forma mínima por tipo. Barra linha meia-boca vinda de escrita manual.
  CONSTRAINT cb_lead_events_shape CHECK (
    CASE event_type
      WHEN 'deal_created' THEN deal_id IS NOT NULL AND to_pipeline_id IS NOT NULL
      WHEN 'stage_changed' THEN deal_id IS NOT NULL AND to_stage_id IS NOT NULL
      WHEN 'pipeline_changed' THEN
        deal_id IS NOT NULL
        AND from_pipeline_id IS NOT NULL
        AND to_pipeline_id IS NOT NULL
        AND from_pipeline_id <> to_pipeline_id
      WHEN 'status_changed' THEN deal_id IS NOT NULL AND to_status IS NOT NULL
      WHEN 'deal_deleted' THEN deal_id IS NOT NULL
      -- ⚠️ Sem `contact_id IS NOT NULL` aqui, por mais tentador que pareça:
      -- apagar contato dispara SET NULL nesta coluna, que é um UPDATE, e
      -- UPDATE revalida CHECK. Exigir o contato faria a exclusão do contato
      -- falhar com violação de CHECK — o oposto de "preservar o histórico".
      WHEN 'tag_added' THEN tag_id IS NOT NULL
      WHEN 'tag_removed' THEN tag_id IS NOT NULL
      ELSE false
    END
  )
);

-- Leitura da trilha no chat e na ficha: sempre por contato, do mais novo para
-- o mais velho.
CREATE INDEX IF NOT EXISTS cb_lead_events_contato_idx
  ON cb_lead_events (account_id, contact_id, occurred_at DESC);

-- Leitura por card — o caminho que sobrevive ao contato apagado.
CREATE INDEX IF NOT EXISTS cb_lead_events_negocio_idx
  ON cb_lead_events (deal_id, occurred_at DESC)
  WHERE deal_id IS NOT NULL;

COMMENT ON TABLE cb_lead_events IS
  'Trilha append-only de mudanças de funil, etapa, status e tags do lead. Escrita só por trigger; `authenticated` tem apenas SELECT.';

-- ------------------------------------------------------------
-- 2) RLS — ler, e só
-- ------------------------------------------------------------
ALTER TABLE cb_lead_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cb_lead_events_select ON cb_lead_events;
CREATE POLICY cb_lead_events_select ON cb_lead_events FOR SELECT
  USING (is_account_member(account_id));

-- ⚠️ O REVOKE NÃO É REDUNDANTE com "não existe policy de INSERT/UPDATE/DELETE".
-- Verificado no banco: sem ele, um DELETE do papel `authenticated` NÃO dá
-- erro — a RLS apenas filtra as linhas e o comando volta "0 linhas afetadas".
-- Um atacante (ou um bug) leria isso como sucesso silencioso. Com o REVOKE, o
-- Postgres responde 42501 e a tentativa fica visível.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON cb_lead_events FROM authenticated, anon;
GRANT SELECT ON cb_lead_events TO authenticated;

-- ------------------------------------------------------------
-- 3) Quem está agindo
-- ------------------------------------------------------------
-- ⚠️ `profiles` é chaveada por `user_id`, NÃO por `id`. Buscar por `id` aqui
-- devolveria NULL em 100% dos eventos e o histórico diria "sistema" para
-- tudo — mentindo justamente sobre o "quem", que é o ponto da trilha.
-- O ORDER BY prioriza o perfil da conta do evento, para o caso (hoje
-- inexistente, amanhã não) de a mesma pessoa ter perfil em duas contas.
CREATE OR REPLACE FUNCTION cb_lead_event_actor(p_account_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT coalesce(nullif(p.full_name, ''), p.email)
    FROM profiles p
   WHERE p.user_id = auth.uid()
   ORDER BY (p.account_id = p_account_id) DESC
   LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION cb_lead_event_actor(uuid) FROM anon, authenticated;

-- ------------------------------------------------------------
-- 4) Trigger de `deals`
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION cb_log_deal_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row       deals;
  v_actor     uuid := auth.uid();
  v_origin    text;
  v_contato   text;
  v_canal     text;
  v_de_funil  text;
  v_para_funil text;
  v_de_etapa  text;
  v_de_pos    integer;
  v_para_etapa text;
  v_para_pos  integer;
  v_tipo      text;
BEGIN
  IF TG_OP = 'DELETE' THEN v_row := OLD; ELSE v_row := NEW; END IF;

  -- Cascata de conta: a própria `accounts` já saiu e `cb_lead_events` está
  -- sendo apagada junto. Gravar aqui seria escrever numa tabela em demolição.
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = v_row.account_id) THEN
    RETURN v_row;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- O gatilho é `UPDATE OF ...`, que dispara quando a coluna é MENCIONADA,
    -- mesmo sem mudar de valor — e o formulário de negócio manda
    -- `pipeline_id` e `stage_id` em todo save, inclusive quando o usuário só
    -- editou a anotação. Sem esta saída, cada save viraria uma linha falsa.
    IF NEW.pipeline_id IS NOT DISTINCT FROM OLD.pipeline_id
       AND NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id
       AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
      RETURN NEW;
    END IF;
  END IF;

  v_origin := CASE
    WHEN v_actor IS NOT NULL THEN 'usuario'
    WHEN TG_OP = 'INSERT' AND NEW.source = 'channel' THEN 'conexao'
    WHEN TG_OP = 'INSERT' AND NEW.source = 'automation' THEN 'automacao'
    ELSE 'sistema'
  END;

  SELECT coalesce(nullif(c.name, ''), c.phone) INTO v_contato
    FROM contacts c WHERE c.id = v_row.contact_id;

  BEGIN
    IF TG_OP = 'INSERT' THEN
      SELECT ch.label INTO v_canal FROM cb_channels ch WHERE ch.id = NEW.channel_id;
      SELECT p.name INTO v_para_funil FROM pipelines p WHERE p.id = NEW.pipeline_id;
      SELECT s.name, s.position INTO v_para_etapa, v_para_pos
        FROM pipeline_stages s WHERE s.id = NEW.stage_id;

      INSERT INTO cb_lead_events (
        account_id, contact_id, contact_label, deal_id, conversation_id,
        event_type, actor_user_id, actor_label, origin,
        to_pipeline_id, to_pipeline_label,
        to_stage_id, to_stage_label, to_stage_position,
        to_status, channel_id, channel_label, details
      ) VALUES (
        NEW.account_id, NEW.contact_id, v_contato, NEW.id, NEW.conversation_id,
        'deal_created', v_actor, cb_lead_event_actor(NEW.account_id), v_origin,
        NEW.pipeline_id, v_para_funil,
        NEW.stage_id, v_para_etapa, v_para_pos,
        NEW.status, NEW.channel_id, v_canal,
        jsonb_build_object('title', NEW.title, 'source', NEW.source)
      );

    ELSIF TG_OP = 'DELETE' THEN
      SELECT p.name INTO v_de_funil FROM pipelines p WHERE p.id = OLD.pipeline_id;
      SELECT s.name, s.position INTO v_de_etapa, v_de_pos
        FROM pipeline_stages s WHERE s.id = OLD.stage_id;

      INSERT INTO cb_lead_events (
        account_id, contact_id, contact_label, deal_id, conversation_id,
        event_type, actor_user_id, actor_label, origin,
        from_pipeline_id, from_pipeline_label,
        from_stage_id, from_stage_label, from_stage_position,
        from_status, channel_id, details
      ) VALUES (
        OLD.account_id, OLD.contact_id, v_contato, OLD.id, OLD.conversation_id,
        'deal_deleted', v_actor, cb_lead_event_actor(OLD.account_id), v_origin,
        OLD.pipeline_id, v_de_funil,
        OLD.stage_id, v_de_etapa, v_de_pos,
        OLD.status, OLD.channel_id,
        jsonb_build_object('title', OLD.title)
      );

    ELSE
      -- ⚠️ Funil e etapa saem numa linha SÓ quando o funil muda. O formulário
      -- grava `pipeline_id` e `stage_id` no MESMO update (deal-form.tsx:191),
      -- e é isso que permite ler "Bancário/Lead → Trabalhista/Triagem" como um
      -- movimento. Duas linhas separadas contariam a história errada: que o
      -- lead saiu e voltou.
      IF NEW.pipeline_id IS DISTINCT FROM OLD.pipeline_id THEN
        v_tipo := 'pipeline_changed';
      ELSIF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
        v_tipo := 'stage_changed';
      END IF;

      IF v_tipo IS NOT NULL THEN
        SELECT p.name INTO v_de_funil FROM pipelines p WHERE p.id = OLD.pipeline_id;
        SELECT p.name INTO v_para_funil FROM pipelines p WHERE p.id = NEW.pipeline_id;
        SELECT s.name, s.position INTO v_de_etapa, v_de_pos
          FROM pipeline_stages s WHERE s.id = OLD.stage_id;
        SELECT s.name, s.position INTO v_para_etapa, v_para_pos
          FROM pipeline_stages s WHERE s.id = NEW.stage_id;

        INSERT INTO cb_lead_events (
          account_id, contact_id, contact_label, deal_id, conversation_id,
          event_type, actor_user_id, actor_label, origin,
          from_pipeline_id, from_pipeline_label, to_pipeline_id, to_pipeline_label,
          from_stage_id, from_stage_label, from_stage_position,
          to_stage_id, to_stage_label, to_stage_position,
          channel_id
        ) VALUES (
          NEW.account_id, NEW.contact_id, v_contato, NEW.id, NEW.conversation_id,
          v_tipo, v_actor, cb_lead_event_actor(NEW.account_id), v_origin,
          OLD.pipeline_id, v_de_funil, NEW.pipeline_id, v_para_funil,
          OLD.stage_id, v_de_etapa, v_de_pos,
          NEW.stage_id, v_para_etapa, v_para_pos,
          NEW.channel_id
        );
      END IF;

      -- Status é linha própria: "moveu para Proposta" e "marcou como ganho"
      -- são dois fatos, e espremê-los numa linha esconderia um dos dois.
      IF NEW.status IS DISTINCT FROM OLD.status THEN
        SELECT p.name INTO v_para_funil FROM pipelines p WHERE p.id = NEW.pipeline_id;
        SELECT s.name, s.position INTO v_para_etapa, v_para_pos
          FROM pipeline_stages s WHERE s.id = NEW.stage_id;

        INSERT INTO cb_lead_events (
          account_id, contact_id, contact_label, deal_id, conversation_id,
          event_type, actor_user_id, actor_label, origin,
          from_status, to_status,
          to_pipeline_id, to_pipeline_label,
          to_stage_id, to_stage_label, to_stage_position,
          channel_id
        ) VALUES (
          NEW.account_id, NEW.contact_id, v_contato, NEW.id, NEW.conversation_id,
          'status_changed', v_actor, cb_lead_event_actor(NEW.account_id), v_origin,
          OLD.status, NEW.status,
          NEW.pipeline_id, v_para_funil,
          NEW.stage_id, v_para_etapa, v_para_pos,
          NEW.channel_id
        );
      END IF;
    END IF;

  EXCEPTION WHEN OTHERS THEN
    -- Ver "POLÍTICA DE FALHA" no topo. Ação humana: estoura, aparece na tela,
    -- a gente descobre na hora. Escrita do servidor: engole, porque a
    -- ingestão (`routeInboundToPipeline`) captura tudo e o lead simplesmente
    -- não viraria card — em silêncio.
    IF v_actor IS NOT NULL THEN
      RAISE;
    END IF;
    RAISE WARNING 'cb_lead_events: evento de negócio descartado (%): %',
      SQLSTATE, SQLERRM;
  END;

  RETURN v_row;
END;
$$;

DROP TRIGGER IF EXISTS cb_deals_log_event ON deals;
CREATE TRIGGER cb_deals_log_event
  AFTER INSERT OR DELETE ON deals
  FOR EACH ROW EXECUTE FUNCTION cb_log_deal_event();

-- `UPDATE OF` limita o disparo às três colunas que interessam: editar título,
-- valor ou anotação não é evento de funil e não deve nem chamar a função.
DROP TRIGGER IF EXISTS cb_deals_log_event_update ON deals;
CREATE TRIGGER cb_deals_log_event_update
  AFTER UPDATE OF pipeline_id, stage_id, status ON deals
  FOR EACH ROW EXECUTE FUNCTION cb_log_deal_event();

REVOKE EXECUTE ON FUNCTION cb_log_deal_event() FROM anon, authenticated;

-- ------------------------------------------------------------
-- 5) Trigger de `contact_tags`
-- ------------------------------------------------------------
-- ⚠️ `contact_tags` NÃO tem `account_id` — a tenancy dela é indireta, via
-- contato. Daí a busca em `contacts`, que de quebra resolve o caso perigoso:
-- quando o contato é apagado, as tags dele cascateiam e o trigger dispara com
-- o contato JÁ removido. Sem a saída silenciosa abaixo, `account_id` viria
-- NULL, o NOT NULL estouraria e — como quem apaga contato é uma pessoa
-- logada — a política de falha reergueria o erro: apagar contato passaria a
-- falhar. E registrar oito "tag removida" numa exclusão de contato seria
-- ruído: a exclusão é o evento, não cada tag que veio junto.
CREATE OR REPLACE FUNCTION cb_log_contact_tag_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row      contact_tags;
  v_actor    uuid := auth.uid();
  v_conta    uuid;
  v_contato  text;
  v_tag      text;
  v_cor      text;
BEGIN
  IF TG_OP = 'DELETE' THEN v_row := OLD; ELSE v_row := NEW; END IF;

  SELECT c.account_id, coalesce(nullif(c.name, ''), c.phone)
    INTO v_conta, v_contato
    FROM contacts c WHERE c.id = v_row.contact_id;

  IF v_conta IS NULL THEN
    RETURN v_row;
  END IF;

  BEGIN
    SELECT t.name, t.color INTO v_tag, v_cor FROM tags t WHERE t.id = v_row.tag_id;

    INSERT INTO cb_lead_events (
      account_id, contact_id, contact_label,
      event_type, actor_user_id, actor_label, origin,
      tag_id, tag_label, tag_color
    ) VALUES (
      v_conta, v_row.contact_id, v_contato,
      CASE WHEN TG_OP = 'DELETE' THEN 'tag_removed' ELSE 'tag_added' END,
      v_actor, cb_lead_event_actor(v_conta),
      CASE WHEN v_actor IS NOT NULL THEN 'usuario' ELSE 'sistema' END,
      v_row.tag_id, v_tag, v_cor
    );
  EXCEPTION WHEN OTHERS THEN
    IF v_actor IS NOT NULL THEN
      RAISE;
    END IF;
    RAISE WARNING 'cb_lead_events: evento de tag descartado (%): %',
      SQLSTATE, SQLERRM;
  END;

  RETURN v_row;
END;
$$;

DROP TRIGGER IF EXISTS cb_contact_tags_log_event ON contact_tags;
CREATE TRIGGER cb_contact_tags_log_event
  AFTER INSERT OR DELETE ON contact_tags
  FOR EACH ROW EXECUTE FUNCTION cb_log_contact_tag_event();

REVOKE EXECUTE ON FUNCTION cb_log_contact_tag_event() FROM anon, authenticated;

-- ------------------------------------------------------------
-- 6) Semente retroativa
-- ------------------------------------------------------------
-- Uma linha "negócio criado" por card já existente, com a data real de
-- criação e `reconstructed = true`: não sabemos quem criou nem por onde o
-- card passou antes de hoje, e a trilha precisa dizer isso em vez de fingir
-- que observou. Idempotente pelo NOT EXISTS — rodar de novo não duplica.
INSERT INTO cb_lead_events (
  account_id, contact_id, contact_label, deal_id, conversation_id,
  event_type, occurred_at, actor_user_id, actor_label, origin,
  to_pipeline_id, to_pipeline_label,
  to_stage_id, to_stage_label, to_stage_position,
  to_status, channel_id, channel_label, reconstructed, details
)
SELECT
  d.account_id, d.contact_id, coalesce(nullif(c.name, ''), c.phone),
  d.id, d.conversation_id,
  'deal_created', coalesce(d.created_at, now()), NULL, NULL, 'retroativo',
  d.pipeline_id, p.name,
  d.stage_id, s.name, s.position,
  d.status, d.channel_id, ch.label, true,
  jsonb_build_object('title', d.title, 'source', d.source)
  FROM deals d
  LEFT JOIN contacts c ON c.id = d.contact_id
  LEFT JOIN pipelines p ON p.id = d.pipeline_id
  LEFT JOIN pipeline_stages s ON s.id = d.stage_id
  LEFT JOIN cb_channels ch ON ch.id = d.channel_id
 WHERE NOT EXISTS (
   SELECT 1 FROM cb_lead_events e
    WHERE e.deal_id = d.id AND e.event_type = 'deal_created'
 );
