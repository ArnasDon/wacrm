-- Per-account catalogue taxonomy: lets an account define its own
-- category/colour vocabulary (canonical value + search aliases) as DATA,
-- instead of the agent catalogue engine hardcoding one business's terms
-- (legging, camisola, ...) for every tenant on the platform.
--
-- The engine (src/lib/catalog/taxonomy.ts) loads these rows per account
-- and falls back to a small built-in generic default set only when an
-- account has configured nothing yet — existing accounts with zero rows
-- here keep working exactly as before this migration.

create table if not exists wacrm.catalog_taxonomy_terms (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references wacrm.accounts(id) on delete cascade,
  kind text not null check (kind in ('category', 'color')),
  canonical_value text not null check (char_length(canonical_value) between 1 and 80),
  aliases text[] not null default '{}',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_taxonomy_terms_unique unique (account_id, kind, canonical_value)
);

create index if not exists catalog_taxonomy_terms_account_idx
  on wacrm.catalog_taxonomy_terms (account_id, kind, enabled);

drop trigger if exists set_updated_at on wacrm.catalog_taxonomy_terms;
create trigger set_updated_at
before update on wacrm.catalog_taxonomy_terms
for each row execute function wacrm.update_updated_at_column();

alter table wacrm.catalog_taxonomy_terms enable row level security;

revoke all on table wacrm.catalog_taxonomy_terms from public, anon;
grant select, insert, update, delete on table wacrm.catalog_taxonomy_terms to authenticated;
grant all on table wacrm.catalog_taxonomy_terms to service_role;

drop policy if exists catalog_taxonomy_terms_select on wacrm.catalog_taxonomy_terms;
create policy catalog_taxonomy_terms_select
on wacrm.catalog_taxonomy_terms
for select
to authenticated
using (wacrm.is_account_member(account_id));

drop policy if exists catalog_taxonomy_terms_insert on wacrm.catalog_taxonomy_terms;
create policy catalog_taxonomy_terms_insert
on wacrm.catalog_taxonomy_terms
for insert
to authenticated
with check (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));

drop policy if exists catalog_taxonomy_terms_update on wacrm.catalog_taxonomy_terms;
create policy catalog_taxonomy_terms_update
on wacrm.catalog_taxonomy_terms
for update
to authenticated
using (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum))
with check (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));

drop policy if exists catalog_taxonomy_terms_delete on wacrm.catalog_taxonomy_terms;
create policy catalog_taxonomy_terms_delete
on wacrm.catalog_taxonomy_terms
for delete
to authenticated
using (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));
