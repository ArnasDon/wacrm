-- Standalone domain schema adapted from the checked-out domain migrations.
-- Static SQL: no runtime source conversion or Supabase services.


-- Domain evolution 001


CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  avatar_url TEXT,
  role TEXT DEFAULT 'user',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own profile" ON profiles;

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;

DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;

CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (app.current_user_id() = user_id);

CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (app.current_user_id() = user_id);

CREATE POLICY "Users can insert own profile" ON profiles FOR INSERT WITH CHECK (app.current_user_id() = user_id);

CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  name TEXT,
  email TEXT,
  company TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contacts_user_id ON contacts(user_id);

CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone);

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own contacts" ON contacts;

CREATE POLICY "Users can manage own contacts" ON contacts FOR ALL USING (app.current_user_id() = user_id);

CREATE TABLE IF NOT EXISTS tags (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3b82f6',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own tags" ON tags;

CREATE POLICY "Users can manage own tags" ON tags FOR ALL USING (app.current_user_id() = user_id);

CREATE TABLE IF NOT EXISTS contact_tags (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(contact_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_contact_tags_contact ON contact_tags(contact_id);

CREATE INDEX IF NOT EXISTS idx_contact_tags_tag ON contact_tags(tag_id);

ALTER TABLE contact_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage contact tags" ON contact_tags;

CREATE POLICY "Users can manage contact tags" ON contact_tags FOR ALL
  USING (EXISTS (SELECT 1 FROM contacts WHERE contacts.id = contact_tags.contact_id AND contacts.user_id = app.current_user_id()));

CREATE TABLE IF NOT EXISTS custom_fields (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  field_type TEXT NOT NULL DEFAULT 'text',
  field_options JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE custom_fields ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own custom fields" ON custom_fields;

CREATE POLICY "Users can manage own custom fields" ON custom_fields FOR ALL USING (app.current_user_id() = user_id);

CREATE TABLE IF NOT EXISTS contact_custom_values (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  custom_field_id UUID NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
  value TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(contact_id, custom_field_id)
);

ALTER TABLE contact_custom_values ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage custom values" ON contact_custom_values;

CREATE POLICY "Users can manage custom values" ON contact_custom_values FOR ALL
  USING (EXISTS (SELECT 1 FROM contacts WHERE contacts.id = contact_custom_values.contact_id AND contacts.user_id = app.current_user_id()));

CREATE TABLE IF NOT EXISTS contact_notes (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  note_text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE contact_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own notes" ON contact_notes;

CREATE POLICY "Users can manage own notes" ON contact_notes FOR ALL USING (app.current_user_id() = user_id);

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending', 'closed')),
  assigned_agent_id UUID,
  last_message_text TEXT,
  last_message_at TIMESTAMPTZ,
  unread_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);

CREATE INDEX IF NOT EXISTS idx_conversations_contact_id ON conversations(contact_id);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own conversations" ON conversations;

CREATE POLICY "Users can manage own conversations" ON conversations FOR ALL USING (app.current_user_id() = user_id);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('customer', 'agent', 'bot')),
  sender_id UUID,
  content_type TEXT NOT NULL DEFAULT 'text' CHECK (content_type IN ('text', 'image', 'document', 'audio', 'video', 'location', 'template')),
  content_text TEXT,
  media_url TEXT,
  template_name TEXT,
  message_id TEXT,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sending', 'sent', 'delivered', 'read', 'failed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);

CREATE INDEX IF NOT EXISTS idx_messages_message_id ON messages(message_id);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own messages" ON messages;

DROP POLICY IF EXISTS "Service role can insert messages" ON messages;

CREATE POLICY "Users can view own messages" ON messages FOR ALL
  USING (EXISTS (SELECT 1 FROM conversations WHERE conversations.id = messages.conversation_id AND conversations.user_id = app.current_user_id()));

CREATE POLICY "Service role can insert messages" ON messages FOR INSERT WITH CHECK (true);

CREATE TABLE IF NOT EXISTS whatsapp_config (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  phone_number_id TEXT NOT NULL,
  waba_id TEXT,
  access_token TEXT NOT NULL,
  verify_token TEXT,
  status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected')),
  connected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

ALTER TABLE whatsapp_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own config" ON whatsapp_config;

CREATE POLICY "Users can manage own config" ON whatsapp_config FOR ALL USING (app.current_user_id() = user_id);

CREATE TABLE IF NOT EXISTS message_templates (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Marketing' CHECK (category IN ('Marketing', 'Utility', 'Authentication')),
  language TEXT DEFAULT 'en_US',
  header_type TEXT CHECK (header_type IN ('text', 'image', 'video', 'document')),
  header_content TEXT,
  body_text TEXT NOT NULL,
  footer_text TEXT,
  buttons JSONB,
  status TEXT DEFAULT 'Draft' CHECK (status IN ('Draft', 'Pending', 'Approved', 'Rejected')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own templates" ON message_templates;

CREATE POLICY "Users can manage own templates" ON message_templates FOR ALL USING (app.current_user_id() = user_id);

CREATE TABLE IF NOT EXISTS pipelines (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE pipelines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own pipelines" ON pipelines;

CREATE POLICY "Users can manage own pipelines" ON pipelines FOR ALL USING (app.current_user_id() = user_id);

CREATE TABLE IF NOT EXISTS pipeline_stages (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  pipeline_id UUID NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  color TEXT NOT NULL DEFAULT '#3b82f6',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_stages_pipeline ON pipeline_stages(pipeline_id);

ALTER TABLE pipeline_stages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage pipeline stages" ON pipeline_stages;

CREATE POLICY "Users can manage pipeline stages" ON pipeline_stages FOR ALL
  USING (EXISTS (SELECT 1 FROM pipelines WHERE pipelines.id = pipeline_stages.pipeline_id AND pipelines.user_id = app.current_user_id()));

CREATE TABLE IF NOT EXISTS deals (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  pipeline_id UUID NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  stage_id UUID NOT NULL REFERENCES pipeline_stages(id),
  contact_id UUID NOT NULL REFERENCES contacts(id),
  conversation_id UUID REFERENCES conversations(id),
  title TEXT NOT NULL,
  value NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency TEXT DEFAULT 'USD',
  notes TEXT,
  expected_close_date DATE,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deals_pipeline ON deals(pipeline_id);

CREATE INDEX IF NOT EXISTS idx_deals_stage ON deals(stage_id);

ALTER TABLE deals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own deals" ON deals;

CREATE POLICY "Users can manage own deals" ON deals FOR ALL USING (app.current_user_id() = user_id);

CREATE TABLE IF NOT EXISTS broadcasts (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  template_name TEXT NOT NULL,
  template_language TEXT NOT NULL DEFAULT 'en_US',
  template_variables JSONB,
  audience_filter JSONB,
  scheduled_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'failed')),
  total_recipients INTEGER DEFAULT 0,
  sent_count INTEGER DEFAULT 0,
  delivered_count INTEGER DEFAULT 0,
  read_count INTEGER DEFAULT 0,
  replied_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE broadcasts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own broadcasts" ON broadcasts;

CREATE POLICY "Users can manage own broadcasts" ON broadcasts FOR ALL USING (app.current_user_id() = user_id);

CREATE TABLE IF NOT EXISTS broadcast_recipients (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  broadcast_id UUID NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'replied', 'failed')),
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  replied_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_broadcast ON broadcast_recipients(broadcast_id);

ALTER TABLE broadcast_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage broadcast recipients" ON broadcast_recipients;

CREATE POLICY "Users can manage broadcast recipients" ON broadcast_recipients FOR ALL
  USING (EXISTS (SELECT 1 FROM broadcasts WHERE broadcasts.id = broadcast_recipients.broadcast_id AND broadcasts.user_id = app.current_user_id()));

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at ON profiles;

DROP TRIGGER IF EXISTS set_updated_at ON contacts;

DROP TRIGGER IF EXISTS set_updated_at ON conversations;

DROP TRIGGER IF EXISTS set_updated_at ON whatsapp_config;

DROP TRIGGER IF EXISTS set_updated_at ON message_templates;

DROP TRIGGER IF EXISTS set_updated_at ON deals;

DROP TRIGGER IF EXISTS set_updated_at ON broadcasts;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON contacts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON conversations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON whatsapp_config FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON message_templates FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON deals FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON broadcasts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS on_auth_user_created ON identity.users;

DROP FUNCTION IF EXISTS public.handle_new_user();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.name, ''),
    NEW.email
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to create profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO omni_owner;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON identity.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- Domain evolution 002


ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_deals_assigned_to ON deals(assigned_to);

UPDATE deals SET status = 'open' WHERE status = 'active' OR status IS NULL;

ALTER TABLE deals ALTER COLUMN status SET DEFAULT 'open';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'deals_status_check' AND conrelid = 'deals'::regclass
  ) THEN
    ALTER TABLE deals DROP CONSTRAINT deals_status_check;
  END IF;
END $$;

ALTER TABLE deals
  ADD CONSTRAINT deals_status_check CHECK (status IN ('open', 'won', 'lost'));


-- Domain evolution 003


ALTER TABLE broadcast_recipients
  ADD COLUMN IF NOT EXISTS whatsapp_message_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_broadcast_recipients_wamid
  ON broadcast_recipients (whatsapp_message_id)
  WHERE whatsapp_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_broadcast_status
  ON broadcast_recipients (broadcast_id, status);

CREATE OR REPLACE FUNCTION public.recompute_broadcast_counts(bid UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE broadcasts b SET
    sent_count      = agg.sent_count,
    delivered_count = agg.delivered_count,
    read_count      = agg.read_count,
    replied_count   = agg.replied_count,
    failed_count    = agg.failed_count,
    updated_at      = NOW()
  FROM (
    SELECT
      COUNT(*) FILTER (WHERE status IN ('sent','delivered','read','replied')) AS sent_count,
      COUNT(*) FILTER (WHERE status IN ('delivered','read','replied'))        AS delivered_count,
      COUNT(*) FILTER (WHERE status IN ('read','replied'))                    AS read_count,
      COUNT(*) FILTER (WHERE status = 'replied')                              AS replied_count,
      COUNT(*) FILTER (WHERE status = 'failed')                               AS failed_count
    FROM broadcast_recipients
    WHERE broadcast_id = bid
  ) agg
  WHERE b.id = bid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.broadcast_recipient_aggregate_trigger()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_broadcast_counts(OLD.broadcast_id);
    RETURN OLD;
  END IF;

  -- INSERT or UPDATE — only recompute when status changed (or on fresh insert)
  IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM public.recompute_broadcast_counts(NEW.broadcast_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS broadcast_recipients_aggregate ON broadcast_recipients;

CREATE TRIGGER broadcast_recipients_aggregate
AFTER INSERT OR UPDATE OR DELETE ON broadcast_recipients
FOR EACH ROW EXECUTE FUNCTION public.broadcast_recipient_aggregate_trigger();


-- Domain evolution 004


ALTER TABLE broadcast_recipients
  ALTER COLUMN contact_id DROP NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'broadcast_recipients_contact_id_fkey'
      AND conrelid = 'broadcast_recipients'::regclass
  ) THEN
    ALTER TABLE broadcast_recipients
      DROP CONSTRAINT broadcast_recipients_contact_id_fkey;
  END IF;
END $$;

ALTER TABLE broadcast_recipients
  ADD CONSTRAINT broadcast_recipients_contact_id_fkey
    FOREIGN KEY (contact_id) REFERENCES contacts(id)
    ON DELETE SET NULL;

ALTER TABLE deals
  ALTER COLUMN contact_id DROP NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'deals_contact_id_fkey'
      AND conrelid = 'deals'::regclass
  ) THEN
    ALTER TABLE deals
      DROP CONSTRAINT deals_contact_id_fkey;
  END IF;
END $$;

ALTER TABLE deals
  ADD CONSTRAINT deals_contact_id_fkey
    FOREIGN KEY (contact_id) REFERENCES contacts(id)
    ON DELETE SET NULL;


-- Domain evolution 005


CREATE OR REPLACE FUNCTION public._bcast_bump(bid UUID, col TEXT, delta INT)
RETURNS VOID AS $$
BEGIN
  EXECUTE format(
    'UPDATE broadcasts SET %I = GREATEST(0, %I + $1), updated_at = NOW() WHERE id = $2',
    col, col
  ) USING delta, bid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public._bcast_cols_for_status(s TEXT)
RETURNS TEXT[] AS $$
BEGIN
  -- 'pending' contributes to nothing.
  IF s = 'pending' THEN RETURN ARRAY[]::TEXT[]; END IF;
  IF s = 'sent'      THEN RETURN ARRAY['sent_count']; END IF;
  IF s = 'delivered' THEN RETURN ARRAY['sent_count','delivered_count']; END IF;
  IF s = 'read'      THEN RETURN ARRAY['sent_count','delivered_count','read_count']; END IF;
  IF s = 'replied'   THEN RETURN ARRAY['sent_count','delivered_count','read_count','replied_count']; END IF;
  IF s = 'failed'    THEN RETURN ARRAY['failed_count']; END IF;
  RETURN ARRAY[]::TEXT[];
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION public.broadcast_recipient_aggregate_trigger()
RETURNS TRIGGER AS $$
DECLARE
  old_cols TEXT[];
  new_cols TEXT[];
  c TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    new_cols := _bcast_cols_for_status(NEW.status);
    FOREACH c IN ARRAY new_cols LOOP
      PERFORM _bcast_bump(NEW.broadcast_id, c, 1);
    END LOOP;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    old_cols := _bcast_cols_for_status(OLD.status);
    FOREACH c IN ARRAY old_cols LOOP
      PERFORM _bcast_bump(OLD.broadcast_id, c, -1);
    END LOOP;
    RETURN OLD;
  END IF;

  -- UPDATE: only care if status changed.
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    old_cols := _bcast_cols_for_status(OLD.status);
    new_cols := _bcast_cols_for_status(NEW.status);
    -- Subtract the old contributions, add the new.
    FOREACH c IN ARRAY old_cols LOOP
      PERFORM _bcast_bump(NEW.broadcast_id, c, -1);
    END LOOP;
    FOREACH c IN ARRAY new_cols LOOP
      PERFORM _bcast_bump(NEW.broadcast_id, c, 1);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.recompute_broadcast_counts(bid UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE broadcasts b SET
    sent_count      = agg.sent_count,
    delivered_count = agg.delivered_count,
    read_count      = agg.read_count,
    replied_count   = agg.replied_count,
    failed_count    = agg.failed_count,
    updated_at      = NOW()
  FROM (
    SELECT
      COUNT(*) FILTER (WHERE status IN ('sent','delivered','read','replied')) AS sent_count,
      COUNT(*) FILTER (WHERE status IN ('delivered','read','replied'))        AS delivered_count,
      COUNT(*) FILTER (WHERE status IN ('read','replied'))                    AS read_count,
      COUNT(*) FILTER (WHERE status = 'replied')                              AS replied_count,
      COUNT(*) FILTER (WHERE status = 'failed')                               AS failed_count
    FROM broadcast_recipients
    WHERE broadcast_id = bid
  ) agg
  WHERE b.id = bid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- Domain evolution 006


CREATE TABLE IF NOT EXISTS automations (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  trigger_type TEXT NOT NULL,
  trigger_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  execution_count INTEGER NOT NULL DEFAULT 0,
  last_executed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automations_user_id ON automations(user_id);

CREATE INDEX IF NOT EXISTS idx_automations_active_trigger
  ON automations(trigger_type) WHERE is_active = TRUE;

ALTER TABLE automations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own automations" ON automations;

CREATE POLICY "Users can manage own automations" ON automations FOR ALL
  USING (app.current_user_id() = user_id);

DROP TRIGGER IF EXISTS set_updated_at ON automations;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON automations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS automation_steps (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  automation_id UUID NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  parent_step_id UUID REFERENCES automation_steps(id) ON DELETE CASCADE,
  branch TEXT CHECK (branch IN ('yes', 'no')),
  step_type TEXT NOT NULL,
  step_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  position INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_steps_automation_id
  ON automation_steps(automation_id, position);

CREATE INDEX IF NOT EXISTS idx_automation_steps_parent
  ON automation_steps(parent_step_id) WHERE parent_step_id IS NOT NULL;

ALTER TABLE automation_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage steps of own automations" ON automation_steps;

CREATE POLICY "Users can manage steps of own automations" ON automation_steps FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM automations a
      WHERE a.id = automation_steps.automation_id
        AND a.user_id = app.current_user_id()
    )
  );

CREATE TABLE IF NOT EXISTS automation_logs (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  automation_id UUID NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  trigger_event TEXT NOT NULL,
  steps_executed JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('success', 'partial', 'failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_logs_automation
  ON automation_logs(automation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_logs_user ON automation_logs(user_id);

ALTER TABLE automation_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own automation logs" ON automation_logs;

CREATE POLICY "Users can view own automation logs" ON automation_logs FOR ALL
  USING (app.current_user_id() = user_id);

CREATE TABLE IF NOT EXISTS automation_pending_executions (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  automation_id UUID NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  log_id UUID REFERENCES automation_logs(id) ON DELETE CASCADE,
  parent_step_id UUID REFERENCES automation_steps(id) ON DELETE SET NULL,
  branch TEXT CHECK (branch IN ('yes', 'no')),
  next_step_position INTEGER NOT NULL,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'done', 'failed')),
  run_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_pending_due
  ON automation_pending_executions(run_at) WHERE status = 'pending';

ALTER TABLE automation_pending_executions ENABLE ROW LEVEL SECURITY;


-- Domain evolution 007


CREATE OR REPLACE FUNCTION increment_automation_execution_count(p_automation_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE automations
  SET
    execution_count = execution_count + 1,
    last_executed_at = NOW()
  WHERE id = p_automation_id;
$$;

REVOKE ALL ON FUNCTION increment_automation_execution_count(UUID) FROM PUBLIC;

REVOKE ALL ON FUNCTION increment_automation_execution_count(UUID) FROM PUBLIC;

REVOKE ALL ON FUNCTION increment_automation_execution_count(UUID) FROM omni_app;

GRANT EXECUTE ON FUNCTION increment_automation_execution_count(UUID) TO omni_worker;


-- Domain evolution 008



-- Domain evolution 009


ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS reply_to_message_id UUID
  REFERENCES messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_messages_reply_to
  ON messages(reply_to_message_id)
  WHERE reply_to_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS message_reactions (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('customer', 'agent')),
  actor_id UUID,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (message_id, actor_type, actor_id)
);

CREATE INDEX IF NOT EXISTS idx_message_reactions_conversation
  ON message_reactions(conversation_id);

CREATE INDEX IF NOT EXISTS idx_message_reactions_message
  ON message_reactions(message_id);

ALTER TABLE message_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see reactions on their conversations" ON message_reactions;

CREATE POLICY "Users see reactions on their conversations" ON message_reactions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = message_reactions.conversation_id
      AND c.user_id = app.current_user_id()
  ));

DROP POLICY IF EXISTS "Users insert reactions on their conversations" ON message_reactions;

CREATE POLICY "Users insert reactions on their conversations" ON message_reactions FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = message_reactions.conversation_id
      AND c.user_id = app.current_user_id()
  ));

DROP POLICY IF EXISTS "Users delete their own agent reactions" ON message_reactions;

CREATE POLICY "Users delete their own agent reactions" ON message_reactions FOR DELETE
  USING (
    actor_type = 'agent'
    AND actor_id = app.current_user_id()
    AND EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = message_reactions.conversation_id
        AND c.user_id = app.current_user_id()
    )
  );

DROP POLICY IF EXISTS "Users update their own agent reactions" ON message_reactions;

CREATE POLICY "Users update their own agent reactions" ON message_reactions FOR UPDATE
  USING (
    actor_type = 'agent'
    AND actor_id = app.current_user_id()
    AND EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = message_reactions.conversation_id
        AND c.user_id = app.current_user_id()
    )
  );


-- Domain evolution 010


ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_content_type_check;

ALTER TABLE messages
  ADD CONSTRAINT messages_content_type_check
  CHECK (content_type IN (
    'text', 'image', 'document', 'audio', 'video',
    'location', 'template', 'interactive'
  ));

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS interactive_reply_id TEXT;

CREATE TABLE IF NOT EXISTS flows (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'archived')),
  trigger_type TEXT NOT NULL
    CHECK (trigger_type IN ('keyword', 'first_inbound_message', 'manual')),
  trigger_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  
  
  
  entry_node_id TEXT,
  fallback_policy JSONB NOT NULL DEFAULT
    '{"on_unknown_reply":"reprompt","max_reprompts":2,"on_timeout_hours":24,"on_exhaust":"handoff"}'::jsonb,
  execution_count INTEGER NOT NULL DEFAULT 0,
  last_executed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flows_active_trigger
  ON flows(user_id, trigger_type)
  WHERE status = 'active';

