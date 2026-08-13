-- ============================================================
-- 062_quick_replies_per_user.sql
--
-- Quick replies become private per user instead of account-shared:
-- each agent only sees/edits their own snippets, never a teammate's.
-- `user_id` already existed on the table (migration 035, originally
-- "author/audit only") — reused here as the actual ownership
-- boundary instead of adding a new column.
-- ============================================================

DROP POLICY IF EXISTS quick_replies_select ON quick_replies;
DROP POLICY IF EXISTS quick_replies_insert ON quick_replies;
DROP POLICY IF EXISTS quick_replies_update ON quick_replies;
DROP POLICY IF EXISTS quick_replies_delete ON quick_replies;

CREATE POLICY quick_replies_select ON quick_replies FOR SELECT
  USING (is_account_member(account_id) AND user_id = auth.uid());
CREATE POLICY quick_replies_insert ON quick_replies FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent') AND user_id = auth.uid());
CREATE POLICY quick_replies_update ON quick_replies FOR UPDATE
  USING (is_account_member(account_id, 'agent') AND user_id = auth.uid());
CREATE POLICY quick_replies_delete ON quick_replies FOR DELETE
  USING (is_account_member(account_id, 'agent') AND user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_quick_replies_user ON quick_replies(user_id);
