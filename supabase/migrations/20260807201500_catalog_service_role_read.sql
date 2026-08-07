-- The automatic AI agent uses the server-side Supabase client (service_role)
-- to search catalogue data. Browser CRUD remains governed separately by the
-- authenticated role + RLS policies.

grant select on table wacrm.catalog_products to service_role;
grant select on table wacrm.catalog_sources to service_role;
