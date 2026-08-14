-- ============================================================
-- 066_conversion_loop.sql — Cerrar el loop de conversiones
--
-- Objetivo (prompt "WACRM — CERRAR EL LOOP DE CONVERSIONES"):
-- reportar los eventos de negocio a Google Ads y Meta Ads para que
-- los anunciantes optimicen contra lo que de verdad pasa.
--
-- Principios:
--   · REUSE > ADAPT > EXTEND > CREATE: `tracking_events` ya es la
--     primitive (event_id UNIQUE = dedup hard, attribution jsonb,
--     payload jsonb). No se crea un "evento de conversión" nuevo:
--     se extiende con columnas nullable y se enriquecen los tipos.
--   · `deal_won` == `purchase` en WACRM: un trato ganado ES la
--     compra (misma operación, con value + currency). UN evento,
--     no dos.
--   · `qualified_lead` NO es un stage nuevo (no existe "qualified"
--     en los pipelines; stages: open/won/lost). Se emite cuando un
--     trato abierto cruza el umbral de score >= 7 (warm), que es el
--     criterio de calificación que YA existe en _compute_priority.
--     Reutiliza la señal, no redefine la regla.
--   · Cola de entrega durable: conversion_deliveries (pending /
--     claimed / sent / failed / permanent) con backoff y UNIQUE
--     (conversion_event_id, platform) → cada conversión se envía a
--     cada plataforma UNA vez, incluso si el cron se solapa.
--
-- Aditiva: solo `add column if not exists` + 1 tabla nueva + 1 CHECK
-- recreado (misma lista + 4 tipos del catálogo) + emisión deal_won
-- dentro de transition_deal + trigger de encolado + trigger de
-- qualified_lead. Sin break del schema existente.
-- ============================================================

-- ------------------------------------------------------------
-- 1) tracking_events — columnas de conversión (nullable, aditivas)
--    Permiten unir el evento con su contacto/trato/cita y llevan el
--    valor monetario para Google (conversionValue) y Meta (value).
-- ------------------------------------------------------------
alter table public.tracking_events
  add column if not exists contact_id     uuid,
  add column if not exists deal_id        uuid,
  add column if not exists appointment_id uuid,
  add column if not exists value          numeric(12,2),
  add column if not exists currency       text;

comment on column public.tracking_events.contact_id     is 'Contacto asociado al evento de conversión (para user_data de los adapters).';
comment on column public.tracking_events.deal_id        is 'Trato asociado (deal_won/qualified_lead).';
comment on column public.tracking_events.appointment_id is 'Cita asociada (appointment_booked/appointment_showed).';
comment on column public.tracking_events.value          is 'Valor monetario de la conversión (Google conversionValue / Meta value).';
comment on column public.tracking_events.currency       is 'Moneda (ISO 4217) del value.';

-- ------------------------------------------------------------
-- 2) CHECK event_type — ampliar con el catálogo canónico
--    Se añaden 4 tipos: lead, qualified_lead, appointment_showed,
--    deal_won. (appointment_booked y purchase ya existían.)
--    Postgres no edita un CHECK: se deja caer y se recrea con la
--    misma lista + los nuevos. La lista completa es la de 047 + 4.
-- ------------------------------------------------------------
alter table public.tracking_events
  drop constraint if exists tracking_events_event_type_check;

alter table public.tracking_events
  add constraint tracking_events_event_type_check
  check (event_type in (
    'form_submit','ctwa_lead','conversion','purchase','lead_value',
    'good_lead','better_lead','appointment_booked','appointment_showed',
    'service_started','closed_won','lead','qualified_lead','deal_won',
    'page_view','whatsapp_click','phone_click','email_click',
    'outbound_click','scroll_depth','message_sent','message_received',
    'call_logged','state_changed','utm_recorded','score_changed','identity_merged'
  ));

-- ------------------------------------------------------------
-- 3) conversion_deliveries — cola durable de entrega a plataformas
--    Una fila por (conversión, plataforma). El cron reclama rows
--    pending → claimed → sent/failed (con backoff) → permanent.
--    UNIQUE(conversion_event_id, platform) = nunca se envía dos
--    veces la misma conversión a la misma plataforma.
-- ------------------------------------------------------------
create table if not exists public.conversion_deliveries (
  id                  uuid primary key default gen_random_uuid(),
  account_id          uuid not null references public.accounts(id) on delete cascade,
  conversion_event_id uuid not null references public.tracking_events(id) on delete cascade,
  platform            text not null check (platform in ('google_ads','meta_capi')),
  status              text not null default 'pending'
    check (status in ('pending','claimed','sent','failed','permanent')),
  attempts            integer not null default 0,
  last_error          text,
  payload             jsonb,          -- snapshot de lo que el adapter necesita
  due_at              timestamptz not null default now(),
  sent_at             timestamptz,
  created_at          timestamptz not null default now(),
  unique (conversion_event_id, platform)
);

