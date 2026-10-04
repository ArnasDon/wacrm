# LuLu Customer Engagement module

Implements the LuLu PRD on top of WACRM. **Rule: don't modify WACRM core when an
extension/API integration works.** Everything LuLu lives in:

- `supabase/migrations/043_lulu_engagement_foundation.sql` — `lulu_*` tables only
- `src/lib/lulu/` — pure decision engine (no I/O, unit-tested)
- `src/app/(dashboard)/engagement/` — overview page
- `src/app/api/v1/lulu/` — LuLu API routes

## Ownership
BigQuery = ecommerce truth · WACRM = communication truth · `lulu_*` = decision truth.

## Engine (src/lib/lulu)
- `lifecycle.ts` — NEW→FIRST_ORDER→ACTIVE→AT_RISK→DORMANT→LOST, cycle-aware (falls back to 15/30/60 days)
- `contact-policy.ts` — opt-out, complaint, post-order suppression, frequency caps, quiet hours
- `next-best-action.ts` — match campaigns → policy gate → configurable priority → idempotent action

## Data
`docs/lulu/bigquery/` — customer master SQL (built from `ksa_jackpot` + `instaleap_raw`), diagnostics, n8n setup.

## Roadmap (PRD §95 V1)
1. ✅ Schema + decision engine
2. ✅ Customer sync endpoint (`docs/lulu/sync-api.md`) + `/engagement` overview page · ⏳ tag sync
3. Action-queue worker (batch ≤1000, 120 req/min, retry/backoff) → WACRM broadcast API
4. Webhook consumer (status/STOP) → `lulu_campaign_events`
5. `/engagement` dashboard + campaign/offer admin, dry-run/test mode, approval
6. Attribution job (orders → campaign window)
