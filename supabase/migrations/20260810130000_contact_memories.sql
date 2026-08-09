-- Long-term semantic memory per CRM contact. The summary is personal data:
-- rows are tenant-scoped, cascade with the contact/account, expire after one
-- year, and are never copied into operational trace tables.

create extension if not exists vector;

create table if not exists wacrm.contact_memories (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references wacrm.accounts(id) on delete cascade,
  contact_id uuid not null references wacrm.contacts(id) on delete cascade,
  conversation_id uuid references wacrm.conversations(id) on delete set null,
  summary text not null,
  is_retrievable boolean not null default true,
  embedding vector(1536),
  fts tsvector generated always as (to_tsvector('simple', summary)) stored,
  source_last_message_at timestamptz,
  expires_at timestamptz not null default (now() + interval '365 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contact_memories_account_conversation_unique
    unique (account_id, conversation_id)
);

create index if not exists contact_memories_contact_created_idx
  on wacrm.contact_memories (account_id, contact_id, created_at desc);

create index if not exists contact_memories_expiry_idx
  on wacrm.contact_memories (expires_at);

create index if not exists contact_memories_fts_idx
  on wacrm.contact_memories using gin (fts);

create index if not exists contact_memories_embedding_idx
  on wacrm.contact_memories using hnsw (embedding vector_cosine_ops);

alter table wacrm.contact_memories enable row level security;

revoke all on table wacrm.contact_memories from public, anon;
grant select, delete on table wacrm.contact_memories to authenticated;
grant all on table wacrm.contact_memories to service_role;

drop policy if exists contact_memories_select on wacrm.contact_memories;
create policy contact_memories_select
on wacrm.contact_memories
for select
to authenticated
using (wacrm.is_account_member(account_id));

drop policy if exists contact_memories_delete on wacrm.contact_memories;
create policy contact_memories_delete
on wacrm.contact_memories
for delete
to authenticated
using (wacrm.is_account_member(account_id, 'admin'));

create or replace function wacrm.match_contact_memories_semantic(
  p_account_id uuid,
  p_contact_id uuid,
  p_query_embedding text,
  p_match_count integer
)
returns table (id uuid, summary text, distance real)
language sql
stable
security definer
set search_path = wacrm, public
as $$
  select m.id,
         m.summary,
         (m.embedding <=> p_query_embedding::vector(1536))::real as distance
  from wacrm.contact_memories m
  where m.account_id = p_account_id
    and (auth.role() = 'service_role' or wacrm.is_account_member(p_account_id))
    and m.contact_id = p_contact_id
    and m.is_retrievable
    and m.expires_at > now()
    and m.embedding is not null
  order by m.embedding <=> p_query_embedding::vector(1536)
  limit greatest(p_match_count, 0);
$$;

create or replace function wacrm.match_contact_memories_fts(
  p_account_id uuid,
  p_contact_id uuid,
  p_query text,
  p_match_count integer
)
returns table (id uuid, summary text, rank real)
language sql
stable
security definer
set search_path = wacrm, public
as $$
  select m.id,
         m.summary,
         ts_rank(m.fts, plainto_tsquery('simple', p_query)) as rank
  from wacrm.contact_memories m
  where m.account_id = p_account_id
    and (auth.role() = 'service_role' or wacrm.is_account_member(p_account_id))
    and m.contact_id = p_contact_id
    and m.is_retrievable
    and m.expires_at > now()
    and m.fts @@ plainto_tsquery('simple', p_query)
  order by rank desc
  limit greatest(p_match_count, 0);
$$;

revoke all on function wacrm.match_contact_memories_semantic(uuid, uuid, text, integer) from public, anon;
grant execute on function wacrm.match_contact_memories_semantic(uuid, uuid, text, integer) to authenticated, service_role;
revoke all on function wacrm.match_contact_memories_fts(uuid, uuid, text, integer) from public, anon;
grant execute on function wacrm.match_contact_memories_fts(uuid, uuid, text, integer) to authenticated, service_role;
