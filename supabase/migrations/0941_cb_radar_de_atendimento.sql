-- ============================================================
-- 941 — Radar de Atendimento
--
-- Um worker periódico lê as conversas dos últimos 7 dias e grava AQUI o
-- resultado (nota, urgência, insatisfação, pedidos não atendidos, menção a
-- processo, métricas de tempo). O painel /radar lê esta tabela; quem escreve
-- é SÓ o worker em service-role — o mesmo desenho da trilha 912.
--
-- Decisões que moram nesta migration (o "porquê" fica aqui porque o schema
-- não consegue contá-lo):
--
-- 1. UMA linha viva por conversa (UNIQUE em conversation_id), reescrita a
--    cada análise. Histórico de notas é evolução futura; guardar toda análise
--    já feita hoje só encheria a tabela sem leitor — o destino que o
--    CLAUDE.md documenta para broadcasts.scheduled_at.
-- 2. `radar_enabled` em cb_channels nasce FALSE. É deliberadamente o oposto
--    da convenção "escopo vazio = todos": o Radar manda conversa de cliente
--    para um provedor de IA externo, e há canal de uso PESSOAL conectado na
--    conta. Ligar é decisão explícita do operador, canal a canal.
-- 3. As FKs são compostas com account_id (molde 925/910): o worker roda em
--    service-role e ignora RLS — FK simples só provaria "existe uma conversa
--    com esse id", não "é da conta certa".
-- 4. `ultima_mensagem_analisada_id` NÃO tem FK: apagar mensagem do fio não
--    pode travar nem cascatear o insight (mesma razão registrada na 932 para
--    reply_to_message_id).
-- 5. O claim do worker é `status='running'` + `running_desde` (o carimbo que
--    a 928 ensinou: created_at/scheduled_for são proxies errados de "quando
--    começou a rodar").
-- ============================================================

-- ------------------------------------------------------------
-- A tabela
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cb_conversation_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  -- Canal da conversa no momento da análise (para o filtro do painel).
  -- NULL quando a conversa não tem canal carimbado (registro pré-902).
  channel_id      uuid,

  -- Janela efetivamente analisada + marca d'água incremental.
  janela_inicio   timestamptz,
  janela_fim      timestamptz,
  ultima_mensagem_analisada_id uuid,
  mensagens_analisadas integer NOT NULL DEFAULT 0,
  -- Mídia/áudio sem texto dentro da janela: a análise é cega a elas e o
  -- painel precisa DIZER isso em vez de fingir cobertura total.
  mensagens_sem_texto integer NOT NULL DEFAULT 0,

  -- Resultado da IA (colunas promovidas para filtro/agregação; o JSON
  -- completo com as evidências fica em `detalhes`).
  nota            smallint CHECK (nota IS NULL OR nota BETWEEN 0 AND 10),
  urgencia        text NOT NULL DEFAULT 'nenhuma'
    CHECK (urgencia IN ('nenhuma','baixa','media','alta')),
  insatisfacao    boolean NOT NULL DEFAULT false,
  mencao_processo boolean NOT NULL DEFAULT false,
  pedidos_abertos integer NOT NULL DEFAULT 0,
  resumo          text,
  detalhes        jsonb,

  -- Métricas determinísticas (SQL/JS sobre sender_type + created_at),
  -- gravadas junto para o painel não recalcular a cada visita.
  -- `aguardando_desde`: o cliente falou por último e ninguém respondeu —
  -- é o sinal mais acionável do painel e existe mesmo sem IA.
  primeira_resposta_seg integer,
  resposta_mediana_seg  integer,
  aguardando_desde      timestamptz,

  -- Ciclo de vida do sinal (anti fadiga de alarme). Reanálise com mensagem
  -- nova volta para 'aberto': a situação mudou, o tratamento anterior não
  -- vale mais. `descartado` alimenta a calibração (falso positivo).
  estado       text NOT NULL DEFAULT 'aberto'
    CHECK (estado IN ('aberto','tratado','descartado')),
  estado_por   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  estado_em    timestamptz,

  -- Worker (molde 925/928).
  status        text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','done','failed')),
  running_desde timestamptz,
  erro          text,
  tentativas    smallint NOT NULL DEFAULT 0,
  analisado_em  timestamptz,

  -- Atribuição de custo desta análise (espelha ai_usage_log, que guarda o
  -- agregado; aqui fica o da ÚLTIMA análise, para depurar conversa cara).
  provider text,
  model    text,
  prompt_tokens     integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cb_conversation_insights_conversa_fkey
    FOREIGN KEY (conversation_id, account_id)
    REFERENCES conversations(id, account_id) ON DELETE CASCADE,
  CONSTRAINT cb_conversation_insights_canal_fkey
    FOREIGN KEY (channel_id, account_id)
    REFERENCES cb_channels(id, account_id) ON DELETE SET NULL (channel_id)
);

