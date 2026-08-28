-- ============================================================
-- 047_catalog_search_pagination.sql
--
-- Root cause of "shows a partial sample as if it were the whole
-- inventory" (AI Sales Agent audit): search_ai_catalog_products had no
-- way to report how many rows matched in total, and the only caller
-- (src/lib/ai/tools/catalog-tools.ts) hardcoded LIMIT 8 with no
-- offset/pagination. For a broad query ("qué TVs tienen"), Postgres'
-- plain FTS rank frequently ties across many rows (single-lexeme
-- matches score identically), and the existing `ORDER BY rank DESC,
-- name ASC` then breaks ties alphabetically — which brand's names
-- happen to sort first is arbitrary, so the model could easily see
-- only e.g. "KOOLHOME" and have no idea Samsung/TCL rows existed too,
-- let alone that it was looking at a partial page at all.
--
-- This migration:
--   1. Adds p_offset (pagination) and p_available_only (stock filter —
--      opt-in only, never hides a specifically-requested item) params.
--   2. Returns a `total_count` column (count(*) OVER(), computed once
--      over the full filtered set before LIMIT/OFFSET) on every row,
--      so the caller can compute has_more without a second query.
--   3. Orders in-stock rows first (available DESC) ahead of rank, so a
--      default/unfiltered browse naturally surfaces available items
--      first without ever excluding agotados from the result set.
--
-- RETURNS TABLE instead of SETOF ai_catalog_products (Postgres doesn't
-- allow CREATE OR REPLACE to change a function's return type), hence
-- the DROP of the OLD 5-arg/SETOF signature first. Same columns as
-- before, in the same order, plus total_count appended at the end —
-- additive from the caller's point of view.
--
-- The creation itself uses CREATE OR REPLACE (not bare CREATE), even
-- though nothing with this exact 7-arg signature can exist on a FIRST
-- run: if this file is ever re-run (a manual re-apply, a migration
-- repair) AFTER already succeeding once, the DROP above becomes a
-- no-op (the 5-arg signature is already gone) and a bare CREATE would
-- then fail with "function already exists" against its own prior
-- output. CREATE OR REPLACE against an identical return type is a
-- true no-op-equivalent, matching 045/046's "safe to run multiple
-- times" discipline.
-- ============================================================

DROP FUNCTION IF EXISTS public.search_ai_catalog_products(uuid, uuid[], text, text, integer);

CREATE OR REPLACE FUNCTION public.search_ai_catalog_products(
  p_account_id      uuid,
  p_data_source_ids uuid[],
  p_query           text,
  p_color           text,
  p_match_count     integer,
  p_offset          integer DEFAULT 0,
  p_available_only  boolean DEFAULT false
)
RETURNS TABLE (
  id                 uuid,
  account_id         uuid,
  data_source_id     uuid,
  source_product_id  text,
  sku                text,
  name               text,
  brand              text,
  model              text,
  description        text,
  color              text,
  variant_label      text,
  capacity           text,
  size               text,
  price              numeric,
  currency           text,
  available          boolean,
  available_quantity integer,
  primary_image_url  text,
  images             jsonb,
  fts                tsvector,
  updated_at         timestamptz,
  total_count        bigint
) AS $$
  SELECT
    p.id, p.account_id, p.data_source_id, p.source_product_id, p.sku, p.name,
    p.brand, p.model, p.description, p.color, p.variant_label, p.capacity,
    p.size, p.price, p.currency, p.available, p.available_quantity,
    p.primary_image_url, p.images, p.fts, p.updated_at,
    count(*) OVER() AS total_count
  FROM ai_catalog_products p
  WHERE p.account_id = p_account_id
    AND (p_data_source_ids IS NULL OR p.data_source_id = ANY(p_data_source_ids))
    AND (
      p_query IS NULL OR trim(p_query) = '' OR
      p.fts @@ plainto_tsquery('simple', p_query) OR
      p.name ILIKE '%' || p_query || '%' OR
      p.sku ILIKE '%' || p_query || '%'
    )
    AND (p_color IS NULL OR trim(p_color) = '' OR p.color ILIKE '%' || p_color || '%')
    AND (p_available_only IS NOT TRUE OR p.available = true)
  ORDER BY
    p.available DESC,
    CASE WHEN p_query IS NULL OR trim(p_query) = '' THEN 0
         ELSE ts_rank(p.fts, plainto_tsquery('simple', p_query)) END DESC,
    p.name ASC,
    p.id ASC -- final deterministic tiebreaker: two rows CAN legitimately
             -- tie on (available, rank, name) — e.g. two color variants
             -- sharing the exact same product name — and without a
             -- unique last key, Postgres does not guarantee the same
             -- relative order for tied rows across separate query
             -- executions. That would risk a row silently appearing on
             -- both page 1 AND page 2 (or on neither) of a paginated
             -- "dame todas las X" listing. `id` is the primary key, so
             -- this makes the ordering fully deterministic.
  LIMIT GREATEST(p_match_count, 0)
  OFFSET GREATEST(p_offset, 0);
$$ LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public;

REVOKE ALL ON FUNCTION public.search_ai_catalog_products(uuid, uuid[], text, text, integer, integer, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_ai_catalog_products(uuid, uuid[], text, text, integer, integer, boolean) TO authenticated, service_role;
