-- ============================================================
-- 055_storage_media_role_gate.sql — require agent+ to write chat-media
--                                     / flow-media objects (ST-N1)
--
-- The problem
--
--   `chat-media` (023) and `flow-media` (016, rescoped by 020) are
--   written to DIRECTLY from the browser — `src/lib/storage/
--   upload-media.ts`'s `uploadAccountMedia`/`deleteAccountMedia` call
--   `supabase.storage` straight from client code, with NO Next.js API
--   route (and therefore no `requireRole()`) in between. Storage RLS is
--   therefore the ONLY authorization boundary for these writes — and
--   both buckets' INSERT/UPDATE/DELETE policies only checked account
--   MEMBERSHIP (`EXISTS (... WHERE p.user_id = auth.uid() ...)`), never
--   `p.account_role`. Every other operational write surface in this
--   schema (contacts, conversations, messages, flows, automations,
--   broadcasts — see migration 017) requires `agent+` via
--   `is_account_member(account_id, 'agent')`; these two buckets were
--   the one write surface that didn't match that pattern, letting a
--   `viewer` upload or delete chat/flow attachments — including
--   deleting a teammate's in-progress upload — despite `canSendMessages`/
--   `canEditSettings` saying they shouldn't be able to.
--
-- The fix
--
--   Add `p.account_role IN ('agent', 'admin', 'owner')` to every
--   INSERT/UPDATE/DELETE policy on both buckets. `flow-media`'s legacy
--   OR-branch (`auth.uid()::text = path[0]`, kept by migration 020 for
--   pre-account-sharing uploads) gets the SAME role check — without it,
--   a viewer could simply write under their own `auth.uid()` folder to
--   route around the account-scoped branch entirely, since that legacy
--   branch had no role check either.
--
--   SELECT policies (public reads — Meta must be able to fetch media
--   URLs without credentials) are UNCHANGED. Bucket visibility
--   (`public = true`) is UNCHANGED. No signed URLs are introduced.
--   account_id isolation (the `account-<id>` path-segment match) is
--   UNCHANGED — this migration only narrows WHO within the correct
--   account may write, not WHICH account's folder they may write to.
--
-- Manual validation (run against a live instance — no automated SQL
-- test harness exists in this repo; same caveat as migrations 034/054):
--
--   1. As a `viewer` JWT, both of these must now be rejected (RLS
--      violation, 0 rows / 42501 depending on client):
--        supabase.storage.from('chat-media').upload('account-<own>/x.png', file)
--        supabase.storage.from('flow-media').upload('account-<own>/x.png', file)
--   2. The SAME calls as an `agent`/`admin`/`owner` of that account must
--      still succeed, unchanged from before this migration.
--   3. A viewer attempting the LEGACY flow-media path
--      (`<own-auth-uid>/x.png`) must also be rejected.
--   4. Public reads (no auth) of an existing object in either bucket
--      must be unaffected.
--
-- Idempotent — DROP POLICY IF EXISTS / CREATE POLICY, safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- chat-media (023)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Members can upload chat media" ON storage.objects;
CREATE POLICY "Members can upload chat media"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'chat-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_role IN ('agent', 'admin', 'owner')
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Members can update chat media" ON storage.objects;
CREATE POLICY "Members can update chat media"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'chat-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_role IN ('agent', 'admin', 'owner')
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Members can delete chat media" ON storage.objects;
CREATE POLICY "Members can delete chat media"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'chat-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_role IN ('agent', 'admin', 'owner')
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

-- ------------------------------------------------------------
-- flow-media (016, rescoped by 020) — same role gate on BOTH the
-- account-scoped branch and the legacy auth.uid() branch.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Members can upload flow media" ON storage.objects;
CREATE POLICY "Members can upload flow media"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'flow-media'
    AND (
      EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.user_id = auth.uid()
          AND p.account_role IN ('agent', 'admin', 'owner')
          AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
      )
      OR (
        auth.uid()::text = (storage.foldername(name))[1]
        AND EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.user_id = auth.uid()
            AND p.account_role IN ('agent', 'admin', 'owner')
        )
      )
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
          AND p.account_role IN ('agent', 'admin', 'owner')
          AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
      )
      OR (
        auth.uid()::text = (storage.foldername(name))[1]
        AND EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.user_id = auth.uid()
            AND p.account_role IN ('agent', 'admin', 'owner')
        )
      )
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
          AND p.account_role IN ('agent', 'admin', 'owner')
          AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
      )
      OR (
        auth.uid()::text = (storage.foldername(name))[1]
        AND EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.user_id = auth.uid()
            AND p.account_role IN ('agent', 'admin', 'owner')
        )
      )
    )
  );

-- Public read policies from 016/023 are untouched — no change needed,
-- no DROP/CREATE issued for them.
