-- ============================================================
-- Multiple WhatsApp numbers per company.
--
-- Pre-050, `whatsapp_config` was UNIQUE(account_id) — one connection
-- per company, enforced at the DB level (see migration 013's comment:
-- "if this ever needs to change, drop the unique and add a `primary`
-- boolean" — this migration is that change).
--
-- Decisions this migration encodes (confirmed with product before
-- writing it — see docs/SANDIA_plan_de_desarrollo.md):
--
--   1. One conversation PER NUMBER, not one per contact account-wide.
--      If the same customer writes to two different company numbers,
--      that's two separate threads — each pinned to the number that
--      owns it, so a reply always goes out on the right connection.
--      `conversations` gets `whatsapp_config_id`, and the dedup unique
--      index from migration 036 (account_id, contact_id) is replaced
--      with (account_id, contact_id, whatsapp_config_id).
--
--   2. Full per-number support for templates and broadcasts, not just
--      the default connection. Meta approves templates per-WABA, not
--      per-account, so `message_templates` needed a real per-number
--      identity anyway — this also resolves the long-standing
--      TODO(account-sharing) where the unique index was still scoped
--      to `user_id` instead of the account (see migration 014).
--      `broadcasts` gets `whatsapp_config_id`, frozen at creation like
--      `template_params` (migration 038), so a resume always continues
--      on the number the campaign actually started from.
--
-- Every application code path that assumes "one config per account"
-- was updated in the same change as this migration (config API,
-- send/react/webhooks, flows/automations senders, templates,
-- broadcasts, dashboard widgets) — do NOT apply this against the real
-- project until that code is deployed, or template/broadcast lookups
-- using `.single()` will start throwing the moment a second row
-- exists.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- 1. whatsapp_config: display name + default flag.
ALTER TABLE public.whatsapp_config
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;

-- Existing connection (there's at most one per account today) becomes
-- the default so nothing changes in behavior until a second number is
-- actually added.
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

-- No separate index on phone_number_id here — migration 013 already
-- added a full UNIQUE constraint on that column account-instance-wide,
-- which is exactly the guarantee multi-number needs too (a phone
-- number still belongs to exactly one connection).

COMMENT ON COLUMN public.whatsapp_config.is_default IS
  'Default outbound WhatsApp connection for this account. Exactly one true row per account_id (enforced by idx_whatsapp_config_one_default_per_account).';
COMMENT ON COLUMN public.whatsapp_config.display_name IS
  'Optional user-facing label ("Sales", "Support") to tell multiple connections apart in the UI.';

-- 2. conversations: which number owns this thread.
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS whatsapp_config_id UUID
  REFERENCES public.whatsapp_config(id) ON DELETE SET NULL;

UPDATE public.conversations c
SET whatsapp_config_id = wc.id
FROM public.whatsapp_config wc
WHERE c.account_id = wc.account_id
  AND wc.is_default = true
  AND c.whatsapp_config_id IS NULL
  AND c.channel = 'whatsapp';

CREATE INDEX IF NOT EXISTS idx_conversations_whatsapp_config
  ON public.conversations(whatsapp_config_id);

COMMENT ON COLUMN public.conversations.whatsapp_config_id IS
  'WhatsApp connection that owns this conversation. One thread per (account, contact, number) — see idx_conversations_account_contact_config.';

-- Replace the (account_id, contact_id) dedup guarantee from migration
-- 036 with (account_id, contact_id, whatsapp_config_id) — the same
-- contact writing to two different numbers now gets two threads
-- instead of being merged into one. NULLs (non-WhatsApp channels, or
-- WhatsApp conversations pre-dating this column with no default to
-- backfill from) don't collide with each other in a Postgres unique
-- index, so this is safe to add without a data migration beyond the
-- backfill above.
DROP INDEX IF EXISTS idx_conversations_account_contact;

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_account_contact_config
  ON public.conversations(account_id, contact_id, whatsapp_config_id);

-- 3. message_templates: per-number identity (Meta templates are
--    approved per-WABA, not per-account).
ALTER TABLE public.message_templates
  ADD COLUMN IF NOT EXISTS whatsapp_config_id UUID
  REFERENCES public.whatsapp_config(id) ON DELETE SET NULL;

UPDATE public.message_templates mt
SET whatsapp_config_id = wc.id
FROM public.whatsapp_config wc
WHERE mt.account_id = wc.account_id
  AND wc.is_default = true
  AND mt.whatsapp_config_id IS NULL;

-- Replace the legacy (user_id, name, language) unique index (migration
-- 014) — scoped to whoever happened to save the row, which let two
-- teammates shadow each other's same-named template (TODO left in
-- submit/route.ts) and couldn't model that "welcome" can legitimately
-- exist once per WABA. Guard against pre-existing duplicates the same
-- way 014 guarded the original unique index: fail loudly rather than
-- silently drop data.
DO $$
DECLARE
  dupe_count INT;
  sample TEXT;
BEGIN
  SELECT count(*) INTO dupe_count
  FROM (
    SELECT whatsapp_config_id, name, language
    FROM public.message_templates
    WHERE whatsapp_config_id IS NOT NULL
    GROUP BY whatsapp_config_id, name, language
    HAVING count(*) > 1
  ) dupes;

  IF dupe_count > 0 THEN
    SELECT string_agg(
      whatsapp_config_id::text || ' / ' || name || ' / ' || COALESCE(language, '(null)') ||
        ' (' || count || ' rows)',
      E'\n  '
    )
    INTO sample
    FROM (
      SELECT whatsapp_config_id, name, language, count(*) AS count
      FROM public.message_templates
      WHERE whatsapp_config_id IS NOT NULL
      GROUP BY whatsapp_config_id, name, language
      HAVING count(*) > 1
    ) dupe_detail;

    RAISE EXCEPTION
      E'Cannot add UNIQUE(whatsapp_config_id, name, language) on message_templates — % duplicate combination(s):\n  %\nDelete the rows you do not want to keep, then re-run migrations.',
      dupe_count, sample;
  END IF;
END $$;

DROP INDEX IF EXISTS message_templates_user_name_language_key;

CREATE UNIQUE INDEX IF NOT EXISTS message_templates_config_name_language_key
  ON public.message_templates(whatsapp_config_id, name, language)
  WHERE whatsapp_config_id IS NOT NULL;

COMMENT ON COLUMN public.message_templates.whatsapp_config_id IS
  'Which WhatsApp connection (WABA) this template belongs to — Meta approves templates per-WABA, not per-account.';

-- 4. broadcasts: which number this campaign sends from, frozen at
--    creation (same pattern as template_params, migration 038).
ALTER TABLE public.broadcasts
  ADD COLUMN IF NOT EXISTS whatsapp_config_id UUID
  REFERENCES public.whatsapp_config(id) ON DELETE SET NULL;

UPDATE public.broadcasts b
SET whatsapp_config_id = wc.id
FROM public.whatsapp_config wc
WHERE b.account_id = wc.account_id
  AND wc.is_default = true
  AND b.whatsapp_config_id IS NULL;

COMMENT ON COLUMN public.broadcasts.whatsapp_config_id IS
  'WhatsApp connection this campaign sends from, frozen at creation so a resume continues on the same number.';

-- 5. create_broadcast_with_recipients: stamp whatsapp_config_id atomically
--    with the parent insert, same reasoning as migration 038's
--    p_template_params addition — a follow-up UPDATE after the RPC would
--    reopen the exact orphaned-parent race issue #370 fixed by making
--    broadcast creation one atomic transaction. Dropped rather than
--    CREATE OR REPLACE'd for the same ambiguous-overload reason 038
--    documented.
DROP FUNCTION IF EXISTS public.create_broadcast_with_recipients(
  UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[]
);

CREATE OR REPLACE FUNCTION public.create_broadcast_with_recipients(
  p_account_id          UUID,
  p_user_id             UUID,
  p_name                TEXT,
  p_template_name       TEXT,
  p_template_language   TEXT,
  p_total_recipients    INTEGER,
  p_contact_ids         UUID[],
  p_template_params     JSONB[],
  p_whatsapp_config_id  UUID
)
RETURNS TABLE(broadcast_id UUID, recipient_id UUID, contact_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_broadcast_id UUID;
BEGIN
  INSERT INTO broadcasts (
    account_id, user_id, name, template_name,
    template_language, status, total_recipients, whatsapp_config_id
  )
  VALUES (
    p_account_id, p_user_id, p_name, p_template_name,
    p_template_language, 'sending', p_total_recipients, p_whatsapp_config_id
  )
  RETURNING id INTO v_broadcast_id;

  RETURN QUERY
  WITH ins AS (
    INSERT INTO broadcast_recipients (
      broadcast_id, contact_id, status, template_params
    )
    SELECT v_broadcast_id, t.cid, 'pending', t.prm
    FROM unnest(p_contact_ids, p_template_params) AS t(cid, prm)
    RETURNING id, contact_id
  )
  SELECT v_broadcast_id, ins.id, ins.contact_id
  FROM ins;
END;
$$;

REVOKE ALL ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[], UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[], UUID) FROM anon;
REVOKE ALL ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[], UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[], UUID) TO service_role;

-- No RLS changes anywhere in this migration — every policy on
-- whatsapp_config / conversations / message_templates / broadcasts is
-- already is_account_member(account_id, ...)-based, which doesn't
-- depend on row cardinality.
