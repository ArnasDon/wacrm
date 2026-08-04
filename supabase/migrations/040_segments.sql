-- ============================================================
-- 040_segments.sql — custom feature, not part of the upstream
-- wacrm template.
--
-- Segments are saved, named tag combinations ("Investidores João
-- Pessoa" = tags Investidor + Alto Padrão) that resolve to a live
-- contact list — contacts must carry EVERY tag in the segment (AND),
-- the same semantics as filter_contacts_by_all_tags (migration 039),
-- so a segment reads as a precise, reusable audience definition
-- rather than a loose OR bucket. Built to be consumed later by
-- Broadcasts / Automations audience pickers (see AudienceConfig in
-- use-broadcast-sending.ts) without a schema change — those call
-- sites would just resolve a segment's tag_ids and reuse the
-- existing AND-filter machinery.
-- ============================================================

CREATE TABLE IF NOT EXISTS segments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_segments_account ON segments(account_id);

CREATE TABLE IF NOT EXISTS segment_tags (
  segment_id UUID NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (segment_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_segment_tags_tag ON segment_tags(tag_id);

ALTER TABLE segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE segment_tags ENABLE ROW LEVEL SECURITY;

-- Same governance level as tags themselves (admin to write, any
-- member to read) — a segment is just a saved tag combination, so it
-- inherits the tag's access model.
DROP POLICY IF EXISTS segments_select ON segments;
DROP POLICY IF EXISTS segments_insert ON segments;
DROP POLICY IF EXISTS segments_update ON segments;
DROP POLICY IF EXISTS segments_delete ON segments;
CREATE POLICY segments_select ON segments FOR SELECT USING (is_account_member(account_id));
CREATE POLICY segments_insert ON segments FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY segments_update ON segments FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY segments_delete ON segments FOR DELETE USING (is_account_member(account_id, 'admin'));

-- segment_tags has no account_id of its own — access is gated through
-- the parent segment's account.
DROP POLICY IF EXISTS segment_tags_select ON segment_tags;
DROP POLICY IF EXISTS segment_tags_insert ON segment_tags;
DROP POLICY IF EXISTS segment_tags_delete ON segment_tags;
CREATE POLICY segment_tags_select ON segment_tags FOR SELECT USING (
  EXISTS (SELECT 1 FROM segments s WHERE s.id = segment_tags.segment_id AND is_account_member(s.account_id))
);
CREATE POLICY segment_tags_insert ON segment_tags FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM segments s WHERE s.id = segment_tags.segment_id AND is_account_member(s.account_id, 'admin'))
);
CREATE POLICY segment_tags_delete ON segment_tags FOR DELETE USING (
  EXISTS (SELECT 1 FROM segments s WHERE s.id = segment_tags.segment_id AND is_account_member(s.account_id, 'admin'))
);

DROP TRIGGER IF EXISTS set_updated_at ON segments;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON segments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- list_segments_with_counts — one round trip for the manager UI:
-- every segment, its tag_ids, and how many contacts currently match
-- (AND semantics). SECURITY INVOKER so RLS on segments/segment_tags/
-- contact_tags scopes everything to the caller's account already —
-- no explicit account_id filter needed here.
-- ============================================================
CREATE OR REPLACE FUNCTION public.list_segments_with_counts()
RETURNS TABLE (
  id UUID,
  name TEXT,
  tag_ids UUID[],
  contact_count BIGINT,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH seg_tags AS (
    SELECT s.id, s.name, s.created_at,
           COALESCE(array_agg(st.tag_id) FILTER (WHERE st.tag_id IS NOT NULL), '{}') AS tag_ids
    FROM segments s
    LEFT JOIN segment_tags st ON st.segment_id = s.id
    GROUP BY s.id, s.name, s.created_at
  )
  SELECT
    st.id,
    st.name,
    st.tag_ids,
    COALESCE((
      SELECT COUNT(*)
      FROM (
        SELECT ct.contact_id
        FROM contact_tags ct
        WHERE ct.tag_id = ANY(st.tag_ids)
        GROUP BY ct.contact_id
        HAVING COUNT(DISTINCT ct.tag_id) = array_length(st.tag_ids, 1)
      ) matched
    ), 0) AS contact_count,
    st.created_at
  FROM seg_tags st
  ORDER BY st.created_at DESC;
$$;

ALTER FUNCTION public.list_segments_with_counts() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.list_segments_with_counts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_segments_with_counts() TO authenticated;