ALTER TABLE flows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own flows" ON flows;

CREATE POLICY "Users can manage own flows" ON flows FOR ALL
  USING (app.current_user_id() = user_id);

CREATE TABLE IF NOT EXISTS flow_nodes (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  flow_id UUID NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  node_key TEXT NOT NULL,
  node_type TEXT NOT NULL CHECK (node_type IN (
    'start',
    'send_buttons',
    'send_list',
    'send_message',
    'collect_input',
    'condition',
    'set_tag',
    'handoff',
    'http_fetch',
    'end'
  )),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  
  
  
  position_x INTEGER NOT NULL DEFAULT 0,
  position_y INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (flow_id, node_key)
);

CREATE INDEX IF NOT EXISTS idx_flow_nodes_flow
  ON flow_nodes(flow_id);

ALTER TABLE flow_nodes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage nodes on their flows" ON flow_nodes;

CREATE POLICY "Users manage nodes on their flows" ON flow_nodes FOR ALL
  USING (EXISTS (
    SELECT 1 FROM flows f
    WHERE f.id = flow_nodes.flow_id
      AND f.user_id = app.current_user_id()
  ));

CREATE TABLE IF NOT EXISTS flow_runs (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  flow_id UUID NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  
  
  
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
    'active',           
    'completed',        
    'handed_off',       
    'timed_out',        
    'paused_by_agent',  
    'failed'            
  )),
  current_node_key TEXT,
  last_prompt_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  
  
  vars JSONB NOT NULL DEFAULT '{}'::jsonb,
  reprompt_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_advanced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  end_reason TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_run_per_contact
  ON flow_runs(user_id, contact_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_flow_runs_active_advanced
  ON flow_runs(last_advanced_at)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_flow_runs_flow_started
  ON flow_runs(flow_id, started_at DESC);

ALTER TABLE flow_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own flow runs" ON flow_runs;

CREATE POLICY "Users see own flow runs" ON flow_runs FOR SELECT
  USING (app.current_user_id() = user_id);

CREATE TABLE IF NOT EXISTS flow_run_events (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  flow_run_id UUID NOT NULL REFERENCES flow_runs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'started',
    'node_entered',
    'message_sent',
    'reply_received',
    'fallback_fired',
    'handoff',
    'timeout',
    'error',
    'completed'
  )),
  node_key TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flow_run_events_run_type
  ON flow_run_events(flow_run_id, event_type);

