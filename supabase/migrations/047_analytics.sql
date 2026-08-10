-- ============================================================
-- 047_analytics.sql — Revenue Engine (DAD docs/analytics.md v7)
-- Atribución por DOM + Identity Resolution + máquina de estados
-- atómica (RPC) + scoring (feature) + timeline único + email_sends.
--
-- Aditiva: solo `add column if not exists` + 2 tablas nuevas.
-- Sin break del schema existente (verificado: 001-046).
-- ============================================================

-- ------------------------------------------------------------
-- 1) contacts.attribution — atribución del contacto
--    {utm, click_ids (incl. ctwa_clid), channel, medium,
--     landing_slug, ref_code, first_seen, last_touch, event_id, consent}
-- ------------------------------------------------------------
alter table public.contacts
  add column if not exists attribution jsonb;

comment on column public.contacts.attribution is
  'Atribución DOM por cookie cross-session 90d (DAD §2). Contiene utm, click_ids (gclid/fbclid/ctwa_clid...), channel, medium, ref_code, first_seen, last_touch, event_id, consent.';

-- ------------------------------------------------------------
-- 2) deals — scoring (feature), optimistic locking, fechas reales
-- ------------------------------------------------------------
alter table public.deals
  add column if not exists score    integer     not null default 0,
  add column if not exists tags     jsonb,
  add column if not exists priority text        not null default 'warm'
    check (priority in ('top','warm','tibio','cold')),
  add column if not exists version  integer     not null default 1,
  add column if not exists won_at   timestamptz,
  add column if not exists lost_at  timestamptz;

comment on column public.deals.score   is 'Suma de tags (max 13). Recalculado por RPC/trigger, no editable a mano (DAD §7.2).';
comment on column public.deals.tags    is '{intencion, respuesta, documentos, urgencia, valor} — 5 dimensiones, valores fijos (DAD §7.2).';
comment on column public.deals.priority is 'Derivada: cold si lost, top si urgencia=2 y score>=9, warm>=7, tibio>=4 (DAD §7.2).';
comment on column public.deals.version is 'Optimistic locking: cada transición atómica lo incrementa; RPC devuelve 409 si el caller tenia version desactualizada (DAD §7.1).';
comment on column public.deals.won_at   is 'Fecha real de cierre (sin proxy updated_at) — reporting (DAD §7.6).';
comment on column public.deals.lost_at  is 'Fecha real de pérdida — reporting de perdidos (DAD §7.6).';

-- ------------------------------------------------------------
-- 3) pipeline_stages.guard_rules — 12 estados configurables por pipeline
-- ------------------------------------------------------------
alter table public.pipeline_stages
  add column if not exists guard_rules jsonb;

comment on column public.pipeline_stages.guard_rules is
  'Reglas de transición configurables por pipeline (DAD §7.1). Ej: {"required_evidence":["call_logged","message_received"],"allow_override":true}. Template de 12 estados se precarga desde la app (src/lib/pipelines/state-machine.ts).';

-- ------------------------------------------------------------
-- 4) email_sends — log de envíos (HOY nada se persiste, DAD §7.7)
--    Reporting de correos + visor (snapshot html) + webhook Resend
-- ------------------------------------------------------------
create table if not exists public.email_sends (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references public.accounts(id) on delete cascade,
  contact_id        uuid references public.contacts(id) on delete set null,
  template_name     text not null,
  recipient         text not null,
  subject           text not null,
  html              text not null,             -- snapshot renderizado (visor srcdoc)
  status            text not null default 'sent'
    check (status in ('sent','delivered','bounced','failed')),
  resend_message_id text,
  sent_at           timestamptz not null default now()
);

create index if not exists idx_email_sends_account_sent
  on public.email_sends (account_id, sent_at desc);

alter table public.email_sends enable row level security;

-- select: viewer+ · insert: agent+ (acotado — el browser NO inserta directo;
-- el envío real lo hace el server con service_role, que bypasea RLS).
-- Drop-then-create: Postgres no tiene CREATE POLICY IF NOT EXISTS y la
-- migración debe re-ejecutarse limpia (auditoría DAT-5).
drop policy if exists "email_sends_select" on public.email_sends;
create policy "email_sends_select" on public.email_sends
  for select using (public.is_account_member(account_id, 'viewer'::public.account_role_enum));
