-- WA CRM — instalador manual completo das melhorias do agente de IA
-- Data: 2026-08-10
--
-- Utilização:
--   1. Execute este ficheiro completo uma única vez no SQL Editor do Supabase.
--   2. Não execute também, separadamente, as sete migrations indicadas abaixo.
--   3. Se qualquer instrução falhar, a transacção inteira será revertida.
--
-- Migrations reunidas, pela ordem original:
--   20260809090000_ai_message_buffer.sql
--   20260809100000_ai_reply_chunks.sql
--   20260810100000_ai_crm_tools.sql
--   20260810110000_agent_tool_calls.sql
--   20260810120000_agent_traces.sql
--   20260810130000_contact_memories.sql
--   20260810140000_ai_guardrails.sql

begin;

set local lock_timeout = '15s';
set local statement_timeout = '5min';

-- Interrompe antes de qualquer alteração quando a base estrutural do WA CRM
-- não está presente nesta base de dados.
do $preflight$
declare
  missing_objects text;
begin
  select string_agg(object_name, ', ' order by object_name)
  into missing_objects
  from (
    values
      ('wacrm.accounts', to_regclass('wacrm.accounts')),
      ('wacrm.agent_tools', to_regclass('wacrm.agent_tools')),
      ('wacrm.ai_configs', to_regclass('wacrm.ai_configs')),
      ('wacrm.contacts', to_regclass('wacrm.contacts')),
      ('wacrm.conversations', to_regclass('wacrm.conversations'))
  ) as required_objects(object_name, object_oid)
  where object_oid is null;

  if missing_objects is not null then
    raise exception
      'Instalação cancelada. Objectos obrigatórios ausentes: %',
      missing_objects;
  end if;
end
$preflight$;

-- ============================================================================
-- 1/7 — Buffer de fragmentos rápidos recebidos pelo WhatsApp
-- ============================================================================

alter table wacrm.ai_configs
  add column if not exists buffer_window_seconds integer not null default 12;

alter table wacrm.ai_configs
  drop constraint if exists ai_configs_buffer_window_seconds_check;

alter table wacrm.ai_configs
  add constraint ai_configs_buffer_window_seconds_check
  check (buffer_window_seconds between 1 and 30);

alter table wacrm.conversations
  add column if not exists ai_dispatch_generation bigint not null default 0;

alter table wacrm.conversations
  add column if not exists ai_dispatch_claimed_generation bigint not null default 0;

alter table wacrm.conversations
  add column if not exists ai_dispatch_pending_since timestamptz;

comment on column wacrm.ai_configs.buffer_window_seconds is
  'Quiet period after the latest inbound message before AI auto-reply runs.';

comment on column wacrm.conversations.ai_dispatch_pending_since is
  'Time of the newest inbound awaiting a buffered AI dispatch; null after claim.';

create or replace function wacrm.schedule_ai_dispatch(
  p_account_id uuid,
  p_conversation_id uuid
)
returns bigint
language sql
security definer
set search_path = pg_catalog
as $$
  update wacrm.conversations
  set ai_dispatch_generation = ai_dispatch_generation + 1,
      ai_dispatch_pending_since = now()
  where id = p_conversation_id
    and account_id = p_account_id
  returning ai_dispatch_generation;
$$;

create or replace function wacrm.claim_ai_dispatch(
  p_account_id uuid,
  p_conversation_id uuid,
  p_generation bigint
)
returns boolean
language sql
security definer
set search_path = pg_catalog
as $$
  with claimed as (
    update wacrm.conversations
    set ai_dispatch_claimed_generation = p_generation,
        ai_dispatch_pending_since = null
    where id = p_conversation_id
      and account_id = p_account_id
      and ai_dispatch_generation = p_generation
      and ai_dispatch_claimed_generation < p_generation
    returning 1
  )
  select exists (select 1 from claimed);
$$;

revoke all on function wacrm.schedule_ai_dispatch(uuid, uuid) from public;
revoke all on function wacrm.schedule_ai_dispatch(uuid, uuid) from anon;
revoke all on function wacrm.schedule_ai_dispatch(uuid, uuid) from authenticated;
grant execute on function wacrm.schedule_ai_dispatch(uuid, uuid) to service_role;

revoke all on function wacrm.claim_ai_dispatch(uuid, uuid, bigint) from public;
revoke all on function wacrm.claim_ai_dispatch(uuid, uuid, bigint) from anon;
revoke all on function wacrm.claim_ai_dispatch(uuid, uuid, bigint) from authenticated;
grant execute on function wacrm.claim_ai_dispatch(uuid, uuid, bigint) to service_role;

