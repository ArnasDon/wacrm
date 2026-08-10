-- ============================================================
-- 050_frequency_queue.sql — Fase 2 Mautic P1.4 + P1 (DAD §8.3)
--   · frequency_rules: límites anti-spam por account+channel
--   · message_queue: cola de envíos diferidos (re-agendar, no descartar)
--   · RLS viewer+ select / agent+ insert (patrón email_sends 047:70-77)
-- ============================================================

-- ------------------------------------------------------------
-- 1) frequency_rules — límite de mensajes por día (por account)
--    El engine consulta ANTES de enviar; si excede, encola en
--    message_queue con due_at en la próxima ventana.
-- ------------------------------------------------------------
create table if not exists public.frequency_rules (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  channel         text not null default 'whatsapp'
    check (channel in ('whatsapp','sms','email')),
  max_per_day     int  not null default 10 check (max_per_day > 0),
  -- Ventana horaria de la clínica (P1.5 smart schedule base):
  -- los mensajes en cola no se entregan fuera de [window_start, window_end).
  window_start    time not null default '09:00',
  window_end      time not null default '20:00',
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (account_id, channel)
);

create index if not exists idx_frequency_rules_account
  on public.frequency_rules (account_id, channel);

alter table public.frequency_rules enable row level security;

-- Drop-then-create: Postgres no tiene CREATE POLICY IF NOT EXISTS y la
-- migración debe re-ejecutarse limpia (auditoría DAT-5).
drop policy if exists "frequency_rules_select" on public.frequency_rules;
create policy "frequency_rules_select" on public.frequency_rules
  for select using (public.is_account_member(account_id, 'viewer'::public.account_role_enum));
drop policy if exists "frequency_rules_insert" on public.frequency_rules;
create policy "frequency_rules_insert" on public.frequency_rules
  for insert with check (public.is_account_member(account_id, 'agent'::public.account_role_enum));
drop policy if exists "frequency_rules_update" on public.frequency_rules;
create policy "frequency_rules_update" on public.frequency_rules
  for update using (public.is_account_member(account_id, 'agent'::public.account_role_enum));

-- ------------------------------------------------------------
-- 2) message_queue — envíos que exceden el límite (no se descartan)
--    Payload = config del step ya resuelta (template_name, params…),
--    para que el drain del cron re-envíe sin re-ejecutar la
--    automatización completa. Idempotente: claim por id + status.
-- ------------------------------------------------------------
create table if not exists public.message_queue (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  contact_id      uuid references public.contacts(id) on delete set null,
  channel         text not null default 'whatsapp'
    check (channel in ('whatsapp','sms','email')),
  -- Config del envío diferido: {step_type, config, reason}
  --   send_template → {template_name, language, params, conversation_id}
  --   send_text     → {text, conversation_id}
  payload         jsonb not null,
  due_at          timestamptz not null default now(),
  status          text not null default 'pending'
    check (status in ('pending','claimed','sent','failed')),
  attempts        int not null default 0,
  last_error      text,
  queued_at       timestamptz not null default now(),
  sent_at         timestamptz
);

create index if not exists idx_message_queue_due
  on public.message_queue (status, due_at asc, queued_at asc);

create index if not exists idx_message_queue_account
  on public.message_queue (account_id, queued_at desc);

alter table public.message_queue enable row level security;

drop policy if exists "message_queue_select" on public.message_queue;
create policy "message_queue_select" on public.message_queue
  for select using (public.is_account_member(account_id, 'viewer'::public.account_role_enum));
drop policy if exists "message_queue_insert" on public.message_queue;
create policy "message_queue_insert" on public.message_queue
  for insert with check (public.is_account_member(account_id, 'agent'::public.account_role_enum));
drop policy if exists "message_queue_update" on public.message_queue;
create policy "message_queue_update" on public.message_queue
  for update using (public.is_account_member(account_id, 'agent'::public.account_role_enum));

-- ------------------------------------------------------------
-- 3) Trigger `message_read` (DAD §8.3 — decision mensaje_leido)
--    Una automatización con trigger message_read dispara cuando
--    el webhook confirma que el usuario leyó un mensaje saliente.
--    El event log ya existe (tracking_events 047); este trigger
--    NUEVO del engine se dispara desde el webhook (route.ts).
--    NOTA: no se añade event_type a tracking_events — message_read
--    es un trigger del ENGINE, no un evento del timeline.
-- ------------------------------------------------------------
