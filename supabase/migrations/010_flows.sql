-- ============================================================
-- Conversational Flows: stateful, branching WhatsApp chatbot.
--
-- What this migration adds:
--
--   1. `flows` — the definition envelope (name, trigger config,
--      entry node, fallback policy, status). One row per authored bot.
--
--   2. `flow_nodes` — the graph rows. Edges live INSIDE each node's
--      `config` JSONB (e.g. each button row carries its own
--      `next_node_key`). Why edges-in-config rather than a separate
--      `flow_edges` table:
--        - The runner only ever asks "given current node X, where does
--          reply Y go?" — that's a single-row lookup with the JSON
--          already on the row. Splitting edges out forces a join per
--          inbound message.
--        - The builder's natural unit of edit is the node ("change this
--          button's label and target"); a side table would force
--          coordinated inserts/deletes on every save.
--      Cross-node integrity is enforced at save-time by the validator
--      (mirrors what `automation_steps`/`validate.ts` already does).
--
--      `node_key` is a STABLE STRING (e.g. "menu_existing"), not the
--      UUID. Edge targets reference node_key, which means:
--        - Cloning a flow doesn't require UUID rewriting in JSON edges.
--        - Templates ship with human-readable keys.
--        - Direct DB inspection is debuggable.
--      The (flow_id, node_key) UNIQUE constraint guarantees lookup
--      determinism.
--
--   3. `flow_runs` — per-contact runtime state machine. The linchpin
--      is the partial unique index `idx_one_active_run_per_contact`:
--      at most one ACTIVE run per (user_id, contact_id). Two concurrent
--      webhook deliveries trying to start a run both attempt INSERT;
--      the second fails with 23505 and the runner catches & exits.
--      No locking required.
--
--   4. `flow_run_events` — append-only audit. Used by the runner for
--      idempotency (refuses to advance twice on the same Meta
--      message_id) and by the future run-history viewer.
--
--   5. Widens `messages.content_type` CHECK to allow 'interactive', and
--      adds `messages.interactive_reply_id`. With this, button/list
--      taps become first-class message rows with a queryable reply id
--      instead of getting silently coerced into the "Unsupported
--      message type" fallback in parseMessageContent.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- 1. Messages table — widen content_type, add interactive_reply_id
-- ============================================================

-- Drop & re-add the CHECK constraint to add 'interactive' as an allowed
-- value. Migration 001 named it `messages_content_type_check` (Postgres
-- default for an inline CHECK on a TEXT column).
ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_content_type_check;

ALTER TABLE messages
  ADD CONSTRAINT messages_content_type_check
  CHECK (content_type IN (
    'text', 'image', 'document', 'audio', 'video',
    'location', 'template', 'interactive'
  ));

-- Reply id of the button / list row the customer tapped. NULL for
-- everything that isn't an interactive reply. No FK — Meta button ids
-- are arbitrary user-chosen strings, not row references.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS interactive_reply_id TEXT;

-- ============================================================
-- 2. flows
-- ============================================================
CREATE TABLE IF NOT EXISTS flows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'archived')),
  trigger_type TEXT NOT NULL
    CHECK (trigger_type IN ('keyword', 'first_inbound_message', 'manual')),
  trigger_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- References `flow_nodes.node_key` (a string, not the UUID). NULL
  -- while the flow is being authored; required before activation
  -- (enforced by the validator, not at the DB level so drafts can save).
  entry_node_id TEXT,
  fallback_policy JSONB NOT NULL DEFAULT
    '{"on_unknown_reply":"reprompt","max_reprompts":2,"on_timeout_hours":24,"on_exhaust":"handoff"}'::jsonb,
  execution_count INTEGER NOT NULL DEFAULT 0,
  last_executed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Active-only lookups dominate the runner's hot path. Partial index
-- keeps it small even when archived flows accumulate.
CREATE INDEX IF NOT EXISTS idx_flows_active_trigger
  ON flows(user_id, trigger_type)
  WHERE status = 'active';

ALTER TABLE flows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own flows" ON flows;
CREATE POLICY "Users can manage own flows" ON flows FOR ALL
  USING (auth.uid() = user_id);