-- ============================================================================
-- 2/7 — Divisão de uma resposta em balões de WhatsApp
-- ============================================================================

alter table wacrm.ai_configs
  add column if not exists max_reply_chunks integer not null default 3;

alter table wacrm.ai_configs
  drop constraint if exists ai_configs_max_reply_chunks_check;

alter table wacrm.ai_configs
  add constraint ai_configs_max_reply_chunks_check
  check (max_reply_chunks between 1 and 5);

comment on column wacrm.ai_configs.max_reply_chunks is
  'Maximum WhatsApp bubbles sent for one AI automatic reply.';

-- ============================================================================
-- 3/7 — Ferramentas CRM do agente
-- ============================================================================

alter table wacrm.agent_tools
  drop constraint if exists agent_tools_tool_key_check;

alter table wacrm.agent_tools
  add constraint agent_tools_tool_key_check
  check (tool_key in (
    'search_catalog',
    'send_product',
    'search_knowledge',
    'add_tag',
    'create_deal',
    'handoff_human'
  ));

insert into wacrm.agent_tools (account_id, agent_id, tool_key, enabled)
select c.account_id, c.id, defaults.tool_key, defaults.enabled
from wacrm.ai_configs c
cross join (values
  ('add_tag'::text, false),
  ('create_deal'::text, false),
  ('handoff_human'::text, true)
) as defaults(tool_key, enabled)
on conflict (agent_id, tool_key) do nothing;

-- ============================================================================
-- 4/7 — Telemetria segura das chamadas de ferramentas
-- ============================================================================

create table if not exists wacrm.agent_tool_calls (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references wacrm.accounts(id) on delete cascade,
  agent_id uuid not null references wacrm.ai_configs(id) on delete cascade,
  conversation_id uuid references wacrm.conversations(id) on delete set null,
  tool_key text not null,
  duration_ms integer not null default 0 check (duration_ms >= 0),
  succeeded boolean not null default true,
  called_at timestamptz not null default now(),
  constraint agent_tool_calls_tool_key_check
    check (tool_key in (
      'search_catalog',
      'send_product',
      'search_knowledge',
      'add_tag',
      'create_deal',
      'handoff_human'
    ))
);

create index if not exists agent_tool_calls_account_called_idx
  on wacrm.agent_tool_calls (account_id, called_at desc);

create index if not exists agent_tool_calls_agent_tool_called_idx
  on wacrm.agent_tool_calls (agent_id, tool_key, called_at desc);

alter table wacrm.agent_tool_calls enable row level security;

revoke all on table wacrm.agent_tool_calls from public, anon;
grant select on table wacrm.agent_tool_calls to authenticated;
grant all on table wacrm.agent_tool_calls to service_role;

drop policy if exists agent_tool_calls_select on wacrm.agent_tool_calls;
create policy agent_tool_calls_select
on wacrm.agent_tool_calls
for select
to authenticated
using (wacrm.is_account_member(account_id));

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'wacrm'
      and tablename = 'agent_tool_calls'
  ) then
    alter publication supabase_realtime add table wacrm.agent_tool_calls;
  end if;
end
$$;

-- ============================================================================
-- 5/7 — Rastreio seguro dos turnos automáticos do agente
-- ============================================================================

create table if not exists wacrm.agent_traces (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references wacrm.accounts(id) on delete cascade,
  agent_id uuid not null references wacrm.ai_configs(id) on delete cascade,
  conversation_id uuid references wacrm.conversations(id) on delete set null,
  turn_id uuid not null,
  intent text,
  model_tier text not null default 'smart',
  final_action text not null,
  tool_calls jsonb not null default '[]'::jsonb,
  memory_match_count integer not null default 0 check (memory_match_count >= 0),
  total_ms integer not null default 0 check (total_ms >= 0),
  created_at timestamptz not null default now(),
  constraint agent_traces_account_turn_unique unique (account_id, turn_id),
  constraint agent_traces_intent_check
    check (intent is null or intent in ('faq', 'sales', 'complaint', 'account', 'smalltalk')),
  constraint agent_traces_model_tier_check check (model_tier in ('fast', 'smart')),
  constraint agent_traces_final_action_check
    check (final_action in ('reply', 'handoff', 'no_reply')),
  constraint agent_traces_tool_calls_array_check check (jsonb_typeof(tool_calls) = 'array')
);

