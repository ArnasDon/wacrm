-- ============================================================
-- 068_action_items_due_time.sql — hora obrigatória no Follow-up
--
-- AGENTS task: "Sempre que um lead for movido para o Follow-up...
-- exigir motivo + prazo (data E hora) para retorno." `due_date`
-- (migration 066) já cobre a data; faltava a hora. A tabela não tem
-- nenhuma linha type='followup' ainda (conferido antes desta
-- migration), então é seguro estender a mesma CHECK constraint que já
-- exige due_date para também exigir due_time — mesma defesa em
-- profundidade que due_date já tinha, agora cobrindo os dois campos.
-- A obrigatoriedade "de verdade" (a UX) vive no hook useFollowupGate,
-- compartilhado pelos 4 pontos de entrada — isto aqui é só o
-- backstop do banco.
--
-- Idempotente — seguro rodar mais de uma vez.
-- ============================================================

ALTER TABLE action_items ADD COLUMN IF NOT EXISTS due_time time;

ALTER TABLE action_items DROP CONSTRAINT IF EXISTS action_items_followup_requires_due_date;
ALTER TABLE action_items ADD CONSTRAINT action_items_followup_requires_due_date
  CHECK (type <> 'followup' OR (due_date IS NOT NULL AND due_time IS NOT NULL));