CREATE INDEX IF NOT EXISTS idx_flow_run_events_run_time
  ON flow_run_events(flow_run_id, created_at DESC);

ALTER TABLE flow_run_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see events on their runs" ON flow_run_events;

CREATE POLICY "Users see events on their runs" ON flow_run_events FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM flow_runs r
    WHERE r.id = flow_run_events.flow_run_id
      AND r.user_id = app.current_user_id()
  ));

DROP TRIGGER IF EXISTS set_updated_at ON flows;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON flows
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- Domain evolution 011


ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS beta_features TEXT[]
    NOT NULL
    DEFAULT ARRAY[]::TEXT[];


-- Domain evolution 012


CREATE OR REPLACE FUNCTION increment_flow_execution_count(p_flow_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE flows
  SET
    execution_count = execution_count + 1,
    last_executed_at = NOW()
  WHERE id = p_flow_id;
$$;

REVOKE ALL ON FUNCTION increment_flow_execution_count(UUID) FROM PUBLIC;

REVOKE ALL ON FUNCTION increment_flow_execution_count(UUID) FROM PUBLIC;

REVOKE ALL ON FUNCTION increment_flow_execution_count(UUID) FROM omni_app;

GRANT EXECUTE ON FUNCTION increment_flow_execution_count(UUID) TO omni_worker;


-- Domain evolution 013


DO $$
DECLARE
  conflict_count INT;
  sample TEXT;
BEGIN
  SELECT count(*) INTO conflict_count
  FROM (
    SELECT phone_number_id
    FROM whatsapp_config
    GROUP BY phone_number_id
    HAVING count(*) > 1
  ) dupes;

  IF conflict_count > 0 THEN
    SELECT string_agg(
      phone_number_id || ' -> [' || array_to_string(owners, ', ') || ']',
      E'\n  '
    )
    INTO sample
    FROM (
      SELECT phone_number_id, array_agg(user_id::text) AS owners
      FROM whatsapp_config
      GROUP BY phone_number_id
      HAVING count(*) > 1
    ) dupe_detail;

    RAISE EXCEPTION
      E'Cannot add UNIQUE(phone_number_id) on whatsapp_config — % phone_number_id value(s) are claimed by more than one user:\n  %\nDelete the duplicate rows you do not want to keep (see migration comment), then re-run migrations.',
      conflict_count,
      sample;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'whatsapp_config_phone_number_id_key'
      AND conrelid = 'whatsapp_config'::regclass
  ) THEN
    ALTER TABLE whatsapp_config
      ADD CONSTRAINT whatsapp_config_phone_number_id_key
      UNIQUE (phone_number_id);
  END IF;
END $$;


-- Domain evolution 014


ALTER TABLE message_templates
  ADD COLUMN IF NOT EXISTS sample_values JSONB,
  ADD COLUMN IF NOT EXISTS meta_template_id TEXT,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS quality_score TEXT,
  ADD COLUMN IF NOT EXISTS header_handle TEXT,
  ADD COLUMN IF NOT EXISTS header_media_url TEXT,
  ADD COLUMN IF NOT EXISTS submission_error TEXT,
  ADD COLUMN IF NOT EXISTS last_submitted_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'message_templates_quality_score_check'
      AND conrelid = 'message_templates'::regclass
  ) THEN
    ALTER TABLE message_templates
      ADD CONSTRAINT message_templates_quality_score_check
      CHECK (quality_score IS NULL OR quality_score IN ('GREEN', 'YELLOW', 'RED'));
  END IF;
END $$;

DO $$
BEGIN
  -- Drop the legacy check by introspecting pg_constraint (the original
  -- constraint name from migration 001 is auto-generated; match by
  -- column + table).
  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid = 'message_templates'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%status%Draft%Pending%Approved%Rejected%'
  ) THEN
    EXECUTE (
      SELECT 'ALTER TABLE message_templates DROP CONSTRAINT ' || quote_ident(conname)
      FROM pg_constraint c
      WHERE c.conrelid = 'message_templates'::regclass
        AND c.contype = 'c'
        AND pg_get_constraintdef(c.oid) ILIKE '%status%Draft%Pending%Approved%Rejected%'
      LIMIT 1
    );
  END IF;
END $$;

UPDATE message_templates SET status = 'DRAFT'    WHERE status = 'Draft';

UPDATE message_templates SET status = 'PENDING'  WHERE status = 'Pending';

UPDATE message_templates SET status = 'APPROVED' WHERE status = 'Approved';

UPDATE message_templates SET status = 'REJECTED' WHERE status = 'Rejected';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'message_templates_status_meta_check'
      AND conrelid = 'message_templates'::regclass
  ) THEN
    ALTER TABLE message_templates
      ADD CONSTRAINT message_templates_status_meta_check
      CHECK (status IN (
        'DRAFT',
        'PENDING',
        'APPROVED',
        'REJECTED',
        'PAUSED',
        'DISABLED',
        'IN_APPEAL',
        'PENDING_DELETION'
      ));
  END IF;
END $$;

ALTER TABLE message_templates ALTER COLUMN status SET DEFAULT 'DRAFT';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'message_templates_buttons_shape_check'
      AND conrelid = 'message_templates'::regclass
  ) THEN
    ALTER TABLE message_templates
      ADD CONSTRAINT message_templates_buttons_shape_check
      CHECK (
        buttons IS NULL
        OR (
          jsonb_typeof(buttons) = 'array'
          AND jsonb_array_length(buttons) <= 10
        )
      );
  END IF;
END $$;

DO $$
DECLARE
  dupe_count INT;
  sample TEXT;
BEGIN
  SELECT count(*) INTO dupe_count
  FROM (
    SELECT user_id, name, language
    FROM message_templates
    GROUP BY user_id, name, language
    HAVING count(*) > 1
  ) dupes;

  IF dupe_count > 0 THEN
    SELECT string_agg(
      user_id::text || ' / ' || name || ' / ' || COALESCE(language, '(null)') ||
        ' (' || count || ' rows)',
      E'\n  '
    )
    INTO sample
    FROM (
      SELECT user_id, name, language, count(*) AS count
      FROM message_templates
      GROUP BY user_id, name, language
      HAVING count(*) > 1
    ) dupe_detail;

    RAISE EXCEPTION
      E'Cannot add UNIQUE(user_id, name, language) on message_templates — % duplicate combination(s):\n  %\nDelete the rows you do not want to keep, then re-run migrations.',
      dupe_count, sample;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS message_templates_user_name_language_key
  ON message_templates (user_id, name, language);

CREATE INDEX IF NOT EXISTS idx_message_templates_meta_template_id
  ON message_templates (meta_template_id)
  WHERE meta_template_id IS NOT NULL;


-- Domain evolution 015


ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS registered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS subscribed_apps_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_registration_error TEXT;

CREATE INDEX IF NOT EXISTS idx_whatsapp_config_registered_at
  ON whatsapp_config (registered_at)
  WHERE registered_at IS NULL;


-- Domain evolution 016


ALTER TABLE flow_nodes
  DROP CONSTRAINT IF EXISTS flow_nodes_node_type_check;

ALTER TABLE flow_nodes
  ADD CONSTRAINT flow_nodes_node_type_check
  CHECK (node_type IN (
    'start',
    'send_buttons',
    'send_list',
    'send_message',
    'send_media',
    'collect_input',
    'condition',
    'set_tag',
    'handoff',
    'http_fetch',
    'end'
  ));


-- Domain evolution 017


DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_role_enum') THEN
    CREATE TYPE account_role_enum AS ENUM ('owner', 'admin', 'agent', 'viewer');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  name TEXT NOT NULL,
  
  
  
  owner_user_id UUID NOT NULL REFERENCES identity.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_one_per_owner
  ON accounts(owner_user_id);

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON accounts;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS account_invitations (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  role account_role_enum NOT NULL CHECK (role <> 'owner'),
  created_by_user_id UUID REFERENCES identity.users(id) ON DELETE SET NULL,
  label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  accepted_by_user_id UUID REFERENCES identity.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_account_invitations_account_pending
  ON account_invitations(account_id, expires_at)
  WHERE accepted_at IS NULL;

ALTER TABLE account_invitations ENABLE ROW LEVEL SECURITY;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS account_role account_role_enum;

CREATE INDEX IF NOT EXISTS idx_profiles_account_role
  ON profiles(account_id, account_role);

CREATE OR REPLACE FUNCTION is_account_member(
  target_account_id UUID,
  min_role account_role_enum DEFAULT 'viewer'
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    WHERE p.user_id = app.current_user_id()
      AND p.account_id = target_account_id
      AND CASE p.account_role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END
        >=
          CASE min_role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END
  );
$$;

ALTER FUNCTION is_account_member(UUID, account_role_enum) OWNER TO omni_owner;

GRANT EXECUTE ON FUNCTION is_account_member(UUID, account_role_enum) TO omni_app, omni_worker;

ALTER TABLE contacts                       ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id) ON DELETE CASCADE;

ALTER TABLE tags                           ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id) ON DELETE CASCADE;

ALTER TABLE custom_fields                  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id) ON DELETE CASCADE;

ALTER TABLE contact_notes                  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id) ON DELETE CASCADE;

ALTER TABLE conversations                  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id) ON DELETE CASCADE;

ALTER TABLE whatsapp_config                ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id) ON DELETE CASCADE;

ALTER TABLE message_templates              ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id) ON DELETE CASCADE;

ALTER TABLE pipelines                      ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id) ON DELETE CASCADE;

ALTER TABLE deals                          ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id) ON DELETE CASCADE;

ALTER TABLE broadcasts                     ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id) ON DELETE CASCADE;

ALTER TABLE automations                    ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id) ON DELETE CASCADE;

ALTER TABLE automation_logs                ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id) ON DELETE CASCADE;

ALTER TABLE automation_pending_executions  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id) ON DELETE CASCADE;

ALTER TABLE flows                          ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id) ON DELETE CASCADE;

ALTER TABLE flow_runs                      ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES accounts(id) ON DELETE CASCADE;

DO $$
DECLARE
  v_table TEXT;
  v_tables TEXT[] := ARRAY[
    'contacts', 'tags', 'custom_fields', 'contact_notes',
    'conversations', 'whatsapp_config', 'message_templates',
    'pipelines', 'deals', 'broadcasts',
    'automations', 'automation_logs', 'automation_pending_executions',
    'flows', 'flow_runs'
  ];
BEGIN
  -- (0) Heal orphaned users. The pre-017 signup trigger (migration
  -- 001) inserted the profile inside an `EXCEPTION WHEN OTHERS ...
  -- RAISE WARNING; RETURN NEW` block, so a signup could leave an
  -- identity.users row with no matching profiles row. Those orphans would
  -- be skipped by step (1) below, get no account, and — if they own
  -- any domain rows (pre-017 RLS only required app.current_user_id() = user_id,
  -- not a profile) — leave account_id NULL and abort the SET NOT NULL
  -- step. Backfilling the missing profile first keys the whole backfill
  -- off identity.users instead of profiles, so every omni_app user is
  -- migrated and no domain row can be left without an account.
  -- full_name / email are NOT NULL on profiles, hence the COALESCE.
  INSERT INTO public.profiles (user_id, full_name, email)
  SELECT u.id,
         COALESCE(u.name, ''),
         COALESCE(u.email, '')
  FROM identity.users u
  WHERE NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.user_id = u.id
  );

  -- (1) Create one account per existing profile whose user does not
  -- yet own one. Idempotent: skips users that already have an account.
  INSERT INTO accounts (name, owner_user_id)
  SELECT COALESCE(NULLIF(p.full_name, ''), p.email, 'My account'),
         p.user_id
  FROM profiles p
  WHERE NOT EXISTS (
    SELECT 1 FROM accounts a WHERE a.owner_user_id = p.user_id
  );

  -- (2) Stamp profile.account_id / account_role for every profile that
  -- hasn't been linked yet.
  UPDATE profiles p
  SET account_id   = a.id,
      account_role = 'owner'
  FROM accounts a
  WHERE a.owner_user_id = p.user_id
    AND p.account_id IS NULL;

  -- (3) Propagate account_id to every domain table. Uses the row's
  -- existing user_id → profiles.user_id → profiles.account_id chain.
  -- Only updates rows where account_id IS NULL so a re-run is cheap.
  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format($f$
      UPDATE %I t
      SET account_id = p.account_id
      FROM profiles p
      WHERE t.user_id = p.user_id
        AND t.account_id IS NULL
    $f$, v_table);
  END LOOP;
