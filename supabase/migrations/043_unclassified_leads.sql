-- ============================================================
-- 043_unclassified_leads.sql — custom feature, not part of the
-- upstream wacrm template.
--
-- "Unclassified" is driven by TAG CATEGORY, not a hardcoded list of
-- tag names — a contact counts as classified once it carries ANY tag
-- whose `category` matches p_classification_category (default
-- 'Finalidade', the category that already holds the "Investimento" /
-- "Moradia" tags seeded in migration 039). Adding a new classification
-- tag later is just adding a tag under that category; neither
-- function needs to change.
--
-- Two functions, mirroring the split already established by
-- filter_contacts_by_tags / filter_contacts_by_all_tags:
--   - count_unclassified_leads: the dashboard KPI. Scoped to leads
--     with a started conversation, per the card's business rule.
--   - list_unclassified_contacts: the Contacts-list drill-through
--     (paginated, same TABLE(contact, total_count) shape as the
--     existing tag filters). Intentionally broader than the KPI —
--     it lists every unclassified CONTACT, not just ones with a
--     conversation, because the Contacts page filters contacts in
--     general, not leads specifically.
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
  WHERE EXISTS (SELECT 1 FROM conversations conv WHERE conv.contact_id = c.id)
    AND NOT EXISTS (
      SELECT 1
      FROM contact_tags ct
      JOIN tags t ON t.id = ct.tag_id
      WHERE ct.contact_id = c.id
        AND t.category = p_classification_category
    );
$$;

ALTER FUNCTION public.count_unclassified_leads(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.count_unclassified_leads(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.count_unclassified_leads(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_unclassified_contacts(
  p_classification_category TEXT DEFAULT 'Finalidade',
  p_search TEXT DEFAULT NULL,
  p_limit INT DEFAULT 25,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (contact contacts, total_count BIGINT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH matched AS (
    SELECT c.id, c.created_at
    FROM contacts c
    WHERE (
        p_search IS NULL
        OR c.name ILIKE '%' || p_search || '%'
        OR c.phone ILIKE '%' || p_search || '%'
        OR c.email ILIKE '%' || p_search || '%'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM contact_tags ct
        JOIN tags t ON t.id = ct.tag_id
        WHERE ct.contact_id = c.id
          AND t.category = p_classification_category
      )
  ),
  page AS (
    SELECT id, count(*) OVER() AS total_count
    FROM matched
    ORDER BY created_at DESC, id
    LIMIT p_limit OFFSET p_offset
  )
  SELECT c AS contact, page.total_count
  FROM page
  JOIN contacts c ON c.id = page.id
  ORDER BY c.created_at DESC, c.id;
$$;

ALTER FUNCTION public.list_unclassified_contacts(TEXT, TEXT, INT, INT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.list_unclassified_contacts(TEXT, TEXT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_unclassified_contacts(TEXT, TEXT, INT, INT) TO authenticated;
