-- ==============================================================================
-- 081_followup_unique_index.sql — Partial Unique Index for Follow-up Suggestions
--
-- ATENÇÃO: Aplicar esta migração somente APÓS a execução da limpeza de duplicatas
-- históricas (scripts/cleanup-historical-followups.sql).
--
-- Impede definitivamente a criação concorrente ou repetida de sugestões pendentes
-- exclusivamente da categoria 'followup' para o mesmo contato dentro da mesma conta.
--
-- NÃO bloqueia outras categorias legítimas (como 'pipeline_move', 'learning',
-- 'action', 'inconsistency', 'other'), garantindo que o mesmo contato possa ter
-- sugestões legítimas de outros tipos simultaneamente.
--
-- NÃO bloqueia follow-ups legítimos futuros: quando uma sugestão é concluída ('done')
-- ou descartada ('ignored'), a cláusula WHERE (status = 'pending' AND category = 'followup')
-- deixa de se aplicar, permitindo novos follow-ups normalmente.
-- ==============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_suggestions_pending_followup_per_contact
  ON public.ai_suggestions (account_id, contact_id)
  WHERE (status = 'pending' AND category = 'followup');
