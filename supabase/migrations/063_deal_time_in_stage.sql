-- ============================================================
-- 063_deal_time_in_stage.sql — primitiva time-in-stage (auditoría
-- pre-producción, refactor/pre-production-cleanup, Fase 3)
--
-- NO existía time-in-stage en el sistema. Esta vista lo deriva
-- sin tocar deals ni tracking_events (0 escrituras, 0 columnas
-- nuevas): es consulta pura sobre la fuente de verdad existente.
--
-- Regla de derivación:
--   stage_entered_at =
--     último `state_changed` cuyo to_stage = deals.stage_id actual
--     Y from_stage <> to_stage   (solo transiciones REALES de
--     stage — transition_deal emite state_changed también cuando
--     cambia únicamente el status con el mismo stage, y eso no
--     debe resetear el contador de tiempo en etapa)
--     fallback: deals.created_at (deals creados por insert directo
--     — deal-form y automation create_deal — que nunca pasaron
--     por transition_deal)
--
-- Seguridad: security_invoker = true → la vista respeta las
-- políticas RLS de `deals` y `tracking_events` para el rol
-- llamante (authenticated). Sin esto, la vista correría como
-- postgres y filtraría el aislamiento por tenant.
--
-- Consumidores futuros: módulo agenda (citas/traslados) — "tiempo
-- que el deal lleva en la etapa actual".
-- ============================================================

DROP VIEW IF EXISTS public.deal_time_in_stage;

CREATE VIEW public.deal_time_in_stage
WITH (security_invoker = true) AS
SELECT
  d.id           AS deal_id,
  d.account_id   AS account_id,
  d.stage_id     AS stage_id,
  d.status       AS status,
  coalesce(
    (
      SELECT max(te.created_at)
      FROM public.tracking_events te
      WHERE te.account_id = d.account_id
        AND te.event_type = 'state_changed'
        AND te.payload ->> 'deal_id' = d.id::text
        AND te.payload ->> 'to_stage' = d.stage_id::text
        AND te.payload ->> 'from_stage' IS DISTINCT FROM te.payload ->> 'to_stage'
    ),
    d.created_at
  ) AS stage_entered_at,
  now() - coalesce(
    (
      SELECT max(te.created_at)
      FROM public.tracking_events te
      WHERE te.account_id = d.account_id
        AND te.event_type = 'state_changed'
        AND te.payload ->> 'deal_id' = d.id::text
        AND te.payload ->> 'to_stage' = d.stage_id::text
        AND te.payload ->> 'from_stage' IS DISTINCT FROM te.payload ->> 'to_stage'
    ),
    d.created_at
  ) AS time_in_stage
FROM public.deals d;