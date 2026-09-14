-- ============================================================
-- 972 — Desde quando o cliente espera resposta (alerta de atraso na caixa)
--
-- Pedido do operador em 2026-09-02: conversa aberta cuja última fala é do
-- cliente, sem resposta nossa por 10 minutos e sem ter sido encerrada, ganha
-- um alerta visual na linha da caixa de entrada. Os 10 minutos são régua de
-- TELA (`src/lib/inbox/atraso.ts`); o que o banco guarda é o fato: desde
-- quando alguém espera.
--
-- ⚠️ É GATILHO, não código de aplicação, pelo mesmo motivo da trilha da 912:
-- há seis escritores de `messages` (webhook da Meta, ingestão e celular
-- pareado da Evolution, núcleo de envio, grupos, senders do robô) e a regra
-- com N escritores mora onde nenhum deles pode esquecê-la.
--
-- Regras:
--   • mensagem do CLIENTE preenche `aguardando_desde` — só se estiver vazia:
--     o relógio conta da PRIMEIRA mensagem sem resposta, não da última
--     (cliente que manda três seguidas espera desde a primeira);
--   • resposta de GENTE limpa. Gente = `sender_id` preenchido OU
--     `from_device` — a régua do Radar, medida em produção (948 mensagens da
--     equipe saem pelo celular pareado e 8 pelo CRM). ⚠️ Broadcast, fluxo,
--     automação e IA NÃO limpam: um disparo em massa apagaria o alerta de
--     todo cliente esquecido, a armadilha que o Radar já documenta;
--   • ENCERRAR limpa (BEFORE UPDATE, na mesma escrita): encerrada não espera
--     ninguém, e a reaberta pelo cliente recomeça a contar da mensagem dele;
--   • mensagem APAGADA recalcula: o cliente que manda "oi" e apaga em
--     seguida ("apagou para todos", `deleted_at` carimbado pelo webhook da
--     Evolution) não está esperando nada — sem o recálculo o relógio
--     ficaria preso numa mensagem que não existe mais (Codex, PR #106);
--   • GRUPO fica de fora (`group_id IS NULL`): "cliente esperando" não faz
--     sentido com trinta participantes, e o contador de não lidas já o
--     exclui pelo mesmo motivo.
--
-- ⚠️ A mensagem do cliente preenche a coluna MESMO com a conversa encerrada:
-- a reabertura (`reopenClosedConversation`) acontece DEPOIS do insert, na
-- mesma requisição, e um gatilho que exigisse `status <> 'closed'` deixaria
-- a conversa reaberta sem relógio. A tela esconde o alerta enquanto a linha
-- estiver encerrada.
--
-- SECURITY DEFINER no gatilho de `messages`: o compositor insere a mensagem
-- com o client do OPERADOR (sob RLS), e a coluna tem de ser mantida
-- independentemente da policy de UPDATE de `conversations` para aquele
-- papel. `search_path` fixo, como manda o lint 0011.
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS aguardando_desde timestamptz;

COMMENT ON COLUMN conversations.aguardando_desde IS
  'Desde quando o cliente espera resposta de gente (972). Mantida por gatilho: mensagem do cliente preenche se vazia; resposta com sender_id ou from_device limpa; encerrar limpa. NULL = ninguém esperando. Sempre NULL em grupo.';

-- ------------------------------------------------------------
-- 1) Mensagem nova mexe no relógio.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION cb_marcar_aguardando_resposta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.sender_type = 'customer' THEN
    UPDATE conversations
    SET aguardando_desde = COALESCE(aguardando_desde, NEW.created_at, now())
    WHERE id = NEW.conversation_id
      AND group_id IS NULL
      AND aguardando_desde IS NULL;
  ELSIF NEW.sender_type = 'agent'
    AND (NEW.sender_id IS NOT NULL OR NEW.from_device) THEN
    UPDATE conversations
    SET aguardando_desde = NULL
    WHERE id = NEW.conversation_id
      AND aguardando_desde IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cb_marcar_aguardando_resposta_trigger ON messages;
CREATE TRIGGER cb_marcar_aguardando_resposta_trigger
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION cb_marcar_aguardando_resposta();

-- ------------------------------------------------------------
-- 1b) Mensagem apagada recalcula o relógio a partir do que SOBROU:
-- a primeira mensagem viva do cliente depois da última resposta viva de
-- gente — a mesma conta do acervo lá embaixo. `deleted_at` só é escrito
-- pelo webhook (`messages.delete`) e pelo caminho de exclusão do CRM, e
-- nos dois é UPDATE de NULL para carimbo; voltar de carimbo para NULL não
-- existe, então o gatilho só olha esse sentido.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION cb_mensagem_apagada_recalcula_espera()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    UPDATE conversations c
    SET aguardando_desde = (
      SELECT MIN(m.created_at)
      FROM messages m
      WHERE m.conversation_id = c.id
        AND m.sender_type = 'customer'
        AND m.deleted_at IS NULL
        AND m.created_at > COALESCE((
          SELECT MAX(h.created_at)
          FROM messages h
          WHERE h.conversation_id = c.id
            AND h.sender_type = 'agent'
            AND (h.sender_id IS NOT NULL OR h.from_device)
            AND h.deleted_at IS NULL
        ), '-infinity'::timestamptz)
    )
    WHERE c.id = NEW.conversation_id
      AND c.group_id IS NULL
      AND c.status <> 'closed';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cb_mensagem_apagada_recalcula_espera_trigger ON messages;
