-- ============================================================
-- 071_exclude_archived_from_unclassified_count.sql — custom fix,
-- not part of the upstream wacrm template.
--
-- count_unclassified_leads (043) — the dashboard's "Leads aguardando
-- classificação" KPI — predates archived_at (069) and never excluded
-- it, unlike its sibling list_unclassified_contacts (already patched
-- by migration 070). An archived contact with a conversation and no
-- classification tag was still counted. Same fix: add
-- "AND c.archived_at IS NULL".
--
-- CREATE OR REPLACE, same signature — idempotent, no client change.
-- ============================================================

CREATE OR REPLACE FUNCTION public.count_unclassified_leads(
  p_classification_category TEXT DEFAULT 'Finalidade'
)
RETURNS INT
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COUNT(DISTINCT c.id)::int
  FROM contacts c
  WHERE c.archived_at IS NULL
    AND EXISTS (SELECT 1 FROM conversations conv WHERE conv.contact_id = c.id)
    AND NOT EXISTS (
      SELECT 1
      FROM contact_tags ct
      JOIN tags t ON t.id = ct.tag_id
      WHERE ct.contact_id = c.id
        AND t.category = p_classification_category
    );
$$;
