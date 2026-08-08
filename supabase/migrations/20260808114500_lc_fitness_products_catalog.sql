-- LC Fitness also keeps catalogue-first products outside the stock tables.
-- These rows are useful for product discovery and imagery, but must not become
-- authoritative stock. stock_products/stock_variations remain the stock source.
--
-- products is the catalogue product table and product_variants supplies extra
-- presentation variants/images. The search layer deliberately exposes these
-- variants with stockQuantity = null.

update wacrm.catalog_sources
set
  field_mapping = coalesce(field_mapping, '{}'::jsonb)
    || jsonb_build_object(
      'catalogTable', 'products',
      'catalogVariantsTable', 'product_variants'
    )
    || case
      when coalesce(field_mapping ->> 'catalogVariantProductId', '') = ''
        then jsonb_build_object('catalogVariantProductId', 'product_id')
      else '{}'::jsonb
    end,
  updated_at = now()
where source_type = 'external_supabase'
  and lower(trim(name)) = lower('Base LC Fitness');