drop policy if exists "email_sends_insert" on public.email_sends;
create policy "email_sends_insert" on public.email_sends
  for insert with check (public.is_account_member(account_id, 'agent'::public.account_role_enum));

-- ------------------------------------------------------------
-- 5) tracking_events — timeline único (inspiración Mautic event log, DAD §5/§8.2)
--    Fuente de verdad del comportamiento; eventos de negocio y anónimos juntos.
-- ------------------------------------------------------------
create table if not exists public.tracking_events (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts(id) on delete cascade,
  event_type   text not null check (event_type in (
                 'form_submit','ctwa_lead','conversion','purchase','lead_value',
                 'good_lead','better_lead','appointment_booked','service_started',
                 'closed_won','page_view','whatsapp_click','phone_click','email_click',
                 'outbound_click','scroll_depth','message_sent','message_received',
                 'call_logged','state_changed','utm_recorded','score_changed','identity_merged')),
  attribution  jsonb,
  landing_slug text,
  ref_code     text,
  event_id     text unique,                     -- dedup hard (DAD §4/§9.3)
  payload      jsonb,                           -- {deal_id, from_stage, to_stage, ...} / {href, value, currency, scrollPercent, ...}
  ip           text,
  created_at   timestamptz not null default now()
);

create index if not exists idx_tracking_events_account_type_time
  on public.tracking_events (account_id, event_type, created_at desc);

alter table public.tracking_events enable row level security;

-- select: viewer+ (datos de negocio de la cuenta). El insert lo hace el server
-- (service_role bypasea RLS); si un agente registra eventos vía sesión, agent+.
drop policy if exists "tracking_events_select" on public.tracking_events;
create policy "tracking_events_select" on public.tracking_events
  for select using (public.is_account_member(account_id, 'viewer'::public.account_role_enum));
drop policy if exists "tracking_events_insert" on public.tracking_events;
create policy "tracking_events_insert" on public.tracking_events
  for insert with check (public.is_account_member(account_id, 'agent'::public.account_role_enum));

-- ------------------------------------------------------------
-- 6) Scoring — helpers puros + RPC set_deal_tags (DAD §7.2)
-- ------------------------------------------------------------

-- suma de las 5 dimensiones (máx 13); null-safe
create or replace function public._sum_score(p_tags jsonb)
returns integer
language sql
immutable
set search_path = public
as $$
  select coalesce((p_tags->>'intencion')::int,0)  + coalesce((p_tags->>'respuesta')::int,0)
       + coalesce((p_tags->>'documentos')::int,0) + coalesce((p_tags->>'urgencia')::int,0)
       + coalesce((p_tags->>'valor')::int,0);
$$;

