-- ============================================================
-- VedMint Crm MySQL Database Schema
-- Sets up all the tables required for the CRM.
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(36) PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  email_verified TINYINT(1) NOT NULL DEFAULT 0,
  two_factor_enabled TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS accounts (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  owner_user_id VARCHAR(36) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS profiles (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) UNIQUE NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  mobile_no VARCHAR(32) NULL,
  avatar_url TEXT,
  role VARCHAR(50) DEFAULT 'user',
  account_id VARCHAR(36),
  account_role VARCHAR(50),
  beta_features JSON,
  whatsapp_config_id VARCHAR(36) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS auth_login_otps (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  code_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_auth_login_otps_user (user_id)
);

CREATE TABLE IF NOT EXISTS contacts (
  id VARCHAR(36) PRIMARY KEY,
  account_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36),
  phone VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  email VARCHAR(255),
  company VARCHAR(255),
  assigned_to VARCHAR(36),
  avatar_url TEXT,
  last_contacted_at TIMESTAMP NULL,
  last_contacted_via VARCHAR(50) NULL,
  first_inbound_message_at TIMESTAMP NULL,
  opted_out TINYINT(1) NOT NULL DEFAULT 0,
  opted_out_at TIMESTAMP NULL,
  opt_out_source VARCHAR(50) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_contacts_account_id ON contacts(account_id);
CREATE INDEX idx_contacts_phone ON contacts(phone);
CREATE INDEX idx_contacts_assigned_to ON contacts(assigned_to);
CREATE INDEX idx_contacts_opted_out ON contacts(account_id, opted_out);

CREATE TABLE IF NOT EXISTS account_compliance_settings (
  account_id VARCHAR(36) NOT NULL,
  opt_out_keywords JSON NULL,
  opt_in_keywords JSON NULL,
  opt_out_reply TEXT NULL,
  opt_in_reply TEXT NULL,
  auto_reply_enabled TINYINT(1) NOT NULL DEFAULT 1,
  exclude_from_broadcasts TINYINT(1) NOT NULL DEFAULT 1,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (account_id),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_log (
  id VARCHAR(36) NOT NULL,
  account_id VARCHAR(36) NOT NULL,
  actor_user_id VARCHAR(36) NULL,
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id VARCHAR(36) NULL,
  meta JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_account_created (account_id, created_at),
  KEY idx_audit_action (account_id, action),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tags (
  id VARCHAR(36) PRIMARY KEY,
  account_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36),
  name VARCHAR(255) NOT NULL,
  color VARCHAR(50) DEFAULT '#3b82f6',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS contact_tags (
  id VARCHAR(36) PRIMARY KEY,
  contact_id VARCHAR(36) NOT NULL,
  tag_id VARCHAR(36) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(contact_id, tag_id),
  FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE INDEX idx_contact_tags_contact ON contact_tags(contact_id);
CREATE INDEX idx_contact_tags_tag ON contact_tags(tag_id);

CREATE TABLE IF NOT EXISTS custom_fields (
  id VARCHAR(36) PRIMARY KEY,
  account_id VARCHAR(36) NOT NULL,
  field_name VARCHAR(255) NOT NULL,
  field_type VARCHAR(50) DEFAULT 'text',
  field_options JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS contact_custom_values (
  id VARCHAR(36) PRIMARY KEY,
  contact_id VARCHAR(36) NOT NULL,
  custom_field_id VARCHAR(36) NOT NULL,
  value TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(contact_id, custom_field_id),
  FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE,
  FOREIGN KEY (custom_field_id) REFERENCES custom_fields(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS contact_notes (
  id VARCHAR(36) PRIMARY KEY,
  contact_id VARCHAR(36) NOT NULL,
  account_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  note_text TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS conversations (
  id VARCHAR(36) PRIMARY KEY,
  account_id VARCHAR(36) NOT NULL,
  contact_id VARCHAR(36) NOT NULL,
  status VARCHAR(50) DEFAULT 'open',
  assigned_agent_id VARCHAR(36),
  last_message_text TEXT,
  last_message_at TIMESTAMP NULL,
  unread_count INT DEFAULT 0,
  reply_deadline_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_agent_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_conversations_account_id ON conversations(account_id);
CREATE INDEX idx_conversations_contact_id ON conversations(contact_id);

CREATE TABLE IF NOT EXISTS messages (
  id VARCHAR(36) PRIMARY KEY,
  conversation_id VARCHAR(36) NOT NULL,
  sender_type VARCHAR(50) NOT NULL,
  sender_id VARCHAR(36),
  content_type VARCHAR(50) DEFAULT 'text',
  content_text TEXT,
  media_url TEXT,
  template_name VARCHAR(255),
  message_id VARCHAR(255),
  status VARCHAR(50) DEFAULT 'sent',
  reply_to_message_id VARCHAR(36) NULL,
  interactive_reply_id VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id);
CREATE INDEX idx_messages_message_id ON messages(message_id);

CREATE TABLE IF NOT EXISTS message_reactions (
  id VARCHAR(36) PRIMARY KEY,
  message_id VARCHAR(36) NOT NULL,
  conversation_id VARCHAR(36) NOT NULL,
  actor_type VARCHAR(50) NOT NULL,
  actor_id VARCHAR(36),
  emoji VARCHAR(50) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(message_id, actor_type, actor_id),
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX idx_message_reactions_conversation ON message_reactions(conversation_id);
CREATE INDEX idx_message_reactions_message ON message_reactions(message_id);

CREATE TABLE IF NOT EXISTS whatsapp_config (
  id VARCHAR(36) PRIMARY KEY,
  account_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36),
  phone_number_id VARCHAR(255) NOT NULL,
  waba_id VARCHAR(255),
  access_token TEXT NOT NULL,
  verify_token VARCHAR(255),
  display_name VARCHAR(255) NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  status VARCHAR(50) DEFAULT 'disconnected',
  connected_at TIMESTAMP NULL,
  registered_at TIMESTAMP NULL,
  subscribed_apps_at TIMESTAMP NULL,
  last_registration_error TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  meta_app_secret TEXT,
  UNIQUE(phone_number_id),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_whatsapp_config_account ON whatsapp_config(account_id);
CREATE INDEX idx_whatsapp_config_account_default ON whatsapp_config(account_id, is_default);

-- Legacy personal-override table (unused; kept so old DBs don't break reads).
CREATE TABLE IF NOT EXISTS member_whatsapp_config (
  user_id VARCHAR(36) PRIMARY KEY,
  account_id VARCHAR(36) NOT NULL,
  use_personal BOOLEAN NOT NULL DEFAULT false,
  phone_number_id VARCHAR(255),
  waba_id VARCHAR(255),
  access_token TEXT,
  verify_token VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES profiles(user_id) ON DELETE CASCADE,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX idx_member_whatsapp_config_account ON member_whatsapp_config(account_id);

CREATE TABLE IF NOT EXISTS message_templates (
  id VARCHAR(36) PRIMARY KEY,
  account_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36),
  name VARCHAR(255) NOT NULL,
  language VARCHAR(50) NOT NULL,
  category VARCHAR(50) NOT NULL,
  status VARCHAR(50) NOT NULL,
  header_type VARCHAR(50),
  header_content TEXT,
  header_handle VARCHAR(512),
  header_media_url TEXT,
  header_media_id VARCHAR(255),
  body_text TEXT NOT NULL DEFAULT '',
  footer_text TEXT,
  buttons JSON,
  sample_values JSON,
  meta_template_id VARCHAR(255),
  quality_score VARCHAR(20),
  submission_error TEXT,
  rejection_reason TEXT,
  last_submitted_at TIMESTAMP NULL,
  components JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE(account_id, name, language),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS pipelines (
  id VARCHAR(36) PRIMARY KEY,
  account_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36),
  name VARCHAR(255) NOT NULL,
  position INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS pipeline_stages (
  id VARCHAR(36) PRIMARY KEY,
  pipeline_id VARCHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  color VARCHAR(50),
  position INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (pipeline_id) REFERENCES pipelines(id) ON DELETE CASCADE
);

CREATE INDEX idx_pipeline_stages_pipeline ON pipeline_stages(pipeline_id);

CREATE TABLE IF NOT EXISTS deals (
  id VARCHAR(36) PRIMARY KEY,
  account_id VARCHAR(36) NOT NULL,
  pipeline_id VARCHAR(36),
  stage_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36),
  title VARCHAR(255) NOT NULL,
  value DECIMAL(15, 2),
  currency VARCHAR(10) DEFAULT 'USD',
  status VARCHAR(50) DEFAULT 'open',
  position INT DEFAULT 0,
  contact_id VARCHAR(36),
  assigned_to VARCHAR(36),
  notes TEXT,
  expected_close_date DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (pipeline_id) REFERENCES pipelines(id) ON DELETE SET NULL,
  FOREIGN KEY (stage_id) REFERENCES pipeline_stages(id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS broadcasts (
  id VARCHAR(36) PRIMARY KEY,
  account_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36),
  name VARCHAR(255) NOT NULL,
  template_name VARCHAR(255),
  template_language VARCHAR(50),
  template_variables JSON,
  audience_filter JSON,
  scheduled_at TIMESTAMP NULL,
  status VARCHAR(50) DEFAULT 'draft',
  total_recipients INT DEFAULT 0,
  sent_count INT DEFAULT 0,
  delivered_count INT DEFAULT 0,
  read_count INT DEFAULT 0,
  replied_count INT DEFAULT 0,
  failed_count INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS broadcast_recipients (
  id VARCHAR(36) PRIMARY KEY,
  broadcast_id VARCHAR(36) NOT NULL,
  contact_id VARCHAR(36),
  status VARCHAR(50) DEFAULT 'pending',
  whatsapp_message_id VARCHAR(255),
  error_message TEXT,
  sent_at TIMESTAMP NULL,
  delivered_at TIMESTAMP NULL,
  read_at TIMESTAMP NULL,
  replied_at TIMESTAMP NULL,
  variables JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (broadcast_id) REFERENCES broadcasts(id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS automations (
  id VARCHAR(36) PRIMARY KEY,
  account_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  trigger_type VARCHAR(50) NOT NULL,
  trigger_config JSON,
  steps JSON,
  is_active BOOLEAN DEFAULT FALSE,
  execution_count INT DEFAULT 0,
  last_executed_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS automation_steps (
  id VARCHAR(36) PRIMARY KEY,
  automation_id VARCHAR(36) NOT NULL,
  parent_step_id VARCHAR(36),
  branch VARCHAR(50),
  step_type VARCHAR(50) NOT NULL,
  step_config JSON,
  position INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (automation_id) REFERENCES automations(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_step_id) REFERENCES automation_steps(id) ON DELETE CASCADE
);

CREATE INDEX idx_automation_steps_automation_id ON automation_steps(automation_id, position);

CREATE TABLE IF NOT EXISTS automation_logs (
  id VARCHAR(36) PRIMARY KEY,
  account_id VARCHAR(36) NOT NULL,
  automation_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36),
  contact_id VARCHAR(36) NOT NULL,
  trigger_event VARCHAR(255) NOT NULL,
  steps_executed JSON,
  status VARCHAR(50) NOT NULL,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (automation_id) REFERENCES automations(id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS automation_pending_executions (
  id VARCHAR(36) PRIMARY KEY,
  account_id VARCHAR(36) NOT NULL,
  automation_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36),
  contact_id VARCHAR(36) NOT NULL,
  log_id VARCHAR(36),
  parent_step_id VARCHAR(36),
  branch VARCHAR(50),
  next_step_position INT,
  context JSON,
  run_at TIMESTAMP NULL,
  status VARCHAR(50) DEFAULT 'pending',
  step_index INT,
  variables JSON,
  execute_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (automation_id) REFERENCES automations(id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS flows (
  id VARCHAR(36) PRIMARY KEY,
  account_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  trigger_type VARCHAR(50),
  trigger_config JSON,
  entry_node_id VARCHAR(255),
  fallback_policy JSON,
  status VARCHAR(50) DEFAULT 'draft',
  execution_count INT DEFAULT 0,
  last_executed_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS flow_nodes (
  id VARCHAR(36) PRIMARY KEY,
  flow_id VARCHAR(36) NOT NULL,
  node_key VARCHAR(255) NOT NULL,
  node_type VARCHAR(255) NOT NULL,
  config JSON NOT NULL,
  position_x INT DEFAULT 0,
  position_y INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(flow_id, node_key),
  FOREIGN KEY (flow_id) REFERENCES flows(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS flow_runs (
  id VARCHAR(36) PRIMARY KEY,
  account_id VARCHAR(36) NOT NULL,
  flow_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36),
  contact_id VARCHAR(36) NOT NULL,
  conversation_id VARCHAR(36),
  current_node_key VARCHAR(255),
  current_node_id VARCHAR(255),
  vars JSON,
  variables JSON,
  status VARCHAR(50) DEFAULT 'active',
  reprompt_count INT DEFAULT 0,
  last_prompt_message_id VARCHAR(255),
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_advanced_at TIMESTAMP NULL,
  ended_at TIMESTAMP NULL,
  end_reason VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (flow_id) REFERENCES flows(id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS flow_run_events (
  id VARCHAR(36) PRIMARY KEY,
  flow_run_id VARCHAR(36) NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  node_key VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (flow_run_id) REFERENCES flow_runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS flow_pending_executions (
  id VARCHAR(36) PRIMARY KEY,
  flow_run_id VARCHAR(36) NOT NULL,
  node_id VARCHAR(255) NOT NULL,
  execute_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (flow_run_id) REFERENCES flow_runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS account_invitations (
  id VARCHAR(36) PRIMARY KEY,
  account_id VARCHAR(36) NOT NULL,
  token_hash VARCHAR(255) UNIQUE NOT NULL,
  role VARCHAR(50) NOT NULL,
  created_by_user_id VARCHAR(36),
  label VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  accepted_at TIMESTAMP NULL,
  accepted_by_user_id VARCHAR(36),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (accepted_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id VARCHAR(36) PRIMARY KEY,
  event_id VARCHAR(255) UNIQUE NOT NULL,
  event_type VARCHAR(255) NOT NULL,
  payload JSON,
  status VARCHAR(50) DEFAULT 'pending',
  retry_count INT DEFAULT 0,
  last_error TEXT,
  processed_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS webhook_retry_queue (
    id VARCHAR(36) PRIMARY KEY,
    webhook_event_id VARCHAR(36) NOT NULL,
    attempt_number INT NOT NULL,
    scheduled_at TIMESTAMP NOT NULL,
    executed_at TIMESTAMP NULL,
    success BOOLEAN,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (webhook_event_id) REFERENCES webhook_events(id) ON DELETE CASCADE
);

CREATE INDEX idx_webhook_retry_queue_scheduled ON webhook_retry_queue(scheduled_at);

CREATE TABLE IF NOT EXISTS webhook_metrics (
    id VARCHAR(36) PRIMARY KEY,
    bucket_hour TIMESTAMP NOT NULL,
    account_id VARCHAR(36),
    event_type VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL,
    event_count INT NOT NULL DEFAULT 0,
    total_latency_ms INT NOT NULL DEFAULT 0,
    retry_count INT NOT NULL DEFAULT 0,
    dead_letter_count INT NOT NULL DEFAULT 0,
    error_breakdown JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE(bucket_hour, account_id, event_type, status),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS webhook_circuit_breakers (
    id VARCHAR(36) PRIMARY KEY,
    circuit_key VARCHAR(255) NOT NULL UNIQUE,
    service_name VARCHAR(255) NOT NULL,
    state VARCHAR(50) DEFAULT 'closed',
    failure_count INT DEFAULT 0,
    last_failure_at TIMESTAMP NULL,
    last_failure_reason TEXT,
    failure_threshold INT DEFAULT 5,
    recovery_timeout_ms INT DEFAULT 30000,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ============================================================
-- BROADCAST RECIPIENT COUNT TRIGGERS
-- ============================================================

DROP TRIGGER IF EXISTS broadcast_recipients_after_insert;
CREATE TRIGGER broadcast_recipients_after_insert
AFTER INSERT ON broadcast_recipients
FOR EACH ROW
  UPDATE broadcasts b
  SET
    sent_count = (SELECT COUNT(*) FROM broadcast_recipients WHERE broadcast_id = NEW.broadcast_id AND status IN ('sent','delivered','read','replied')),
    delivered_count = (SELECT COUNT(*) FROM broadcast_recipients WHERE broadcast_id = NEW.broadcast_id AND status IN ('delivered','read','replied')),
    read_count = (SELECT COUNT(*) FROM broadcast_recipients WHERE broadcast_id = NEW.broadcast_id AND status IN ('read','replied')),
    replied_count = (SELECT COUNT(*) FROM broadcast_recipients WHERE broadcast_id = NEW.broadcast_id AND status = 'replied'),
    failed_count = (SELECT COUNT(*) FROM broadcast_recipients WHERE broadcast_id = NEW.broadcast_id AND status = 'failed')
  WHERE b.id = NEW.broadcast_id;

DROP TRIGGER IF EXISTS broadcast_recipients_after_update;
CREATE TRIGGER broadcast_recipients_after_update
AFTER UPDATE ON broadcast_recipients
FOR EACH ROW
  UPDATE broadcasts b
  SET
    sent_count = (SELECT COUNT(*) FROM broadcast_recipients WHERE broadcast_id = NEW.broadcast_id AND status IN ('sent','delivered','read','replied')),
    delivered_count = (SELECT COUNT(*) FROM broadcast_recipients WHERE broadcast_id = NEW.broadcast_id AND status IN ('delivered','read','replied')),
    read_count = (SELECT COUNT(*) FROM broadcast_recipients WHERE broadcast_id = NEW.broadcast_id AND status IN ('read','replied')),
    replied_count = (SELECT COUNT(*) FROM broadcast_recipients WHERE broadcast_id = NEW.broadcast_id AND status = 'replied'),
    failed_count = (SELECT COUNT(*) FROM broadcast_recipients WHERE broadcast_id = NEW.broadcast_id AND status = 'failed')
  WHERE b.id = NEW.broadcast_id;

DROP TRIGGER IF EXISTS broadcast_recipients_after_delete;
CREATE TRIGGER broadcast_recipients_after_delete
AFTER DELETE ON broadcast_recipients
FOR EACH ROW
  UPDATE broadcasts b
  SET
    sent_count = (SELECT COUNT(*) FROM broadcast_recipients WHERE broadcast_id = OLD.broadcast_id AND status IN ('sent','delivered','read','replied')),
    delivered_count = (SELECT COUNT(*) FROM broadcast_recipients WHERE broadcast_id = OLD.broadcast_id AND status IN ('delivered','read','replied')),
    read_count = (SELECT COUNT(*) FROM broadcast_recipients WHERE broadcast_id = OLD.broadcast_id AND status IN ('read','replied')),
    replied_count = (SELECT COUNT(*) FROM broadcast_recipients WHERE broadcast_id = OLD.broadcast_id AND status = 'replied'),
    failed_count = (SELECT COUNT(*) FROM broadcast_recipients WHERE broadcast_id = OLD.broadcast_id AND status = 'failed')
  WHERE b.id = OLD.broadcast_id;
