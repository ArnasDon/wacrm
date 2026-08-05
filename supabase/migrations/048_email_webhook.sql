-- ------------------------------------------------------------
-- 048_email_webhook.sql — Items 13-14 del plan §13 (DAD §7.7)
--
-- Persistencia de email_sends + webhook Resend real con Svix:
--   1) automation_id en email_sends (dedup de re-ejecución de secuencias)
--   2) contadores por trigger (opened/clicked) actualizados por el webhook
--   3) RPC atómica _on_email_webhook (service_role, bypasa RLS)
-- ------------------------------------------------------------

-- 1) Columnas nuevas en email_sends
alter table public.email_sends
  add column if not exists automation_id uuid
    references public.automations(id) on delete set null,
  add column if not exists opened_count integer not null default 0,
  add column if not exists clicked_count integer not null default 0,
  add column if not exists opened_at timestamptz,
  add column if not exists clicked_at timestamptz;

comment on column public.email_sends.automation_id is
  'Automatización que originó el envío (null si es manual). Dedup de re-ejecución de secuencias (DAD §7.7).';
comment on column public.email_sends.opened_count is
  'Incrementado por el webhook de Resend en email.opened.';
comment on column public.email_sends.clicked_count is
  'Incrementado por el webhook de Resend en email.clicked.';

-- Índice único parcial: una fila por (contacto, automatización). El envío
-- manual (automation_id null) nunca colisiona gracias al WHERE parcial.
create unique index if not exists uq_email_sends_contact_automation
  on public.email_sends (contact_id, automation_id)
  where automation_id is not null;

-- Lookup del webhook por resend_message_id (payload data.email_id).
create index if not exists idx_email_sends_resend_message
  on public.email_sends (resend_message_id);

-- ------------------------------------------------------------
-- 2) RPC atómica _on_email_webhook — el webhook (service_role) la llama
--    con el resend_message_id y el trigger recibido. Atómico por UPDATE
--    en una sola sentencia (sin read-modify-write).
-- ------------------------------------------------------------
create or replace function public._on_email_webhook(
  p_resend_message_id text,
  p_trigger text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_trigger = 'delivered' then
    update public.email_sends
       set status = 'delivered'
     where resend_message_id = p_resend_message_id
       and status = 'sent';
  elsif p_trigger = 'bounced' then
    update public.email_sends
       set status = 'bounced'
     where resend_message_id = p_resend_message_id
       and status = 'sent';
  elsif p_trigger = 'opened' then
    update public.email_sends
       set opened_count = opened_count + 1,
           opened_at = coalesce(opened_at, now())
     where resend_message_id = p_resend_message_id;
  elsif p_trigger = 'clicked' then
    update public.email_sends
       set clicked_count = clicked_count + 1,
           clicked_at = coalesce(clicked_at, now())
     where resend_message_id = p_resend_message_id;
  end if;
end;
$$;

-- Solo service_role la ejecuta (el webhook del server). Anon/authenticated: nunca.
revoke all on function public._on_email_webhook(text, text) from public, anon, authenticated;
grant execute on function public._on_email_webhook(text, text) to service_role;
