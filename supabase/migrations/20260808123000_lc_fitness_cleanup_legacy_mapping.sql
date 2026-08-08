-- Clean stale optional mappings left by the first database-integration form.
-- stock_products_v2 does not expose these columns; keeping them in field_mapping
-- makes PostgREST try to SELECT non-existent columns during agent catalogue search.
-- This migration only affects the LC Fitness external Supabase source and preserves
-- credentials, table names, variants and catalogue mappings.

update wacrm.catalog_sources
set
  field_mapping = coalesce(field_mapping, '{}'::jsonb)
    - 'description'
    - 'currency'
    - 'productUrl'
    - 'category'
    - 'stockQuantity',
  updated_at = now()
where source_type = 'external_supabase'
  and lower(trim(name)) = lower('Base LC Fitness')
  and coalesce(field_mapping ->> 'table', '') = 'stock_products_v2';
