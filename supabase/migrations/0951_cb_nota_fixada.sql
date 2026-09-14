-- ============================================================
-- 951 — Nota fixada por cliente
--
-- O operador fixa UMA anotação por cliente; ela sobe para o topo da aba
-- Notas do painel do contato e fica presa (sticky) acima da rolagem.
-- Pedido do operador em 2026-08-29.
--
-- ⚠️ A escrita NÃO vem do navegador: a 918/920 revogaram INSERT e UPDATE de
-- `authenticated` (nota não é editável). Fixar é um UPDATE — passa pela
-- rota `/api/cb/notes/[id]` em service-role, que valida papel e posse.
-- Nenhum GRANT novo aqui, de propósito: a coluna nova entra no SELECT que a
-- tabela já concede e em nada mais.
--
-- ⚠️ "Uma por cliente" é o ÍNDICE PARCIAL, não a rota: entre limpar a
-- antiga e fixar a nova cabe outra requisição, e é o banco que desempata
-- (a rota trata o 23505 como corrida e reporta). Nota de GRUPO
-- (contact_id nulo) fica de fora — fixação é conceito da ficha do cliente.
-- ============================================================

ALTER TABLE cb_conversation_notes
  ADD COLUMN IF NOT EXISTS fixada_em timestamptz;

COMMENT ON COLUMN cb_conversation_notes.fixada_em IS
  'Quando a nota foi fixada no topo da ficha do cliente. NULL = não fixada. No máximo uma por contato (índice parcial cb_conversation_notes_fixada_unica).';

CREATE UNIQUE INDEX IF NOT EXISTS cb_conversation_notes_fixada_unica
  ON cb_conversation_notes (contact_id)
  WHERE fixada_em IS NOT NULL AND contact_id IS NOT NULL;

-- Conferência de FORMA apenas — segura em banco vazio (nenhum dado exigido).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'cb_conversation_notes_fixada_unica'
  ) THEN
    RAISE EXCEPTION '951: índice parcial da nota fixada não foi criado';
  END IF;
END $$;
