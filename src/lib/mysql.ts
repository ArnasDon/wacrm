import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';

let pool: mysql.Pool | null = null;
let initialized = false;

export function getPool(): mysql.Pool {
  if (pool) return pool;

  const connectionUri = process.env.DATABASE_URL;

  if (connectionUri) {
    pool = mysql.createPool({
      uri: connectionUri,
      waitForConnections: true,
      connectionLimit: 20,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
    });
  } else {
    pool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'vedmint_crm',
      port: Number(process.env.DB_PORT) || 3306,
      waitForConnections: true,
      connectionLimit: 20,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
    });
  }

  // Automatically initialize database schema in background
  if (!initialized) {
    initialized = true;
    initializeDatabase(pool).catch((err) => {
      console.error('[MySQL] async schema init failed:', err);
    });
  }

  return pool;
}

async function ensureColumn(
  connection: mysql.PoolConnection,
  sql: string,
  label: string,
): Promise<void> {
  try {
    await connection.query(sql);
    console.log(`[MySQL] migration applied: ${label}`);
  } catch (err: any) {
    if (err.code === "ER_DUP_FIELDNAME" || err.errno === 1060) {
      console.log(`[MySQL] migration exists: ${label}`);
      return;
    }
    console.warn(`[MySQL] migration ${label}:`, err.message);
  }
}

async function ensureIndex(
  connection: mysql.PoolConnection,
  sql: string,
  label: string,
): Promise<void> {
  try {
    await connection.query(sql);
  } catch (err: any) {
    if (err.code === "ER_DUP_KEYNAME" || err.errno === 1061) return;
    console.warn(`[MySQL] index ${label}:`, err.message);
  }
}

