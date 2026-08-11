-- ============================================================
-- 058_stage_status_and_native_evidence.sql
--
-- Dos cambios que hacen REAL la máquina de estados. Hasta ahora:
--
--   · `guard_rules` era siempre NULL —nada en el repo lo escribía— así que
--     `evaluateTransition` y `transition_deal` dejaban pasar todo. El sistema
--     de guardas existía sobre el papel y no gobernaba nada.
--
--   · Aunque se escribieran reglas, las dos evidencias que de verdad importan
--     en un CRM de servicios —`call_logged` y `message_received`— se resolvían
--     contra `tracking_events`, donde NUNCA se escriben. Viven en `calls` y en
--     `messages`, que es donde deben vivir: son entidades, no eventos.
--
-- 1. `pipeline_stages.stage_status`
--
--    El estado terminal era conocimiento del UI: quien llamaba a la RPC tenía
--    que pasar `p_new_status` a mano, y el kanban no lo pasa. Resultado:
--    arrastrar una tarjeta a "Won" no marcaba el trato como ganado.
--
--    Ahora la etapa lleva su propio estado y la RPC lo deriva. Es aditiva y
--    con default 'open', así que ningún pipeline existente cambia de
--    comportamiento salvo por el backfill explícito de abajo.
--
-- 2. Evidencia nativa
--
--    `call_logged` y `message_received` pasan a resolverse contra `calls` y
--    `messages`. No se duplican como eventos: se consulta donde ya están.
--
--    Los valores son los que el código escribe de verdad, verificados:
--      · `messages.sender_type` = 'customer' (CHECK de 001:166 —no existe
--        'contact'—, y es lo que escriben los 10 sitios que insertan mensajes)
--      · una llamada contestada es `answered_at IS NOT NULL`. Se acepta
--        además `disposition = 'completed'` por si algún día se escribe: hoy
--        el webhook solo escribe 'missed' y deja el resto en NULL, así que
--        exigir 'completed' habría hecho la guarda incumplible.
--
-- Idempotente.
-- ============================================================

-- ============================================================
-- 1. Estado terminal por etapa
-- ============================================================
ALTER TABLE pipeline_stages
  ADD COLUMN IF NOT EXISTS stage_status text NOT NULL DEFAULT 'open'
    CHECK (stage_status IN ('open', 'won', 'lost'));

COMMENT ON COLUMN pipeline_stages.stage_status IS
  'Estado del trato al entrar en esta etapa. transition_deal lo usa cuando el llamante no pasa p_new_status.';

-- Backfill de los pipelines que ya existen: el seed viejo creaba una etapa
-- "Won" que nunca marcaba nada. Solo por nombre exacto, para no adivinar.
UPDATE pipeline_stages SET stage_status = 'won'
 WHERE stage_status = 'open' AND lower(name) IN ('won', 'ganado', 'servicio completado');
UPDATE pipeline_stages SET stage_status = 'lost'
 WHERE stage_status = 'open' AND lower(name) IN ('lost', 'perdido', 'no contestó', 'largo plazo', 'desistió');

-- ============================================================
-- 2. transition_deal — evidencia nativa + estado derivado de la etapa
--    Copia de 047:241-373 con dos cambios acotados; el resto es idéntico:
--    row lock, optimistic locking, state_changed y prioridad no se tocan.
-- ============================================================
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

  -- El stage se carga ANTES del no-op: su `stage_status` es lo que decide el
  -- estado destino cuando el llamante no lo pasa (el kanban no lo pasa).
  select * into v_stage from public.pipeline_stages where id = p_to_stage_id;
  if not found then
    raise exception 'transition_deal: stage % no existe', p_to_stage_id;
  end if;

  v_status := coalesce(p_new_status, v_stage.stage_status, v_deal.status);

  -- no-op: mismo stage y sin cambio de status
  if v_deal.stage_id = p_to_stage_id and v_status = v_deal.status then
    return jsonb_build_object('ok', false, 'code', 'NO_OP', 'message', 'la transición no cambia nada');
  end if;

  -- guard_rules del stage destino (configurables, NO bloqueantes por defecto)
  v_guards := coalesce(v_stage.guard_rules, '{}'::jsonb);
  if v_guards ? 'required_evidence' then
    for v_required in select jsonb_array_elements_text(v_guards -> 'required_evidence')
    loop
      if v_required = 'call_logged' then
        -- Llamada contestada con el contacto del trato. Vive en `calls`, no
        -- en tracking_events: no se duplica el hecho, se consulta su casa.
        select exists (
          select 1 from public.calls c
          where c.account_id = v_deal.account_id
            and c.contact_id = v_deal.contact_id
            and (c.answered_at is not null or c.disposition = 'completed')
        ) into v_has;

      elsif v_required = 'message_received' then
        -- Mensaje entrante del contacto, en cualquier canal (WhatsApp o SMS:
        -- `messages.channel` no discrimina aquí a propósito).
        select exists (
          select 1
          from public.messages m
          join public.conversations cv on cv.id = m.conversation_id
          where cv.account_id = v_deal.account_id
            and cv.contact_id = v_deal.contact_id
            and m.sender_type = 'customer'
        ) into v_has;

      else
        -- Cualquier otra evidencia sigue resolviéndose contra el timeline.
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

  return jsonb_build_object(
    'ok', true,
    'version',  v_deal.version + 1,
    'status',   v_status,
    'priority', v_priority
  );
end;
$$;