create index if not exists idx_conversion_deliveries_due
  on public.conversion_deliveries (status, due_at)
  where status in ('pending','failed');

alter table public.conversion_deliveries enable row level security;

-- Solo el server (service_role) lee/escribe la cola; ningún rol de
-- negocio la toca directo.
drop policy if exists "conversion_deliveries_service" on public.conversion_deliveries;
create policy "conversion_deliveries_service" on public.conversion_deliveries
  for all using (false) with check (false);

-- ------------------------------------------------------------
-- 4) Trigger de ENCOLADO — cada conversión crea su entrega
--    AFTER INSERT en tracking_events: para un event_type del
--    catálogo de conversión, crea las filas conversion_deliveries
--    de las plataformas con señal de atribución presente.
--    (El cron solo procesa si hay credenciales → fail-open.)
-- ------------------------------------------------------------
create or replace function public._conversion_enqueue()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attr   jsonb := coalesce(new.attribution, '{}'::jsonb);
  v_ids    jsonb := coalesce(v_attr -> 'click_ids', '{}'::jsonb);
  v_goog   boolean;
  v_meta   boolean;
  v_payload jsonb;
begin
  if new.event_type not in ('lead','qualified_lead','appointment_booked',
                             'appointment_showed','deal_won','purchase') then
    return null;
  end if;

  v_goog := (v_ids ? 'gclid') or (v_ids ? 'gbraid') or (v_ids ? 'wbraid');
  v_meta := (v_ids ? 'fbclid') or (v_attr ? 'fbc') or (v_attr ? 'fbp');

  v_payload := jsonb_build_object(
    'event_name', new.event_type,
    'event_id',   new.event_id,
    'contact_id', new.contact_id,
    'value',      new.value,
    'currency',   new.currency,
    'created_at', new.created_at
  ) || jsonb_build_object('attribution', v_attr);

  if v_goog then
    insert into public.conversion_deliveries
      (account_id, conversion_event_id, platform, payload)
    values (new.account_id, new.id, 'google_ads', v_payload);
  end if;

  if v_meta then
    insert into public.conversion_deliveries
      (account_id, conversion_event_id, platform, payload)
    values (new.account_id, new.id, 'meta_capi', v_payload);
  end if;

  return null;
end;
$$;

drop trigger if exists trg_conversion_enqueue on public.tracking_events;
create trigger trg_conversion_enqueue
  after insert on public.tracking_events
  for each row execute function public._conversion_enqueue();