-- Uma linha viva por conversa. Índice ÚNICO TOTAL (não parcial) de
-- propósito: é o que permite upsert por ON CONFLICT — a armadilha dos
-- índices parciais da 903 não se aplica aqui.
CREATE UNIQUE INDEX IF NOT EXISTS cb_conversation_insights_conversa_idx
  ON cb_conversation_insights (conversation_id);

-- A leitura do painel: os insights da conta, mais recentes primeiro.
CREATE INDEX IF NOT EXISTS cb_conversation_insights_painel_idx
  ON cb_conversation_insights (account_id, analisado_em DESC);

-- ------------------------------------------------------------
-- Índice que faltava em messages
--
-- A varredura do worker é "mensagens desta conversa nesta janela", e o fio
-- do inbox ordena por created_at — até aqui só existia índice em
-- (conversation_id). Com 2,5 mil linhas nada dói; este índice é para o
-- problema nunca aparecer.
-- ------------------------------------------------------------

CREATE INDEX IF NOT EXISTS messages_conversa_data_idx
  ON messages (conversation_id, created_at);

-- ------------------------------------------------------------
-- Opt-in por canal
-- ------------------------------------------------------------

ALTER TABLE cb_channels
  ADD COLUMN IF NOT EXISTS radar_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN cb_channels.radar_enabled IS
  'Radar de Atendimento analisa as conversas deste canal com IA. Nasce '
  'desligado de propósito (sigilo advogado-cliente): ligar é decisão '
  'explícita do operador. ⚠️ Coluna de configuração: precisa estar em '
  'CB_CHANNEL_SAFE_COLUMNS (repo.ts) para aparecer na tela.';

-- ------------------------------------------------------------
-- Gemini como terceiro provedor + modo 'radar' no log de uso
--
-- Os CHECKs vieram da 029/033 com a lista fechada em ('openai','anthropic').
-- DROP + ADD porque CHECK não tem ALTER; os nomes vêm do padrão do Postgres
-- para constraints sem nome explícito (conferidos no banco em 2026-08-27).
-- ------------------------------------------------------------

ALTER TABLE ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_provider_check;
ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_provider_check
  CHECK (provider IN ('openai','anthropic','gemini'));

ALTER TABLE ai_usage_log
  DROP CONSTRAINT IF EXISTS ai_usage_log_provider_check;
ALTER TABLE ai_usage_log
  ADD CONSTRAINT ai_usage_log_provider_check
  CHECK (provider IN ('openai','anthropic','gemini'));

ALTER TABLE ai_usage_log
  DROP CONSTRAINT IF EXISTS ai_usage_log_mode_check;
ALTER TABLE ai_usage_log
  ADD CONSTRAINT ai_usage_log_mode_check
  CHECK (mode IN ('auto_reply','draft','radar'));

-- ------------------------------------------------------------
-- Batimento do ciclo do Radar (decisão da 937: coluna nova na tabela de
-- batimento que já existe, não tabela nova). Semeada em 'epoch', nunca em
-- now(): "nunca rodou" tem de ser distinguível de "rodou agora".
-- ------------------------------------------------------------

ALTER TABLE cb_agendador_batimento
  ADD COLUMN IF NOT EXISTS ultimo_ciclo_radar timestamptz NOT NULL DEFAULT 'epoch';

