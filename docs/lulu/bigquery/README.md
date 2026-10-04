# BigQuery → WACRM

1. Run each query in `diagnostics.sql` and check the results (statuses, shared phones, item join, phone format).
2. Adjust the `params` CTE at the top of `customer_master.sql` (valid statuses, VIP share, etc.).
3. Run `customer_master.sql` — one row per customer, columns already match the sync API.
4. Load it into WACRM with n8n (below) or any script.

## n8n workflow (daily)
`Schedule Trigger` → `Google BigQuery` (Execute Query: paste customer_master.sql) →
`Code` (chunk) → `Loop Over Items / Split In Batches` → `HTTP Request` (POST) → `Wait` (1 s)

**Code node** — builds batches of 500 for the API:
```js
const rows = $input.all().map(i => i.json);
const out = [];
for (let i = 0; i < rows.length; i += 500) {
  out.push({ json: { customers: rows.slice(i, i + 500), create_contacts: false } });
}
return out;
```

**HTTP Request node:** POST `https://<your-app>/api/v1/lulu/customers/sync`,
header `Authorization: Bearer wacrm_live_…`, body = JSON `{{ $json }}`.

Start with `create_contacts: false`: profiles link only to customers who already exist as WhatsApp contacts.
Turn it on only after you've decided who is allowed to be messaged (see consent note below).

## Consent (read before any live send)
These tables contain no marketing-consent field. The sync therefore stores new customers as opted-in by default.
Before the first live campaign, confirm where WhatsApp opt-in is captured (checkout checkbox, app setting, prior
conversation) and send `marketing_opt_in` explicitly. Note that a customer already marked opted-out is never
flipped back by a sync.
