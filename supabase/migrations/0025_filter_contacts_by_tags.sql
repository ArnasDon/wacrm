-- ============================================================
-- 025_filter_contacts_by_tags.sql — server-side tag filter
--
-- Why an RPC
--
--   The Contacts page filters by tag by resolving the selected
--   tags to contact ids and paging the result. Doing that on the
--   client (SELECT contact_id FROM contact_tags WHERE tag_id IN …,
--   then .in('id', ids) on contacts) hits two PostgREST limits for
--   accounts where a tag covers many contacts:
--     - the unbounded contact_tags select is silently capped
--       (~1000 rows), dropping contacts from the filter, and
--     - the follow-up .in('id', ids) pushes every matching id into
--       one IN-clause (the ~1000-value cap the broadcast sender
--       already pages around) and bloats the request URL.
--
--   Both break the total count and pagination. This function does
--   the join, de-duplication (OR across tags), ordering, windowed
--   total count, and LIMIT/OFFSET in one query so the result is
--   always complete and correctly counted.
--
-- Security
--
--   SECURITY INVOKER (the default): the function runs as the
--   caller, so the existing RLS on `contacts` and `contact_tags`
--   (account membership, migration 017) scopes the result to the
--   caller's account. No privilege bypass — unlike the SECURITY
--   DEFINER member RPCs in 018/019.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE OR REPLACE FUNCTION public.filter_contacts_by_tags(
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
    -- Distinct contacts having ANY of the selected tags (OR),
    -- narrowed by the same name/phone/email search as the list.
    SELECT DISTINCT c.id, c.created_at
    FROM contacts c
    JOIN contact_tags ct ON ct.contact_id = c.id
    WHERE ct.tag_id = ANY(p_tag_ids)
      AND (
        p_search IS NULL
        OR c.name ILIKE '%' || p_search || '%'
        OR c.phone ILIKE '%' || p_search || '%'
        OR c.email ILIKE '%' || p_search || '%'
      )
  ),
  page AS (
    -- count(*) OVER() is evaluated before LIMIT, so it is the full
    -- match total regardless of the page being returned.
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

ALTER FUNCTION public.filter_contacts_by_tags(UUID[], TEXT, INT, INT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.filter_contacts_by_tags(UUID[], TEXT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.filter_contacts_by_tags(UUID[], TEXT, INT, INT) TO authenticated;
