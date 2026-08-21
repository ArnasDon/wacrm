# API (§22)

Two API surfaces:

- **Internal** (`/api/**`, this document) — used by this app's own UI.
  Session-cookie auth via Supabase SSR, account/role resolved
  server-side by `requireRole(minRole)` (`src/lib/auth/account.ts`).
  Not meant for third-party integration.
- **Public** (`/api/v1/**`) — scoped, revocable API key auth, cursor
  pagination (`{ data, meta: { next_cursor } }`). Full reference:
  [`docs/public-api.md`](./public-api.md). Routes listed below for
  completeness only.

Every route enforces authorization server-side (role check via
`requireRole`, or the RLS policy on the query itself) — the "shown but
disabled" UI convention (§14) is a UX nicety, not the actual boundary.

## Account & team

| Method          | Path                                       | Role                 | Purpose                                                                                |
| --------------- | ------------------------------------------ | -------------------- | -------------------------------------------------------------------------------------- |
| GET             | `/api/account`                             | viewer               | Current account context                                                                |
| GET/POST/DELETE | `/api/account/api-keys`, `/[id]`           | admin                | Public API key management                                                              |
| GET/POST/DELETE | `/api/account/invitations`, `/[id]`        | admin                | Invite links                                                                           |
| GET             | `/api/account/members`                     | viewer               | Roster, incl. embedded BA fields                                                       |
| PATCH/DELETE    | `/api/account/members/[userId]`            | admin                | Role change / removal (via RPC)                                                        |
| PATCH           | `/api/account/members/[userId]/ba-profile` | admin                | BA region/market/capacity/status/languages (via `set_ba_profile_fields` RPC — Phase 6) |
| POST            | `/api/account/transfer-ownership`          | owner                | Ownership transfer (via RPC)                                                           |
| GET/POST        | `/api/invitations/[token]/peek`, `/redeem` | public (token-gated) | Accept an invite                                                                       |

## AI assistant

| Method          | Path                                 | Role    | Purpose                           |
| --------------- | ------------------------------------ | ------- | --------------------------------- |
| GET/PUT         | `/api/ai/config`                     | admin   | Provider + key config (encrypted) |
| POST            | `/api/ai/draft`                      | agent   | Draft a reply for the composer    |
| POST            | `/api/ai/autoreply/[conversationId]` | service | Auto-reply bot turn               |
| GET/POST/DELETE | `/api/ai/knowledge`, `/[id]`         | agent+  | Knowledge base documents          |
| POST            | `/api/ai/knowledge/reindex`          | admin   | Rebuild embeddings                |
| POST            | `/api/ai/playground`, `/api/ai/test` | admin   | Provider connectivity checks      |
| GET             | `/api/ai/usage`                      | admin   | `ai_usage_log` spend              |

## Automations & Flows

| Method                | Path                              | Role        | Purpose                             |
| --------------------- | --------------------------------- | ----------- | ----------------------------------- |
| GET/POST/PATCH/DELETE | `/api/automations`, `/[id]`       | agent+      | Automation CRUD                     |
| POST                  | `/api/automations/[id]/duplicate` | agent+      | Clone                               |
| GET                   | `/api/automations/cron`           | cron secret | Drains pending Wait-step executions |
| POST                  | `/api/automations/engine`         | internal    | Engine entry point                  |
| GET/POST/PATCH/DELETE | `/api/flows`, `/[id]`             | agent+      | Flow CRUD                           |
| POST                  | `/api/flows/[id]/activate`        | agent+      | Activate a Flow                     |
| GET                   | `/api/flows/[id]/runs`            | viewer      | Run history                         |
| GET                   | `/api/flows/cron`                 | cron secret | Drains timed-out Flow runs          |
| GET                   | `/api/flows/templates`            | viewer      | Starter templates                   |

## Content Studio (§10)

| Method                | Path                                              | Role                     | Purpose                                                     |
| --------------------- | ------------------------------------------------- | ------------------------ | ----------------------------------------------------------- |
| GET/POST/PATCH/DELETE | `/api/content`, `/[id]`                           | agent+                   | Content post CRUD                                           |
| POST                  | `/api/content/[id]/submit`, `/approve`            | agent+ / admin           | Review workflow                                             |
| POST                  | `/api/content/[id]/schedule`                      | agent+                   | Schedule via `create_content_broadcast_with_recipients` RPC |
| GET/PUT/DELETE        | `/api/content/[id]/translations`, `/[language]`   | agent+ (own `languages`) | Manual `ContentTranslation` rows                            |
| GET/POST/DELETE       | `/api/content/[id]/voice-notes`, `/[voiceNoteId]` | agent+                   | BA-recorded audio (`chat-media` bucket)                     |
| GET                   | `/api/content/cron`                               | cron secret              | Drains + sends due scheduled posts                          |

