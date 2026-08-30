-- ============================================================
-- 096_saved_views.sql — reusable list views (starting with Contacts)
--
-- A "saved view" is a named bundle of list state — search term, tag
-- filter, sort — that a user can switch between on the Contacts page
-- (Twenty-style view tabs). Per-user by default; `is_shared` promotes
-- one to the whole account.
--
--   config jsonb shape (Contacts):
--     { "search": string, "tagIds": string[], "sort": "recent"
--       | "oldest" | "name" | "name_desc" }
--   resource: only 'contacts' today — the CHECK grows as more lists
--   adopt views.
--
-- RLS: you always see your own views; you also see an account-mate's
-- view only when they shared it. You can only write your own rows.
-- Same `is_account_member` tenancy as the rest of the schema.
--
-- Also extends `filter_contacts_by_tags` with a `p_sort` argument so
-- the tag-filtered path honours the same sort as the plain path. The
-- 4-arg calls in older clients keep working via the DEFAULT.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.saved_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  resource TEXT NOT NULL CHECK (resource IN ('contacts')),
  name TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_shared BOOLEAN NOT NULL DEFAULT false,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saved_views_account_resource
  ON public.saved_views(account_id, resource);

ALTER TABLE public.saved_views ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON public.saved_views;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.saved_views
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP POLICY IF EXISTS saved_views_select ON public.saved_views;
DROP POLICY IF EXISTS saved_views_insert ON public.saved_views;
DROP POLICY IF EXISTS saved_views_update ON public.saved_views;
DROP POLICY IF EXISTS saved_views_delete ON public.saved_views;

CREATE POLICY saved_views_select ON public.saved_views FOR SELECT
  USING (is_account_member(account_id) AND (user_id = auth.uid() OR is_shared));
CREATE POLICY saved_views_insert ON public.saved_views FOR INSERT
  WITH CHECK (is_account_member(account_id) AND user_id = auth.uid());
CREATE POLICY saved_views_update ON public.saved_views FOR UPDATE
  USING (is_account_member(account_id) AND user_id = auth.uid())
  WITH CHECK (is_account_member(account_id) AND user_id = auth.uid());
CREATE POLICY saved_views_delete ON public.saved_views FOR DELETE
  USING (is_account_member(account_id) AND user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_views TO authenticated;
GRANT ALL ON public.saved_views TO service_role;

-- ------------------------------------------------------------
-- filter_contacts_by_tags + p_sort
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.filter_contacts_by_tags(UUID[], TEXT, INT, INT);

CREATE OR REPLACE FUNCTION public.filter_contacts_by_tags(
  p_tag_ids UUID[],
  p_search TEXT DEFAULT NULL,
  p_limit INT DEFAULT 25,
  p_offset INT DEFAULT 0,
  p_sort TEXT DEFAULT 'recent'
)
RETURNS TABLE (contact contacts, total_count BIGINT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH matched AS (
    SELECT DISTINCT c.id, c.created_at, c.name
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
    SELECT id, count(*) OVER() AS total_count
    FROM matched
    ORDER BY
      CASE WHEN p_sort = 'oldest'    THEN created_at END ASC,
      CASE WHEN p_sort = 'name'      THEN lower(name) END ASC NULLS LAST,
      CASE WHEN p_sort = 'name_desc' THEN lower(name) END DESC NULLS LAST,
      CASE WHEN p_sort NOT IN ('oldest','name','name_desc') THEN created_at END DESC,
      id
    LIMIT p_limit OFFSET p_offset
  )
  SELECT c AS contact, page.total_count
  FROM page
  JOIN contacts c ON c.id = page.id
  ORDER BY
    CASE WHEN p_sort = 'oldest'    THEN c.created_at END ASC,
    CASE WHEN p_sort = 'name'      THEN lower(c.name) END ASC NULLS LAST,
    CASE WHEN p_sort = 'name_desc' THEN lower(c.name) END DESC NULLS LAST,
    CASE WHEN p_sort NOT IN ('oldest','name','name_desc') THEN c.created_at END DESC,
    c.id;
$$;

ALTER FUNCTION public.filter_contacts_by_tags(UUID[], TEXT, INT, INT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.filter_contacts_by_tags(UUID[], TEXT, INT, INT, TEXT) FROM PUBLIC;
-- The pre-096 definition carried an explicit `anon` EXECUTE grant that
-- REVOKE ... FROM PUBLIC doesn't clear. Drop it — the function is
-- SECURITY INVOKER + RLS-protected, but no unauthenticated caller has
-- any business here.
REVOKE EXECUTE ON FUNCTION public.filter_contacts_by_tags(UUID[], TEXT, INT, INT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.filter_contacts_by_tags(UUID[], TEXT, INT, INT, TEXT) TO authenticated;
