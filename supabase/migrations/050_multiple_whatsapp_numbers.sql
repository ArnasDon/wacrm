-- Multiple WhatsApp numbers per company. Existing connection becomes the
-- default; conversations retain the number that owns their thread.

ALTER TABLE public.whatsapp_config
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;

UPDATE public.whatsapp_config wc
SET is_default = true
WHERE wc.id IN (
  SELECT DISTINCT ON (account_id) id
  FROM public.whatsapp_config
  ORDER BY account_id, connected_at DESC NULLS LAST, created_at ASC
);

ALTER TABLE public.whatsapp_config
  DROP CONSTRAINT IF EXISTS whatsapp_config_account_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_config_one_default_per_account
  ON public.whatsapp_config(account_id) WHERE is_default;
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_config_meta_phone_number
  ON public.whatsapp_config(phone_number_id) WHERE phone_number_id IS NOT NULL;

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS whatsapp_config_id UUID
  REFERENCES public.whatsapp_config(id) ON DELETE SET NULL;

UPDATE public.conversations c
SET whatsapp_config_id = wc.id
FROM public.whatsapp_config wc
WHERE c.account_id = wc.account_id
  AND wc.is_default = true
  AND c.whatsapp_config_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_whatsapp_config
  ON public.conversations(whatsapp_config_id);

COMMENT ON COLUMN public.whatsapp_config.is_default IS
  'Default outbound WhatsApp connection for this account.';
COMMENT ON COLUMN public.conversations.whatsapp_config_id IS
  'WhatsApp connection that owns this conversation; retained for correct replies.';