create index if not exists agent_traces_account_created_idx
  on wacrm.agent_traces (account_id, created_at desc);

create index if not exists agent_traces_conversation_created_idx
  on wacrm.agent_traces (conversation_id, created_at desc)
  where conversation_id is not null;

alter table wacrm.agent_traces enable row level security;

revoke all on table wacrm.agent_traces from public, anon;
grant select on table wacrm.agent_traces to authenticated;
grant all on table wacrm.agent_traces to service_role;

drop policy if exists agent_traces_select on wacrm.agent_traces;
create policy agent_traces_select
on wacrm.agent_traces
for select
to authenticated
using (wacrm.is_account_member(account_id));

-- ============================================================================
-- 6/7 — Memória semântica de longo prazo por contacto
-- ============================================================================

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

revoke all on function wacrm.match_contact_memories_semantic(uuid, uuid, text, integer)
  from public, anon;
grant execute on function wacrm.match_contact_memories_semantic(uuid, uuid, text, integer)
  to authenticated, service_role;

revoke all on function wacrm.match_contact_memories_fts(uuid, uuid, text, integer)
  from public, anon;
grant execute on function wacrm.match_contact_memories_fts(uuid, uuid, text, integer)
  to authenticated, service_role;

-- ============================================================================
-- 7/7 — Protecções da resposta final do agente
-- ============================================================================

alter table wacrm.agent_traces
  add column if not exists guardrail_violations text[] not null default '{}';

alter table wacrm.agent_traces
  drop constraint if exists agent_traces_guardrail_violations_check;

alter table wacrm.agent_traces
  add constraint agent_traces_guardrail_violations_check
  check (
    guardrail_violations <@ array[
      'control_marker',
      'system_prompt_leak',
      'credential_or_secret',
      'payment_card',
      'unsupported_price',
      'unverified_availability',
      'unsafe_promise'
    ]::text[]
  );

-- Verificação final ainda dentro da transacção. Uma falha aqui também reverte
-- todas as alterações anteriores.
do $verification$
declare
  missing_components text;
begin
  select string_agg(component, ', ' order by component)
  into missing_components
  from (
    values
      (
        'ai_configs.buffer_window_seconds',
        exists (
          select 1 from information_schema.columns
          where table_schema = 'wacrm'
            and table_name = 'ai_configs'
            and column_name = 'buffer_window_seconds'
        )
      ),
      (
        'ai_configs.max_reply_chunks',
        exists (
          select 1 from information_schema.columns
          where table_schema = 'wacrm'
            and table_name = 'ai_configs'
            and column_name = 'max_reply_chunks'
        )
      ),
      ('agent_tool_calls', to_regclass('wacrm.agent_tool_calls') is not null),
      ('agent_traces', to_regclass('wacrm.agent_traces') is not null),
      ('contact_memories', to_regclass('wacrm.contact_memories') is not null),
      (
        'agent_traces.guardrail_violations',
        exists (
          select 1 from information_schema.columns
          where table_schema = 'wacrm'
            and table_name = 'agent_traces'
            and column_name = 'guardrail_violations'
        )
      ),
      ('extensão vector', exists (select 1 from pg_extension where extname = 'vector')),
      (
        'schedule_ai_dispatch',
        to_regprocedure('wacrm.schedule_ai_dispatch(uuid,uuid)') is not null
      ),
      (
        'claim_ai_dispatch',
        to_regprocedure('wacrm.claim_ai_dispatch(uuid,uuid,bigint)') is not null
      ),
      (
        'match_contact_memories_semantic',
        to_regprocedure(
          'wacrm.match_contact_memories_semantic(uuid,uuid,text,integer)'
        ) is not null
      ),
      (
        'match_contact_memories_fts',
        to_regprocedure(
          'wacrm.match_contact_memories_fts(uuid,uuid,text,integer)'
        ) is not null
      )
  ) as checks(component, installed)
  where not installed;

  if missing_components is not null then
    raise exception
      'A verificação final falhou. Componentes ausentes: %',
      missing_components;
  end if;
end
$verification$;

commit;

-- Este resultado só aparece se toda a instalação tiver sido concluída.
select
  'OK'::text as estado,
  'Melhorias completas do agente de IA instaladas no WA CRM.'::text as resultado,
  7::integer as migrations_aplicadas;