-- ------------------------------------------------------------
-- Permissões — padrão 912 + as quatro linhas completas (lição 913/915/931):
-- authenticated SÓ LÊ; anon não tem NADA; service_role escreve.
-- O estado (tratar/descartar) muda por rota de API com service-role, nunca
-- pelo navegador — o REVOKE de UPDATE não é redundante: sem ele um UPDATE
-- do navegador voltaria "0 linhas" com cara de sucesso.
--
-- ⚠️ Banco vazio: todo privilégio conferido abaixo é CONCEDIDO por escrito
-- aqui — nada depende do default privilege do Supabase.
-- ------------------------------------------------------------

ALTER TABLE cb_conversation_insights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cb_conversation_insights_select ON cb_conversation_insights;
CREATE POLICY cb_conversation_insights_select ON cb_conversation_insights
  FOR SELECT USING (is_account_member(account_id));

REVOKE ALL ON TABLE cb_conversation_insights FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE cb_conversation_insights
  FROM authenticated;
GRANT  SELECT ON TABLE cb_conversation_insights TO authenticated;
GRANT  SELECT, INSERT, UPDATE, DELETE ON TABLE cb_conversation_insights
  TO service_role;

-- ------------------------------------------------------------
-- Conferência do RESULTADO, não da intenção (regra do CLAUDE.md).
-- Nenhum bloco depende de dado que só exista em produção.
-- ------------------------------------------------------------

DO $$
BEGIN
  -- RLS ligada e com exatamente a policy de SELECT.
  IF NOT (SELECT relrowsecurity FROM pg_class
          WHERE relname = 'cb_conversation_insights') THEN
    RAISE EXCEPTION '941: RLS desligada em cb_conversation_insights';
  END IF;
  IF (SELECT count(*) FROM pg_policies
      WHERE tablename = 'cb_conversation_insights') <> 1 THEN
    RAISE EXCEPTION '941: esperava 1 policy em cb_conversation_insights';
  END IF;

  -- authenticated: SELECT sim, escrita não.
  IF NOT has_table_privilege('authenticated', 'cb_conversation_insights', 'SELECT') THEN
    RAISE EXCEPTION '941: authenticated perdeu o SELECT';
  END IF;
  IF has_table_privilege('authenticated', 'cb_conversation_insights', 'INSERT')
     OR has_table_privilege('authenticated', 'cb_conversation_insights', 'UPDATE')
     OR has_table_privilege('authenticated', 'cb_conversation_insights', 'DELETE') THEN
    RAISE EXCEPTION '941: authenticated consegue escrever em cb_conversation_insights';
  END IF;

  -- anon: nada.
  IF has_table_privilege('anon', 'cb_conversation_insights', 'SELECT') THEN
    RAISE EXCEPTION '941: anon enxerga cb_conversation_insights';
  END IF;

  -- service_role: escrita completa (o worker é ele).
  IF NOT (has_table_privilege('service_role', 'cb_conversation_insights', 'INSERT')
      AND has_table_privilege('service_role', 'cb_conversation_insights', 'UPDATE')
      AND has_table_privilege('service_role', 'cb_conversation_insights', 'DELETE')) THEN
    RAISE EXCEPTION '941: service_role sem escrita em cb_conversation_insights';
  END IF;

  -- Os CHECKs ampliados aceitam o valor novo e continuam recusando lixo.
  IF EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'ai_configs_provider_check'
      AND check_clause NOT LIKE '%gemini%'
  ) THEN
    RAISE EXCEPTION '941: CHECK de ai_configs.provider ficou sem gemini';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'ai_usage_log_mode_check'
      AND check_clause NOT LIKE '%radar%'
  ) THEN
    RAISE EXCEPTION '941: CHECK de ai_usage_log.mode ficou sem radar';
  END IF;

  -- Colunas novas existem.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cb_channels' AND column_name = 'radar_enabled'
  ) THEN
    RAISE EXCEPTION '941: cb_channels.radar_enabled não foi criada';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cb_agendador_batimento'
      AND column_name = 'ultimo_ciclo_radar'
  ) THEN
    RAISE EXCEPTION '941: cb_agendador_batimento.ultimo_ciclo_radar não foi criada';
  END IF;

  RAISE NOTICE '941: ok.';
END $$;
