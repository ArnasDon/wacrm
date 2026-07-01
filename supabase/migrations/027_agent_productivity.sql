-- ============================================================
-- AGENT PRODUCTIVITY: Quick Replies & Snooze
-- ============================================================

-- 1. Add snooze_until to conversations
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS snooze_until TIMESTAMPTZ;

-- 2. Create quick_replies table
CREATE TABLE IF NOT EXISTS quick_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shortcut TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, shortcut)
);

ALTER TABLE quick_replies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own quick replies" ON quick_replies;
CREATE POLICY "Users can manage own quick replies" ON quick_replies FOR ALL USING (auth.uid() = user_id);

-- Add updated_at trigger
DROP TRIGGER IF EXISTS set_updated_at ON quick_replies;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON quick_replies FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Enable realtime if needed
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'quick_replies'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE quick_replies;
  END IF;
END $$;
