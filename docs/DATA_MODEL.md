# Data Model (§9.0/§22)

Records which tables are reused as-is from the [wacrm](https://github.com/ArnasDon/wacrm)
foundation, which were extended with Rimula-specific columns, and
which are entirely net-new — the record §22 says "keeps the fork
maintainable and mergeable against upstream." Verified against the
actual migration SQL in `supabase/migrations/`, not assumed from the
spec — see each migration's own header comment for the full rationale
behind a given column.

Tenancy: every table below is scoped by `account_id NOT NULL`, with
RLS via the `is_account_member(account_id, min_role)` SECURITY
DEFINER helper (migration 017). A `user_id` column, where one exists
alongside `account_id`, is legacy/audit only and does **not** enforce
isolation (§14).

## Reused as-is

Untouched by any Rimula migration — full wacrm foundation functionality.

| Table                                                                         | Rimula role                                                                                                                                             |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accounts`, `account_invitations`, `account_role_enum`                        | Tenancy                                                                                                                                                 |
| `conversations`                                                               | WhatsApp thread per Member (one per contact, enforced at the DB level since migration 036)                                                              |
| `messages`, `message_reactions`                                               | WhatsApp messages + reactions                                                                                                                           |
| `message_templates`                                                           | Meta-approved templates                                                                                                                                 |
| `pipelines`, `pipeline_stages`                                                | Kanban board underneath Leads (see `deals` below — a Lead is still a Kanban deal)                                                                       |
| `automations`, `automation_logs`, `automation_pending_executions`             | No-code automation engine                                                                                                                               |
| `flows`, `flow_nodes`, `flow_runs`, `flow_run_events`                         | Visual Flow builder                                                                                                                                     |
| `ai_configs`, `ai_knowledge_documents`, `ai_knowledge_chunks`, `ai_usage_log` | AI reply assistant + knowledge base (pgvector)                                                                                                          |
| `api_keys`, `webhook_endpoints`                                               | Public API + outbound webhooks                                                                                                                          |
| `quick_replies`                                                               | Reusable BA response snippets                                                                                                                           |
| `tags`, `custom_fields`, `contact_tags`, `contact_custom_values`              | Contact tagging/custom fields                                                                                                                           |
| Storage buckets `avatars`, `flow-media`, `chat-media`                         | Media (Rimula product images, content media, voice notes, and inbound-media mirrors all reuse `chat-media`, `account-<account_id>/...` path convention) |

## Extended

Existing table, new Rimula-specific columns. Migration column names the
change so you can find the exact `ALTER TABLE`.

| Table                          | Rimula concept                             | Key new columns                                                                                                                                                                                                                                                  | Migration                   |
| ------------------------------ | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `profiles`                     | `BA` (extends the account-member identity) | `region_id`, `market_id`, `ba_status`, `open_leads`, `capacity`, `languages` (`ur`/`ps`/`pa`/`ur-Roman`)                                                                                                                                                         | 051                         |
| `contacts`                     | `Member`                                   | `role`, `region_id`, `market_id`, `vehicle`, `vehicle_type`, `opt_in_status`, `whatsapp_status`, `community_status`, `joined_date`, `last_engagement`                                                                                                            | 050                         |
| `broadcasts`                   | `ScheduledPost` / Announcements            | `content_id` (→ `content`), `language`                                                                                                                                                                                                                           | 053                         |
| `deals`                        | `Lead`                                     | `status` widened from `'open'/'won'/'lost'` to the 8-value funnel enum (`NEW…CONVERTED/LOST`, existing rows remapped); `source`, `campaign_id`, `original_content_id`, `market_id`, `region_id`, `next_follow_up`, `last_contacted`, `outcome`, `routing_reason` | 055, 056 (`routing_reason`) |
| `customer_requests`            | (already net-new, see below)               | `routing_reason`, `deal_id` (→ `deals`, once qualified into a Lead)                                                                                                                                                                                              | 056                         |
| `trials`                       | (already net-new, see below)               | `routing_reason`                                                                                                                                                                                                                                                 | 056                         |
| `accounts`                     | Demo Mode setting                          | `demo_mode_enabled`                                                                                                                                                                                                                                              | 052                         |
| `messages`, `broadcasts`       | Demo-origin markers                        | `is_demo` (or equivalent marker column)                                                                                                                                                                                                                          | 052                         |
| `account/members` API response | BA profile visibility                      | Embeds `region`/`market` names + BA fields (no schema change — a query-shape extension, migration 056's era)                                                                                                                                                     | —                           |

**Correction from `RIMULA_BUILD_SPEC.md` §9.0's own draft:** that
section speculatively listed `product` as a possible `deals` column —
it is **not** one. A Lead's product is reached via
`campaign_id → campaigns.product_id`, not a duplicate FK (see the
Phase 6 section of `IMPLEMENTATION_PLAN.md`).

## Net-new

Every table below has `account_id NOT NULL` + RLS via
`is_account_member(...)` unless noted otherwise.

| Table                                                                                        | Rimula concept                                                                                                     | Migration                               |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| `community_groups`                                                                           | `CommunityGroup` ("Rimula Announcements" destination)                                                              | 040                                     |
| `product_categories`, `products`, `product_images`, `product_applications`, `product_claims` | `ProductCategory`, `Product`, `ProductImage`, `ProductApplication`, `ProductClaim`                                 | 041                                     |
| `vehicles`, `product_vehicles`                                                               | `Vehicle`, verified `ProductVehicle` compatibility                                                                 | 042                                     |
| `campaigns`                                                                                  | `Campaign`                                                                                                         | 043                                     |
| `customer_requests`                                                                          | `CustomerRequest`                                                                                                  | 044 (+056: `routing_reason`, `deal_id`) |
| `trials`                                                                                     | `Trial`                                                                                                            | 045 (+056: `routing_reason`)            |
| `content`, `content_translations`, `voice_notes`                                             | `Content`, `ContentTranslation`, `VoiceNote` (BA-recorded audio — TTS dropped, Phase 8)                            | 046                                     |
| `engagement_events`, `product_interactions`                                                  | `EngagementEvent`, `ProductInteraction` (funnel/attribution event log — no client write policy, service-role only) | 047                                     |
| `whatsapp_sync_log`                                                                          | `WhatsAppSyncLog` (catalogue sync status — Phase 8 finally reads/writes it)                                        | 048                                     |
| `regions`, `markets`                                                                         | Lookup tables `Member`/`BA`/`Lead` all key `region_id`/`market_id` into                                            | 049                                     |
| `ba_routing_settings`                                                                        | Per-account `LeadRoutingService` strategy (`round_robin`/`lowest_open_leads`/`manual`) + round-robin cursor        | 056                                     |

### RPCs (SECURITY DEFINER, bypass RLS by design — see each for the caller-authority check baked in)

| RPC                                                                            | Purpose                                                                                   | Migration            |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | -------------------- |
| `create_broadcast_with_recipients`, `create_content_broadcast_with_recipients` | Atomic broadcast + recipient-row creation                                                 | 037/038/052, 053/054 |
| `set_member_role`, `remove_account_member`, `transfer_account_ownership`       | Admin-gated member management (`profiles_update` RLS only allows self-edit)               | 018                  |
| `set_ba_profile_fields`                                                        | Admin edits a teammate's BA fields — same self-edit-only gap as above                     | 056                  |
| `adjust_ba_open_leads`                                                         | Atomic ±1 on `profiles.open_leads`, callable by the routing agent, not just the target BA | 056                  |
| `advance_ba_routing_cursor`                                                    | Round-robin routing state                                                                 | 056                  |
| `match_ai_knowledge_fts`, `match_ai_knowledge_semantic`                        | AI knowledge-base retrieval (`SECURITY INVOKER` since 032 — a cross-tenant-read fix)      | 030, 032             |

## Migration index

`001`–`039` are the wacrm foundation (see `CHANGELOG.md` for the
per-migration history). `040` onward is Rimula:

| #   | File                                            | What it does                                                                                 |
| --- | ----------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 040 | `rimula_community_groups.sql`                   | `community_groups`                                                                           |
| 041 | `rimula_products.sql`                           | `product_categories`, `products`, `product_images`, `product_applications`, `product_claims` |
| 042 | `rimula_vehicles.sql`                           | `vehicles`, `product_vehicles`                                                               |
| 043 | `rimula_campaigns.sql`                          | `campaigns`                                                                                  |
| 044 | `rimula_customer_requests.sql`                  | `customer_requests`                                                                          |
| 045 | `rimula_trials.sql`                             | `trials`                                                                                     |
| 046 | `rimula_content.sql`                            | `content`, `content_translations`, `voice_notes`                                             |
| 047 | `rimula_engagement_analytics.sql`               | `engagement_events`, `product_interactions`                                                  |
| 048 | `rimula_whatsapp_sync_log.sql`                  | `whatsapp_sync_log`                                                                          |
| 049 | `rimula_markets_regions.sql`                    | `regions`, `markets`                                                                         |
| 050 | `rimula_member_fields.sql`                      | Extends `contacts` into `Member`                                                             |
| 051 | `rimula_ba_fields.sql`                          | Extends `profiles` into `BA`                                                                 |
| 052 | `rimula_demo_mode_and_markers.sql`              | `accounts.demo_mode_enabled`, demo-origin markers                                            |
| 053 | `rimula_content_scheduling.sql`                 | Extends `broadcasts` (`content_id`, `language`), `create_content_broadcast_with_recipients`  |
| 054 | `fix_ambiguous_contact_id_column_reference.sql` | Bug fix — ambiguous column reference in the 053 RPC                                          |
| 055 | `rimula_leads.sql`                              | Extends `deals` into `Lead` (status enum widened, 8 new columns)                             |
| 056 | `rimula_ba_routing.sql`                         | `ba_routing_settings`, `routing_reason`/`deal_id` columns, routing RPCs                      |

**Live-database note (Phase 8 discovery, unresolved as of this
writing):** `npm run db:seed` fails inserting into `deals` with
`Could not find the 'campaign_id' column of 'deals' in the schema
cache` against the Supabase project this workspace is connected to —
migrations 055/056 exist as files (and are correct — reviewed line by
line) but were apparently never applied to that live project. This
build environment has no `supabase` CLI, no direct Postgres connection
string, and no exec-SQL RPC to apply them. Apply
`055_rimula_leads.sql` and `056_rimula_ba_routing.sql` (in order)
against the live project, then re-run `npm run db:seed`, before
trusting that project's `deals`/Lead data.