END $$;

ALTER TABLE profiles                       ALTER COLUMN account_id   SET NOT NULL;

ALTER TABLE profiles                       ALTER COLUMN account_role SET NOT NULL;

ALTER TABLE contacts                       ALTER COLUMN account_id   SET NOT NULL;

ALTER TABLE tags                           ALTER COLUMN account_id   SET NOT NULL;

ALTER TABLE custom_fields                  ALTER COLUMN account_id   SET NOT NULL;

ALTER TABLE contact_notes                  ALTER COLUMN account_id   SET NOT NULL;

ALTER TABLE conversations                  ALTER COLUMN account_id   SET NOT NULL;

ALTER TABLE whatsapp_config                ALTER COLUMN account_id   SET NOT NULL;

ALTER TABLE message_templates              ALTER COLUMN account_id   SET NOT NULL;

ALTER TABLE pipelines                      ALTER COLUMN account_id   SET NOT NULL;

ALTER TABLE deals                          ALTER COLUMN account_id   SET NOT NULL;

ALTER TABLE broadcasts                     ALTER COLUMN account_id   SET NOT NULL;

ALTER TABLE automations                    ALTER COLUMN account_id   SET NOT NULL;

ALTER TABLE automation_logs                ALTER COLUMN account_id   SET NOT NULL;

ALTER TABLE automation_pending_executions  ALTER COLUMN account_id   SET NOT NULL;

ALTER TABLE flows                          ALTER COLUMN account_id   SET NOT NULL;

ALTER TABLE flow_runs                      ALTER COLUMN account_id   SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_account                ON contacts(account_id);

CREATE INDEX IF NOT EXISTS idx_tags_account                    ON tags(account_id);

CREATE INDEX IF NOT EXISTS idx_custom_fields_account           ON custom_fields(account_id);

CREATE INDEX IF NOT EXISTS idx_contact_notes_account           ON contact_notes(account_id);

CREATE INDEX IF NOT EXISTS idx_conversations_account           ON conversations(account_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_config_account         ON whatsapp_config(account_id);

CREATE INDEX IF NOT EXISTS idx_message_templates_account       ON message_templates(account_id);

CREATE INDEX IF NOT EXISTS idx_pipelines_account               ON pipelines(account_id);

CREATE INDEX IF NOT EXISTS idx_deals_account                   ON deals(account_id);

CREATE INDEX IF NOT EXISTS idx_broadcasts_account              ON broadcasts(account_id);

CREATE INDEX IF NOT EXISTS idx_automations_account             ON automations(account_id);

CREATE INDEX IF NOT EXISTS idx_automation_logs_account         ON automation_logs(account_id);

CREATE INDEX IF NOT EXISTS idx_automation_pending_account      ON automation_pending_executions(account_id);

CREATE INDEX IF NOT EXISTS idx_flows_account                   ON flows(account_id);

CREATE INDEX IF NOT EXISTS idx_flow_runs_account               ON flow_runs(account_id);

ALTER TABLE whatsapp_config DROP CONSTRAINT IF EXISTS whatsapp_config_user_id_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'whatsapp_config_account_id_key'
  ) THEN
    ALTER TABLE whatsapp_config ADD CONSTRAINT whatsapp_config_account_id_key UNIQUE (account_id);
  END IF;
END $$;

DROP INDEX IF EXISTS idx_one_active_run_per_contact;

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_run_per_contact
  ON flow_runs(account_id, contact_id)
  WHERE status = 'active';

DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY (ARRAY[
        'contacts', 'tags', 'custom_fields', 'contact_notes',
        'conversations', 'whatsapp_config', 'message_templates',
        'pipelines', 'deals', 'broadcasts', 'automations',
        'automation_logs', 'flows', 'flow_runs', 'contact_tags',
        'contact_custom_values', 'messages', 'pipeline_stages',
        'broadcast_recipients', 'automation_steps', 'flow_nodes',
        'flow_run_events', 'message_reactions', 'profiles',
        'accounts', 'account_invitations'
      ])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, pol.tablename);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "Users can manage own contacts" ON contacts;

CREATE POLICY contacts_select ON contacts FOR SELECT USING (is_account_member(account_id));

CREATE POLICY contacts_insert ON contacts FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));

CREATE POLICY contacts_update ON contacts FOR UPDATE USING (is_account_member(account_id, 'agent'));

CREATE POLICY contacts_delete ON contacts FOR DELETE USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS "Users can manage own tags" ON tags;

CREATE POLICY tags_select ON tags FOR SELECT USING (is_account_member(account_id));

CREATE POLICY tags_insert ON tags FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));

CREATE POLICY tags_update ON tags FOR UPDATE USING (is_account_member(account_id, 'admin'));

CREATE POLICY tags_delete ON tags FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS "Users can manage own custom fields" ON custom_fields;

CREATE POLICY custom_fields_select ON custom_fields FOR SELECT USING (is_account_member(account_id));

CREATE POLICY custom_fields_insert ON custom_fields FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));

CREATE POLICY custom_fields_update ON custom_fields FOR UPDATE USING (is_account_member(account_id, 'admin'));

CREATE POLICY custom_fields_delete ON custom_fields FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS "Users can manage own notes" ON contact_notes;

CREATE POLICY contact_notes_select ON contact_notes FOR SELECT USING (is_account_member(account_id));

CREATE POLICY contact_notes_insert ON contact_notes FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));

CREATE POLICY contact_notes_update ON contact_notes FOR UPDATE USING (is_account_member(account_id, 'agent'));

CREATE POLICY contact_notes_delete ON contact_notes FOR DELETE USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS "Users can manage own conversations" ON conversations;

CREATE POLICY conversations_select ON conversations FOR SELECT USING (is_account_member(account_id));

CREATE POLICY conversations_insert ON conversations FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));

CREATE POLICY conversations_update ON conversations FOR UPDATE USING (is_account_member(account_id, 'agent'));

CREATE POLICY conversations_delete ON conversations FOR DELETE USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS "Users can manage own config" ON whatsapp_config;

CREATE POLICY whatsapp_config_select ON whatsapp_config FOR SELECT USING (is_account_member(account_id));

CREATE POLICY whatsapp_config_insert ON whatsapp_config FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));

CREATE POLICY whatsapp_config_update ON whatsapp_config FOR UPDATE USING (is_account_member(account_id, 'admin'));

CREATE POLICY whatsapp_config_delete ON whatsapp_config FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS "Users can manage own templates" ON message_templates;

CREATE POLICY message_templates_select ON message_templates FOR SELECT USING (is_account_member(account_id));

CREATE POLICY message_templates_insert ON message_templates FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));

CREATE POLICY message_templates_update ON message_templates FOR UPDATE USING (is_account_member(account_id, 'admin'));

CREATE POLICY message_templates_delete ON message_templates FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS "Users can manage own pipelines" ON pipelines;

CREATE POLICY pipelines_select ON pipelines FOR SELECT USING (is_account_member(account_id));

CREATE POLICY pipelines_insert ON pipelines FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));

CREATE POLICY pipelines_update ON pipelines FOR UPDATE USING (is_account_member(account_id, 'admin'));

CREATE POLICY pipelines_delete ON pipelines FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS "Users can manage own deals" ON deals;

CREATE POLICY deals_select ON deals FOR SELECT USING (is_account_member(account_id));

CREATE POLICY deals_insert ON deals FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));

CREATE POLICY deals_update ON deals FOR UPDATE USING (is_account_member(account_id, 'agent'));

CREATE POLICY deals_delete ON deals FOR DELETE USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS "Users can manage own broadcasts" ON broadcasts;

CREATE POLICY broadcasts_select ON broadcasts FOR SELECT USING (is_account_member(account_id));

CREATE POLICY broadcasts_insert ON broadcasts FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));

CREATE POLICY broadcasts_update ON broadcasts FOR UPDATE USING (is_account_member(account_id, 'agent'));

CREATE POLICY broadcasts_delete ON broadcasts FOR DELETE USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS "Users can manage own automations" ON automations;

CREATE POLICY automations_select ON automations FOR SELECT USING (is_account_member(account_id));

CREATE POLICY automations_insert ON automations FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));

CREATE POLICY automations_update ON automations FOR UPDATE USING (is_account_member(account_id, 'agent'));

CREATE POLICY automations_delete ON automations FOR DELETE USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS "Users can view own automation logs" ON automation_logs;

CREATE POLICY automation_logs_select ON automation_logs FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS "Users can manage own flows" ON flows;

CREATE POLICY flows_select ON flows FOR SELECT USING (is_account_member(account_id));

CREATE POLICY flows_insert ON flows FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));

CREATE POLICY flows_update ON flows FOR UPDATE USING (is_account_member(account_id, 'agent'));

CREATE POLICY flows_delete ON flows FOR DELETE USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS "Users see own flow runs" ON flow_runs;

CREATE POLICY flow_runs_select ON flow_runs FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS "Users can manage contact tags" ON contact_tags;

CREATE POLICY contact_tags_select ON contact_tags FOR SELECT USING (
  EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_tags.contact_id AND is_account_member(c.account_id))
);

CREATE POLICY contact_tags_modify ON contact_tags FOR ALL USING (
  EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_tags.contact_id AND is_account_member(c.account_id, 'agent'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_tags.contact_id AND is_account_member(c.account_id, 'agent'))
);

DROP POLICY IF EXISTS "Users can manage custom values" ON contact_custom_values;

CREATE POLICY contact_custom_values_select ON contact_custom_values FOR SELECT USING (
  EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_custom_values.contact_id AND is_account_member(c.account_id))
);

CREATE POLICY contact_custom_values_modify ON contact_custom_values FOR ALL USING (
  EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_custom_values.contact_id AND is_account_member(c.account_id, 'agent'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_custom_values.contact_id AND is_account_member(c.account_id, 'agent'))
);

DROP POLICY IF EXISTS "Users can view own messages" ON messages;

DROP POLICY IF EXISTS "Service role can insert messages" ON messages;

CREATE POLICY messages_select ON messages FOR SELECT USING (
  EXISTS (SELECT 1 FROM conversations c WHERE c.id = messages.conversation_id AND is_account_member(c.account_id))
);

