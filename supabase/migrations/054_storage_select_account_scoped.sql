-- ============================================================
-- 054_storage_select_account_scoped.sql
--
-- Closes a cross-tenant enumeration hole (audit finding DAT-1):
--
-- The three public storage buckets (`chat-media`, `avatars`,
-- `flow-media`) shipped SELECT policies that were public by bucket
-- alone (`USING (bucket_id = '...')`). The bucket is public so Meta
-- can fetch URLs without auth — but the SELECT policy ALSO governs
-- API operations (list / download / signed-URL creation) via the
-- PostgREST anon key. The anon key has no auth.uid(), so the old
-- policies let ANY unauthenticated caller enumerate every object in
-- every tenant's folder (`storage.objects` listing, cross-account
-- media exfiltration).
--
-- This migration re-scopes those SELECT policies to the same
-- account/user predicates the INSERT/UPDATE/DELETE policies already
-- use (migrations 008, 016/020, 023). Public URL reads still work —
-- `getPublicUrl` serves object bytes without hitting RLS, which is
-- exactly how the app renders avatars, chat media and flow media
-- (see src/lib/storage/upload-media.ts and profile-form.tsx).
--
-- - chat-media: account members only (`account-<account_id>` path).
-- - avatars:    the owning user only (`<auth.uid()>` path segment).
-- - flow-media: account members, plus legacy per-user paths
--               (compat branch from migration 020).
--
-- Drop-then-create, idempotent — same convention as 008/016/020/023.
-- ============================================================

-- ============================================================
-- chat-media: SELECT scoped to account members
-- ============================================================
DROP POLICY IF EXISTS "Chat media is publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Chat media is readable by account members" ON storage.objects;
CREATE POLICY "Chat media is readable by account members"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'chat-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

-- ============================================================
-- avatars: SELECT scoped to the owning user
-- ============================================================
DROP POLICY IF EXISTS "Avatars are publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Avatars are readable by their owner" ON storage.objects;
CREATE POLICY "Avatars are readable by their owner"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- ============================================================
-- flow-media: SELECT scoped to account members (with legacy
-- per-user path compatibility, mirroring migration 020's writes)
-- ============================================================
DROP POLICY IF EXISTS "Flow media is publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Flow media is readable by account members" ON storage.objects;
CREATE POLICY "Flow media is readable by account members"
  ON storage.objects FOR SELECT
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
