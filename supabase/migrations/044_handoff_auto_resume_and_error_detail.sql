-- Migration 044: 30-minute auto-resume for human_active and technical_error,
-- permanent lock limited to manual and payment_review with open checkout,
-- technical_error owner notification clarity, and order_inbound_events.error_detail.
BEGIN;

ALTER TABLE public.order_inbound_events
  ADD COLUMN IF NOT EXISTS error_detail text;

CREATE OR REPLACE FUNCTION public.prepare_bot_handoff()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.ai_autoreply_disabled AND (NOT OLD.ai_autoreply_disabled OR NEW.bot_handoff_id IS NULL) THEN
    IF NEW.bot_handoff_id IS NULL OR NEW.bot_handoff_id IS NOT DISTINCT FROM OLD.bot_handoff_id THEN
      NEW.bot_handoff_id := gen_random_uuid();
    END IF;
    NEW.bot_pause_reason := coalesce(NEW.bot_pause_reason, 'manual');
    NEW.bot_paused_at := coalesce(NEW.bot_paused_at, now());
    IF NEW.bot_pause_reason = 'manual' THEN
      NEW.bot_resume_after := NULL;
    ELSE
      NEW.bot_resume_after := coalesce(NEW.bot_resume_after, now() + interval '30 minutes');
    END IF;
    NEW.status := 'pending';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.notify_bot_handoff()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  recipient uuid;
  notification_title text;
