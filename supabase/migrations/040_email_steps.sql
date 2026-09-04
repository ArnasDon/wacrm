-- ============================================================
-- 040 — Email actions inside automations and flows.
--
-- The email engine (listmonk) already backs the Email section for
-- newsletters. This migration lets the SAME engine be driven from
-- the WhatsApp automation and flow builders, so a single journey can
-- mix channels: "new contact → WhatsApp welcome → wait a day → email
-- the brochure".
--
--   1. flow_nodes.node_type gains 'send_email'. The column carries a
--      CHECK constraint enumerating legal node types (migration 016
--      set the current list), so it has to be re-declared here.
--   2. automation_steps.step_type is free TEXT (migration 006) — no
--      constraint to widen. 'send_email' and 'add_to_mailing_list'
--      are validated in application code like every other step type.
--
-- Idempotent — safe to run more than once.
-- ============================================================

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
    'send_email',
    'collect_input',
    'condition',
    'set_tag',
    'handoff',
    'http_fetch',
    'end'
  ));
