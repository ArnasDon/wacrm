-- ============================================================
-- 910_cb_negocio_e_conversa.sql — o negócio passa a apontar para a conversa
--
-- POR QUE ESTA MIGRATION EXISTE
-- O card do funil nasce de uma conversa (o roteador da 908 cria um quando o
-- cliente escreve), mas não guardava qual. Resultado: o Kanban mostra o nome
-- do cliente e não tem caminho de volta para o atendimento — o operador vê o
-- card, quer responder, e precisa procurar a conversa na mão.
--
-- ⚠️ A COLUNA JÁ EXISTIA E NÃO PODIA SER USADA.
-- `deals.conversation_id` está lá desde a 001. O que impedia de preenchê-la é
-- a FK: `deals_conversation_id_fkey` é a ÚNICA das seis FKs para
-- `conversations` sem regra de exclusão (NO ACTION). E há DOIS caminhos que
-- apagam conversa em cascata:
--
--   · `conversations.contact_id` → contacts ON DELETE CASCADE  (001)
--     ou seja: APAGAR UM CONTATO apaga as conversas dele.
--   · `conversations.user_id`    → auth.users ON DELETE CASCADE (001)
--     ou seja: REMOVER UM MEMBRO da equipe apaga as conversas dele.
--
-- Com a coluna preenchida e a FK em NO ACTION, os dois estouram 23503 e a
-- operação falha. O primeiro é exatamente a regressão que a migration 004
-- existe para impedir ("CASCADE é o wrong fix — apagaria linhas de
-- histórico"); o segundo é o mesmo cenário que levou a 908 a tornar
-- `deals.user_id` anulável.
--
-- POR QUE A FK É COMPOSTA
-- Mesma forma que a 903 deu a `conversations` e a 908 a `deals`. A policy
-- `deals_insert` valida apenas `account_id` — o `conversation_id` que vem do
-- cliente não é checado por RLS nenhuma, então uma FK simples deixaria gravar
-- conversa de OUTRA conta. Composta, o banco recusa.
--
-- ⚠️ `ON DELETE SET NULL (conversation_id)` — a lista de colunas é
-- obrigatória. Sem ela o Postgres tentaria anular `account_id` junto, que é
-- NOT NULL, e apagar QUALQUER conversa passaria a falhar. Mesma pegadinha que
-- a 903 documenta e que a 908 repetiu.
--
-- ❌ SEM BACKFILL, de propósito. Seria gravar um palpite: o formulário do
-- negócio já resolve a conversa pelo contato quando o vínculo é nulo
-- (deal-form.tsx), então os cards anteriores a esta migration continuam
-- abrindo a conversa certa. Preencher agora transformaria "a conversa atual
-- deste contato" em "a conversa de onde este card veio", que é outra coisa.
--
-- Nota: a coluna não é 100% virgem — `merge_duplicate_conversations()` (036,
-- SECURITY DEFINER) reaponta `deals.conversation_id` ao fundir conversas
-- duplicadas. Aquele UPDATE só colapsa conversas do mesmo
-- (account_id, contact_id), então segue compatível com a FK composta.
--
-- Idempotente — seguro rodar mais de uma vez.
-- ============================================================

-- ------------------------------------------------------------
-- 1. O alvo da FK composta
--
-- Diferente da 908, que reaproveitou `cb_channels_id_account_key` da 903,
-- aqui não há índice pronto: sem este CREATE o ALTER falha com
-- "there is no unique constraint matching given keys".
-- ------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS conversations_id_account_key
  ON conversations (id, account_id);

-- ------------------------------------------------------------
-- 2. A regra de exclusão
-- ------------------------------------------------------------
ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_conversation_id_fkey;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'deals_conversation_account_fkey'
  ) THEN
    ALTER TABLE deals
      ADD CONSTRAINT deals_conversation_account_fkey
      FOREIGN KEY (conversation_id, account_id)
      REFERENCES conversations (id, account_id)
      ON DELETE SET NULL (conversation_id);
  END IF;
END $$;

-- ------------------------------------------------------------
-- 3. Índice para o lado que passa a ser consultado
--
-- Não existia nenhum índice em `deals.conversation_id` — com NO ACTION o
-- delete de conversa já fazia seq scan de verificação, e com SET NULL ele
-- passa a fazer seq scan MAIS escrita. Enquanto a coluna era sempre nula isso
-- não custava nada; a partir de agora ela fica preenchida na maioria das
-- linhas. Parcial porque negócio criado à mão continua sem conversa.
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS cb_deals_conversa_idx
  ON deals (conversation_id)
  WHERE conversation_id IS NOT NULL;

COMMENT ON COLUMN deals.conversation_id IS
  'Conversa de onde este negocio nasceu. NULL em negocio criado a mao, em '
  'negocio anterior a 910, e quando a conversa e apagada (SET NULL).';
