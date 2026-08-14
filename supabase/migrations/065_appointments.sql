-- ============================================================
-- 065_appointments.sql — primitiva Appointment (agenda interna)
--
-- Alcance (auditoría/implementación "calendario interno", sin SaaS):
--   · appointments: cita con contacto + usuario responsable + recurso opcional
--   · appointment_resources: sala/recurso mínima (id, name) — solo lo
--     necesario para identificarlo en calendario y detectar conflictos
--
-- Reglas de diseño:
--   · REUTILIZA contacts (FK), profiles/auth.users (asignación) — NO
--     duplica contacto ni crea entidad Doctor.
--   · NO tabla de notas nueva: `notes text` en la cita (no existe Note
--     entity_type/entity_id genérico que reutilizar).
--   · status mínimo: scheduled | confirmed | completed | cancelled | no_show
--     (sin máquina de estados).
--   · Conflictos por overlap simple en el API (start < new.end AND end >
--     new.start) — sin motor de disponibilidad.
--   · RLS viewer+ select / agent+ insert/update (patrón 050).
-- ============================================================

-- ------------------------------------------------------------
-- 1) appointment_resources — sala/recurso (mínima)
-- ------------------------------------------------------------
create table if not exists public.appointment_resources (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (account_id, name)
);

create index if not exists idx_appointment_resources_account
  on public.appointment_resources (account_id, name);

alter table public.appointment_resources enable row level security;

drop policy if exists "appointment_resources_select" on public.appointment_resources;
create policy "appointment_resources_select" on public.appointment_resources
  for select using (public.is_account_member(account_id, 'viewer'::public.account_role_enum));
drop policy if exists "appointment_resources_insert" on public.appointment_resources;
create policy "appointment_resources_insert" on public.appointment_resources
  for insert with check (public.is_account_member(account_id, 'agent'::public.account_role_enum));
drop policy if exists "appointment_resources_update" on public.appointment_resources;
create policy "appointment_resources_update" on public.appointment_resources
  for update using (public.is_account_member(account_id, 'agent'::public.account_role_enum));

-- ------------------------------------------------------------
-- 2) appointments
-- ------------------------------------------------------------
create table if not exists public.appointments (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts(id) on delete cascade,
  contact_id       uuid not null references public.contacts(id) on delete cascade,
  -- Usuario responsable (doctor/agente). auth.users — mismo patrón que
  -- automations.user_id / contact_notes.user_id (017).
  assigned_user_id uuid not null references auth.users(id) on delete cascade,
  resource_id      uuid references public.appointment_resources(id) on delete set null,
  start_at         timestamptz not null,
  end_at           timestamptz not null,
  status           text not null default 'scheduled'
    check (status in ('scheduled','confirmed','completed','cancelled','no_show')),
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (end_at > start_at)
);

-- Solapamientos (conflictos) doctor y sala: indexar por intervalo.
create index if not exists idx_appointments_assigned_range
  on public.appointments (account_id, assigned_user_id, start_at, end_at);
create index if not exists idx_appointments_resource_range
  on public.appointments (account_id, resource_id, start_at, end_at);
create index if not exists idx_appointments_contact
  on public.appointments (account_id, contact_id, start_at);

alter table public.appointments enable row level security;

drop policy if exists "appointments_select" on public.appointments;
create policy "appointments_select" on public.appointments
  for select using (public.is_account_member(account_id, 'viewer'::public.account_role_enum));
drop policy if exists "appointments_insert" on public.appointments;
create policy "appointments_insert" on public.appointments
  for insert with check (public.is_account_member(account_id, 'agent'::public.account_role_enum));
drop policy if exists "appointments_update" on public.appointments;
create policy "appointments_update" on public.appointments
  for update using (public.is_account_member(account_id, 'agent'::public.account_role_enum))
  with check (public.is_account_member(account_id, 'agent'::public.account_role_enum));
drop policy if exists "appointments_delete" on public.appointments;
create policy "appointments_delete" on public.appointments
  for delete using (public.is_account_member(account_id, 'admin'::public.account_role_enum));
