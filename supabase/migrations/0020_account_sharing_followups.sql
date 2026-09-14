-- ============================================================
-- 020_account_sharing_followups.sql — review-board fixes for
-- the multi-user accounts series (#167-#177).
--
-- Two concerns this migration addresses:
--
--   1. Engine dispatch indexes — the per-inbound automations and
--      flows lookups now scope by `account_id + trigger_type/status
--      + is_active/status='active'`. The pre-017 partial indexes
--      (`idx_automations_active_trigger`, no flows equivalent) were
--      account-blind. For shared accounts with 100+ teammates each
--      authoring rules, the planner ends up post-filtering by
--      account_id. Composite partial indexes drop the post-filter
--      cost to zero on the hot path.
--
--   2. Flow-media storage scoping — migration 016 created the
--      `flow-media` bucket with per-user RLS policies keyed on
--      `auth.uid() = path[0]`. After the multi-user move, flows
--      are account-scoped but the storage paths remained user-
--      scoped: an agent who left the account would orphan every
--      flow node referencing media they had uploaded. This
--      migration switches the write policies to account-scoped
--      paths (`account-<account_id>/...`) while leaving the
--      legacy `<auth.uid()>/...` paths writable by their original
--      uploader for backward compatibility. The bucket is public,
--      so reads are unchanged.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- COMPOSITE INDEXES — engine dispatch hot path
-- ============================================================

-- `runAutomationsForTrigger` queries
--   automations WHERE account_id = X AND trigger_type = Y AND is_active = TRUE
-- Migration 006 added a partial index on (trigger_type) WHERE is_active.
-- Composite + partial index lets the planner answer all three predicates
-- from one index lookup. The existing partial index can stay as belt-and-
-- braces for any code path that filters only by trigger_type.
CREATE INDEX IF NOT EXISTS idx_automations_account_active_trigger
  ON automations(account_id, trigger_type)
  WHERE is_active = TRUE;

-- `findEntryFlow` queries
--   flows WHERE account_id = X AND status = 'active'
-- Migration 017 only added `idx_flows_account`; this partial composite
-- is tuned for the engine's lookup and skips archived/draft rows.
CREATE INDEX IF NOT EXISTS idx_flows_account_active
  ON flows(account_id)
  WHERE status = 'active';

-- ============================================================
-- FLOW-MEDIA STORAGE — account-scoped writes
--
-- New path convention: `account-<uuid>/<timestamp>-<base>.<ext>`
-- Legacy path convention: `<uuid>/<timestamp>-<base>.<ext>` (where
-- the uuid is auth.uid() — preserved for back-compat).
--
-- Reads stay public (the bucket is public so Meta can fetch media
-- URLs without credentials). Only the write policies change.
--
-- Drop existing per-user policies and replace with account-aware
-- ones that accept either path convention.
-- ============================================================
DROP POLICY IF EXISTS "Users can upload their own flow media" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own flow media" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own flow media" ON storage.objects;

DROP POLICY IF EXISTS "Members can upload flow media" ON storage.objects;
CREATE POLICY "Members can upload flow media"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'flow-media'
    AND (
      -- New: any account member uploading under their account's folder.
      -- `'account-' || account_id` is how we namespace the folder, so
      -- two accounts that happen to be in the same Supabase project
      -- can never accidentally collide.
      EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.user_id = auth.uid()
          AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
      )
      -- Legacy: the original uploader keeps write access to files they
      -- already uploaded under the pre-020 path convention.
      OR auth.uid()::text = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Members can update flow media" ON storage.objects;
CREATE POLICY "Members can update flow media"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'flow-media'
    AND (
      EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.user_id = auth.uid()
          AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
      )
      OR auth.uid()::text = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Members can delete flow media" ON storage.objects;
CREATE POLICY "Members can delete flow media"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'flow-media'
    AND (
      EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.user_id = auth.uid()
          AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
      )
      OR auth.uid()::text = (storage.foldername(name))[1]
    )
  );

-- Public read policy from 016 stays as-is; reads cross both path
-- conventions without modification.
