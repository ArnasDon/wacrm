-- Attach the existing LC Fitness auxiliary tables to the same external Supabase source.
-- Preserve all current credentials and column mappings; only fill the optional table names
-- when they have not already been configured by an administrator.

update wacrm.catalog_sources
set
  field_mapping = coalesce(field_mapping, '{}'::jsonb)
    || case
      when coalesce(field_mapping ->> 'variantsTable', '') = ''
        then jsonb_build_object('variantsTable', 'stock_variations')
      else '{}'::jsonb
    end
    || case
      when coalesce(field_mapping ->> 'catalogTable', '') = ''
        then jsonb_build_object('catalogTable', 'store_products')
      else '{}'::jsonb
    end
    || case
      when coalesce(field_mapping ->> 'brandsTable', '') = ''
        then jsonb_build_object('brandsTable', 'store_brands')
      else '{}'::jsonb
    end,
  updated_at = now()
where source_type = 'external_supabase'
  and lower(trim(name)) = lower('Base LC Fitness');
