# Z-API Implementation Runbook (`wacrm`)

This runbook covers the WhatsApp provider flow using Z-API.

## 1) Prerequisites

Before connecting an instance:

1. Configure `.env.local` or production env:
   - `SUPABASE_SERVICE_ROLE_KEY` with a real service-role key
   - `ENCRYPTION_KEY` with 64 hex chars
   - `NEXT_PUBLIC_SITE_URL` with the public HTTPS app origin in production
   - `AUTOMATION_CRON_SECRET` for cron smoke tests
2. Create or reuse an existing Z-API instance.
3. Have the instance ID, instance token, and Client-Token available.

Z-API credentials are not global env vars for normal runtime. They are
saved per account in Settings > WhatsApp and encrypted in
`whatsapp_config`.

## 2) Readiness Check

Run:

```bash
npm run zapi:check
```

This validates:

- required Supabase/env values
- `ENCRYPTION_KEY` format
- `NEXT_PUBLIC_SITE_URL` suitability for webhooks
- `AUTOMATION_CRON_SECRET`
- optional Z-API `/me` reachability if `ZAPI_INSTANCE_ID`,
  `ZAPI_INSTANCE_TOKEN`, and `ZAPI_CLIENT_TOKEN` are set for a smoke check
- remote migration proof for migrations `030` and `031`
- the remote `whatsapp_config` schema, saved encrypted Z-API credentials,
  and a `/me` validation using those saved credentials

## 3) Required Migrations

The target environment must have:

- `supabase/migrations/030_whatsapp_webhook_replay_guard.sql`
- `supabase/migrations/031_zapi_migration.sql`

Remote proof options:

```bash
npx supabase migration list --linked
```

or:

```bash
npx supabase migration list --db-url "$SUPABASE_DB_URL"
```

## 4) Connect Z-API in the UI

1. Open Settings > WhatsApp.
2. Enter:
   - Z-API instance ID
   - Z-API instance token
   - Z-API Client-Token
3. Click Connect WhatsApp.
4. The app validates `/me`, generates/reuses an encrypted webhook secret,
   and configures Z-API webhooks to:
   `/api/whatsapp/webhook?secret=<server-generated-secret>`.
5. If the instance is not connected, scan the QR code.

The UI shows only the callback route without the secret. The secret stays
encrypted server-side.

## 5) Webhook Validation

The webhook accepts Z-API payloads only when:

- `secret` in the URL matches the encrypted account secret
- `instanceId` matches a saved `whatsapp_config.zapi_instance_id`
- replay guard accepts the event key

Expected callbacks:

- `ConnectedCallback`
- `DisconnectedCallback`
- `MessageStatusCallback`
- inbound message payloads

Status mapping:

- `SENT` -> `sent`
- `RECEIVED` -> `delivered`
- `READ`, `READ_BY_ME`, `PLAYED` -> `read`

Inbound messages from `fromMe`, groups, and newsletters are ignored.

## 6) Message Smoke Tests

With the instance connected:

1. Send text from the inbox or `POST /api/v1/messages`.
2. Send media and confirm `whatsapp_message_id` is saved.
3. React to a message and confirm `/send-reaction` succeeds.
4. Send a dashboard or public API broadcast.
5. Trigger an automation and a flow send step.
6. Send a real inbound message and confirm contact, conversation, message,
   flows, automations, and external webhooks behave as expected.

## 7) Block Production Readiness When

- `SUPABASE_SERVICE_ROLE_KEY` is missing or placeholder.
- `ENCRYPTION_KEY` is not 64 hex chars.
- `NEXT_PUBLIC_SITE_URL` is not public HTTPS for production.
- Migrations `030` and `031` are not proven remotely.
- The account lacks encrypted Z-API instance token, Client-Token, or
  webhook secret.
- Z-API `/me` does not validate, unless the environment is explicitly in
  QR-pending setup mode.
- Cron smoke tests still fail with
  `AUTOMATION_CRON_SECRET is not configured`.
