-- ============================================================
-- 041_broadcast_audience_rpcs.sql — server-side broadcast audience
--
-- Why an RPC
--
--   025_filter_contacts_by_tags.sql called this out: any unbounded
--   `.select()` against `contacts` (or a join table) is silently
--   capped at PostgREST's default max-rows (1000), and a follow-up
--   `.in('id', ids)` over thousands of ids bloats the request URL.
--   That migration fixed the Contacts page filter; the same bug was
--   still live in broadcast creation. `src/app/api/broadcasts/create/
--   route.ts` resolved the audience by fetching full contact rows
--   client-side (`.select('*')`, `.in('tag_id', ids)`, …), so a tag
--   covering more than 1000 contacts silently produced a broadcast
--   with only 1000 recipients — no error, no warning.
--
--   The route only ever reads `contact.id` off the resolved rows
--   (name/phone/email are never used), so there is no reason to ship
--   contact rows across the wire at all. These two functions resolve
--   the audience entirely in SQL:
--     - count_audience() returns the audience size as a single
--       scalar — scalar returns aren't subject to max-rows.
--     - enqueue_broadcast_recipients() inserts the resolved audience
--       directly into broadcast_recipients server-side and returns
--       the row count, replacing both the manual resolve step and
--       the chunked client-side recipient-insert loop.
--
--   Both share one SQL helper, _broadcast_audience_contact_ids(), so
--   the audience-matching logic (all / tags / custom_field / csv,
--   OR-across-tags, exclude-tags anti-join) is defined once.
--
-- Security
--
--   All three functions are SECURITY INVOKER (the default): they run
--   as the calling user, so the existing RLS on `contacts`,
--   `contact_tags`, `contact_custom_values` and `broadcast_recipients`
--   (account membership, migration 017) scopes every result to the
--   caller's account — same reasoning as 025, no privilege bypass.
--   No explicit account-id parameter is needed: the helper starts
--   from `contacts c`, which RLS has already narrowed to the
--   caller's account, and every join back to it (contact_tags,
--   contact_custom_values) is keyed off that already-scoped `c.id`.
--   enqueue_broadcast_recipients()'s INSERT is likewise checked
--   against broadcast_recipients' own RLS (via the parent broadcast's
--   account), exactly as the row-by-row client insert was before.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ------------------------------------------------------------
-- _broadcast_audience_contact_ids — shared audience resolver
--
-- Returns the distinct contact ids matching one audience config.
-- Mirrors src/app/api/broadcasts/create/route.ts lines 45-105:
--   p_audience_type = 'all'          → every contact in the account
--   p_audience_type = 'tags'         → ANY of p_tag_ids (OR, DISTINCT)
--   p_audience_type = 'custom_field' → p_custom_field_id/operator/value
--                                       operators: is (=), is_not (!=),
--                                       contains (ILIKE %value%)
--   p_audience_type = 'csv'          → contacts matching p_csv_phones
--   p_exclude_tag_ids                → anti-join, applied on top of
--                                       any of the above
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._broadcast_audience_contact_ids(
  p_audience_type TEXT,
  p_tag_ids UUID[] DEFAULT NULL,
  p_custom_field_id UUID DEFAULT NULL,
  p_custom_field_operator TEXT DEFAULT NULL,
  p_custom_field_value TEXT DEFAULT NULL,
  p_csv_phones TEXT[] DEFAULT NULL,
  p_exclude_tag_ids UUID[] DEFAULT NULL
)
RETURNS TABLE (contact_id UUID)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH matched AS (
    -- DISTINCT so a contact carrying two selected tags (or matching
    -- more than one clause) is only resolved once.
    SELECT DISTINCT c.id AS contact_id
    FROM contacts c
    WHERE
      p_audience_type = 'all'
      OR (
        p_audience_type = 'tags'
        AND p_tag_ids IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM contact_tags ct
          WHERE ct.contact_id = c.id AND ct.tag_id = ANY(p_tag_ids)
        )
      )
      OR (
        p_audience_type = 'custom_field'
        AND p_custom_field_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM contact_custom_values cv
          WHERE cv.contact_id = c.id
            AND cv.custom_field_id = p_custom_field_id
            AND (
              (p_custom_field_operator = 'is' AND cv.value = p_custom_field_value)
              OR (p_custom_field_operator = 'is_not' AND cv.value <> p_custom_field_value)
              OR (p_custom_field_operator = 'contains' AND cv.value ILIKE '%' || p_custom_field_value || '%')
            )
        )
      )
      OR (
        p_audience_type = 'csv'
        AND p_csv_phones IS NOT NULL
        AND c.phone = ANY(p_csv_phones)
      )
  )
  SELECT m.contact_id
  FROM matched m
  WHERE p_exclude_tag_ids IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM contact_tags ex
       WHERE ex.contact_id = m.contact_id AND ex.tag_id = ANY(p_exclude_tag_ids)
     );