-- ------------------------------------------------------------
-- 5) transition_deal — emitir deal_won (== purchase)
--    Copia de 058 con UNA adición: cuando el estado resultante es
--    'won' y no venía de 'won', además del state_changed se inserta
--    un tracking_event 'deal_won' con contact_id/deal_id/value/
--    currency (el valor y moneda del trato). El resto es idéntico.
-- ------------------------------------------------------------
create or replace function public.transition_deal(
  p_deal_id        uuid,
  p_to_stage_id    uuid,
  p_new_status     text        default null,
  p_triggered_by   text        default 'agent',
  p_evidence       jsonb       default null,
  p_override_reason text       default null,
  p_expected_version integer   default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deal    public.deals%rowtype;
  v_stage   public.pipeline_stages%rowtype;
  v_guards  jsonb;
  v_missing text[] := '{}';
  v_required text;
  v_has     boolean;
  v_priority text;
  v_status  text;
begin
  if p_new_status is not null and p_new_status not in ('open','won','lost') then
    raise exception 'transition_deal: status no válido: % (open|won|lost)', p_new_status;
  end if;

  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then
    raise exception 'transition_deal: deal % no existe', p_deal_id;
  end if;

  if not public.is_account_member(v_deal.account_id, 'agent'::public.account_role_enum) then
    raise exception 'transition_deal: forbidden — se requiere rol agent+ de la cuenta';
  end if;

  if p_expected_version is not null and v_deal.version <> p_expected_version then
    return jsonb_build_object(
      'ok', false, 'code', 'VERSION_CONFLICT',
      'current_version', v_deal.version,
      'expected_version', p_expected_version
    );
  end if;

  select * into v_stage from public.pipeline_stages where id = p_to_stage_id;
  if not found then
    raise exception 'transition_deal: stage % no existe', p_to_stage_id;
  end if;

  v_status := coalesce(p_new_status, v_stage.stage_status, v_deal.status);

  if v_deal.stage_id = p_to_stage_id and v_status = v_deal.status then
    return jsonb_build_object('ok', false, 'code', 'NO_OP', 'message', 'la transición no cambia nada');
  end if;

  v_guards := coalesce(v_stage.guard_rules, '{}'::jsonb);
  if v_guards ? 'required_evidence' then
    for v_required in select jsonb_array_elements_text(v_guards -> 'required_evidence')
    loop
      if v_required = 'call_logged' then
        select exists (
          select 1 from public.calls c
          where c.account_id = v_deal.account_id
            and c.contact_id = v_deal.contact_id
            and (c.answered_at is not null or c.disposition = 'completed')
        ) into v_has;
      elsif v_required = 'message_received' then
        select exists (
          select 1
          from public.messages m
          join public.conversations cv on cv.id = m.conversation_id
          where cv.account_id = v_deal.account_id
            and cv.contact_id = v_deal.contact_id
            and m.sender_type = 'customer'
        ) into v_has;
      else
        select exists (
          select 1 from public.tracking_events te
          where te.account_id = v_deal.account_id
            and te.event_type = v_required
            and te.payload ->> 'deal_id' = v_deal.id::text
        ) into v_has;
      end if;

      if not v_has then
        v_missing := v_missing || v_required;
      end if;
    end loop;

    if array_length(v_missing, 1) is not null then
      if v_guards ->> 'allow_override' = 'false' or p_override_reason is null then
        return jsonb_build_object(
          'ok', false, 'code', 'GUARDS_MISSING',
          'missing', v_missing,
          'hint', coalesce(
            v_guards ->> 'hint',
            'evidencia requerida no encontrada; usa p_override_reason para avanzar (no-bloqueante)'
          )
        );
      end if;
    end if;
  end if;

  if v_status = 'won' then
    v_deal.won_at := now();
    v_deal.lost_at := null;
  elsif v_status = 'lost' then
    v_deal.lost_at := now();
  elsif v_status = 'open' and v_deal.lost_at is not null then
    v_deal.lost_at := null;
  end if;

  v_priority := public._compute_priority(v_deal.tags, v_deal.score, v_status);

  update public.deals
     set stage_id  = p_to_stage_id,
         status    = v_status,
         won_at    = v_deal.won_at,
         lost_at   = v_deal.lost_at,
         priority  = v_priority,
         version   = version + 1,
         updated_at = now()
   where id = p_deal_id;

  insert into public.tracking_events (account_id, event_type, payload)
  values (
    v_deal.account_id,
    'state_changed',
    jsonb_build_object(
      'deal_id',         v_deal.id,
      'from_stage',      v_deal.stage_id,
      'to_stage',        p_to_stage_id,
      'from_status',     v_deal.status,
      'to_status',       v_status,
      'triggered_by',    coalesce(p_triggered_by, 'agent'),
      'evidence',        p_evidence,
      'override_reason', p_override_reason
    )
  );

  -- deal_won == purchase (solo al GANAR, no en reactivaciones repetidas)
  if v_status = 'won' and v_deal.status <> 'won' then
    insert into public.tracking_events
      (account_id, contact_id, deal_id, event_type, value, currency, attribution, payload)
    values (
      v_deal.account_id,
      v_deal.contact_id,
      v_deal.id,
      'deal_won',
      v_deal.value,
      v_deal.currency,
      -- La atribución del trato NO vive en deals (no hay FK); se propaga la
      -- del contacto: es quien vino de un anuncio.
      (select attribution from public.contacts where id = v_deal.contact_id),
      jsonb_build_object('deal_id', v_deal.id, 'title', v_deal.title)
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'version',  v_deal.version + 1,
    'status',   v_status,
    'priority', v_priority
  );
end;
$$;

-- ------------------------------------------------------------
-- 6) Trigger qualified_lead — cruce del umbral de calificación
--    AFTER UPDATE en deals: cuando un trato ABIERTO pasa de
--    score < 7 a score >= 7 (warm, el criterio que ya define
--    _compute_priority) y no venía de won/lost, se emite
--    qualified_lead. Se propaga la atribución del contacto.
-- ------------------------------------------------------------
create or replace function public._deal_qualified_lead()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'open'
     and new.score >= 7
     and (old.score is null or old.score < 7)
  then
    insert into public.tracking_events
      (account_id, contact_id, deal_id, event_type, attribution, payload)
    values (
      new.account_id,
      new.contact_id,
      new.id,
      'qualified_lead',
      (select attribution from public.contacts where id = new.contact_id),
      jsonb_build_object('deal_id', new.id, 'score', new.score)
    );
  end if;
  return null;
end;
$$;

drop trigger if exists trg_deal_qualified_lead on public.deals;
create trigger trg_deal_qualified_lead
  after update on public.deals
  for each row execute function public._deal_qualified_lead();

-- ------------------------------------------------------------
-- 7) Grants — helpers internos, nadie ejecuta directo
-- ------------------------------------------------------------
revoke all on function public._conversion_enqueue() from public, anon, authenticated;
revoke all on function public._deal_qualified_lead() from public, anon, authenticated;