CREATE POLICY messages_modify ON messages FOR ALL USING (
  EXISTS (SELECT 1 FROM conversations c WHERE c.id = messages.conversation_id AND is_account_member(c.account_id, 'agent'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM conversations c WHERE c.id = messages.conversation_id AND is_account_member(c.account_id, 'agent'))
);

DROP POLICY IF EXISTS "Users can manage pipeline stages" ON pipeline_stages;

CREATE POLICY pipeline_stages_select ON pipeline_stages FOR SELECT USING (
  EXISTS (SELECT 1 FROM pipelines p WHERE p.id = pipeline_stages.pipeline_id AND is_account_member(p.account_id))
);

CREATE POLICY pipeline_stages_modify ON pipeline_stages FOR ALL USING (
  EXISTS (SELECT 1 FROM pipelines p WHERE p.id = pipeline_stages.pipeline_id AND is_account_member(p.account_id, 'admin'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM pipelines p WHERE p.id = pipeline_stages.pipeline_id AND is_account_member(p.account_id, 'admin'))
);

DROP POLICY IF EXISTS "Users can manage broadcast recipients" ON broadcast_recipients;

CREATE POLICY broadcast_recipients_select ON broadcast_recipients FOR SELECT USING (
  EXISTS (SELECT 1 FROM broadcasts b WHERE b.id = broadcast_recipients.broadcast_id AND is_account_member(b.account_id))
);

CREATE POLICY broadcast_recipients_modify ON broadcast_recipients FOR ALL USING (
  EXISTS (SELECT 1 FROM broadcasts b WHERE b.id = broadcast_recipients.broadcast_id AND is_account_member(b.account_id, 'agent'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM broadcasts b WHERE b.id = broadcast_recipients.broadcast_id AND is_account_member(b.account_id, 'agent'))
);

DROP POLICY IF EXISTS "Users can manage steps of own automations" ON automation_steps;

CREATE POLICY automation_steps_select ON automation_steps FOR SELECT USING (
  EXISTS (SELECT 1 FROM automations a WHERE a.id = automation_steps.automation_id AND is_account_member(a.account_id))
);

CREATE POLICY automation_steps_modify ON automation_steps FOR ALL USING (
  EXISTS (SELECT 1 FROM automations a WHERE a.id = automation_steps.automation_id AND is_account_member(a.account_id, 'agent'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM automations a WHERE a.id = automation_steps.automation_id AND is_account_member(a.account_id, 'agent'))
);

DROP POLICY IF EXISTS "Users manage nodes on their flows" ON flow_nodes;

CREATE POLICY flow_nodes_select ON flow_nodes FOR SELECT USING (
  EXISTS (SELECT 1 FROM flows f WHERE f.id = flow_nodes.flow_id AND is_account_member(f.account_id))
);

CREATE POLICY flow_nodes_modify ON flow_nodes FOR ALL USING (
  EXISTS (SELECT 1 FROM flows f WHERE f.id = flow_nodes.flow_id AND is_account_member(f.account_id, 'agent'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM flows f WHERE f.id = flow_nodes.flow_id AND is_account_member(f.account_id, 'agent'))
);

DROP POLICY IF EXISTS "Users see events on their runs" ON flow_run_events;

CREATE POLICY flow_run_events_select ON flow_run_events FOR SELECT USING (
  EXISTS (SELECT 1 FROM flow_runs r WHERE r.id = flow_run_events.flow_run_id AND is_account_member(r.account_id))
);

DROP POLICY IF EXISTS "Users see reactions on their conversations" ON message_reactions;

DROP POLICY IF EXISTS "Users insert reactions on their conversations" ON message_reactions;

DROP POLICY IF EXISTS "Users delete their own agent reactions" ON message_reactions;

DROP POLICY IF EXISTS "Users update their own agent reactions" ON message_reactions;

CREATE POLICY message_reactions_select ON message_reactions FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.id = message_reactions.message_id
      AND is_account_member(c.account_id)
  )
);

CREATE POLICY message_reactions_modify ON message_reactions FOR ALL USING (
  EXISTS (
    SELECT 1 FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.id = message_reactions.message_id
      AND is_account_member(c.account_id, 'agent')
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.id = message_reactions.message_id
      AND is_account_member(c.account_id, 'agent')
  )
);

DROP POLICY IF EXISTS "Users can view own profile" ON profiles;

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;

DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;

CREATE POLICY profiles_select ON profiles FOR SELECT
  USING (app.current_user_id() = user_id OR is_account_member(account_id));

CREATE POLICY profiles_update ON profiles FOR UPDATE
  USING (app.current_user_id() = user_id)
  WITH CHECK (app.current_user_id() = user_id);

CREATE POLICY profiles_insert ON profiles FOR INSERT
  WITH CHECK (app.current_user_id() = user_id);

DROP POLICY IF EXISTS accounts_select ON accounts;

DROP POLICY IF EXISTS accounts_update ON accounts;

CREATE POLICY accounts_select ON accounts FOR SELECT
  USING (is_account_member(id));

CREATE POLICY accounts_update ON accounts FOR UPDATE
  USING (is_account_member(id, 'admin'))
  WITH CHECK (is_account_member(id, 'admin'));

DROP POLICY IF EXISTS account_invitations_select ON account_invitations;

DROP POLICY IF EXISTS account_invitations_modify ON account_invitations;

CREATE POLICY account_invitations_select ON account_invitations FOR SELECT
  USING (is_account_member(account_id, 'admin'));

CREATE POLICY account_invitations_modify ON account_invitations FOR ALL
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS on_auth_user_created ON identity.users;

DROP FUNCTION IF EXISTS public.handle_new_user();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name TEXT;
  v_account_id UUID;
BEGIN
  v_full_name := COALESCE(NEW.name, '');

  INSERT INTO public.accounts (name, owner_user_id)
  VALUES (COALESCE(NULLIF(v_full_name, ''), NEW.email, 'My account'), NEW.id)
  RETURNING id INTO v_account_id;

  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (NEW.id, v_full_name, NEW.email, v_account_id, 'owner');

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO omni_owner;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON identity.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- Domain evolution 018


CREATE OR REPLACE FUNCTION public.set_member_role(
  p_user_id UUID,
  p_new_role account_role_enum
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_target_account_id UUID;
  v_target_role account_role_enum;
BEGIN
  -- Caller must be omni_app.
  IF app.current_user_id() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Resolve caller's account + role.
  SELECT account_id, account_role
  INTO v_caller_account_id, v_caller_role
  FROM profiles
  WHERE user_id = app.current_user_id();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  -- Caller must be admin+.
  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher'
      USING ERRCODE = '42501';
  END IF;

  -- Can't change own role via this endpoint.
  IF p_user_id = app.current_user_id() THEN
    RAISE EXCEPTION 'Cannot change your own role'
      USING ERRCODE = '22023';
  END IF;

  -- Resolve target.
  SELECT account_id, account_role
  INTO v_target_account_id, v_target_role
  FROM profiles
  WHERE user_id = p_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  -- Target must be in caller's account.
  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  -- Owner role changes go through transfer_account_ownership.
  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'Use transfer_account_ownership to demote an owner'
      USING ERRCODE = '22023';
  END IF;
  IF p_new_role = 'owner' THEN
    RAISE EXCEPTION 'Use transfer_account_ownership to promote to owner'
      USING ERRCODE = '22023';
  END IF;

  UPDATE profiles
  SET account_role = p_new_role
  WHERE user_id = p_user_id;
END;
$$;

ALTER FUNCTION public.set_member_role(UUID, account_role_enum) OWNER TO omni_owner;

REVOKE ALL ON FUNCTION public.set_member_role(UUID, account_role_enum) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.set_member_role(UUID, account_role_enum) TO omni_app;

CREATE OR REPLACE FUNCTION public.remove_account_member(
  p_user_id UUID
) RETURNS UUID  
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_target_account_id UUID;
  v_target_role account_role_enum;
  v_target_name TEXT;
  v_target_email TEXT;
  v_new_account_id UUID;
BEGIN
  IF app.current_user_id() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id, account_role
  INTO v_caller_account_id, v_caller_role
  FROM profiles
  WHERE user_id = app.current_user_id();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id = app.current_user_id() THEN
    RAISE EXCEPTION 'Cannot remove yourself; transfer ownership or leave the account instead'
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id, account_role, full_name, email
  INTO v_target_account_id, v_target_role, v_target_name, v_target_email
  FROM profiles
  WHERE user_id = p_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'Cannot remove the account owner; transfer ownership first'
      USING ERRCODE = '22023';
  END IF;

  -- Spin up a fresh personal account for the removed user. Mirror
  -- of handle_new_user's logic — keep them whole, just relocated.
  INSERT INTO accounts (name, owner_user_id)
  VALUES (
    COALESCE(NULLIF(v_target_name, ''), v_target_email, 'My account'),
    p_user_id
  )
  RETURNING id INTO v_new_account_id;

  UPDATE profiles
  SET account_id = v_new_account_id,
      account_role = 'owner'
  WHERE user_id = p_user_id;

  RETURN v_new_account_id;
END;
$$;

ALTER FUNCTION public.remove_account_member(UUID) OWNER TO omni_owner;

REVOKE ALL ON FUNCTION public.remove_account_member(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.remove_account_member(UUID) TO omni_app;

CREATE OR REPLACE FUNCTION public.transfer_account_ownership(
  p_new_owner_user_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_target_account_id UUID;
  v_target_role account_role_enum;
BEGIN
  IF app.current_user_id() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id, account_role
  INTO v_caller_account_id, v_caller_role
  FROM profiles
  WHERE user_id = app.current_user_id();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  IF v_caller_role <> 'owner' THEN
    RAISE EXCEPTION 'Only the account owner can transfer ownership'
      USING ERRCODE = '42501';
  END IF;

  IF p_new_owner_user_id = app.current_user_id() THEN
    RAISE EXCEPTION 'You are already the owner'
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id, account_role
  INTO v_target_account_id, v_target_role
  FROM profiles
  WHERE user_id = p_new_owner_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account'
      USING ERRCODE = '42501';
  END IF;

  -- Demote current owner first so the temporary state where the
  -- account has zero owners is never visible — both writes happen
  -- in the same function transaction.
  UPDATE profiles SET account_role = 'admin'
  WHERE user_id = app.current_user_id();

  UPDATE profiles SET account_role = 'owner'
  WHERE user_id = p_new_owner_user_id;

  UPDATE accounts SET owner_user_id = p_new_owner_user_id
  WHERE id = v_caller_account_id;
END;
$$;

ALTER FUNCTION public.transfer_account_ownership(UUID) OWNER TO omni_owner;

REVOKE ALL ON FUNCTION public.transfer_account_ownership(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.transfer_account_ownership(UUID) TO omni_app;


-- Domain evolution 019


CREATE OR REPLACE FUNCTION public.peek_invitation(
  p_token_hash TEXT
) RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv account_invitations%ROWTYPE;
  v_account_name TEXT;
BEGIN
  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF v_inv.accepted_at IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'used');
  END IF;

  IF v_inv.expires_at <= NOW() THEN
    RETURN json_build_object('ok', false, 'reason', 'expired');
  END IF;

  SELECT name INTO v_account_name
  FROM accounts
  WHERE id = v_inv.account_id;

  RETURN json_build_object(
    'ok', true,
    'account_name', v_account_name,
    'role', v_inv.role,
    'expires_at', v_inv.expires_at
  );
END;
$$;

ALTER FUNCTION public.peek_invitation(TEXT) OWNER TO omni_owner;

REVOKE ALL ON FUNCTION public.peek_invitation(TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.peek_invitation(TEXT) TO PUBLIC, omni_app;

CREATE OR REPLACE FUNCTION public.redeem_invitation(
  p_token_hash TEXT
) RETURNS UUID  
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := app.current_user_id();
  v_inv account_invitations%ROWTYPE;
  v_old_account_id UUID;
  v_old_account_owner UUID;
  v_has_data BOOLEAN;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023';
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation has already been redeemed'
      USING ERRCODE = '22023';
  END IF;
  IF v_inv.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '22023';
  END IF;

  -- Caller's current account + its owner.
  SELECT p.account_id, a.owner_user_id
  INTO v_old_account_id, v_old_account_owner
  FROM profiles p
  JOIN accounts a ON a.id = p.account_id
  WHERE p.user_id = v_caller_id;

  IF v_old_account_id IS NULL THEN
    -- Defensive — every omni_app user has a profile post-017.
    RAISE EXCEPTION 'Caller has no profile' USING ERRCODE = '42501';
  END IF;

  -- Edge case: the inviter sent themselves a link, or the
  -- caller is somehow already in the inviter's account.
  IF v_old_account_id = v_inv.account_id THEN
    RAISE EXCEPTION 'You are already a member of this account'
      USING ERRCODE = '23505';
  END IF;

  -- Safety: the caller must be the SOLE OWNER of their current
  -- account (i.e. their fresh personal account from signup or a
  -- prior removal). Any other state means they're either:
  --   - a member of another shared account (joining a second
  --     would silently orphan their access to the first), or
  --   - the owner of an account with teammates (they'd abandon
  --     their team to join the inviter's).
  -- Either way, the safe answer is "make a different login".
  IF v_old_account_owner <> v_caller_id THEN
    RAISE EXCEPTION 'You are already in a shared account; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  -- Belt: even if they own their account, refuse if it has any
  -- domain data — joining would orphan their contacts, deals,
  -- broadcasts, automations, flows, templates, etc.
  SELECT EXISTS (
    SELECT 1 FROM contacts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM conversations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM broadcasts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flows WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM pipelines WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM message_templates WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM tags WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM custom_fields WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM contact_notes WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM whatsapp_config WHERE account_id = v_old_account_id
    LIMIT 1
  ) INTO v_has_data;

  IF v_has_data THEN
    RAISE EXCEPTION 'Your account already contains data; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  -- Move the profile first so the cascade-on-delete of the old
  -- account doesn't try to nuke this user's profile too.
  UPDATE profiles
  SET account_id = v_inv.account_id,
      account_role = v_inv.role
  WHERE user_id = v_caller_id;

  UPDATE account_invitations
  SET accepted_at = NOW(),
      accepted_by_user_id = v_caller_id
  WHERE id = v_inv.id;

  -- Clean up the orphan personal account. Empty by the checks
  -- above, so this is purely housekeeping — no cascades fire
  -- because no other rows reference it.
  DELETE FROM accounts WHERE id = v_old_account_id;

  RETURN v_inv.account_id;
END;
$$;

ALTER FUNCTION public.redeem_invitation(TEXT) OWNER TO omni_owner;

REVOKE ALL ON FUNCTION public.redeem_invitation(TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.redeem_invitation(TEXT) TO omni_app;


-- Domain evolution 020


CREATE INDEX IF NOT EXISTS idx_automations_account_active_trigger
  ON automations(account_id, trigger_type)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_flows_account_active
  ON flows(account_id)
  WHERE status = 'active';


-- Domain evolution 021


ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS default_currency TEXT NOT NULL DEFAULT 'USD';

ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_default_currency_format;

ALTER TABLE accounts
  ADD CONSTRAINT accounts_default_currency_format
  CHECK (default_currency ~ '^[A-Z]{3}$');


-- Domain evolution 022


ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS phone_normalized TEXT
  GENERATED ALWAYS AS (regexp_replace(phone, '\D', '', 'g')) STORED;

CREATE OR REPLACE FUNCTION public.merge_duplicate_contacts()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group   RECORD;
  v_survivor UUID;
  v_losers   UUID[];
  v_merged   INTEGER := 0;
BEGIN
  FOR v_group IN
    SELECT account_id,
           phone_normalized,
           array_agg(id ORDER BY created_at ASC, id ASC) AS ids
    FROM contacts
    WHERE phone_normalized <> ''
    GROUP BY account_id, phone_normalized
    HAVING count(*) > 1
  LOOP
    v_survivor := v_group.ids[1];
    v_losers   := v_group.ids[2:array_length(v_group.ids, 1)];

    -- Plain re-point: these tables have no contact-scoped unique
    -- constraint. `conversations` is ON DELETE CASCADE, so this
    -- re-point is what saves its rows (and their messages) from
    -- being deleted with the loser contact.
    UPDATE conversations                 SET contact_id = v_survivor WHERE contact_id = ANY(v_losers);
    UPDATE contact_notes                 SET contact_id = v_survivor WHERE contact_id = ANY(v_losers);
    UPDATE deals                         SET contact_id = v_survivor WHERE contact_id = ANY(v_losers);
    UPDATE broadcast_recipients          SET contact_id = v_survivor WHERE contact_id = ANY(v_losers);
    UPDATE automation_logs               SET contact_id = v_survivor WHERE contact_id = ANY(v_losers);
    UPDATE automation_pending_executions SET contact_id = v_survivor WHERE contact_id = ANY(v_losers);

    -- Conflict-guarded re-point for UNIQUE(contact_id, tag_id):
    -- move only tags the survivor doesn't already have, drop the rest.
    UPDATE contact_tags ct SET contact_id = v_survivor
      WHERE ct.contact_id = ANY(v_losers)
        AND NOT EXISTS (
          SELECT 1 FROM contact_tags s
          WHERE s.contact_id = v_survivor AND s.tag_id = ct.tag_id
        );
    DELETE FROM contact_tags WHERE contact_id = ANY(v_losers);

    -- Same guard for UNIQUE(contact_id, custom_field_id). Survivor's
    -- own value wins on conflict.
    UPDATE contact_custom_values cv SET contact_id = v_survivor
      WHERE cv.contact_id = ANY(v_losers)
        AND NOT EXISTS (
          SELECT 1 FROM contact_custom_values s
          WHERE s.contact_id = v_survivor AND s.custom_field_id = cv.custom_field_id
        );
    DELETE FROM contact_custom_values WHERE contact_id = ANY(v_losers);

    -- flow_runs has a partial UNIQUE on active runs per contact.
    -- Re-point only NON-active runs (exempt from the partial index)
    -- to preserve history; any active loser run is left to be
    -- NULLed by its FK's ON DELETE SET NULL when the loser is
    -- removed below — avoids colliding with the survivor's active run.
    UPDATE flow_runs SET contact_id = v_survivor
      WHERE contact_id = ANY(v_losers) AND status <> 'active';

    DELETE FROM contacts WHERE id = ANY(v_losers);

    v_merged := v_merged + COALESCE(array_length(v_losers, 1), 0);
  END LOOP;

  RETURN v_merged;
END;
$$;

ALTER FUNCTION public.merge_duplicate_contacts() OWNER TO omni_owner;

REVOKE ALL ON FUNCTION public.merge_duplicate_contacts() FROM PUBLIC;

SELECT public.merge_duplicate_contacts();

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_account_phone_normalized
  ON contacts (account_id, phone_normalized)
  WHERE phone_normalized <> '';


-- Domain evolution 023



-- Domain evolution 024


CREATE TABLE IF NOT EXISTS member_presence (
  user_id      UUID PRIMARY KEY REFERENCES identity.users(id) ON DELETE CASCADE,
  account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'online' CHECK (status IN ('online', 'away')),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS member_presence_account_idx
  ON member_presence(account_id);

ALTER TABLE member_presence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS member_presence_select ON member_presence;

CREATE POLICY member_presence_select ON member_presence FOR SELECT
  USING (is_account_member(account_id));

CREATE OR REPLACE FUNCTION public.touch_presence(
  p_status TEXT DEFAULT 'online'
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
BEGIN
  IF app.current_user_id() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('online', 'away') THEN
    RAISE EXCEPTION 'Invalid presence status: %', p_status
      USING ERRCODE = '22023';
  END IF;

  SELECT account_id INTO v_account_id
  FROM profiles
  WHERE user_id = app.current_user_id();

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'No account for caller' USING ERRCODE = '22023';
  END IF;

  INSERT INTO member_presence (user_id, account_id, status, last_seen_at)
  VALUES (app.current_user_id(), v_account_id, p_status, now())
  ON CONFLICT (user_id) DO UPDATE
    SET status       = excluded.status,
        last_seen_at = now(),
        account_id   = excluded.account_id;
END;
$$;


-- Domain evolution 025


CREATE OR REPLACE FUNCTION public.filter_contacts_by_tags(
  p_tag_ids UUID[],
  p_search TEXT DEFAULT NULL,
  p_limit INT DEFAULT 25,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (contact contacts, total_count BIGINT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH matched AS (
    -- Distinct contacts having ANY of the selected tags (OR),
    -- narrowed by the same name/phone/email search as the list.
    SELECT DISTINCT c.id, c.created_at
    FROM contacts c
    JOIN contact_tags ct ON ct.contact_id = c.id
    WHERE ct.tag_id = ANY(p_tag_ids)
      AND (
        p_search IS NULL
        OR c.name ILIKE '%' || p_search || '%'
        OR c.phone ILIKE '%' || p_search || '%'
        OR c.email ILIKE '%' || p_search || '%'
      )
  ),
  page AS (
    -- count(*) OVER() is evaluated before LIMIT, so it is the full
    -- match total regardless of the page being returned.
    SELECT id, count(*) OVER() AS total_count
    FROM matched
    ORDER BY created_at DESC, id
    LIMIT p_limit OFFSET p_offset
  )
  SELECT c AS contact, page.total_count
  FROM page
  JOIN contacts c ON c.id = page.id
  ORDER BY c.created_at DESC, c.id;
$$;

ALTER FUNCTION public.filter_contacts_by_tags(UUID[], TEXT, INT, INT) OWNER TO omni_owner;

REVOKE ALL ON FUNCTION public.filter_contacts_by_tags(UUID[], TEXT, INT, INT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.filter_contacts_by_tags(UUID[], TEXT, INT, INT) TO omni_app;


-- Domain evolution 026


CREATE TABLE IF NOT EXISTS api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by   uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  name         text NOT NULL,
  key_prefix   text NOT NULL,             
  key_hash     text NOT NULL UNIQUE,      
  scopes       text[] NOT NULL DEFAULT '{}',
  last_used_at timestamptz,
  expires_at   timestamptz,               
  revoked_at   timestamptz,               
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS api_keys_account_id_idx ON api_keys (account_id);

CREATE INDEX IF NOT EXISTS api_keys_key_hash_idx ON api_keys (key_hash);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS api_keys_select ON api_keys;

CREATE POLICY api_keys_select ON api_keys FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS api_keys_insert ON api_keys;

CREATE POLICY api_keys_insert ON api_keys FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS api_keys_update ON api_keys;

CREATE POLICY api_keys_update ON api_keys FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS api_keys_delete ON api_keys;

CREATE POLICY api_keys_delete ON api_keys FOR DELETE
  USING (is_account_member(account_id, 'admin'));


-- Domain evolution 027


CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  
  user_id UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'conversation_assigned'
    CHECK (type IN ('conversation_assigned')),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  
  
  actor_user_id UUID REFERENCES identity.users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications(user_id)
  WHERE read_at IS NULL;

ALTER TABLE notifications REPLICA IDENTITY FULL;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_select ON notifications;

DROP POLICY IF EXISTS notifications_update ON notifications;

CREATE POLICY notifications_select ON notifications FOR SELECT
  USING (app.current_user_id() = user_id);

CREATE POLICY notifications_update ON notifications FOR UPDATE
  USING (app.current_user_id() = user_id)
  WITH CHECK (app.current_user_id() = user_id);

REVOKE UPDATE ON notifications FROM omni_app;

GRANT UPDATE (read_at) ON notifications TO omni_app;

CREATE OR REPLACE FUNCTION notify_conversation_assigned()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_name TEXT;
  v_actor_name TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.assigned_agent_id IS NULL THEN
      RETURN NEW;
    END IF;
  ELSE
    IF NEW.assigned_agent_id IS NULL
       OR NEW.assigned_agent_id IS NOT DISTINCT FROM OLD.assigned_agent_id THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Skip self-assignment — nothing to notify the agent about.
  IF app.current_user_id() IS NOT NULL AND app.current_user_id() = NEW.assigned_agent_id THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(name, ''), phone) INTO v_contact_name
  FROM contacts WHERE id = NEW.contact_id;

  IF app.current_user_id() IS NOT NULL THEN
    SELECT full_name INTO v_actor_name
    FROM profiles WHERE user_id = app.current_user_id();
  END IF;

  INSERT INTO notifications (
    account_id, user_id, type, conversation_id, contact_id,
    actor_user_id, title, body
  ) VALUES (
    NEW.account_id,
    NEW.assigned_agent_id,
    'conversation_assigned',
    NEW.id,
    NEW.contact_id,
    app.current_user_id(),
    'New conversation assigned',
    COALESCE(v_actor_name, 'Someone') || ' assigned you a conversation with '
      || COALESCE(v_contact_name, 'a contact')
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let a notification failure block the assignment itself.
  RAISE WARNING 'Failed to create assignment notification for conversation %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION notify_conversation_assigned() OWNER TO omni_owner;

DROP TRIGGER IF EXISTS on_conversation_assigned ON conversations;

CREATE TRIGGER on_conversation_assigned
  AFTER INSERT OR UPDATE OF assigned_agent_id ON conversations
  FOR EACH ROW EXECUTE FUNCTION notify_conversation_assigned();


-- Domain evolution 028


CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by       uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  url              text NOT NULL,             
  secret           text NOT NULL,             
  events           text[] NOT NULL DEFAULT '{}',
  is_active        boolean NOT NULL DEFAULT true,
  last_delivery_at timestamptz,               
  failure_count    integer NOT NULL DEFAULT 0, 
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webhook_endpoints_account_id_idx
  ON webhook_endpoints (account_id);

ALTER TABLE webhook_endpoints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS webhook_endpoints_select ON webhook_endpoints;

CREATE POLICY webhook_endpoints_select ON webhook_endpoints FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS webhook_endpoints_insert ON webhook_endpoints;

CREATE POLICY webhook_endpoints_insert ON webhook_endpoints FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS webhook_endpoints_update ON webhook_endpoints;

CREATE POLICY webhook_endpoints_update ON webhook_endpoints FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS webhook_endpoints_delete ON webhook_endpoints;

CREATE POLICY webhook_endpoints_delete ON webhook_endpoints FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.record_webhook_failure(
  endpoint_id uuid,
  max_failures int
)
RETURNS void AS $$
  UPDATE webhook_endpoints
  SET failure_count = failure_count + 1,
      is_active = CASE
        WHEN failure_count + 1 >= max_failures THEN false
        ELSE is_active
      END
  WHERE id = endpoint_id;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;


-- Domain evolution 029


CREATE TABLE IF NOT EXISTS ai_configs (
  id                                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id                        uuid NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  created_by                        uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  provider                          text NOT NULL CHECK (provider IN ('openai', 'anthropic')),
  model                             text NOT NULL,
  api_key                           text NOT NULL,            
  system_prompt                     text,                     
  is_active                         boolean NOT NULL DEFAULT false,
  auto_reply_enabled                boolean NOT NULL DEFAULT false,
  auto_reply_max_per_conversation   integer NOT NULL DEFAULT 3
                                      CHECK (auto_reply_max_per_conversation BETWEEN 1 AND 20),
  created_at                        timestamptz NOT NULL DEFAULT now(),
  updated_at                        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ai_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_configs_select ON ai_configs;

CREATE POLICY ai_configs_select ON ai_configs FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS ai_configs_insert ON ai_configs;

CREATE POLICY ai_configs_insert ON ai_configs FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_configs_update ON ai_configs;

CREATE POLICY ai_configs_update ON ai_configs FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_configs_delete ON ai_configs;

CREATE POLICY ai_configs_delete ON ai_configs FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_ai_configs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ai_configs_updated_at ON ai_configs;

CREATE TRIGGER ai_configs_updated_at
  BEFORE UPDATE ON ai_configs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_ai_configs_updated_at();

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ai_autoreply_disabled boolean NOT NULL DEFAULT false;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ai_reply_count integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.claim_ai_reply_slot(
  conversation_id uuid,
  max_replies integer
)
RETURNS boolean AS $$
  WITH claimed AS (
    UPDATE conversations
    SET ai_reply_count = ai_reply_count + 1
    WHERE id = conversation_id
      AND ai_reply_count < max_replies
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM claimed);
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.claim_ai_reply_slot(uuid, integer) TO omni_worker;


-- Domain evolution 030


ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS embeddings_api_key text;

CREATE TABLE IF NOT EXISTS ai_knowledge_documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by  uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  title       text NOT NULL,
  content     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_knowledge_documents_account_id_idx
  ON ai_knowledge_documents (account_id);

ALTER TABLE ai_knowledge_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_knowledge_documents_select ON ai_knowledge_documents;

CREATE POLICY ai_knowledge_documents_select ON ai_knowledge_documents FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS ai_knowledge_documents_insert ON ai_knowledge_documents;

CREATE POLICY ai_knowledge_documents_insert ON ai_knowledge_documents FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_knowledge_documents_update ON ai_knowledge_documents;

CREATE POLICY ai_knowledge_documents_update ON ai_knowledge_documents FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_knowledge_documents_delete ON ai_knowledge_documents;

CREATE POLICY ai_knowledge_documents_delete ON ai_knowledge_documents FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_ai_knowledge_documents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ai_knowledge_documents_updated_at ON ai_knowledge_documents;

CREATE TRIGGER ai_knowledge_documents_updated_at
  BEFORE UPDATE ON ai_knowledge_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_ai_knowledge_documents_updated_at();

CREATE TABLE IF NOT EXISTS ai_knowledge_chunks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  uuid NOT NULL REFERENCES ai_knowledge_documents(id) ON DELETE CASCADE,
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  chunk_index  integer NOT NULL DEFAULT 0,
  content      text NOT NULL,
  
  
  
  
  
  
  
  fts          tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
  embedding    real[],
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_knowledge_chunks_account_id_idx
  ON ai_knowledge_chunks (account_id);

CREATE INDEX IF NOT EXISTS ai_knowledge_chunks_document_id_idx
  ON ai_knowledge_chunks (document_id);

CREATE INDEX IF NOT EXISTS ai_knowledge_chunks_fts_idx
  ON ai_knowledge_chunks USING gin (fts);

ALTER TABLE ai_knowledge_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_knowledge_chunks_select ON ai_knowledge_chunks;

CREATE POLICY ai_knowledge_chunks_select ON ai_knowledge_chunks FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS ai_knowledge_chunks_insert ON ai_knowledge_chunks;

CREATE POLICY ai_knowledge_chunks_insert ON ai_knowledge_chunks FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_knowledge_chunks_update ON ai_knowledge_chunks;

CREATE POLICY ai_knowledge_chunks_update ON ai_knowledge_chunks FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_knowledge_chunks_delete ON ai_knowledge_chunks;

CREATE POLICY ai_knowledge_chunks_delete ON ai_knowledge_chunks FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.match_ai_knowledge_fts(
  p_account_id  uuid,
  p_query       text,
  p_match_count integer
)
RETURNS TABLE (id uuid, content text, rank real) AS $$
  SELECT c.id,
         c.content,
         ts_rank(c.fts, plainto_tsquery('simple', p_query)) AS rank
  FROM ai_knowledge_chunks c
  WHERE c.account_id = p_account_id
    AND c.fts @@ plainto_tsquery('simple', p_query)
  ORDER BY rank DESC
  LIMIT GREATEST(p_match_count, 0);
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.match_ai_knowledge_fts(uuid, text, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.match_ai_knowledge_fts(uuid, text, integer) TO omni_app, omni_worker;


-- Domain evolution 031


GRANT EXECUTE ON FUNCTION public.claim_ai_reply_slot(uuid, integer) TO omni_worker;


-- Domain evolution 032


CREATE OR REPLACE FUNCTION public.match_ai_knowledge_fts(
  p_account_id  uuid,
  p_query       text,
  p_match_count integer
)
RETURNS TABLE (id uuid, content text, rank real) AS $$
  SELECT c.id,
         c.content,
         ts_rank(c.fts, plainto_tsquery('simple', p_query)) AS rank
  FROM ai_knowledge_chunks c
  WHERE c.account_id = p_account_id
    AND c.fts @@ plainto_tsquery('simple', p_query)
  ORDER BY rank DESC
  LIMIT GREATEST(p_match_count, 0);
$$ LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public;

REVOKE ALL ON FUNCTION public.match_ai_knowledge_fts(uuid, text, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.match_ai_knowledge_fts(uuid, text, integer) TO omni_app, omni_worker;


-- Domain evolution 033


ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS ai_generated boolean NOT NULL DEFAULT false;

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS handoff_agent_id uuid REFERENCES identity.users(id) ON DELETE SET NULL;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ai_handoff_summary text;

CREATE TABLE IF NOT EXISTS ai_usage_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id   uuid REFERENCES conversations(id) ON DELETE SET NULL,
  
  mode              text NOT NULL CHECK (mode IN ('auto_reply', 'draft')),
  provider          text NOT NULL CHECK (provider IN ('openai', 'anthropic')),
  model             text NOT NULL,
  prompt_tokens     integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  total_tokens      integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_log_account_created
  ON ai_usage_log(account_id, created_at DESC);

ALTER TABLE ai_usage_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_usage_log_select ON ai_usage_log;

CREATE POLICY ai_usage_log_select ON ai_usage_log FOR SELECT
  USING (is_account_member(account_id, 'admin'));


-- Domain evolution 034


CREATE OR REPLACE FUNCTION public.enforce_profile_privilege_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (NEW.account_role IS DISTINCT FROM OLD.account_role
      OR NEW.account_id IS DISTINCT FROM OLD.account_id)
     AND current_user = 'omni_app'
  THEN
    RAISE EXCEPTION
      'account_role and account_id cannot be changed directly; use the account member/invitation RPCs'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_profile_privilege_columns() OWNER TO omni_owner;

DROP TRIGGER IF EXISTS enforce_profile_privilege_columns ON public.profiles;

CREATE TRIGGER enforce_profile_privilege_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_profile_privilege_columns();


-- Domain evolution 035


ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS interactive_payload JSONB;

CREATE TABLE IF NOT EXISTS quick_replies (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  
  user_id UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  
  
  kind TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'interactive')),
  content_text TEXT,
  interactive_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quick_replies_account ON quick_replies(account_id);

ALTER TABLE quick_replies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quick_replies_select ON quick_replies;

DROP POLICY IF EXISTS quick_replies_insert ON quick_replies;

DROP POLICY IF EXISTS quick_replies_update ON quick_replies;

DROP POLICY IF EXISTS quick_replies_delete ON quick_replies;

CREATE POLICY quick_replies_select ON quick_replies FOR SELECT
  USING (is_account_member(account_id));

CREATE POLICY quick_replies_insert ON quick_replies FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

CREATE POLICY quick_replies_update ON quick_replies FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

CREATE POLICY quick_replies_delete ON quick_replies FOR DELETE
  USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON quick_replies;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON quick_replies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- Domain evolution 036


CREATE OR REPLACE FUNCTION public.merge_duplicate_conversations()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group    RECORD;
  v_survivor UUID;
  v_losers   UUID[];
  v_all      UUID[];
  v_merged   INTEGER := 0;
BEGIN
  FOR v_group IN
    SELECT account_id,
           contact_id,
           array_agg(id ORDER BY created_at ASC, id ASC) AS ids,
           COALESCE(SUM(unread_count), 0)                AS total_unread
    FROM conversations
    GROUP BY account_id, contact_id
    HAVING count(*) > 1
  LOOP
    v_all      := v_group.ids;
    v_survivor := v_all[1];
    v_losers   := v_all[2:array_length(v_all, 1)];

    -- Re-point every conversation-scoped child from the losers onto
    -- the survivor. None of these carry a conversation-scoped unique
    -- constraint (message_id is intentionally non-unique — see
    -- migration 009), so a plain UPDATE is safe. Doing this BEFORE the
    -- delete is what saves the ON DELETE CASCADE children (messages,
    -- message_reactions, notifications) from being removed with the
    -- loser conversations.
    UPDATE messages          SET conversation_id = v_survivor WHERE conversation_id = ANY(v_losers);
    UPDATE message_reactions SET conversation_id = v_survivor WHERE conversation_id = ANY(v_losers);
    UPDATE deals             SET conversation_id = v_survivor WHERE conversation_id = ANY(v_losers);
    UPDATE flow_runs         SET conversation_id = v_survivor WHERE conversation_id = ANY(v_losers);
    UPDATE notifications     SET conversation_id = v_survivor WHERE conversation_id = ANY(v_losers);
    UPDATE ai_usage_log      SET conversation_id = v_survivor WHERE conversation_id = ANY(v_losers);

    -- Roll the merged unread counts onto the survivor and re-derive
    -- its last-message summary from the now-complete message set, so
    -- the surviving thread reflects the full history.
    UPDATE conversations c
    SET unread_count      = v_group.total_unread,
        last_message_text = lm.content_text,
        last_message_at   = lm.created_at,
        updated_at        = NOW()
    FROM (
      SELECT content_text, created_at
      FROM messages
      WHERE conversation_id = v_survivor
      ORDER BY created_at DESC
      LIMIT 1
    ) lm
    WHERE c.id = v_survivor;

    -- Survivor may have no messages at all (edge case). Still fold in
    -- the merged unread count in that case.
    UPDATE conversations
    SET unread_count = v_group.total_unread,
        updated_at   = NOW()
    WHERE id = v_survivor
      AND NOT EXISTS (SELECT 1 FROM messages WHERE conversation_id = v_survivor);

    DELETE FROM conversations WHERE id = ANY(v_losers);

    v_merged := v_merged + COALESCE(array_length(v_losers, 1), 0);
  END LOOP;

  RETURN v_merged;
END;
$$;

ALTER FUNCTION public.merge_duplicate_conversations() OWNER TO omni_owner;

REVOKE ALL ON FUNCTION public.merge_duplicate_conversations() FROM PUBLIC;

SELECT public.merge_duplicate_conversations();

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_account_contact
  ON conversations (account_id, contact_id);


-- Domain evolution 037


WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY conversation_id, message_id
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM messages
  WHERE message_id IS NOT NULL
)
DELETE FROM messages m
USING ranked r
WHERE m.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_conversation_message_id
  ON messages (conversation_id, message_id);

CREATE OR REPLACE FUNCTION public.bump_conversation_on_inbound(
  p_conversation_id UUID,
  p_last_message_text TEXT
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE conversations
  SET unread_count      = COALESCE(unread_count, 0) + 1,
      last_message_text = p_last_message_text,
      last_message_at   = NOW(),
      updated_at        = NOW()
  WHERE id = p_conversation_id;
$$;

REVOKE ALL ON FUNCTION public.bump_conversation_on_inbound(UUID, TEXT) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.bump_conversation_on_inbound(UUID, TEXT) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.bump_conversation_on_inbound(UUID, TEXT) FROM omni_app;

GRANT EXECUTE ON FUNCTION public.bump_conversation_on_inbound(UUID, TEXT) TO omni_worker;

CREATE OR REPLACE FUNCTION public.create_broadcast_with_recipients(
  p_account_id       UUID,
  p_user_id          UUID,
  p_name             TEXT,
  p_template_name    TEXT,
  p_template_language TEXT,
  p_total_recipients INTEGER,
  p_contact_ids      UUID[]
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
    template_language, status, total_recipients
  )
  VALUES (
    p_account_id, p_user_id, p_name, p_template_name,
    p_template_language, 'sending', p_total_recipients
  )
  RETURNING id INTO v_broadcast_id;

  RETURN QUERY
  WITH ins AS (
    INSERT INTO broadcast_recipients (broadcast_id, contact_id, status)
    SELECT v_broadcast_id, cid, 'pending'
    FROM unnest(p_contact_ids) AS cid
    RETURNING id, contact_id
  )
  SELECT v_broadcast_id, ins.id, ins.contact_id
  FROM ins;
END;
$$;

REVOKE ALL ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[]) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[]) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[]) FROM omni_app;

GRANT EXECUTE ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[]) TO omni_worker;


-- Domain evolution 038


ALTER TABLE broadcast_recipients
  ADD COLUMN IF NOT EXISTS template_params JSONB;

COMMENT ON COLUMN broadcast_recipients.template_params IS
  'Positional body values for this recipient''s template send ({{1}}, {{2}}, ...), frozen when the broadcast was planned. NULL on rows created before migration 038; a resume treats that as no params.';

ALTER TABLE broadcasts
  ADD COLUMN IF NOT EXISTS delivery_locked_at TIMESTAMPTZ;

COMMENT ON COLUMN broadcasts.delivery_locked_at IS
  'Set while a server-side delivery pass is fanning out; NULL when idle. See 038_broadcast_resume.sql.';

CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_broadcast_status
  ON broadcast_recipients(broadcast_id, status);

DROP FUNCTION IF EXISTS public.create_broadcast_with_recipients(
  UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[]
);

CREATE OR REPLACE FUNCTION public.create_broadcast_with_recipients(
  p_account_id        UUID,
  p_user_id           UUID,
  p_name              TEXT,
  p_template_name     TEXT,
  p_template_language TEXT,
  p_total_recipients  INTEGER,
  p_contact_ids       UUID[],
  p_template_params   JSONB[]
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
    template_language, status, total_recipients
  )
  VALUES (
    p_account_id, p_user_id, p_name, p_template_name,
    p_template_language, 'sending', p_total_recipients
  )
  RETURNING id INTO v_broadcast_id;

  -- Two-array unnest pairs each contact with its params positionally.
  -- A shorter params array pads with NULL, which the resume path reads
  -- as "no params" — the same as a pre-038 row.
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

REVOKE ALL ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[]) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[]) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[]) FROM omni_app;

GRANT EXECUTE ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[]) TO omni_worker;


-- Domain evolution 039


ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS media_type TEXT;

COMMENT ON COLUMN messages.media_type IS
  'MIME type of media_url''s content, as reported by Meta. Populated for '
  'INBOUND media only: an outbound media_url is a chat-media object whose '
  'path already carries the original filename and extension, so the type '
  'adds nothing there. Also NULL for text messages and for every row '
  'written before migration 039.';

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS mirror_inbound_media BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN whatsapp_config.mirror_inbound_media IS
  'When true (default), the inbound webhook copies received media into '
  'the chat-media bucket so it outlives Meta''s ~30-day retention. Turn '
  'off to keep storage flat and accept that attachments expire.';


-- Domain evolution 040


ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS wa_user_id TEXT,
  ADD COLUMN IF NOT EXISTS wa_parent_user_id TEXT,
  ADD COLUMN IF NOT EXISTS wa_username TEXT;

COMMENT ON COLUMN contacts.wa_user_id IS
  'WhatsApp business-scoped user ID (e.g. "US.13491208655302741918"). Stable per (user, business portfolio) and the primary inbound key when Meta withholds the phone number.';

COMMENT ON COLUMN contacts.wa_parent_user_id IS
  'Portfolio-level BSUID (e.g. "US.ENT.11815799212886844830"). Stored for reference; not used as a lookup key.';

COMMENT ON COLUMN contacts.wa_username IS
  'WhatsApp username, without the leading @. Display only — usernames are user-changeable and must never be used as an identity key.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_account_wa_user_id
  ON contacts (account_id, wa_user_id)
  WHERE wa_user_id IS NOT NULL;


-- Domain evolution 041


CREATE OR REPLACE FUNCTION public.create_broadcast_with_recipients(
  p_account_id        UUID,
  p_user_id           UUID,
  p_name              TEXT,
  p_template_name     TEXT,
  p_template_language TEXT,
  p_total_recipients  INTEGER,
  p_contact_ids       UUID[],
  p_template_params   JSONB[]
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
    template_language, status, total_recipients
  )
  VALUES (
    p_account_id, p_user_id, p_name, p_template_name,
    p_template_language, 'sending', p_total_recipients
  )
  RETURNING id INTO v_broadcast_id;

  -- Two-array unnest pairs each contact with its params positionally.
  -- A shorter params array pads with NULL, which the resume path reads
  -- as "no params" — the same as a pre-038 row.
  RETURN QUERY
  WITH ins AS (
    INSERT INTO broadcast_recipients (
      broadcast_id, contact_id, status, template_params
    )
    SELECT v_broadcast_id, t.cid, 'pending', t.prm
    FROM unnest(p_contact_ids, p_template_params) AS t(cid, prm)
    -- Qualified: a bare `contact_id` collides with the RETURNS TABLE
    -- output variable of the same name. This is the whole fix.
    RETURNING id, broadcast_recipients.contact_id
  )
  SELECT v_broadcast_id, ins.id, ins.contact_id
  FROM ins;
END;
$$;

REVOKE ALL ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[]) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[]) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[]) FROM omni_app;

GRANT EXECUTE ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[]) TO omni_worker;


-- Domain evolution 042


ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS error_code INTEGER,
  ADD COLUMN IF NOT EXISTS error_title TEXT,
  ADD COLUMN IF NOT EXISTS error_details TEXT;

COMMENT ON COLUMN messages.error_code IS
  'Meta''s numeric error code from a failed status webhook (errors[0].code). '
  'NULL unless the message failed. Not cleared by a later status update.';

COMMENT ON COLUMN messages.error_title IS
  'Meta''s short error label from a failed status webhook (errors[0].title). '
  'NULL unless the message failed.';

COMMENT ON COLUMN messages.error_details IS
  'Meta''s human-readable explanation from a failed status webhook '
  '(errors[0].error_data.details). NULL unless the message failed and Meta '
  'supplied details.';


-- Schema privileges: the browser never receives database credentials.
GRANT USAGE ON SCHEMA public TO omni_app, omni_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO omni_app, omni_worker;
REVOKE ALL ON public.app_migrations FROM omni_app, omni_worker;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO omni_app, omni_worker;
-- No PUBLIC execute on privileged helpers; original explicit grants remain.
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
-- No vector extension required for local full-text knowledge search.
CREATE FUNCTION public.match_ai_knowledge_semantic(p_account_id uuid, p_query_embedding text, p_match_count integer)
RETURNS TABLE(id uuid, content text, distance real) LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Semantic search is not configured on this local database; full-text search is available.' USING ERRCODE = '0A000';
END $$;
REVOKE ALL ON FUNCTION public.match_ai_knowledge_semantic(uuid,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_ai_knowledge_semantic(uuid,text,integer) TO omni_app, omni_worker;