BEGIN
  IF NOT NEW.ai_autoreply_disabled OR NEW.bot_handoff_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.bot_handoff_id IS NOT DISTINCT FROM OLD.bot_handoff_id THEN
    RETURN NEW;
  END IF;

  notification_title := CASE
    WHEN NEW.bot_pause_reason = 'technical_error' THEN 'Erro técnico no atendimento'
    ELSE 'Atendimento necessário'
  END;

  FOR recipient IN
    SELECT p.user_id
    FROM public.profiles p
    WHERE p.account_id = NEW.account_id
      AND p.account_role IN ('owner', 'admin', 'agent')
      AND (
        p.user_id = NEW.assigned_agent_id
        OR (NEW.assigned_agent_id IS NULL AND p.account_role IN ('owner', 'admin'))
        OR (NEW.bot_pause_reason = 'technical_error' AND p.account_role = 'owner')
      )
    UNION
    SELECT a.owner_user_id
    FROM public.accounts a
    WHERE a.id = NEW.account_id
      AND (NEW.assigned_agent_id IS NULL OR NEW.bot_pause_reason = 'technical_error')
  LOOP
    INSERT INTO public.notifications(
      account_id,
      user_id,
      type,
      conversation_id,
      contact_id,
      actor_user_id,
      title,
      body,
      read_at,
      handoff_id
    )
    VALUES (
      NEW.account_id,
      recipient,
      'human_attention_required',
      NEW.id,
      NEW.contact_id,
      NULL,
      notification_title,
      concat(
        'Motivo: ',
        NEW.bot_pause_reason,
        '. Última mensagem: ',
        left(coalesce(NEW.last_message_text, ''), 250)
      ),
      NULL,
      NEW.bot_handoff_id
    )
    ON CONFLICT DO NOTHING;
  END LOOP;

  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.handle_conversation_handoff(
  p_account_id uuid,
  p_conversation_id uuid,
  p_contact_id uuid,
  p_request boolean DEFAULT false,
  p_reason text DEFAULT 'customer_request',
  p_resume boolean DEFAULT false,
  p_new_order boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  c public.conversations;
  active_human boolean;
  reason text;
  has_open_checkout boolean;
BEGIN
  IF p_reason NOT IN (
    'customer_request',
    'order_review',
    'payment_review',
    'technical_error',
    'human_active',
    'manual'
  ) THEN
    RAISE EXCEPTION 'Invalid handoff reason';
  END IF;

  SELECT * INTO c
  FROM public.conversations
  WHERE account_id = p_account_id
    AND id = p_conversation_id
    AND contact_id = p_contact_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversation/contact does not belong to account';
  END IF;

  -- Preserve the human-send history. Only a known send strictly before a valid
  -- resumption is superseded; equal/future timestamps remain conservative.
  active_human := c.last_agent_message_at IS NOT NULL
    AND c.last_agent_message_at > now() - interval '30 minutes'
    AND NOT (
      c.bot_order_resumed_at IS NOT NULL
      AND c.bot_order_resumed_at <= now()
      AND c.last_agent_message_at < c.bot_order_resumed_at
    );

  IF p_new_order AND NOT p_request THEN
    UPDATE public.conversations
       SET ai_autoreply_disabled = false,
           status = 'open',
           ai_reply_count = 0,
           bot_pause_reason = NULL,
           bot_paused_at = NULL,
           bot_resume_after = NULL,
           bot_handoff_id = NULL,
           bot_order_resumed_at = now()
     WHERE id = c.id AND account_id = p_account_id;
    RETURN jsonb_build_object('blocked', false, 'resumed', true);
  END IF;

  IF NOT p_request AND NOT c.ai_autoreply_disabled AND NOT active_human AND c.status <> 'pending' THEN
    RETURN jsonb_build_object('blocked', false);
  END IF;

  IF c.bot_handoff_id IS NULL OR NOT c.ai_autoreply_disabled THEN
    reason := CASE
      WHEN p_request THEN p_reason
      WHEN active_human THEN 'human_active'
      ELSE coalesce(c.bot_pause_reason, 'order_review')
    END;

    UPDATE public.conversations
       SET ai_autoreply_disabled = true,
           status = 'pending',
           bot_pause_reason = reason,
           bot_handoff_id = gen_random_uuid(),
           bot_paused_at = now(),
           bot_resume_after = CASE
             WHEN reason = 'manual' THEN NULL
             ELSE now() + interval '30 minutes'
           END
     WHERE id = c.id AND account_id = p_account_id
     RETURNING * INTO c;

    UPDATE public.flow_runs
       SET status = 'handed_off',
           ended_at = now(),
           end_reason = 'conversation_handoff'
     WHERE account_id = p_account_id
       AND conversation_id = c.id
       AND status = 'active';
  ELSIF p_request AND c.bot_pause_reason IS DISTINCT FROM 'manual' THEN
    IF p_reason IN ('customer_request', 'payment_review', 'technical_error', 'manual')
       AND (
         c.bot_pause_reason IS DISTINCT FROM p_reason
         OR (c.bot_resume_after IS NOT NULL AND now() >= c.bot_resume_after)
       ) THEN
      UPDATE public.conversations
         SET status = 'pending',
             bot_pause_reason = p_reason,
             bot_handoff_id = gen_random_uuid(),
             bot_paused_at = now(),
             bot_resume_after = CASE
               WHEN p_reason = 'manual' THEN NULL
               ELSE now() + interval '30 minutes'
             END
       WHERE id = c.id AND account_id = p_account_id
       RETURNING * INTO c;
    END IF;
  END IF;

  IF NOT active_human
     AND c.bot_pause_reason IS DISTINCT FROM 'manual'
     AND NOT p_request
     AND c.bot_resume_after IS NOT NULL
     AND now() >= c.bot_resume_after THEN

    IF c.bot_pause_reason = 'payment_review' THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.order_drafts d
        LEFT JOIN public.orders o
          ON o.account_id = d.account_id
         AND o.external_reference = coalesce(
           d.state->>'paymentReference',
           concat('TEXT-', d.state->>'id', '-', d.state->>'version')
         )
        WHERE d.account_id = p_account_id
          AND d.conversation_id = c.id
          AND (
            EXISTS (
              SELECT 1
              FROM public.order_checkouts oc
              WHERE oc.account_id = p_account_id
                AND oc.external_reference = coalesce(
                  d.state->>'paymentReference',
                  concat('TEXT-', d.state->>'id', '-', d.state->>'version')
                )
                AND oc.status <> 'completed'
            )
            OR o.status IN ('pending', 'checkout_processing', 'checkout_uncertain')
            OR (
              d.state->>'stage' = 'payment_created'
              AND (
                o.id IS NULL
                OR o.status NOT IN ('paid', 'payment_approved', 'completed', 'cancelled')
              )
            )
          )
      ) INTO has_open_checkout;

      IF has_open_checkout THEN
        RETURN jsonb_build_object(
          'blocked', true,
          'episode_id', c.bot_handoff_id,
          'notice', 'waiting'
        );
      END IF;
    END IF;

    IF c.bot_pause_reason = 'customer_request' AND NOT p_resume THEN
      RETURN jsonb_build_object(
        'blocked', true,
        'episode_id', c.bot_handoff_id,
        'notice', 'resume'
      );
    END IF;

    UPDATE public.conversations
       SET ai_autoreply_disabled = false,
           status = 'open',
           ai_reply_count = 0,
           bot_pause_reason = NULL,
           bot_paused_at = NULL,
           bot_resume_after = NULL,
           bot_handoff_id = NULL
     WHERE id = c.id AND account_id = p_account_id;

    RETURN jsonb_build_object('blocked', false, 'resumed', true);
  END IF;

  RETURN jsonb_build_object(
    'blocked', true,
    'episode_id', c.bot_handoff_id,
    'notice', 'waiting'
  );
END $$;

REVOKE ALL ON FUNCTION public.handle_conversation_handoff(uuid, uuid, uuid, boolean, text, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_conversation_handoff(uuid, uuid, uuid, boolean, text, boolean, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.notify_bot_handoff() FROM PUBLIC, anon, authenticated;

COMMIT;
