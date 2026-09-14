-- ============================================================
-- 991 — A janela de 24h da Meta, na linha da caixa de entrada
--
-- Pedido do operador em 10/09/2026, ao conectar o número oficial: "uma forma
-- discreta de marcar e mostrar aqui dentro da caixa de entrada quando o lead
-- tiver selecionado para a API da Meta" — o selo da ampulheta. A REGRA da
-- janela já existe e é lida no fio (`src/lib/inbox/janela-24h.ts`, PR #192):
-- 24h contadas da última mensagem do CLIENTE que chegou pelo número oficial
-- por onde se vai responder. O fio tem as mensagens carregadas; a LISTA não —
-- ela carrega só `conversations`. Por isso o banco passa a guardar o fato de
-- que a régua da lista precisa: QUANDO foi a última mensagem do cliente pela
-- API oficial, e POR QUAL número.
--
-- ⚠️ É GATILHO, não código de aplicação, pelo mesmo motivo da 972 (e da
-- trilha da 912): são vários os escritores de `messages` (webhook da Meta,
-- ingestão da Evolution, celular pareado, API v1…), e a regra com N
-- escritores mora onde nenhum deles pode esquecê-la.
--
-- Regras — ESPELHO de `contaParaOCanal` em `janela-24h.ts` (mudou lá, muda
-- aqui; há teste lendo este arquivo):
--   • só mensagem do CLIENTE (`sender_type = 'customer'`);
--   • CARIMBADA (`channel_id`): conta só se a conexão for da Meta
--     (`cb_channels.kind = 'meta'`). Mensagem pelo QR Code ou pelo Instagram
--     não abre janela nenhuma — a Evolution não tem janela, e a do Instagram
--     está fora desta v1;
--   • SEM carimbo: conta se o id do provedor é da API oficial (`wamid.`) —
--     é o histórico de antes do multi-canal e o carimbo que falhou. A
--     conversa fica com `janela_meta_canal_id` NULO, que a régua da lista lê
--     como "número oficial, qual não se sabe" (conta para qualquer número
--     oficial de saída, como o fio faz);
--   • só AVANÇA: a coluna guarda a mensagem mais RECENTE, e uma mensagem
--     antiga entregue depois (replay do webhook) não a recua;
--   • GRUPO fica de fora (`group_id IS NULL`): a Cloud API da Meta não
--     entrega grupo, e o fio exclui grupo da janela (`ehGrupo`);
--   • mensagem APAGADA continua contando: a janela da Meta abre com a
--     mensagem que o cliente MANDOU, e "apagar para todos" não a fecha do
--     lado da Meta — o fio também não olha `deleted_at`;
--   • conexão oficial APAGADA anula o número (`ON DELETE SET NULL`), como a
--     902 anula o carimbo das mensagens dela — a régua volta a "qual não se
--     sabe".
--
-- ⚠️ LIMITAÇÃO ESCRITA: é UM par por conversa — a mensagem oficial mais
-- recente, de QUALQUER número oficial. O fio conta POR número sobre as
-- mensagens. Com DOIS números oficiais na mesma conta, cliente que escreveu
-- aos dois e conversa FIXADA no mais antigo: o fio diz "aberta" e a lista
-- fica sem ampulheta (falso negativo, nunca o contrário). Aceito em
-- 12/09/2026 porque a conta tem um oficial; se um segundo for conectado, o
-- caminho é guardar a janela POR número (mapa canal→instante) numa migration
-- nova. `selo-da-janela.test.ts` pina a divergência.
--
-- ⚠️ A conversa ENCERRADA também é carimbada: a reabertura acontece DEPOIS
-- do insert (a mesma razão da 972), e é a TELA que esconde o selo na aba
-- Encerradas (decisão do operador, 10/09/2026).
--
-- SECURITY DEFINER e `search_path` fixo, como na 972: o compositor insere
-- com o client do operador, e a coluna tem de ser mantida independentemente
-- da policy de UPDATE de `conversations` para o papel dele.
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS janela_meta_desde timestamptz,
  ADD COLUMN IF NOT EXISTS janela_meta_canal_id uuid
    REFERENCES cb_channels(id) ON DELETE SET NULL;

COMMENT ON COLUMN conversations.janela_meta_desde IS
  'Quando chegou a última mensagem do CLIENTE pela API oficial da Meta (991). Mantida por gatilho; só avança. A janela de 24h da lista conta daqui. NULL = o cliente nunca escreveu pelo número oficial. Sempre NULL em grupo.';

COMMENT ON COLUMN conversations.janela_meta_canal_id IS
  'Por qual número oficial chegou a mensagem de janela_meta_desde (991). NULL com janela_meta_desde preenchido = mensagem da Meta sem carimbo (histórico, carimbo que falhou ou conexão apagada): conta para qualquer número oficial de saída, como no fio.';

-- ------------------------------------------------------------
-- 1) Mensagem do cliente pela API oficial avança o relógio.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION cb_marcar_janela_da_meta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kind text;
  v_em timestamptz := COALESCE(NEW.created_at, now());
