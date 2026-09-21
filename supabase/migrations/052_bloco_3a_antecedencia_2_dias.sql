-- ============================================================
-- 052_bloco_3a_antecedencia_2_dias.sql — antecedência mínima do modo
-- comercial passa de 2 horas para 2 dias úteis.
--
-- Contexto: com `commercial_min_lead_time_min = 120` (2h, migração 046),
-- o agente comercial podia propor uma reunião ainda hoje ou já amanhã.
-- O Ricardo pediu (21/09/2026) que as horas propostas fiquem sempre a
-- 2-3 dias de distância, nunca no próprio dia nem no seguinte. O valor
-- em minutos sobe para 2880 (48h); a contagem em si passa a saltar
-- fins-de-semana em `addBusinessMinutes`
-- (src/lib/calendar/commercial-availability.ts) — sem essa mudança de
-- código, 2880 minutos corridos a partir de uma sexta-feira à tarde
-- cairiam num domingo, o que não serve.
--
-- Muda o DEFAULT (contas novas nascem já com 2 dias úteis) e actualiza
-- as contas existentes que ainda estão no valor antigo (120) — uma
-- conta que já tenha sido ajustada manualmente para outro valor
-- fica intocada.
--
-- Idempotente, seguro correr mais do que uma vez.
-- ============================================================

ALTER TABLE ai_configs
  ALTER COLUMN commercial_min_lead_time_min SET DEFAULT 2880;

UPDATE ai_configs
  SET commercial_min_lead_time_min = 2880
  WHERE commercial_min_lead_time_min = 120;