CREATE TRIGGER cb_mensagem_apagada_recalcula_espera_trigger
  AFTER UPDATE OF deleted_at ON messages
  FOR EACH ROW
  EXECUTE FUNCTION cb_mensagem_apagada_recalcula_espera();

-- ------------------------------------------------------------
-- 2) Encerrar limpa — BEFORE, para ir na MESMA escrita do status.
-- SECURITY INVOKER basta: só mexe em NEW.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION cb_encerrar_limpa_espera()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'closed' AND OLD.status IS DISTINCT FROM 'closed' THEN
    NEW.aguardando_desde := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cb_encerrar_limpa_espera_trigger ON conversations;
CREATE TRIGGER cb_encerrar_limpa_espera_trigger
  BEFORE UPDATE OF status ON conversations
  FOR EACH ROW
  EXECUTE FUNCTION cb_encerrar_limpa_espera();

-- ------------------------------------------------------------
-- 3) Privilégios — as duas metades. Ninguém chama as funções direto
-- (gatilho dispara sem EXECUTE — checado no CREATE TRIGGER). A DEFINER
-- fechada para os papéis do PostgREST é o que impede alguém de chamá-la
-- pela API com um NEW forjado.
-- ------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION cb_marcar_aguardando_resposta() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION cb_mensagem_apagada_recalcula_espera() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION cb_encerrar_limpa_espera() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 4) Acervo: quem já está esperando hoje. Idempotente (só preenche o que
-- está NULL) e vazio-seguro (zero linhas num banco novo). Mensagem apagada
-- não conta: "Esta mensagem foi apagada" não é pergunta esperando resposta.
--
-- ⚠️ SEM recorte de idade, de propósito: conversa aberta em que o cliente
-- falou por último há 40 dias está esperando há 40 dias — e o objetivo da
-- caixa é zerá-la, então cada uma dessas precisa ser respondida ou
-- encerrada. Esconder as antigas daria uma caixa "limpa" por omissão.
-- ------------------------------------------------------------
WITH ultima_resposta AS (
  SELECT conversation_id, MAX(created_at) AS em
  FROM messages
  WHERE sender_type = 'agent'
    AND (sender_id IS NOT NULL OR from_device)
    AND deleted_at IS NULL
  GROUP BY conversation_id
),
espera AS (
  SELECT m.conversation_id, MIN(m.created_at) AS desde
  FROM messages m
  LEFT JOIN ultima_resposta r ON r.conversation_id = m.conversation_id
  WHERE m.sender_type = 'customer'
    AND m.deleted_at IS NULL
    AND (r.em IS NULL OR m.created_at > r.em)
  GROUP BY m.conversation_id
)
UPDATE conversations c
SET aguardando_desde = e.desde
FROM espera e
WHERE c.id = e.conversation_id
  AND c.group_id IS NULL
  AND c.status <> 'closed'
  AND c.aguardando_desde IS NULL;

-- ------------------------------------------------------------
-- 5) Conferência — forma e privilégio; verdadeira num banco vazio.
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'conversations' AND column_name = 'aguardando_desde'
  ) THEN
    RAISE EXCEPTION '972: coluna aguardando_desde ausente';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'cb_marcar_aguardando_resposta_trigger'
  ) THEN
    RAISE EXCEPTION '972: gatilho de messages ausente';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'cb_encerrar_limpa_espera_trigger'
  ) THEN
    RAISE EXCEPTION '972: gatilho de conversations ausente';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'cb_mensagem_apagada_recalcula_espera_trigger'
  ) THEN
    RAISE EXCEPTION '972: gatilho de mensagem apagada ausente';
  END IF;

  IF has_function_privilege('anon', 'cb_marcar_aguardando_resposta()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'cb_marcar_aguardando_resposta()', 'EXECUTE')
     OR has_function_privilege('anon', 'cb_mensagem_apagada_recalcula_espera()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'cb_mensagem_apagada_recalcula_espera()', 'EXECUTE') THEN
    RAISE EXCEPTION '972: função DEFINER continua executável pela API';
  END IF;

  -- Grupo nunca espera: afirmar ausência é trivialmente verdadeiro num banco
  -- vazio e pega um acervo mal preenchido num banco cheio.
  IF EXISTS (
    SELECT 1 FROM conversations WHERE group_id IS NOT NULL AND aguardando_desde IS NOT NULL
  ) THEN
    RAISE EXCEPTION '972: grupo com aguardando_desde preenchido';
  END IF;

  IF EXISTS (
    SELECT 1 FROM conversations WHERE status = 'closed' AND aguardando_desde IS NOT NULL
  ) THEN
    RAISE EXCEPTION '972: conversa encerrada com aguardando_desde preenchido';
  END IF;
END $$;
