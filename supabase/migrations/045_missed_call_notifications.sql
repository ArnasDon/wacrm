-- ============================================================
-- 045 — Notificaciones missed_call (Fase 2, DAD §13)
--
-- Sube el missed_call a la campanita. Hoy notifications.type solo
-- acepta 'conversation_assigned' (027) y las filas se crean solo por
-- función SECURITY DEFINER (sin policy INSERT de cliente). Esto:
--   1. Amplía el CHECK a 'missed_call'.
--   2. Crea notify_missed_call(): SECURITY DEFINER, disparada en
--      UPDATE de calls cuando disposition pasa a 'missed' (una sola
--      vez por fila — condición OLD), dirigida a accounts.owner_user_id
--      (single-account personal).
--
-- Idempotente (DROP IF EXISTS + recrear como el patrón 027).
-- ============================================================

-- 1) Ampliar el CHECK del tipo
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'missed_call'));

-- 2) Función + trigger
CREATE OR REPLACE FUNCTION public.notify_missed_call()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_user_id UUID;
  v_contact_name TEXT;
  v_from_number  TEXT;
BEGIN
  -- Solo la transición hacia 'missed' (no re-notificar reejecuciones).
  IF TG_OP <> 'UPDATE' OR NEW.disposition IS DISTINCT FROM 'missed'
     OR OLD.disposition IS NOT DISTINCT FROM 'missed' THEN
    RETURN NEW;
  END IF;

  -- Destino: el dueño del account (single-account personal).
  SELECT owner_user_id INTO v_owner_user_id
  FROM public.accounts WHERE id = NEW.account_id;

  IF v_owner_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(name, ''), phone) INTO v_contact_name
  FROM public.contacts WHERE id = NEW.contact_id;

  v_from_number := NEW.from_number;

  INSERT INTO public.notifications (
    account_id, user_id, type, contact_id, title, body
  ) VALUES (
    NEW.account_id,
    v_owner_user_id,
    'missed_call',
    NEW.contact_id,
    'Missed call',
    COALESCE(v_contact_name, v_from_number, 'Unknown number')
      || ' called and you missed it'
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to create missed_call notification for call %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.notify_missed_call() OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.notify_missed_call() TO service_role;

DROP TRIGGER IF EXISTS on_call_missed ON public.calls;
CREATE TRIGGER on_call_missed
  AFTER UPDATE OF disposition ON public.calls
  FOR EACH ROW EXECUTE FUNCTION public.notify_missed_call();