$$;

ALTER FUNCTION public._broadcast_audience_contact_ids(TEXT, UUID[], UUID, TEXT, TEXT, TEXT[], UUID[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public._broadcast_audience_contact_ids(TEXT, UUID[], UUID, TEXT, TEXT, TEXT[], UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._broadcast_audience_contact_ids(TEXT, UUID[], UUID, TEXT, TEXT, TEXT[], UUID[]) TO authenticated;

-- ------------------------------------------------------------
-- count_audience — audience size as a single scalar
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.count_audience(
  p_audience_type TEXT,
  p_tag_ids UUID[] DEFAULT NULL,
  p_custom_field_id UUID DEFAULT NULL,
  p_custom_field_operator TEXT DEFAULT NULL,
  p_custom_field_value TEXT DEFAULT NULL,
  p_csv_phones TEXT[] DEFAULT NULL,
  p_exclude_tag_ids UUID[] DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT count(*)
  FROM public._broadcast_audience_contact_ids(
    p_audience_type,
    p_tag_ids,
    p_custom_field_id,
    p_custom_field_operator,
    p_custom_field_value,
    p_csv_phones,
    p_exclude_tag_ids
  );
$$;

ALTER FUNCTION public.count_audience(TEXT, UUID[], UUID, TEXT, TEXT, TEXT[], UUID[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.count_audience(TEXT, UUID[], UUID, TEXT, TEXT, TEXT[], UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.count_audience(TEXT, UUID[], UUID, TEXT, TEXT, TEXT[], UUID[]) TO authenticated;

-- ------------------------------------------------------------
-- enqueue_broadcast_recipients — insert the resolved audience as
-- pending broadcast_recipients rows; returns the number inserted.
--
-- Same parameter order as count_audience with one addition
-- (p_broadcast_id, first) so the route can pass the same audience
-- arguments to both.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_broadcast_recipients(
  p_broadcast_id UUID,
  p_audience_type TEXT,
  p_tag_ids UUID[] DEFAULT NULL,
  p_custom_field_id UUID DEFAULT NULL,
  p_custom_field_operator TEXT DEFAULT NULL,
  p_custom_field_value TEXT DEFAULT NULL,
  p_csv_phones TEXT[] DEFAULT NULL,
  p_exclude_tag_ids UUID[] DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_inserted BIGINT;
BEGIN
  INSERT INTO broadcast_recipients (broadcast_id, contact_id, status)
  SELECT p_broadcast_id, a.contact_id, 'pending'
  FROM public._broadcast_audience_contact_ids(
    p_audience_type,
    p_tag_ids,
    p_custom_field_id,
    p_custom_field_operator,
    p_custom_field_value,
    p_csv_phones,
    p_exclude_tag_ids
  ) a;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

ALTER FUNCTION public.enqueue_broadcast_recipients(UUID, TEXT, UUID[], UUID, TEXT, TEXT, TEXT[], UUID[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enqueue_broadcast_recipients(UUID, TEXT, UUID[], UUID, TEXT, TEXT, TEXT[], UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_broadcast_recipients(UUID, TEXT, UUID[], UUID, TEXT, TEXT, TEXT[], UUID[]) TO authenticated;