BEGIN
  IF NEW.channel_id IS NOT NULL THEN
    SELECT kind INTO v_kind FROM cb_channels WHERE id = NEW.channel_id;
    IF v_kind IS DISTINCT FROM 'meta' THEN
      RETURN NEW;
    END IF;
  ELSIF NEW.message_id IS NULL OR NEW.message_id NOT LIKE 'wamid.%' THEN
    RETURN NEW;
  END IF;

  UPDATE conversations
  SET janela_meta_desde = v_em,
      janela_meta_canal_id = NEW.channel_id
  WHERE id = NEW.conversation_id
    AND group_id IS NULL
    AND (janela_meta_desde IS NULL OR janela_meta_desde < v_em);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cb_marcar_janela_da_meta_trigger ON messages;
CREATE TRIGGER cb_marcar_janela_da_meta_trigger
  AFTER INSERT ON messages
  FOR EACH ROW
  WHEN (NEW.sender_type = 'customer')
  EXECUTE FUNCTION cb_marcar_janela_da_meta();

-- ------------------------------------------------------------
-- 2) Privilégios — as duas metades. Ninguém chama a função direto (gatilho
-- dispara sem EXECUTE — checado no CREATE TRIGGER). A DEFINER fechada para
-- os papéis do PostgREST é o que impede alguém de chamá-la pela API com um
-- NEW forjado.
-- ------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION cb_marcar_janela_da_meta() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 3) Acervo: a última mensagem do cliente pela API oficial em cada
-- conversa. Idempotente (só avança) e vazio-seguro (zero linhas num banco
-- novo). A conversa cujo cliente escreveu há dias fica carimbada também —
-- a régua da lista é quem decide que 24h já passaram.
-- ------------------------------------------------------------
WITH oficiais AS (
  SELECT id FROM cb_channels WHERE kind = 'meta'
),
ultima AS (
  SELECT DISTINCT ON (m.conversation_id)
         m.conversation_id,
         m.created_at AS em,
         m.channel_id AS canal
  FROM messages m
  WHERE m.sender_type = 'customer'
    AND m.created_at IS NOT NULL
    AND (
      m.channel_id IN (SELECT id FROM oficiais)
      OR (m.channel_id IS NULL AND m.message_id LIKE 'wamid.%')
    )
  ORDER BY m.conversation_id, m.created_at DESC
)
UPDATE conversations c
SET janela_meta_desde = u.em,
    janela_meta_canal_id = u.canal
FROM ultima u
WHERE c.id = u.conversation_id
  AND c.group_id IS NULL
  AND (c.janela_meta_desde IS NULL OR c.janela_meta_desde < u.em);

-- ------------------------------------------------------------
-- 4) Conferência — forma e privilégio (verdadeiras num banco vazio) e a
-- mecânica do acervo, DERIVADA do banco e pulada quando não há dado.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_conv uuid;
  v_em timestamptz;
  v_gravado timestamptz;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'conversations' AND column_name = 'janela_meta_desde'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'conversations' AND column_name = 'janela_meta_canal_id'
  ) THEN
    RAISE EXCEPTION '991: coluna da janela ausente';
  END IF;

  -- A FK anula o número quando a conexão some ('n' = SET NULL).
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'conversations_janela_meta_canal_id_fkey' AND confdeltype = 'n'
  ) THEN
    RAISE EXCEPTION '991: FK do número da janela sem ON DELETE SET NULL';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'cb_marcar_janela_da_meta_trigger'
  ) THEN
    RAISE EXCEPTION '991: gatilho de messages ausente';
  END IF;

  IF has_function_privilege('anon', 'cb_marcar_janela_da_meta()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'cb_marcar_janela_da_meta()', 'EXECUTE') THEN
    RAISE EXCEPTION '991: função DEFINER continua executável pela API';
  END IF;

  -- Forma: grupo nunca tem janela, e número sem instante não existe. Afirmar
  -- ausência é trivialmente verdadeiro num banco vazio.
  IF EXISTS (
    SELECT 1 FROM conversations WHERE group_id IS NOT NULL AND janela_meta_desde IS NOT NULL
  ) THEN
    RAISE EXCEPTION '991: grupo com janela_meta_desde preenchido';
  END IF;
  IF EXISTS (
    SELECT 1 FROM conversations WHERE janela_meta_canal_id IS NOT NULL AND janela_meta_desde IS NULL
  ) THEN
    RAISE EXCEPTION '991: número da janela sem instante';
  END IF;

  -- Mecânica do acervo: a conversa da mensagem mais recente do cliente pela
  -- API oficial tem de estar carimbada com ela (ou com algo mais novo).
  SELECT m.conversation_id, m.created_at INTO v_conv, v_em
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
    RAISE NOTICE '991: banco sem mensagem do cliente pela API oficial, nada a provar.';
  ELSE
    SELECT janela_meta_desde INTO v_gravado FROM conversations WHERE id = v_conv;
    IF v_gravado IS NULL OR v_gravado < v_em THEN
      RAISE EXCEPTION '991: acervo não carimbou a conversa % (gravado %, esperado >= %)',
        v_conv, v_gravado, v_em;
    END IF;
  END IF;
END $$;
