-- ============================================================
-- 970 — índice de `cb_scheduled_messages.message_id`
--
-- O PR #89 (achado #21 do plano de 31/08) passou a perguntar "esta mensagem
-- nasceu de uma agendada?" por `.in('message_id', <ids da janela>)`, nos
-- dois lados: o worker do Radar (a cada análise) e o hook do painel (a cada
-- 2 min com a aba aberta). A tabela é o ACERVO permanente das enviadas — a
-- tela /agendadas pagina justamente ele — e a 925 só indexou
-- `(conversation_id, account_id, scheduled_for)` e `scheduled_for` das
-- pendentes: a consulta nova varria a tabela inteira antes de conferir até
-- 1000 ids (achado do Codex no PR #89). Não dói hoje (1 linha) e passa a
-- doer por crescimento, sem ninguém mudar código — a família de "teto que
-- chega sozinho" já documentada.
--
-- PARCIAL em `message_id IS NOT NULL`: a coluna só é preenchida quando o
-- disparo gravou a mensagem; pendente/cancelada/falha ficam nulas e nunca
-- são o alvo desta pergunta.
-- ============================================================

CREATE INDEX IF NOT EXISTS cb_scheduled_messages_message_idx
  ON cb_scheduled_messages (message_id)
  WHERE message_id IS NOT NULL;

-- ============================================================
-- Conferência — só schema, roda em banco VAZIO
-- ============================================================
DO $$
DECLARE
  v_def TEXT;
BEGIN
  SELECT indexdef INTO v_def
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'cb_scheduled_messages'
    AND indexname = 'cb_scheduled_messages_message_idx';

  IF v_def IS NULL THEN
    RAISE EXCEPTION '970: índice cb_scheduled_messages_message_idx não existe';
  END IF;
  IF v_def !~* 'WHERE \(message_id IS NOT NULL\)' THEN
    RAISE EXCEPTION '970: o índice não é parcial em message_id IS NOT NULL: %', v_def;
  END IF;

  RAISE NOTICE '970 OK — cb_scheduled_messages.message_id indexado (parcial)';
END $$;
