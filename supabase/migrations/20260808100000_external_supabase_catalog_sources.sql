-- Extend catalogue sources with a direct, read-only Supabase connector.
-- Credentials remain encrypted in auth_secret_encrypted and sources remain tenant-scoped.

alter table wacrm.catalog_sources
  drop constraint if exists catalog_sources_source_type_check;

alter table wacrm.catalog_sources
  add constraint catalog_sources_source_type_check
  check (source_type in ('internal', 'external_rest', 'external_supabase'));

comment on column wacrm.catalog_sources.field_mapping is
  'Connector-specific mapping. external_supabase supports schema, table, id, name, description, price, currency, imageUrl, productUrl, category, stockQuantity, searchColumns, activeColumn, publishedColumn.';