-- ============================================================
-- 3. flow_nodes
-- ============================================================
CREATE TABLE IF NOT EXISTS flow_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  -- Reserved for the v2 react-flow canvas. v1 list editor leaves both
  -- at 0; carrying the columns now avoids a follow-up migration when
  -- the canvas ships.
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
      AND f.user_id = auth.uid()
  ));

-- ============================================================
-- 4. flow_runs
-- ============================================================
CREATE TABLE IF NOT EXISTS flow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id UUID NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- contact_id intentionally SET NULL on delete (matches the
  -- automation_logs / broadcast_recipients pattern in migration 004):
  -- deleting a contact must not erase the historical audit trail.
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
    'active',           -- currently awaiting customer input
    'completed',        -- reached an end node naturally
    'handed_off',       -- ended via a handoff node
    'timed_out',        -- swept by the cron after fallback_policy.on_timeout_hours
    'paused_by_agent',  -- an agent manually replied; flow yielded
    'failed'            -- runner hit an unrecoverable error
  )),
  current_node_key TEXT,
  last_prompt_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  -- Captured collect_input values + http_fetch responses. Interpolated
  -- into downstream node configs at advance time.
  vars JSONB NOT NULL DEFAULT '{}'::jsonb,
  reprompt_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_advanced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  end_reason TEXT
);

-- Linchpin of idempotency / concurrency safety. At most one active run
-- per (user_id, contact_id). Two concurrent webhook deliveries each
-- trying to start a run will collide on this index; the second INSERT
-- fails with 23505 and the runner catches & returns consumed:true.
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_run_per_contact
  ON flow_runs(user_id, contact_id)
  WHERE status = 'active';

-- Cron sweep query: "find active runs older than X hours" needs to be
-- index-supported so the sweeper stays cheap as flow volume grows.
CREATE INDEX IF NOT EXISTS idx_flow_runs_active_advanced
  ON flow_runs(last_advanced_at)
  WHERE status = 'active';

-- Detail / history page queries: "list runs for this flow, newest first".
CREATE INDEX IF NOT EXISTS idx_flow_runs_flow_started
  ON flow_runs(flow_id, started_at DESC);

ALTER TABLE flow_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own flow runs" ON flow_runs;
CREATE POLICY "Users see own flow runs" ON flow_runs FOR SELECT
  USING (auth.uid() = user_id);

-- The runner uses service_role for all writes; users never INSERT /
-- UPDATE / DELETE flow_runs from the client. Omitting those policies
-- keeps the surface tight (mirrors automation_pending_executions).

-- ============================================================
-- 5. flow_run_events
-- ============================================================
CREATE TABLE IF NOT EXISTS flow_run_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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

-- Idempotency check in the runner needs fast lookup by
-- (flow_run_id, event_type, payload->>'meta_message_id'). The runner
-- does the JSONB extraction client-side; index just needs the first
-- two columns to narrow.
CREATE INDEX IF NOT EXISTS idx_flow_run_events_run_type
  ON flow_run_events(flow_run_id, event_type);

-- History viewer: reverse-chronological scan per run.
CREATE INDEX IF NOT EXISTS idx_flow_run_events_run_time
  ON flow_run_events(flow_run_id, created_at DESC);

ALTER TABLE flow_run_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see events on their runs" ON flow_run_events;
CREATE POLICY "Users see events on their runs" ON flow_run_events FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM flow_runs r
    WHERE r.id = flow_run_events.flow_run_id
      AND r.user_id = auth.uid()
  ));

-- ============================================================
-- 6. updated_at trigger on flows
-- ============================================================
-- Reuses update_updated_at_column() from migration 001. Trigger name
-- matches the convention used on every other table that has one
-- (see migration 001 lines 361-367).
DROP TRIGGER IF EXISTS set_updated_at ON flows;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON flows
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 7. Realtime publication
-- ============================================================
-- Add flow_runs so the inbox can render "this contact is in flow X at
-- node Y" live as the runner advances. Other flow tables don't need
-- realtime — the builder reads on demand, the runner is server-side.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'flow_runs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE flow_runs;
  END IF;
END $$;
