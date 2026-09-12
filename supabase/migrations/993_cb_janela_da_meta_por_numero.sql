-- ============================================================
-- 993 — A janela de 24h da Meta POR NÚMERO (substitui as colunas da 991)
--
-- A 991 guardava UM par por conversa (`janela_meta_desde` +
-- `janela_meta_canal_id`): a mensagem oficial mais recente do cliente, de
-- QUALQUER número oficial. O fio conta POR número sobre as mensagens
-- (`contaParaOCanal`, `janela-24h.ts`). Com dois números oficiais na mesma
-- conta, cliente que escreveu aos dois e conversa FIXADA no mais antigo: o
-- fio dizia "aberta" e a lista escondia a ampulheta (achado da revisão do PR
-- #194 e do Codex; aceito em 12/09/2026 como limitação escrita e revisto no
-- mesmo dia, a pedido do operador). Agora a conversa guarda um MAPA
-- número → instante:
--
--   janela_meta = { "<channel_id>": "<timestamptz>", …,
--                   "sem_carimbo": "<timestamptz>" }
--
-- e a régua da lista lê a entrada do número de SAÍDA e a `sem_carimbo`,
-- ficando com a mais recente — exatamente o que o fio faz ao procurar a
-- última mensagem do cliente que conta para aquele número.
--
-- Regras — ESPELHO de `contaParaOCanal` (há teste lendo este arquivo):
--   • só mensagem do CLIENTE; carimbada, só conexão `meta` (entra na chave do
--     número); SEM carimbo, só se o id é `wamid.` (entra em `sem_carimbo`);
--   • cada chave só AVANÇA (replay do webhook não recua);
--   • GRUPO fora; mensagem apagada continua contando (o fio também não olha
--     `deleted_at`);
--   • conexão oficial APAGADA: a chave dela é DOBRADA em `sem_carimbo`,
--     ficando a mais recente das duas. É o que a 902 faz com o carimbo das
--     mensagens (ON DELETE SET NULL): o fio passa a contá-las como sem
--     carimbo, para qualquer número oficial de saída. Sem a dobra, a lista
--     esconderia uma janela que o fio mostra.
--
-- As colunas da 991 são REMOVIDAS: duas fontes divergiriam. O app anterior
-- lê `select *` e degrada sem elas (sem ampulheta); o novo lê `janela_meta`.
-- Nenhuma outra tela ou rota lia as duas colunas (conferido no PR #194).
--
-- SECURITY DEFINER e `search_path` fixo nas duas funções, como na 972.
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS janela_meta jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN conversations.janela_meta IS
  'A janela de 24h da Meta POR NÚMERO (993): mapa id-da-conexão → instante da última mensagem do CLIENTE por aquele número oficial; a chave sem_carimbo guarda a mensagem da Meta sem carimbo (histórico, carimbo que falhou, conexão apagada), que conta para qualquer número oficial. Mantido por gatilho; cada chave só avança. {} = o cliente nunca escreveu pelo oficial. Sempre {} em grupo.';

-- ------------------------------------------------------------
-- 1) O gatilho da 991, agora gravando na chave do número.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION cb_marcar_janela_da_meta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kind text;
  v_chave text;
  v_em timestamptz := COALESCE(NEW.created_at, now());
BEGIN
  IF NEW.channel_id IS NOT NULL THEN
    SELECT kind INTO v_kind FROM cb_channels WHERE id = NEW.channel_id;
    IF v_kind IS DISTINCT FROM 'meta' THEN
      RETURN NEW;
    END IF;
    v_chave := NEW.channel_id::text;
  ELSIF NEW.message_id IS NULL OR NEW.message_id NOT LIKE 'wamid.%' THEN
    RETURN NEW;
  ELSE
    v_chave := 'sem_carimbo';
  END IF;

  UPDATE conversations
  SET janela_meta = janela_meta || jsonb_build_object(v_chave, v_em)
  WHERE id = NEW.conversation_id
    AND group_id IS NULL
    AND ((janela_meta -> v_chave) IS NULL
         OR (janela_meta ->> v_chave)::timestamptz < v_em);
  RETURN NEW;
END;
$$;

-- O gatilho da 991 continua apontando para a função (mesmo nome); recriado
-- aqui só para a migration valer sozinha num banco que nunca viu a 991.
DROP TRIGGER IF EXISTS cb_marcar_janela_da_meta_trigger ON messages;
CREATE TRIGGER cb_marcar_janela_da_meta_trigger
  AFTER INSERT ON messages
  FOR EACH ROW
  WHEN (NEW.sender_type = 'customer')
  EXECUTE FUNCTION cb_marcar_janela_da_meta();

-- ------------------------------------------------------------
-- 2) Conexão oficial apagada: a chave dela vira `sem_carimbo`.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION cb_dobrar_janela_da_conexao_apagada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_chave text := OLD.id::text;
BEGIN
  IF OLD.kind IS DISTINCT FROM 'meta' THEN
    RETURN OLD;
  END IF;
  UPDATE conversations
  SET janela_meta = (janela_meta - v_chave) || jsonb_build_object(
    'sem_carimbo',
    GREATEST((janela_meta ->> v_chave)::timestamptz,
             (janela_meta ->> 'sem_carimbo')::timestamptz)
  )
  WHERE janela_meta ? v_chave;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS cb_dobrar_janela_da_conexao_apagada_trigger ON cb_channels;
CREATE TRIGGER cb_dobrar_janela_da_conexao_apagada_trigger
  AFTER DELETE ON cb_channels
  FOR EACH ROW
  EXECUTE FUNCTION cb_dobrar_janela_da_conexao_apagada();

