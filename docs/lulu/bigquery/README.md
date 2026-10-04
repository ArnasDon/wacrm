# BigQuery → WACRM

1. Run each query in `diagnostics.sql` and check the results (statuses, shared phones, item join, phone format).
2. Adjust the `params` CTE at the top of `customer_master.sql` (valid statuses, VIP share, etc.).
3. Run `customer_master.sql` — one row per customer, columns already match the sync API.
4. Load it into WACRM with n8n (below) or any script.

## n8n workflow
Import `docs/lulu/n8n/lulu-customer-sync.workflow.json` (n8n → Workflows → Import from file). It runs
`Manual run | Daily 06:00` → BigQuery (`SELECT * FROM lulu_customer_master`) → batches of 500 → loop → POST to the
sync API (3 retries, 1 s pause) → Summary. Setup steps are in the sticky note inside the workflow.

Region: `customer_master.sql` keeps only customers whose latest order city is in `focus_cities` (western province for
phase 1). Set it to `[]` to include everyone once Riyadh / Eastern data is ready; re-run `create_view.sql` afterwards.

## Consent (read before any live send)
These tables contain no marketing-consent field. The sync therefore stores new customers as opted-in by default.
Before the first live campaign, confirm where WhatsApp opt-in is captured (checkout checkbox, app setting, prior
conversation) and send `marketing_opt_in` explicitly. Note that a customer already marked opted-out is never
flipped back by a sync.