## Products & compatibility (§11)

| Method                | Path                                          | Role           | Purpose                                                                                             |
| --------------------- | --------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------- |
| GET/POST/PATCH/DELETE | `/api/products`, `/[id]`                      | viewer / admin | Product catalog                                                                                     |
| GET/POST/PATCH/DELETE | `/api/product-categories`, `/[id]`            | viewer / admin | Categories                                                                                          |
| GET/POST/DELETE       | `/api/products/[id]/images`, `/[imageId]`     | admin          | Product images                                                                                      |
| GET/POST/DELETE       | `/api/products/[id]/applications`, `/[appId]` | admin          | "Used in X" entries                                                                                 |
| GET/POST/PATCH        | `/api/products/[id]/claims`, `/[claimId]`     | admin          | Approved-claims workflow                                                                            |
| GET/POST/DELETE       | `/api/products/[id]/vehicles`, `/[compatId]`  | admin          | Verified vehicle compatibility                                                                      |
| GET/POST/PATCH/DELETE | `/api/vehicles`, `/[id]`                      | viewer / admin | Vehicle reference list                                                                              |
| GET/POST              | `/api/products/[id]/catalogue-sync`           | admin          | WhatsApp Commerce sync attempt (Phase 8 — always stubbed today, see `docs/WHATSAPP_FEASIBILITY.md`) |

## Campaigns (§13)

| Method           | Path                  | Role            | Purpose                  |
| ---------------- | --------------------- | --------------- | ------------------------ |
| GET/POST         | `/api/campaigns`      | viewer / agent+ | List / create            |
| GET/PATCH/DELETE | `/api/campaigns/[id]` | viewer / agent+ | Detail / update / delete |

## Requests → Leads → Trials (§12, Phase 6)

| Method           | Path                                  | Role            | Purpose                                                           |
| ---------------- | ------------------------------------- | --------------- | ----------------------------------------------------------------- |
| GET/POST         | `/api/customer-requests`              | viewer / agent+ | List / create (routes via `LeadRoutingService`)                   |
| GET/PATCH/DELETE | `/api/customer-requests/[id]`         | viewer / agent+ | Detail / status / reassign                                        |
| POST             | `/api/customer-requests/[id]/convert` | agent+          | Qualify into a Lead                                               |
| GET/POST         | `/api/leads`                          | viewer / agent+ | List / create a Lead (`deals`)                                    |
| GET/PATCH/DELETE | `/api/leads/[id]`                     | viewer / agent+ | Detail / status (CONVERTED fires the conversion event) / reassign |
| GET/POST         | `/api/trials`                         | viewer / agent+ | List / create                                                     |
| GET/PATCH/DELETE | `/api/trials/[id]`                    | viewer / agent+ | Detail / status progression                                       |
| GET/PATCH        | `/api/settings/ba-routing`            | viewer / admin  | Routing strategy                                                  |

## WhatsApp

| Method                | Path                                               | Role                 | Purpose                                         |
| --------------------- | -------------------------------------------------- | -------------------- | ----------------------------------------------- |
| GET/POST              | `/api/whatsapp/config`                             | admin                | Meta credentials (encrypted)                    |
| POST                  | `/api/whatsapp/config/verify-registration`         | admin                | Confirm `/register` succeeded                   |
| POST                  | `/api/whatsapp/send`                               | agent+               | Ad hoc 1:1 send                                 |
| POST                  | `/api/whatsapp/react`                              | agent+               | Outbound reaction                               |
| POST                  | `/api/whatsapp/broadcast`                          | agent+               | Create + fan out a broadcast                    |
| POST                  | `/api/whatsapp/broadcast/[id]/resume`              | agent+               | Resume a partially-failed send                  |
| GET                   | `/api/whatsapp/media/[mediaId]`                    | viewer               | Media proxy (`getMediaUrl` → `downloadMedia`)   |
| GET/POST/PATCH/DELETE | `/api/whatsapp/templates/[id]`, `/submit`, `/sync` | admin                | Message template lifecycle                      |
| GET/POST              | `/api/whatsapp/webhook`                            | Meta (HMAC-verified) | Verification handshake + inbound event delivery |

## Other

| Method   | Path                          | Role                | Purpose                    |
| -------- | ----------------------------- | ------------------- | -------------------------- |
| GET/POST | `/api/quick-replies`, `/[id]` | any member / agent+ | Reusable response snippets |
| POST     | `/api/contacts/[id]/tags`     | agent+              | Tag a contact              |

## Public API (`/api/v1`)

Full reference: [`docs/public-api.md`](./public-api.md). Resources:
`broadcasts`, `contacts`, `conversations` (+ `messages`), `messages`,
`me`, `webhooks`. Auth via `Authorization: Bearer <api_key>`, key
scopes checked per route, hashed at rest (`src/lib/api-keys/`).
