-- ============================================================
-- 039_tags_category_and_all_filter.sql — custom feature, not part
-- of the upstream wacrm template.
--
-- Adds a lightweight "category" grouping to tags (e.g. "Finalidade",
-- "Tipo de imóvel", "Bairro", "Faixa de valor", "Quartos", "Status",
-- "Momento" for real-estate lead qualification) and a companion
-- server-side filter that matches contacts having ALL of a set of
-- tags — a sibling to filter_contacts_by_tags (migration 025), which
-- matches ANY of the selected tags.
--
-- Kept as a separate function rather than overloading
-- filter_contacts_by_tags: PostgREST's RPC resolution doesn't handle
-- overloaded function names cleanly, and a distinct name keeps the
-- "any" vs "all" call sites unambiguous in application code.
-- ============================================================

ALTER TABLE tags ADD COLUMN IF NOT EXISTS category TEXT;

CREATE OR REPLACE FUNCTION public.filter_contacts_by_all_tags(
  p_tag_ids UUID[],
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
    -- Contacts having EVERY tag in p_tag_ids (AND) — group by contact
    -- and require the distinct-tag hit count to equal the number of
    -- tags requested, narrowed by the same name/phone/email search
    -- as the list and as filter_contacts_by_tags.
    SELECT c.id, c.created_at
    FROM contacts c
    JOIN contact_tags ct ON ct.contact_id = c.id
    WHERE ct.tag_id = ANY(p_tag_ids)
      AND (
        p_search IS NULL
        OR c.name ILIKE '%' || p_search || '%'
        OR c.phone ILIKE '%' || p_search || '%'
        OR c.email ILIKE '%' || p_search || '%'
      )
    GROUP BY c.id, c.created_at
    HAVING COUNT(DISTINCT ct.tag_id) = array_length(p_tag_ids, 1)
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

ALTER FUNCTION public.filter_contacts_by_all_tags(UUID[], TEXT, INT, INT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.filter_contacts_by_all_tags(UUID[], TEXT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.filter_contacts_by_all_tags(UUID[], TEXT, INT, INT) TO authenticated;
