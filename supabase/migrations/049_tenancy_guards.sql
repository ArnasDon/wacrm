-- ============================================================
-- 049_tenancy_guards.sql — cierre de la fractura de tenencia del fork
-- (hallazgos P1-4/P1-5, auditoría 7 dominios).
--
-- Problema (047_analytics.sql):
--   1) _deal_on_interaction (rama calls) escaneaba deals por contact_id
--      SIN filtrar account_id → un agent con un contact_id ajeno podía
--      forjar el scoring (y el histórico score_changed) de deals de otra
--      cuenta. La rama messages tampoco validaba que la conversación
--      perteneciera al mismo account que el deal.
--   2) transition_deal validaba el stage destino solo por id → un agent
--      podía mover un deal a un stage de OTRO account; combinado con
--      stage_id ON DELETE CASCADE (046) borraba deals de terceros.
--
-- Fix: re-emitir ambas funciones con el filtro de tenencia, y recrear
-- los triggers para que apunten a las versiones nuevas. CREATE OR
-- REPLACE + DROP TRIGGER IF EXISTS → idempotente.
-- ============================================================

-- ------------------------------------------------------------
-- transition_deal: el stage destino debe pertenecer al MISMO
-- account que el deal (no solo existir por id).
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

  -- TENANCY (auditoría P1-5): el stage destino debe pertenecer al mismo
  -- account que el deal. Sin esto, un stage de otra cuenta (por id) era
  -- válido → cross-tenant en transiciones y en el CASCADE de borrado (046).
  select s.* into v_stage
  from public.pipeline_stages s
  join public.pipelines p on p.id = s.pipeline_id
  where s.id = p_to_stage_id
    and p.account_id = v_deal.account_id;
  if not found then
    raise exception 'transition_deal: stage % no existe en esta cuenta', p_to_stage_id;
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
-- _deal_on_interaction: filtro de tenencia en AMBAS ramas.
--   · rama messages: el deal debe pertenecer al account de la
--     conversación del mensaje.
--   · rama calls: el deal debe pertenecer al account de la llamada.
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
      join public.conversations c on c.id = d.conversation_id
      where d.conversation_id = new.conversation_id
        and c.account_id = d.account_id          -- TENANCY (auditoría P1-4)
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
        and d.account_id = new.account_id       -- TENANCY (auditoría P1-4)
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

-- Recrear triggers → apuntan a las funciones corregidas (idempotente).
drop trigger if exists trg_deal_score_on_message on public.messages;
create trigger trg_deal_score_on_message
  after insert on public.messages
  for each row execute function public._deal_on_interaction();

drop trigger if exists trg_deal_score_on_call on public.calls;
create trigger trg_deal_score_on_call
  after insert on public.calls
  for each row execute function public._deal_on_interaction();