-- ------------------------------------------------------------
-- 3) Privilégios — gatilho dispara sem EXECUTE; a DEFINER fechada para os
-- papéis do PostgREST é o que impede chamá-la pela API com um NEW forjado.
-- ------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION cb_marcar_janela_da_meta() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION cb_dobrar_janela_da_conexao_apagada() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 4) Acervo: refeito de `messages` (o par da 991 guardava só a mais recente
-- e não serve de fonte). Uma chave por número, com a última mensagem do
-- cliente por ali; `||` sobrescreve com o mesmo valor numa segunda passada.
-- Vazio-seguro: zero linhas num banco novo.
-- ------------------------------------------------------------
WITH oficiais AS (
  SELECT id FROM cb_channels WHERE kind = 'meta'
),
ultimas AS (
  SELECT m.conversation_id,
         COALESCE(m.channel_id::text, 'sem_carimbo') AS chave,
         MAX(m.created_at) AS em
  FROM messages m
  WHERE m.sender_type = 'customer'
    AND m.created_at IS NOT NULL
    AND (
      m.channel_id IN (SELECT id FROM oficiais)
      OR (m.channel_id IS NULL AND m.message_id LIKE 'wamid.%')
    )
  GROUP BY m.conversation_id, COALESCE(m.channel_id::text, 'sem_carimbo')
),
mapas AS (
  SELECT conversation_id, jsonb_object_agg(chave, to_jsonb(em)) AS mapa
  FROM ultimas
  GROUP BY conversation_id
)
UPDATE conversations c
SET janela_meta = c.janela_meta || m.mapa
FROM mapas m
WHERE c.id = m.conversation_id
  AND c.group_id IS NULL;

-- ------------------------------------------------------------
-- 5) As colunas da 991 saem (a FK de janela_meta_canal_id vai junto).
-- ------------------------------------------------------------
ALTER TABLE conversations
  DROP COLUMN IF EXISTS janela_meta_canal_id,
  DROP COLUMN IF EXISTS janela_meta_desde;

-- ------------------------------------------------------------
-- 6) Conferência — forma e privilégio (verdadeiras num banco vazio) e a
-- mecânica do acervo, DERIVADA do banco e pulada quando não há dado.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_conv uuid;
  v_chave text;
  v_em timestamptz;
  v_gravado timestamptz;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'conversations' AND column_name = 'janela_meta'
      AND data_type = 'jsonb' AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION '993: coluna janela_meta ausente ou com a forma errada';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'conversations'
      AND column_name IN ('janela_meta_desde', 'janela_meta_canal_id')
  ) THEN
    RAISE EXCEPTION '993: as colunas da 991 continuam na tabela';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'cb_marcar_janela_da_meta_trigger')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'cb_dobrar_janela_da_conexao_apagada_trigger') THEN
    RAISE EXCEPTION '993: gatilho ausente';
  END IF;
  IF has_function_privilege('anon', 'cb_marcar_janela_da_meta()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'cb_marcar_janela_da_meta()', 'EXECUTE')
     OR has_function_privilege('anon', 'cb_dobrar_janela_da_conexao_apagada()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'cb_dobrar_janela_da_conexao_apagada()', 'EXECUTE') THEN
    RAISE EXCEPTION '993: função DEFINER continua executável pela API';
  END IF;

  -- Forma: grupo nunca tem janela, e toda chave é `sem_carimbo` ou uma
  -- conexão oficial VIVA (a apagada foi dobrada). Afirmar ausência é
  -- trivialmente verdadeiro num banco vazio.
  IF EXISTS (
    SELECT 1 FROM conversations WHERE group_id IS NOT NULL AND janela_meta <> '{}'::jsonb
  ) THEN
    RAISE EXCEPTION '993: grupo com janela_meta preenchido';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM conversations c, jsonb_each_text(c.janela_meta) e
    WHERE e.key <> 'sem_carimbo'
      AND NOT EXISTS (
        SELECT 1 FROM cb_channels ch WHERE ch.id::text = e.key AND ch.kind = 'meta'
      )
  ) THEN
    RAISE EXCEPTION '993: chave de janela_meta que não é conexão oficial viva';
  END IF;

  -- Mecânica do acervo: a mensagem mais recente do cliente pela API oficial
  -- tem de estar na chave do número dela (ou em sem_carimbo), com valor >=.
  SELECT m.conversation_id, COALESCE(m.channel_id::text, 'sem_carimbo'), m.created_at
    INTO v_conv, v_chave, v_em
  FROM messages m
  JOIN conversations c ON c.id = m.conversation_id
  WHERE m.sender_type = 'customer'
    AND c.group_id IS NULL
    AND m.created_at IS NOT NULL
    AND (
      m.channel_id IN (SELECT id FROM cb_channels WHERE kind = 'meta')
      OR (m.channel_id IS NULL AND m.message_id LIKE 'wamid.%')
    )
  ORDER BY m.created_at DESC
  LIMIT 1;

  IF v_conv IS NULL THEN
    RAISE NOTICE '993: banco sem mensagem do cliente pela API oficial, nada a provar.';
  ELSE
    SELECT (janela_meta ->> v_chave)::timestamptz INTO v_gravado
    FROM conversations WHERE id = v_conv;
    IF v_gravado IS NULL OR v_gravado < v_em THEN
      RAISE EXCEPTION '993: acervo não carimbou a conversa % na chave % (gravado %, esperado >= %)',
        v_conv, v_chave, v_gravado, v_em;
    END IF;
  END IF;
END $$;
