/**
 * Z-API connection and readiness check for wacrm.
 *
 * Checks:
 * - Required environment variables + value quality
 * - NEXT_PUBLIC_SITE_URL is suitable for provider webhooks
 * - Optional Z-API /me reachability when smoke-check credentials are set
 * - Optional remote migration presence via supabase migration list
 *
 * Usage:
 *   node scripts/zapi-readiness-check.mjs
 * Optional:
 *   SUPABASE_DB_URL=<postgres://...> node scripts/zapi-readiness-check.mjs
 */

import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const REQUIRED = {
  NEXT_PUBLIC_SUPABASE_URL: {
    label: 'NEXT_PUBLIC_SUPABASE_URL',
    validate: (value) => value.startsWith('https://') && value.includes('.supabase.co'),
  },
  NEXT_PUBLIC_SUPABASE_ANON_KEY: {
    label: 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    validate: (value) => value.includes('.') && value.split('.').length >= 3,
  },
  SUPABASE_SERVICE_ROLE_KEY: {
    label: 'SUPABASE_SERVICE_ROLE_KEY',
    validate: (value) => {
      const forbidden = ['COLE_SUA_SERVICE_ROLE_KEY_AQUI', 'your-service-role-key'];
      if (!value.length || forbidden.includes(value)) return false;
      const parts = value.split('.');
      return parts.length >= 3 && parts.every((part) => part.length > 0);
    },
  },
  ENCRYPTION_KEY: {
    label: 'ENCRYPTION_KEY',
    validate: (value) => /^[0-9a-fA-F]{64}$/.test(value),
  },
};

function loadEnvFile(path) {
  if (!fs.existsSync(path)) return {};
  const text = fs.readFileSync(path, 'utf8');
  const lines = text.split(/\r?\n/);
  const env = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    env[key] = value;
  }
  return env;
}

