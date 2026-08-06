-- Internal quick catalogues and external REST catalogue connectors.

create table if not exists wacrm.catalog_sources (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references wacrm.accounts(id) on delete cascade,
  name text not null,
  source_type text not null check (source_type in ('internal', 'external_rest')),
  is_active boolean not null default true,
  base_url text,
  search_path text,
  auth_type text not null default 'none' check (auth_type in ('none', 'bearer', 'api_key_header')),
  auth_header text,
  auth_secret_encrypted text,
  field_mapping jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists catalog_sources_account_idx
  on wacrm.catalog_sources(account_id, is_active);

create table if not exists wacrm.catalog_products (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references wacrm.accounts(id) on delete cascade,
  source_id uuid references wacrm.catalog_sources(id) on delete set null,
  external_id text,
  name text not null,
  description text,
  price numeric(14,2) not null check (price >= 0),
  currency text not null default 'MZN',
  image_url text,
  product_url text,
  category text,
  stock_quantity integer,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists catalog_products_account_search_idx
  on wacrm.catalog_products(account_id, is_active, name);
create index if not exists catalog_products_source_idx
  on wacrm.catalog_products(source_id);

alter table wacrm.catalog_sources enable row level security;
alter table wacrm.catalog_products enable row level security;

create policy "catalog_sources_account_members" on wacrm.catalog_sources
  for all using (wacrm.is_account_member(account_id))
  with check (wacrm.is_account_member(account_id));

create policy "catalog_products_account_members" on wacrm.catalog_products
  for all using (wacrm.is_account_member(account_id))
  with check (wacrm.is_account_member(account_id));