-- prioridad derivada (DAD §7.2): cold si lost, top si urgencia=2 y score>=9,
-- warm >= 7, tibio >= 4, cold < 4. won → warm.
create or replace function public._compute_priority(p_tags jsonb, p_score integer, p_status text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_status = 'lost' then 'cold'
    when p_status = 'won'  then 'warm'
    when coalesce((p_tags->>'urgencia')::int,0) = 2 and p_score >= 9 then 'top'
    when p_score >= 7 then 'warm'
    when p_score >= 4 then 'tibio'
    else 'cold'
  end;
$$;

-- RPC: el agente fija tags (merge parcial sobre los existentes); se recalcula
-- score + priority y se emite score_changed con reason (trazabilidad total).
-- Valores fijos por dimensión: intencion 0-3, respuesta 0-3, documentos 0-2,
-- urgencia 0-2, valor 1-3 (DAD §7.2).
create or replace function public.set_deal_tags(
  p_deal_id uuid,
  p_tags    jsonb,
  p_reason  text default 'manual'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deal     public.deals%rowtype;
  v_key      text;
  v_val      jsonb;
  v_int      int;
  v_new_tags jsonb;
  v_score    int;
  v_priority text;
begin
  if p_tags is null or jsonb_typeof(p_tags) <> 'object' then
    raise exception 'set_deal_tags: p_tags debe ser un objeto jsonb';
  end if;

  -- validación estricta: solo las 5 claves con rangos fijos (nada de texto libre)
  for v_key, v_val in select * from jsonb_each(p_tags)
  loop
    if jsonb_typeof(v_val) <> 'number' then
      raise exception 'set_deal_tags: tag % debe ser numérico', v_key;
    end if;
    v_int := (v_val #>> '{}')::int;
    case v_key
      when 'intencion'  then if v_int < 0 or v_int > 3 then raise exception 'set_deal_tags: intencion fuera de rango (0-3): %', v_int; end if;
      when 'respuesta'  then if v_int < 0 or v_int > 3 then raise exception 'set_deal_tags: respuesta fuera de rango (0-3): %', v_int; end if;
      when 'documentos' then if v_int < 0 or v_int > 2 then raise exception 'set_deal_tags: documentos fuera de rango (0-2): %', v_int; end if;
      when 'urgencia'   then if v_int < 0 or v_int > 2 then raise exception 'set_deal_tags: urgencia fuera de rango (0-2): %', v_int; end if;
      when 'valor'      then if v_int < 1 or v_int > 3 then raise exception 'set_deal_tags: valor fuera de rango (1-3): %', v_int; end if;
      else raise exception 'set_deal_tags: tag no válido: %', v_key;
    end case;
  end loop;

  select * into v_deal from public.deals where id = p_deal_id for update;
  if not found then
    raise exception 'set_deal_tags: deal % no existe', p_deal_id;
  end if;
  if not public.is_account_member(v_deal.account_id, 'agent'::public.account_role_enum) then
    raise exception 'set_deal_tags: forbidden — se requiere rol agent+ de la cuenta';
  end if;

  -- merge parcial: solo las claves provistas reemplazan
  v_new_tags := coalesce(v_deal.tags, '{}'::jsonb) || p_tags;
  v_score    := public._sum_score(v_new_tags);
  v_priority := public._compute_priority(v_new_tags, v_score, v_deal.status);

  update public.deals
     set tags = v_new_tags,
         score = v_score,
         priority = v_priority,
         updated_at = now()
   where id = p_deal_id;

  -- invariante: todo cambio de score emite su fila en tracking_events (DAD §7.2)
  insert into public.tracking_events (account_id, event_type, payload)
  values (
    v_deal.account_id,
    'score_changed',
    jsonb_build_object(
      'deal_id',  p_deal_id,
      'tags',     v_new_tags,
      'score',    v_score,
      'priority', v_priority,
      'reason',   coalesce(p_reason, 'manual')
    )
  );

  return jsonb_build_object('ok', true, 'tags', v_new_tags, 'score', v_score, 'priority', v_priority);
end;
$$;

-- ------------------------------------------------------------
-- 7) RPC transition_deal — transiciones ATÓMICAS (DAD §7.1)
--    En UNA transacción: FOR UPDATE (row lock) → guard_rules →
--    UPDATE con optimistic locking (version) → evento state_changed.
--    Sin esta RPC no hay transición; ninguna ruta edita deals directo.
-- ------------------------------------------------------------
create or replace function public.transition_deal(
  p_deal_id        uuid,
  p_to_stage_id    uuid,
  p_new_status     text        default null,   -- 'open'|'won'|'lost' (nullable: solo mueve de stage)
  p_triggered_by   text        default 'agent',
  p_evidence       jsonb       default null,
  p_override_reason text       default null,   -- avance no-bloqueante con razón (DAD §7.1)
  p_expected_version integer   default null    -- optimistic lock; null = sin control
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

  -- optimistic locking: version desactualizada → 409 (el primero en commitar gana)
  if p_expected_version is not null and v_deal.version <> p_expected_version then
    return jsonb_build_object(
      'ok', false, 'code', 'VERSION_CONFLICT',
      'current_version', v_deal.version,
      'expected_version', p_expected_version
    );
  end if;

  -- no-op: mismo stage y sin cambio de status
  if v_deal.stage_id = p_to_stage_id and (p_new_status is null or p_new_status = v_deal.status) then
    return jsonb_build_object('ok', false, 'code', 'NO_OP', 'message', 'la transición no cambia nada');
  end if;

  select * into v_stage from public.pipeline_stages where id = p_to_stage_id;
  if not found then
    raise exception 'transition_deal: stage % no existe', p_to_stage_id;
  end if;

  -- guard_rules del stage destino (configurables, NO bloqueantes por defecto)
  v_guards := coalesce(v_stage.guard_rules, '{}'::jsonb);
  if v_guards ? 'required_evidence' then
    for v_required in select jsonb_array_elements_text(v_guards -> 'required_evidence')
    loop
      select exists (
        select 1 from public.tracking_events te
        where te.account_id = v_deal.account_id
          and te.event_type = v_required
          and te.payload ->> 'deal_id' = v_deal.id::text
      ) into v_has;
      if not v_has then
        v_missing := v_missing || v_required;
      end if;
    end loop;

    if array_length(v_missing, 1) is not null then
      -- hard guard (allow_override=false) o sin razón → rechaza con checklist
      if v_guards ->> 'allow_override' = 'false' or p_override_reason is null then
        return jsonb_build_object(
          'ok', false, 'code', 'GUARDS_MISSING',
          'missing', v_missing,
          'hint', 'evidencia requerida no encontrada en el timeline; usa p_override_reason para avanzar (no-bloqueante)'
        );
      end if;
      -- no-bloqueante: avanza, la razón queda auditada en state_changed
    end if;
  end if;

  -- fechas reales de cierre/pérdida (DAD §7.6): won → won_at, lost → lost_at,
  -- reactivación (open sobre lost) → limpia lost_at (historial queda en tracking_events)
  if p_new_status = 'won' then
    v_deal.won_at := now();
    v_deal.lost_at := null;
  elsif p_new_status = 'lost' then
    v_deal.lost_at := now();
  elsif p_new_status = 'open' and v_deal.lost_at is not null then
    v_deal.lost_at := null;
  end if;

  -- prioridad derivada tras la transición
  v_priority := public._compute_priority(v_deal.tags, v_deal.score, coalesce(p_new_status, v_deal.status));

  update public.deals
     set stage_id  = p_to_stage_id,
         status    = coalesce(p_new_status, status),
         won_at    = v_deal.won_at,
         lost_at   = v_deal.lost_at,
         priority  = v_priority,
         version   = version + 1,
         updated_at = now()
   where id = p_deal_id;

  -- invariante: sin fila de evento no hubo cambio (misma transacción, DAD §7.1)
  insert into public.tracking_events (account_id, event_type, payload)
  values (
    v_deal.account_id,
    'state_changed',
    jsonb_build_object(
      'deal_id',         v_deal.id,
      'from_stage',      v_deal.stage_id,
      'to_stage',        p_to_stage_id,
      'from_status',     v_deal.status,
      'to_status',       coalesce(p_new_status, v_deal.status),
      'triggered_by',    coalesce(p_triggered_by, 'agent'),
      'evidence',        p_evidence,
      'override_reason', p_override_reason
    )
  );

  return jsonb_build_object(
    'ok', true,
    'version',  v_deal.version + 1,
    'status',   coalesce(p_new_status, v_deal.status),
    'priority', v_priority
  );
end;
$$;

-- ------------------------------------------------------------
-- 8) Trigger de score derivado de interacciones (DAD §7.2)
--    Heurísticas trazables (reason registrado en score_changed):
--      · message con sender_type='customer'  → respuesta >= 1
--      · message con content_type='document' → documentos = 2
--      · call status='answered'              → respuesta = 2
--    intencion/urgencia/valor los fija el agente vía set_deal_tags.
-- ------------------------------------------------------------
create or replace function public._deal_on_interaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r         record;
  v_tags    jsonb;
  v_score   int;
  v_priority text;
  v_reason  text;
begin
  if tg_table_name = 'messages' and tg_op = 'INSERT' then
    for r in
      select d.id, d.tags, d.score, d.status, d.account_id
      from public.deals d
      where d.conversation_id = new.conversation_id
        and d.status = 'open'
    loop
      v_tags := coalesce(r.tags, '{}'::jsonb);
      v_reason := null;

      if new.sender_type = 'customer' and coalesce((v_tags->>'respuesta')::int, 0) < 1 then
        v_tags := v_tags || jsonb_build_object('respuesta', 1);
        v_reason := 'respuesta: contacto escribió por primera vez';
      end if;
      if new.content_type = 'document' and coalesce((v_tags->>'documentos')::int, 0) < 2 then
        v_tags := v_tags || jsonb_build_object('documentos', 2);
        v_reason := coalesce(v_reason, 'documentos: documento recibido');
      end if;

      if v_reason is not null then
        v_score := public._sum_score(v_tags);
        v_priority := public._compute_priority(v_tags, v_score, r.status);
        update public.deals
           set tags = v_tags, score = v_score, priority = v_priority, updated_at = now()
         where id = r.id;
        insert into public.tracking_events (account_id, event_type, payload)
        values (r.account_id, 'score_changed',
          jsonb_build_object('deal_id', r.id, 'tags', v_tags, 'score', v_score,
                             'priority', v_priority, 'reason', v_reason));
      end if;
    end loop;

  elsif tg_table_name = 'calls' and tg_op = 'INSERT' then
    for r in
      select d.id, d.tags, d.score, d.status, d.account_id
      from public.deals d
      where d.contact_id = new.contact_id
        and d.status = 'open'
    loop
      v_tags := coalesce(r.tags, '{}'::jsonb);

      if new.status = 'answered' and coalesce((v_tags->>'respuesta')::int, 0) < 2 then
        v_tags := v_tags || jsonb_build_object('respuesta', 2);
        v_score := public._sum_score(v_tags);
        v_priority := public._compute_priority(v_tags, v_score, r.status);
        update public.deals
           set tags = v_tags, score = v_score, priority = v_priority, updated_at = now()
         where id = r.id;
        insert into public.tracking_events (account_id, event_type, payload)
        values (r.account_id, 'score_changed',
          jsonb_build_object('deal_id', r.id, 'tags', v_tags, 'score', v_score,
                             'priority', v_priority, 'reason', 'respuesta: llamada contestada'));
      end if;
    end loop;
  end if;

  return null; -- AFTER trigger: el return se ignora
end;
$$;

drop trigger if exists trg_deal_score_on_message on public.messages;
create trigger trg_deal_score_on_message
  after insert on public.messages
  for each row execute function public._deal_on_interaction();

drop trigger if exists trg_deal_score_on_call on public.calls;
create trigger trg_deal_score_on_call
  after insert on public.calls
  for each row execute function public._deal_on_interaction();

-- ------------------------------------------------------------
-- 9) Grants — patrón 037_harden_function_grants.sql
--    RPC de negocio: solo authenticated + service_role (check de membresía interno).
--    Helpers/triggers: internos, nadie ejecuta directo.
-- ------------------------------------------------------------
-- set_deal_tags(uuid, jsonb, text) — RPC pública de negocio
revoke all on function public.set_deal_tags(uuid, jsonb, text) from public, anon;
revoke all on function public.set_deal_tags(uuid, jsonb, text) from authenticated;
grant execute on function public.set_deal_tags(uuid, jsonb, text) to authenticated, service_role;

-- transition_deal(uuid, uuid, text, text, jsonb, text, integer) — RPC pública de negocio
revoke all on function public.transition_deal(uuid, uuid, text, text, jsonb, text, integer) from public, anon;
revoke all on function public.transition_deal(uuid, uuid, text, text, jsonb, text, integer) from authenticated;
grant execute on function public.transition_deal(uuid, uuid, text, text, jsonb, text, integer) to authenticated, service_role;

-- helpers internos: nadie ejecuta directo (solo se llaman desde triggers/RPC internas)
revoke all on function public._sum_score(jsonb) from public, anon, authenticated;
revoke all on function public._compute_priority(jsonb, integer, text) from public, anon, authenticated;
revoke all on function public._deal_on_interaction() from public, anon, authenticated;
