-- ============================================================
-- wacrm — which schema releases are already applied?
--
-- There is no migration runner in this setup: the bundles under
-- docs/deploy/ are pasted into the Supabase SQL editor by hand, and
-- nothing records that they ran. So before a deploy the only honest
-- answer to "did I already apply that one?" comes from looking at the
-- schema itself.
--
-- Paste this into Supabase Cloud -> SQL Editor and run it. Every row
-- should read APPLIED before you redeploy the matching code.
--
-- Read-only: it inspects catalogs and changes nothing.
-- ============================================================

WITH checks AS (
  SELECT
    '037 attribution'  AS release,
    to_regclass('public.attribution_events') IS NOT NULL
      AND EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'contacts' AND column_name = 'source')
      AS ok,
    'docs/deploy/ads-attribution.sql' AS bundle
  UNION ALL
  SELECT
    '038 ad platforms',
    to_regclass('public.ad_accounts') IS NOT NULL
      AND to_regclass('public.ad_campaigns') IS NOT NULL
      AND to_regclass('public.ad_metrics_daily') IS NOT NULL,
    'docs/deploy/ads-attribution.sql'
  UNION ALL
  SELECT
    '039 deal closed_at',
    EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_name = 'deals' AND column_name = 'closed_at'),
    'docs/deploy/ads-attribution.sql'
  UNION ALL
  SELECT
    '040 tracked links',
    to_regclass('public.tracked_links') IS NOT NULL,
    'docs/deploy/ads-attribution.sql'
  UNION ALL
  SELECT
    -- 041 adds no table or column: it only widens the notifications
    -- type CHECK to accept 'deal_assigned', so the constraint body is
    -- the only trace it leaves.
    '041 deal assignment',
    EXISTS (SELECT 1 FROM pg_constraint
            WHERE conname = 'notifications_type_check'
              AND pg_get_constraintdef(oid) LIKE '%deal_assigned%'),
    'docs/deploy/ads-attribution.sql'
  UNION ALL
  SELECT
    '042 ads hardening',
    EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_name = 'ad_entities' AND column_name = 'attempts')
      AND EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_name = 'ad_accounts' AND column_name = 'timezone'),
    'docs/deploy/ads-attribution.sql'
  UNION ALL
  SELECT
    '043 branding',
    EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_name = 'accounts' AND column_name = 'brand_name')
      AND EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'brand-assets'),
    'docs/deploy/branding.sql'
)
SELECT
  release,
  CASE WHEN ok THEN 'APPLIED' ELSE 'MISSING -> run the bundle' END AS status,
  bundle
FROM checks
ORDER BY release;
