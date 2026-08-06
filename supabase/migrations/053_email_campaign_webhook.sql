-- ============================================================
-- 053_email_campaign_webhook.sql — Webhook de Resend → campañas.
--
-- La RPC `_on_email_webhook` (048) actualizaba solo `email_sends`.
-- 052 dejó `email_campaign_recipients` con `resend_message_id`
-- (UNIQUE parcial) para que la fase webhook espeje las entregas de
-- campaña. Esta migración ES ESA fase: amplía la RPC para que, además
-- de `email_sends`, actualice la fila de campaña del mismo
-- resend_message_id.
--
-- Los UPDATes a email_campaign_recipients disparan el trigger de
-- agregación O(1) de 052 (`email_campaign_recipient_aggregate_trigger`),
-- por lo que los conteos de `email_campaigns` (sent/delivered/opened/
-- clicked/clicked/bounced) se actualizan solos — sin lógica extra aquí.
--
-- Cambios de status (ladder forward-only, como 048):
--   delivered → status='delivered' (si estaba 'sent')
--   bounced   → status='bounced'   (si estaba 'sent')
--   opened    → opened_at (primera vez); status sigue (el ladder ya cubre)
--   clicked   → clicked_at (primera vez); status sigue
--
-- Idempotente — seguro de correr varias veces.
-- ============================================================

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
  -- 1) email_sends (fill: envíos manuales / de automatizaciones)
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

  -- 2) email_campaign_recipients (si el email era de una campaña)
  --    Avanza el status forward-only para que el trigger de agregación
  --    de 052 sume opened_count/clicked_count a la campaña (el ladder
  --    de `_ec_cols_for_status` apoya cada rung sin requerir sent previo).
  if p_trigger = 'delivered' then
    update public.email_campaign_recipients
       set status = 'delivered',
           delivered_at = coalesce(delivered_at, now())
     where resend_message_id = p_resend_message_id
       and status = 'sent';
  elsif p_trigger = 'bounced' then
    update public.email_campaign_recipients
       set status = 'bounced',
           error_message = coalesce(error_message, 'Resend bounce'),
           delivered_at = coalesce(delivered_at, now())
     where resend_message_id = p_resend_message_id
       and status = 'sent';
  elsif p_trigger = 'opened' then
    update public.email_campaign_recipients
       set status = 'opened',
           opened_at = coalesce(opened_at, now())
     where resend_message_id = p_resend_message_id
       and status in ('sent', 'delivered');
  elsif p_trigger = 'clicked' then
    update public.email_campaign_recipients
       set status = 'clicked',
           clicked_at = coalesce(clicked_at, now())
     where resend_message_id = p_resend_message_id
       and status in ('sent', 'delivered', 'opened');
  end if;
end;
$$;

-- Solo service_role la ejecuta (igual que 048). Sin cambios de acceso.
revoke all on function public._on_email_webhook(text, text) from public, anon, authenticated;
grant execute on function public._on_email_webhook(text, text) to service_role;