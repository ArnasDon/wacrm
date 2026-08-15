CREATE TABLE IF NOT EXISTS public.ai_action_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  actor_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('close_conversation', 'mark_deal_won', 'move_deal')),
  target_id UUID NOT NULL,
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_action_log_account_created
  ON public.ai_action_log(account_id, created_at DESC);

ALTER TABLE public.ai_action_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_action_log_select ON public.ai_action_log;
CREATE POLICY ai_action_log_select ON public.ai_action_log FOR SELECT
  USING (public.is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS ai_action_log_insert ON public.ai_action_log;
CREATE POLICY ai_action_log_insert ON public.ai_action_log FOR INSERT
  WITH CHECK (public.is_account_member(account_id) AND actor_user_id = auth.uid());

REVOKE ALL ON TABLE public.ai_action_log FROM anon;
GRANT SELECT, INSERT ON TABLE public.ai_action_log TO authenticated;