async function ensureSchemaMigrations(connection: mysql.PoolConnection) {
  await ensureEmailVerifiedColumn(connection);

  await ensureColumn(
    connection,
    "ALTER TABLE users ADD COLUMN two_factor_enabled TINYINT(1) NOT NULL DEFAULT 0",
    "users.two_factor_enabled",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE profiles ADD COLUMN mobile_no VARCHAR(32) NULL",
    "profiles.mobile_no",
  );
  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS auth_login_otps (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        code_hash VARCHAR(255) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        attempts INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_auth_login_otps_user (user_id)
      )
    `);
    console.log("[MySQL] migration ensured: auth_login_otps");
  } catch (err: any) {
    console.warn("[MySQL] auth_login_otps table:", err.message);
  }

  await ensureColumn(
    connection,
    "ALTER TABLE contacts ADD COLUMN user_id VARCHAR(36) NULL AFTER account_id",
    "contacts.user_id",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE contacts ADD COLUMN assigned_to VARCHAR(36) NULL AFTER company",
    "contacts.assigned_to",
  );

  await ensureColumn(
    connection,
    "ALTER TABLE tags ADD COLUMN user_id VARCHAR(36) NULL AFTER account_id",
    "tags.user_id",
  );

  await ensureColumn(
    connection,
    "ALTER TABLE pipelines ADD COLUMN user_id VARCHAR(36) NULL AFTER account_id",
    "pipelines.user_id",
  );

  await ensureColumn(
    connection,
    "ALTER TABLE deals ADD COLUMN pipeline_id VARCHAR(36) NULL AFTER account_id",
    "deals.pipeline_id",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE deals ADD COLUMN user_id VARCHAR(36) NULL AFTER stage_id",
    "deals.user_id",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE deals ADD COLUMN currency VARCHAR(10) DEFAULT 'USD' AFTER value",
    "deals.currency",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE deals ADD COLUMN assigned_to VARCHAR(36) NULL AFTER contact_id",
    "deals.assigned_to",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE deals ADD COLUMN notes TEXT NULL AFTER assigned_to",
    "deals.notes",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE deals ADD COLUMN expected_close_date DATE NULL AFTER notes",
    "deals.expected_close_date",
  );

  await ensureIndex(
    connection,
    "CREATE INDEX idx_contacts_assigned_to ON contacts(assigned_to)",
    "idx_contacts_assigned_to",
  );

  // Automations & flows — align live DB with application inserts/filters
  await ensureColumn(
    connection,
    "ALTER TABLE whatsapp_config ADD COLUMN user_id VARCHAR(36) NULL AFTER account_id",
    "whatsapp_config.user_id",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE whatsapp_config ADD COLUMN registered_at TIMESTAMP NULL",
    "whatsapp_config.registered_at",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE whatsapp_config ADD COLUMN subscribed_apps_at TIMESTAMP NULL",
    "whatsapp_config.subscribed_apps_at",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE whatsapp_config ADD COLUMN last_registration_error TEXT NULL",
    "whatsapp_config.last_registration_error",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE message_templates ADD COLUMN user_id VARCHAR(36) NULL AFTER account_id",
    "message_templates.user_id",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE message_templates ADD COLUMN header_type VARCHAR(50) NULL",
    "message_templates.header_type",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE message_templates ADD COLUMN header_content TEXT NULL",
    "message_templates.header_content",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE message_templates ADD COLUMN header_handle VARCHAR(512) NULL",
    "message_templates.header_handle",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE message_templates ADD COLUMN header_media_url TEXT NULL",
    "message_templates.header_media_url",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE message_templates ADD COLUMN header_media_id VARCHAR(255) NULL",
    "message_templates.header_media_id",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE message_templates ADD COLUMN body_text TEXT NULL",
    "message_templates.body_text",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE message_templates ADD COLUMN footer_text TEXT NULL",
    "message_templates.footer_text",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE message_templates ADD COLUMN buttons JSON NULL",
    "message_templates.buttons",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE message_templates ADD COLUMN sample_values JSON NULL",
    "message_templates.sample_values",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE message_templates ADD COLUMN quality_score VARCHAR(20) NULL",
    "message_templates.quality_score",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE message_templates ADD COLUMN submission_error TEXT NULL",
    "message_templates.submission_error",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE message_templates ADD COLUMN rejection_reason TEXT NULL",
    "message_templates.rejection_reason",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE message_templates ADD COLUMN last_submitted_at TIMESTAMP NULL",
    "message_templates.last_submitted_at",
  );

  await ensureColumn(
    connection,
    "ALTER TABLE broadcasts ADD COLUMN user_id VARCHAR(36) NULL AFTER account_id",
    "broadcasts.user_id",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE broadcasts ADD COLUMN template_variables JSON NULL AFTER template_language",
    "broadcasts.template_variables",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE broadcasts ADD COLUMN audience_filter JSON NULL AFTER template_variables",
    "broadcasts.audience_filter",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE broadcasts ADD COLUMN scheduled_at TIMESTAMP NULL AFTER audience_filter",
    "broadcasts.scheduled_at",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE broadcasts ADD COLUMN replied_count INT DEFAULT 0 AFTER read_count",
    "broadcasts.replied_count",
  );

  await ensureColumn(
    connection,
    "ALTER TABLE broadcast_recipients ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
    "broadcast_recipients.created_at",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE broadcast_recipients ADD COLUMN replied_at TIMESTAMP NULL",
    "broadcast_recipients.replied_at",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE broadcast_recipients ADD COLUMN whatsapp_message_id VARCHAR(255) NULL",
    "broadcast_recipients.whatsapp_message_id",
  );

  await ensureColumn(
    connection,
    "ALTER TABLE automations ADD COLUMN user_id VARCHAR(36) NULL AFTER account_id",
    "automations.user_id",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE automations ADD COLUMN description TEXT NULL AFTER name",
    "automations.description",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE automations ADD COLUMN execution_count INT DEFAULT 0 AFTER is_active",
    "automations.execution_count",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE automations ADD COLUMN last_executed_at TIMESTAMP NULL AFTER execution_count",
    "automations.last_executed_at",
  );

  await ensureColumn(
    connection,
    "ALTER TABLE automation_logs ADD COLUMN user_id VARCHAR(36) NULL AFTER automation_id",
    "automation_logs.user_id",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE automation_logs ADD COLUMN steps_executed JSON NULL AFTER trigger_event",
    "automation_logs.steps_executed",
  );

  await ensureColumn(
    connection,
    "ALTER TABLE automation_pending_executions ADD COLUMN user_id VARCHAR(36) NULL AFTER automation_id",
    "automation_pending_executions.user_id",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE automation_pending_executions ADD COLUMN log_id VARCHAR(36) NULL AFTER contact_id",
    "automation_pending_executions.log_id",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE automation_pending_executions ADD COLUMN parent_step_id VARCHAR(36) NULL AFTER log_id",
    "automation_pending_executions.parent_step_id",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE automation_pending_executions ADD COLUMN branch VARCHAR(50) NULL AFTER parent_step_id",
    "automation_pending_executions.branch",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE automation_pending_executions ADD COLUMN next_step_position INT NULL AFTER branch",
    "automation_pending_executions.next_step_position",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE automation_pending_executions ADD COLUMN context JSON NULL AFTER next_step_position",
    "automation_pending_executions.context",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE automation_pending_executions ADD COLUMN run_at TIMESTAMP NULL AFTER context",
    "automation_pending_executions.run_at",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE automation_pending_executions ADD COLUMN status VARCHAR(50) DEFAULT 'pending' AFTER run_at",
    "automation_pending_executions.status",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE automation_pending_executions MODIFY COLUMN step_index INT NULL",
    "automation_pending_executions.step_index_nullable",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE automation_pending_executions MODIFY COLUMN execute_at TIMESTAMP NULL",
    "automation_pending_executions.execute_at_nullable",
  );

  await ensureColumn(
    connection,
    "ALTER TABLE flows ADD COLUMN user_id VARCHAR(36) NULL AFTER account_id",
    "flows.user_id",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE flows ADD COLUMN execution_count INT DEFAULT 0 AFTER status",
    "flows.execution_count",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE flows ADD COLUMN last_executed_at TIMESTAMP NULL AFTER execution_count",
    "flows.last_executed_at",
  );

  await ensureColumn(
    connection,
    "ALTER TABLE flow_runs ADD COLUMN user_id VARCHAR(36) NULL AFTER flow_id",
    "flow_runs.user_id",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE flow_runs ADD COLUMN conversation_id VARCHAR(36) NULL AFTER contact_id",
    "flow_runs.conversation_id",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE flow_runs ADD COLUMN current_node_key VARCHAR(255) NULL AFTER conversation_id",
    "flow_runs.current_node_key",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE flow_runs ADD COLUMN vars JSON NULL AFTER current_node_id",
    "flow_runs.vars",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE flow_runs ADD COLUMN reprompt_count INT DEFAULT 0 AFTER status",
    "flow_runs.reprompt_count",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE flow_runs ADD COLUMN last_prompt_message_id VARCHAR(255) NULL AFTER reprompt_count",
    "flow_runs.last_prompt_message_id",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE flow_runs ADD COLUMN started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP AFTER last_prompt_message_id",
    "flow_runs.started_at",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE flow_runs ADD COLUMN last_advanced_at TIMESTAMP NULL AFTER started_at",
    "flow_runs.last_advanced_at",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE flow_runs ADD COLUMN ended_at TIMESTAMP NULL AFTER last_advanced_at",
    "flow_runs.ended_at",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE flow_runs ADD COLUMN end_reason VARCHAR(255) NULL AFTER ended_at",
    "flow_runs.end_reason",
  );

  // Inbox / WhatsApp webhook — columns referenced by inbound message inserts
  await ensureColumn(
    connection,
    "ALTER TABLE messages ADD COLUMN reply_to_message_id VARCHAR(36) NULL AFTER status",
    "messages.reply_to_message_id",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE messages ADD COLUMN interactive_reply_id VARCHAR(255) NULL AFTER reply_to_message_id",
    "messages.interactive_reply_id",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE conversations ADD COLUMN reply_deadline_at TIMESTAMP NULL AFTER unread_count",
    "conversations.reply_deadline_at",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE contacts ADD COLUMN last_contacted_at TIMESTAMP NULL AFTER avatar_url",
    "contacts.last_contacted_at",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE contacts ADD COLUMN last_contacted_via VARCHAR(50) NULL AFTER last_contacted_at",
    "contacts.last_contacted_via",
  );
  await ensureColumn(
    connection,
    "ALTER TABLE contacts ADD COLUMN first_inbound_message_at TIMESTAMP NULL AFTER last_contacted_via",
    "contacts.first_inbound_message_at",
  );
}

async function ensureEmailVerifiedColumn(connection: mysql.PoolConnection) {
  let columnAdded = false;
  try {
    await connection.query(
      'ALTER TABLE users ADD COLUMN email_verified TINYINT(1) NOT NULL DEFAULT 0',
    );
    columnAdded = true;
  } catch (err: any) {
    const alreadyExists =
      err.code === 'ER_DUP_FIELDNAME' ||
      err.errno === 1060;
    if (!alreadyExists) {
      console.warn('[MySQL] email_verified migration:', err.message);
    }
  }

  if (columnAdded) {
    await connection.query('UPDATE users SET email_verified = 1');
    console.log('[MySQL] Grandfathered existing users as email-verified');
  }
}

async function initializeDatabase(p: mysql.Pool) {
  try {
    const schemaPath = path.join(process.cwd(), 'supabase', 'mysql_schema.sql');
    if (!fs.existsSync(schemaPath)) {
      console.warn('[MySQL] mysql_schema.sql file not found at:', schemaPath);
      return;
    }
    const sqlContent = fs.readFileSync(schemaPath, 'utf8');
    
    // Split statements carefully by semicolon at end of line
    const statements = sqlContent
      .split(/;\s*\r?\n/)
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    const connection = await p.getConnection();
    try {
      for (const statement of statements) {
        if (!statement) continue;
        try {
          await connection.query(statement);
        } catch (err: any) {
          const isDuplicateError = 
            err.code === 'ER_DUP_KEYNAME' || 
            err.code === 'ER_TABLE_EXISTS_ERROR' || 
            err.code === 'ER_DUP_FIELDNAME' ||
            err.errno === 1061 || 
            err.errno === 1050 || 
            err.errno === 1060;
          
          if (!isDuplicateError) {
            console.warn(`[MySQL] warning executing statement: ${err.message}`);
          }
        }
      }

      await ensureSchemaMigrations(connection);

      console.log('[MySQL] Database schema initialized/verified successfully');
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('[MySQL] Database schema initialization failed:', error);
  }
}

export async function query<T = any>(sql: string, params?: any[]): Promise<T[]> {
  const p = getPool();
  const [rows] = await p.execute(sql, params);
  return rows as T[];
}

export async function transaction<T>(callback: (connection: mysql.PoolConnection) => Promise<T>): Promise<T> {
  const p = getPool();
  const connection = await p.getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
