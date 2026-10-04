# Customer sync API

`POST /api/v1/lulu/customers/sync` — BigQuery → WACRM customer read-model.

**Auth:** `Authorization: Bearer <api key>` (create under Settings → API keys) with scope
`contacts:write`. **Limit:** 500 customers per request, 120 requests/min per key.

```bash
curl -X POST https://<your-app>/api/v1/lulu/customers/sync \
  -H "Authorization: Bearer wacrm_live_xxx" -H "Content-Type: application/json" \
  -d '{
    "create_contacts": false,
    "customers": [{
      "customer_id": "12345",
      "mobile": "0500000000",
      "name": "Ahmed",
      "language": "ar",
      "birthday": "1990-09-24",
      "first_order_date": "2025-01-10",
      "last_order_date": "2026-09-05",
      "total_orders": 38,
      "total_sales": 5244,
      "median_interval_days": 10,
      "preferred_store": "3805 Amir Fawaz",
      "preferred_category": "Grocery",
      "vip_flag": true,
      "marketing_opt_in": true
    }]
  }'
```

## Fields
Required: `customer_id`, `mobile` (05XXXXXXXX, 5XXXXXXXX, 9665…, +9665… all accepted; non-Saudi numbers need `+`/`00`).
Optional: `loyalty_id, name, language (ar|en, default ar), birthday, first_order_date, last_order_date,
total_orders, total_sales, average_order_value (derived if absent), orders_30d, orders_90d,
median_interval_days, stddev_interval_days, preferred_store, preferred_category, customer_segment,
rfm_recency/frequency/monetary (1-5), lifetime_value, vip_flag, marketing_opt_in (default true), active_complaint,
distinct_names, distinct_emails, suspect_reason, data_as_of`.

`data_as_of` (ISO time of the newest order in the source data; body-level or per row) is stored on the sync log and shown on
`/engagement` with a warning when older than 36 h.

`suspect_reason` (non-empty text, e.g. `many_names:796`) flags a suspected shared/fake number: the profile is stored and
listed on `/engagement`, but excluded from KPIs and never contacted. Sending the customer again without it clears the flag.

`lifecycle_stage` is computed by the engine (personal purchase cycle when ≥3 orders and `median_interval_days`
is given; otherwise 15/30/60-day fallback).

## Behaviour
- Upsert on `(account, customer_id)`; safe to re-send.
- Profiles link to existing WACRM contacts by phone. `create_contacts: true` also creates missing contacts.
- **Opt-out is sticky:** a customer already `marketing_opt_in=false` is never flipped back by a sync.
- Response: `{ received, upserted, failed, contacts_linked, contacts_created, opted_out_preserved, errors[≤50] }`.
  Bad rows are reported and skipped; the rest are saved (`status: PARTIAL` in `lulu_customer_sync_log`).

## BigQuery → n8n
Schedule node (daily) → BigQuery node (customer master query) → Code node chunking into arrays of 500 →
HTTP Request node (POST above, header auth). Add a short wait between chunks.