function normalize(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function maskValue(value) {
  if (!value) return '';
  if (value.length <= 12) return '***';
  return `${value.slice(0, 3)}...${value.slice(-3)}`;
}

function decryptSecret(encryptedText, keyHex) {
  const parts = encryptedText.split(':');
  const key = Buffer.from(keyHex, 'hex');

  if (parts.length === 3) {
    const [ivHex, ctHex, tagHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(tagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(ctHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  if (parts.length === 2) {
    const [ivHex, ctHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(ctHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  throw new Error(`unrecognised encrypted secret format (${parts.length - 1} colons)`);
}

function checkSiteUrl(value) {
  if (!value) {
    return {
      ok: false,
      status: 'fail',
      message: 'missing; Z-API requires a public HTTPS webhook URL in production',
      value: '',
    };
  }
  try {
    const url = new URL(value);
    const localhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    const ok = url.protocol === 'https:' || localhost;
    return {
      ok,
      status: ok ? (localhost ? 'warn' : 'ok') : 'fail',
      message: ok
        ? localhost
          ? 'local URL is valid only for local testing'
          : 'valid HTTPS origin'
        : 'must be HTTPS unless using localhost',
      value: `${url.protocol}//${url.host}`,
    };
  } catch {
    return {
      ok: false,
      status: 'fail',
      message: 'invalid URL',
      value,
    };
  }
}

async function checkZapiMe({ instanceId, instanceToken, clientToken }) {
  const url = `https://api.z-api.io/instances/${encodeURIComponent(instanceId)}/token/${encodeURIComponent(instanceToken)}/me`;
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Client-Token': clientToken,
        'Content-Type': 'application/json',
      },
    });
    const text = await response.text().catch(() => '');
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    const connected = data?.connected === true;
    return {
      checked: true,
      ok: response.ok,
      connected,
      status: response.ok ? 'ok' : 'fail',
      value: `${response.status}`,
      message: response.ok
        ? connected
          ? 'Z-API /me reachable and instance is connected'
          : 'Z-API /me reachable, but the instance is not connected yet'
        : `Z-API /me returned ${response.status}: ${text.slice(0, 120)}`,
    };
  } catch (error) {
    return {
      checked: true,
      ok: false,
      connected: false,
      status: 'fail',
      value: '0',
      message: `Z-API request failed: ${error instanceof Error ? error.message : 'unknown error'}`,
    };
  }
}

async function checkZapiReachability(env) {
  const instanceId = normalize(env.ZAPI_INSTANCE_ID);
  const instanceToken = normalize(env.ZAPI_INSTANCE_TOKEN);
  const clientToken = normalize(env.ZAPI_CLIENT_TOKEN);
  if (!instanceId || !instanceToken || !clientToken) {
    return {
      checked: false,
      ok: true,
      connected: false,
      status: 'warn',
      value: '',
      message:
        'smoke credentials not set; normal credentials are stored per account in the database',
    };
  }

  return checkZapiMe({ instanceId, instanceToken, clientToken });
}

function runSupabaseMigrationCheck(dbUrl) {
  const run = dbUrl
    ? spawnSync('npx', ['supabase', 'migration', 'list', '--db-url', dbUrl], {
        encoding: 'utf8',
        timeout: 120000,
      })
    : spawnSync('npx', ['supabase', 'migration', 'list', '--linked'], {
        encoding: 'utf8',
        timeout: 120000,
      });

  if (run.status !== 0) {
    return {
      checked: false,
      ok: false,
      message:
        'Migration proof is unavailable. Set SUPABASE_DB_URL and rerun `zapi:check`, or `supabase link` first.',
    };
  }

  const stdout = `${run.stdout || ''}`;
  const has030 = /030_whatsapp_webhook_replay_guard\.sql/.test(stdout);
  const has031 = /031_zapi_migration\.sql/.test(stdout);
  const has037 = /037_ai_inbox_agent\.sql/.test(stdout);
  const has038 = /038_ai_agent_run_idempotency\.sql/.test(stdout);
  const has039 = /039_ai_agent_user_owner_fallback\.sql/.test(stdout);
  const ok = has030 && has031 && has037 && has038 && has039;

  return {
    checked: true,
    ok,
    versionsFound: stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
    message:
      ok
        ? 'Found migration versions 030, 031, 037, 038, and 039 in remote migration history.'
        : 'Missing one or more required migration versions 030, 031, 037, 038, or 039 in output.',
  };
}

function checkLocalAiMigrations() {
  const required = [
    'supabase/migrations/037_ai_inbox_agent.sql',
    'supabase/migrations/038_ai_agent_run_idempotency.sql',
    'supabase/migrations/039_ai_agent_user_owner_fallback.sql',
  ];
  const missing = required.filter((path) => !fs.existsSync(path));
  return {
    ok: missing.length === 0,
    missing,
    message: missing.length === 0
      ? 'AI migration files 037, 038, and 039 are present locally.'
      : `missing local AI migration file(s): ${missing.join(', ')}`,
  };
}

function checkOpenAiProvider(value) {
  const normalized = normalize(value);
  const ok = normalized.startsWith('sk-') && normalized.length > 20;
  return {
    ok,
    status: ok ? 'ok' : 'fail',
    value: ok ? 'openai' : '',
    message: ok
      ? 'OpenAI Responses API provider key is present'
      : 'missing or invalid OPENAI_API_KEY; AI inbox agent cannot run in production',
  };
}

async function checkSavedZapiConfig(env, targetAccountId) {
  const checks = [];

  const supabaseUrl = normalize(env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceRoleKey = normalize(env.SUPABASE_SERVICE_ROLE_KEY);
  const encryptionKey = normalize(env.ENCRYPTION_KEY);
  if (!supabaseUrl || !serviceRoleKey || !/^[0-9a-fA-F]{64}$/.test(encryptionKey)) {
    return {
      ok: false,
      checks: [
        {
          item: 'db.whatsapp_config',
          status: 'fail',
          value: '',
          message: 'cannot inspect saved Z-API config until Supabase env and ENCRYPTION_KEY are valid',
        },
      ],
    };
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  let query = supabase
    .from('whatsapp_config')
    .select(
      'id, account_id, zapi_instance_id, zapi_instance_token, zapi_client_token, zapi_webhook_secret, zapi_connected_phone, connection_status, status'
    )
    .order('updated_at', { ascending: false });
  if (targetAccountId) query = query.eq('account_id', targetAccountId);

  const { data, error } = await query;

  if (error) {
    return {
      ok: false,
      checks: [
        {
          item: 'db.whatsapp_config_schema',
          status: 'fail',
          value: error.code || '',
          message: `cannot select Z-API columns from whatsapp_config: ${error.message}`,
        },
      ],
    };
  }

  checks.push({
    item: 'db.whatsapp_config_schema',
    status: 'ok',
    value: `${data.length} row(s)`,
    message: targetAccountId
      ? 'Z-API columns are present on whatsapp_config for the target account'
      : 'Z-API columns are present on whatsapp_config',
  });

  const completeRows = data.filter(
    (row) =>
      row.zapi_instance_id &&
      row.zapi_instance_token &&
      row.zapi_client_token &&
      row.zapi_webhook_secret
  );

  if (!completeRows.length) {
    checks.push({
      item: 'db.whatsapp_config_rows',
      status: 'fail',
      value: `${data.length} row(s)`,
      message: targetAccountId
        ? 'target account has no zapi_instance_id, encrypted instance token, Client-Token, and webhook secret'
        : 'no account has zapi_instance_id, encrypted instance token, Client-Token, and webhook secret',
    });
    return { ok: false, checks };
  }

  checks.push({
    item: 'db.whatsapp_config_rows',
    status: 'ok',
    value: `${completeRows.length} configured`,
    message: targetAccountId
      ? 'target account has encrypted Z-API credentials and webhook secret'
      : 'at least one account has encrypted Z-API credentials and webhook secret',
  });

  let lastMessage = 'no configured row could be validated against Z-API /me';
  for (const row of completeRows) {
    try {
      const zapiCheck = await checkZapiMe({
        instanceId: row.zapi_instance_id,
        instanceToken: decryptSecret(row.zapi_instance_token, encryptionKey),
        clientToken: decryptSecret(row.zapi_client_token, encryptionKey),
      });
      lastMessage = zapiCheck.message;
      if (zapiCheck.ok && zapiCheck.connected) {
        checks.push({
          item: 'db.zapi.me',
          status: 'ok',
          value: maskValue(row.zapi_instance_id),
          message: 'saved Z-API credentials validate and the instance is connected',
        });
        return { ok: true, checks };
      }
    } catch (error) {
      lastMessage =
        error instanceof Error ? `failed to decrypt or validate saved Z-API credentials: ${error.message}` : lastMessage;
    }
  }

  checks.push({
    item: 'db.zapi.me',
    status: 'fail',
    value: '',
    message: lastMessage,
  });
  return { ok: false, checks };
}

(async function main() {
  const envFromFile = loadEnvFile('.env.local');
  const env = { ...envFromFile, ...process.env };
  const checks = [];
  let allOk = true;

  console.log('wacrm + Z-API readiness check');
  console.log('-----------------------------');

  for (const [key, cfg] of Object.entries(REQUIRED)) {
    const value = normalize(env[key]);
    const valid = value && cfg.validate(value);
    checks.push({
      item: `env.${key}`,
      status: valid ? 'ok' : 'fail',
      value: maskValue(value),
      message: valid ? 'valid' : `invalid or missing (${cfg.label})`,
    });
    if (!valid) allOk = false;
  }

  const siteUrl = checkSiteUrl(normalize(env.NEXT_PUBLIC_SITE_URL));
  checks.push({
    item: 'env.NEXT_PUBLIC_SITE_URL',
    status: siteUrl.status,
    value: siteUrl.value,
    message: siteUrl.message,
  });
  if (!siteUrl.ok) allOk = false;

  const cronSecret = normalize(env.AUTOMATION_CRON_SECRET);
  checks.push({
    item: 'env.AUTOMATION_CRON_SECRET',
    status: cronSecret ? 'ok' : 'fail',
    value: cronSecret ? maskValue(cronSecret) : '',
    message: cronSecret ? 'present' : 'missing; cron smoke tests will fail',
  });
  if (!cronSecret) allOk = false;

  const openAiProvider = checkOpenAiProvider(env.OPENAI_API_KEY);
  checks.push({
    item: 'ai.provider',
    status: openAiProvider.status,
    value: openAiProvider.value,
    message: openAiProvider.message,
  });
  if (!openAiProvider.ok) allOk = false;

  const targetAccountId = normalize(env.WACRM_TARGET_ACCOUNT_ID);
  checks.push({
    item: 'env.WACRM_TARGET_ACCOUNT_ID',
    status: targetAccountId ? 'ok' : 'fail',
    value: targetAccountId ? maskValue(targetAccountId) : '',
    message: targetAccountId
      ? 'target account selected for saved Z-API readiness checks'
      : 'missing; readiness must validate the target production account, not any account',
  });
  if (!targetAccountId) allOk = false;

  const zapiCheck = await checkZapiReachability(env);
  checks.push({
    item: 'zapi.me',
    status: zapiCheck.status,
    value: zapiCheck.value,
    message: zapiCheck.message,
  });
  if (!zapiCheck.ok) allOk = false;

  const migrationCheck = runSupabaseMigrationCheck(normalize(env.SUPABASE_DB_URL));
  checks.push({
    item: 'db.migrations',
    status: migrationCheck.ok ? 'ok' : migrationCheck.checked ? 'fail' : 'warn',
    value: migrationCheck.versionsFound ? `${migrationCheck.versionsFound.length} entries` : '',
    message: migrationCheck.message,
  });
  if (!migrationCheck.ok) allOk = false;

  const localAiMigrations = checkLocalAiMigrations();
  checks.push({
    item: 'local.ai_migrations',
    status: localAiMigrations.ok ? 'ok' : 'fail',
    value: localAiMigrations.ok ? '032,033,034' : '',
    message: localAiMigrations.message,
  });
  if (!localAiMigrations.ok) allOk = false;

  const savedConfigCheck = await checkSavedZapiConfig(env, targetAccountId);
  checks.push(...savedConfigCheck.checks);
  if (!savedConfigCheck.ok) allOk = false;

  console.log('');
  for (const check of checks) {
    const line = [
      check.item.padEnd(30),
      check.status.padEnd(5).toUpperCase(),
      check.value ? `[${check.value}]` : '[ ]',
      `- ${check.message}`,
    ].join(' ');
    console.log(line);
  }

  if (migrationCheck.checked) {
    console.log('');
    console.log('Migration versions returned by Supabase CLI:');
    if (migrationCheck.versionsFound?.length) {
      for (const item of migrationCheck.versionsFound) {
        console.log(`- ${item}`);
      }
    } else {
      console.log('- (none found)');
    }
  }

  console.log('');
  if (allOk) {
    console.log('Result: READY');
    process.exitCode = 0;
  } else {
    console.log('Result: BLOCKED');
    process.exitCode = 1;
  }
})();
