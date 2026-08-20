-- 073_ai_template_fill.sql — AI "Gerar com IA" button in the template-send
-- modal (Inbox), for filling HSM {{1}}, {{2}}, ... body variables from the
-- conversation + lead + template context.
--
-- One additive change on top of the existing ai_usage_log foundation
-- (migrations 033/050/051/052/059) — no new tables, no new infra: this
-- mode just joins the same cost ledger auto_reply/draft/lead_analysis/
-- followup/learning/ctwa_rescue already log through.

ALTER TABLE ai_usage_log DROP CONSTRAINT IF EXISTS ai_usage_log_mode_check;
ALTER TABLE ai_usage_log
  ADD CONSTRAINT ai_usage_log_mode_check
  CHECK (mode IN ('auto_reply', 'draft', 'lead_analysis', 'followup', 'learning', 'ctwa_rescue', 'template_fill'));
