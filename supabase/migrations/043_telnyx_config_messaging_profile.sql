-- ============================================================
-- 043_telnyx_config_messaging_profile.sql — SMS outbound source
--
-- Gap detectado al implementar el step `send_sms`: `telnyx_config`
-- (038) guardaba la Call Control App id (voz) pero NO el Messaging
-- Profile id, que es un recurso de Telnyx DISTINTO (SMS vs voz) y que
-- el webhook `POST /v2/messages` exige en el body. Se añade aditivo y
-- nullable (igual que `call_control_app_id`): el usuario lo pega en
-- Settings junto al resto de la config de Telnyx ("pegar 1 API key y
-- funciona"), y `send_sms` lo lee de aquí.
-- Idempotente (ADD COLUMN IF NOT EXISTS).
-- ============================================================

ALTER TABLE public.telnyx_config
  ADD COLUMN IF NOT EXISTS messaging_profile_id text;