# Omni Connect AI / WACRM: Technical Document

**Updated:** 29 October 2026  
**Implementation:** `feature-remove-supabase`  
**Local database:** PostgreSQL 18, `omni_connect`  
**Purpose:** Explain the current project, its modules, its local PostgreSQL architecture, and exactly how it connects CRM accounts to Meta WhatsApp Business numbers.

This document describes the checked-out implementation. [docs/TECHNICAL_REPORT.md](docs/TECHNICAL_REPORT.md) is the earlier, pre-migration report and describes Supabase-era behavior and proposed alternatives. Use this document for the current architecture. Secrets and actual customer credentials are deliberately excluded.

## Contents

1. [The key answers about Meta](#1-the-key-answers-about-meta)
2. [Application architecture](#2-application-architecture)
3. [Repository structure](#3-repository-structure)
4. [What replaced Supabase](#4-what-replaced-supabase)
5. [Database, authentication and account isolation](#5-database-authentication-and-account-isolation)
6. [Module-by-module guide](#6-module-by-module-guide)
7. [CRM accounts and WhatsApp configuration](#7-crm-accounts-and-whatsapp-configuration)
8. [How Meta authorizes a business-number connection](#8-how-meta-authorizes-a-business-number-connection)
9. [Development, Live mode, publication and App Review](#9-development-live-mode-publication-and-app-review)
10. [Connecting your existing Meta test number](#10-connecting-your-existing-meta-test-number)
11. [Connecting a real business number](#11-connecting-a-real-business-number)
12. [Meta API calls used by this project](#12-meta-api-calls-used-by-this-project)
13. [Outgoing and incoming message journeys](#13-outgoing-and-incoming-message-journeys)
14. [Flows, automations and the order-status scenario](#14-flows-automations-and-the-order-status-scenario)
15. [Configuration and operation](#15-configuration-and-operation)
16. [Verification, limitations and future work](#16-verification-limitations-and-future-work)
17. [Source references](#17-source-references)

## 1. The key answers about Meta

**Do we need a Meta developer application?** Yes. This project connects directly to the official WhatsApp Cloud API. A Meta application with the WhatsApp use case/product provides the application identity used for permissions, tokens and webhook configuration. You already created such an application when you obtained your Meta test number. Removing Supabase does not require creating another Meta application.

**Does Meta allow connection just because we know a phone number?** No. The business must control the WhatsApp assets, and the access token must authorize the application to operate on the relevant assets. A public telephone number, Phone Number ID or WABA ID alone is insufficient. Token permissions and asset assignments are part of authorization. Meta's official collection explains the business assets, token types and WhatsApp permissions involved. [M1]

**Do we need to publish it?** There are three different situations:

| Situation                                                   | What to expect                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Your current Meta test number and permitted test recipients | Continue using the developer testing setup. A public customer-onboarding release is not necessary just to repeat that test.                                                                                                                                                                                                            |
| Your own real business number                               | Configure the business assets, number, token and webhooks for production. Check the application's production/Live requirements and permissions in Meta's dashboard. Using your own assets is distinct from requesting permission to manage unrelated businesses.                                                                       |
| A SaaS application connecting other companies' numbers      | Plan for the applicable Tech Provider/customer-onboarding requirements, a Live/released application, business verification as required, and App Review/Advanced Access for the permissions the onboarding flow requests. Embedded Signup is the usual customer-facing onboarding approach. The current CRM does not implement it. [M2] |

**Changing App Mode, passing App Review, verifying a business, and registering a phone are separate operations.** None is a replacement for the others. Deploying this Next.js application on a server is also separate from publishing/releasing the Meta application. There is no mobile application to submit to an app store in the current project.

Meta's dashboard and onboarding requirements change. During this documentation update, some Meta developer pages required login or returned rate-limit errors. The accessible official Meta collections support the API and Embedded Signup descriptions; the exact current production eligibility and requested permissions must be checked in your own Meta application dashboard. This document does not claim that your application has already passed review or business verification.

## 2. Application architecture

This is a **modular monolith**: one Next.js application serves the React interface, authentication endpoints, domain APIs, webhook receiver and business logic. It is not a collection of independently deployed microservices.

```text
CRM user in browser
        |
        | Same-origin HTTP requests and session cookies
        v
Next.js application
  - React pages and components
  - Better Auth sessions
  - Account/role checks and named API handlers
  - Domain services and SQL repositories
        |                 |                    |
        v                 v                    v
PostgreSQL           Local filesystem      External services
omni_connect         local-data/uploads    - Meta WhatsApp Cloud API
                                           - Optional AI providers
                                           - SMTP / outbound webhooks

Meta -> public HTTPS webhook -> Next.js -> account lookup -> PostgreSQL

Local jobs process -> protected cron endpoints -> waits/timeouts
```

Current major technologies:

| Concern               | Implementation                                                                 |
| --------------------- | ------------------------------------------------------------------------------ |
| Application framework | Next.js 16.3.5 App Router                                                      |
| UI                    | React 19, TypeScript, Tailwind CSS, shared UI components                       |
| Database access       | `pg` / node-postgres; named SQL repositories                                   |
| Authentication        | Better Auth with PostgreSQL-backed identity/session tables                     |
| Database              | PostgreSQL, UUIDs, JSONB, arrays, triggers/functions, RLS and full-text search |
| Inbox updates         | HTTP polling rather than Supabase Realtime                                     |
| File storage          | Local filesystem plus PostgreSQL ownership metadata                            |
| Flow editor           | React Flow / `@xyflow/react` and graph-layout utilities                        |
| AI                    | Optional account-specific OpenAI/Anthropic integration; OpenAI embeddings      |
| Tests                 | Vitest and embedded PostgreSQL through PGlite                                  |
| Translation           | `next-intl` and JSON message catalogues                                        |

There is no Prisma/Drizzle ORM, Redis queue or external realtime gateway in the current implementation. These were possible architectural alternatives, not dependencies added by this migration.

## 3. Repository structure

| Location                 | Responsibility                                                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `src/app/(dashboard)/`   | Authenticated pages: dashboard, inbox, contacts, pipelines, broadcasts, automations, flows, notifications and settings |
| `src/app/api/`           | Server-side HTTP endpoints                                                                                             |
| `src/app/api/auth/`      | Better Auth route integration                                                                                          |
| `src/app/api/v1/`        | External/public API authenticated with scoped API keys                                                                 |
| `src/components/`        | UI components grouped by business module                                                                               |
| `src/hooks/`             | Browser auth, polling, presence, notifications and related hooks                                                       |
| `src/lib/db/`            | SQL repositories, pools, transactions, account context and database integration tests                                  |
| `src/lib/auth/`          | Better Auth configuration, roles, sessions, invitation utilities and email                                             |
| `src/lib/whatsapp/`      | Meta HTTP helpers, encryption, inbound/outbound messaging, templates and broadcasts                                    |
| `src/lib/flows/`         | Conversation graph runtime, validation, interpolation and send adapters                                                |
| `src/lib/automations/`   | Event-triggered step runtime, waits, branching and send adapters                                                       |
| `src/lib/ai/`            | Providers, context, knowledge retrieval, embeddings, usage and auto-reply                                              |
| `src/lib/storage/`       | Filesystem operations and upload helpers                                                                               |
| `src/lib/webhooks/`      | Outbound event delivery, signing and destination checks                                                                |
| `src/lib/api-keys/`      | API key generation, hashing, authentication and scopes                                                                 |
| `src/proxy.ts`           | Session-aware page/API routing and redirects; individual endpoints still authorize their operations                    |
| `src/types/`             | Shared application/domain types                                                                                        |
| `messages/`              | Translated UI text                                                                                                     |
| `database/bootstrap.sql` | Initial database roles and grants                                                                                      |
| `database/migrations/`   | Current standalone PostgreSQL migrations                                                                               |
| `scripts/`               | Database checks/migrations, tests, jobs and dependency audit                                                           |
| `local-data/`            | Private runtime uploads and development mail; not source-controlled                                                    |
| `mcp-server/`            | Optional, separately runnable MCP adapter over `/api/v1`; does not access PostgreSQL directly                          |
| `supabase/migrations/`   | Historical upstream SQL; not used by the current migration runner                                                      |
| `docs/`                  | Design, API and historical documentation                                                                               |

Some legacy comments still mention original migration numbers or managed-storage terminology. The executable implementation and current `database/migrations/` take precedence over those comments. An empty legacy directory is not a runtime dependency.

## 4. What replaced Supabase

| Previous capability             | Current implementation                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| Supabase-hosted database        | Local PostgreSQL database `omni_connect`                                              |
| Supabase Auth                   | Better Auth and the `identity` schema                                                 |
| Browser `.from(...)` queries    | Browser calls named `/api/...` routes; server repositories execute SQL                |
| Supabase service-role clients   | Explicit worker database pool and account-scoped repositories                         |
| Supabase Realtime subscriptions | Bounded same-origin polling and snapshot reconciliation                               |
| Supabase Storage                | Files in `local-data/uploads`, metadata in `public.stored_objects`                    |
| Supabase migration/CLI workflow | `npm run db:migrate` against checked-in standalone SQL                                |
| Supabase environment variables  | Database URLs, Better Auth configuration, local storage and existing provider secrets |

The Supabase SDK packages were removed. `npm run check:no-supabase` checks runtime imports, endpoints, dependencies and required environment references. Historical SQL and explanatory documents may still contain the word Supabase.

The migration started with empty application data. It did not copy your old Supabase login, WhatsApp configuration or conversations. The hosted project was not deleted or modified.

## 5. Database, authentication and account isolation

### 5.1 One database, many business accounts

All CRM accounts share the same database. Records are separated by account membership and `account_id`; a new customer account does not create a new PostgreSQL database.

```text
identity.users
      |
      | user_id
      v
public.profiles ---- account_id ----> public.accounts
                                           |
                                           +--> whatsapp_config
                                           +--> contacts / conversations
                                           +--> pipelines / deals
                                           +--> broadcasts / flows / automations
                                           +--> AI configuration / knowledge
```

`messages` belong to conversations, and several child tables inherit their account relationship through their parent. Not every table has a direct `account_id` column.

### 5.2 Login versus business membership

Better Auth stores identities, credentials, sessions and verification records in the `identity` schema. Local email/password signup provisions a CRM profile and owner account atomically through database provisioning logic. Invitations let teammates join an account.

The current profile model represents one active account membership per user. Roles are `owner`, `admin`, `agent` and `viewer`. Owners/admins manage account settings and members; agents perform operational work such as sending messages; viewers have read access where supported. Ownership transfer is handled separately from ordinary role changes.

`src/lib/db/context-core.ts` resolves membership from the authenticated user. `withAccount` rechecks account and role before work rather than trusting a browser-supplied account identifier. UI visibility rules are convenience only; server guards and database RLS enforce access.

### 5.3 Database roles and pools

| Role          | Purpose                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------- |
| `omni_owner`  | Owns schema objects and applies migrations                                                  |
| `omni_app`    | Normal CRM domain operations; restricted by RLS                                             |
| `omni_auth`   | Authentication operations, with `identity,public` search path                               |
| `omni_worker` | Signature/key/cron-authorized background work; deliberately privileged and kept server-only |

Pools are initialized lazily. Transactions use a transaction-local `app.user_id`, so a pooled connection does not retain another user's identity after commit/rollback. Failed leases are discarded. Worker repositories still include account predicates even though the worker role bypasses RLS.

A separate coordination pool uses worker credentials for per-contact flow advisory locks. This serializes concurrent flow dispatches across processes without keeping a SQL transaction open during Meta calls, and avoids occupying the SQL pool needed by the sender.

### 5.4 Current migrations

| Migration                       | Purpose                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------- |
| `001_identity.sql`              | Local authentication schema and foundational identity objects                |
| `002_domain.sql`                | Standalone CRM schema, account provisioning, RLS and domain functions        |
| `003_function_permissions.sql`  | Function execution privileges                                                |
| `004_presence_permissions.sql`  | Presence-related permissions                                                 |
| `005_local_storage.sql`         | Local upload metadata, ownership and access rules                            |
| `006_identity_profile_sync.sql` | Identity/profile synchronization                                             |
| `007_invitation_safety.sql`     | Prevents invitation redemption from deleting teammates or local account data |

The runner uses advisory locking, checksums and transactional migration history. Applied SQL must remain unchanged; add a new migration for future changes. An unmanaged existing schema is refused for review rather than reset or silently adopted.

## 6. Module-by-module guide

### 6.1 Account, users and settings

Account/member/invitation APIs use repositories such as `accounts.ts` and `invitations.ts`. Account-wide settings include currency, member roles, WhatsApp, AI and API keys. Profile updates use Better Auth; email changes require verification. Development reset/verification email is captured privately in `local-data/mail`; production requires SMTP.

### 6.2 Contacts, tags, notes and custom fields

Contacts are account-owned customer records. Import/deduplication utilities normalize phone identities. Tags, notes and custom fields support segmentation and automation. Related-record ownership is checked before associations are written. Relevant repositories include `contacts.ts`, `contact-details.ts`, `contact-import.ts` and `tags.ts`.

### 6.3 Dashboard

`dashboard.ts` provides named metrics/activity/pipeline queries. Browser-side date aggregation preserves the user's timezone behavior where needed. Dashboard reads are account-scoped.

### 6.4 Pipelines and deals

`pipelines.ts` manages boards and stages. `deals.ts` manages opportunities, value/currency, contacts and stage movement. A sales pipeline is a CRM sales board; it is different from an executable conversation flow.

### 6.5 Inbox and conversations

`inbox.ts` reads conversations/messages/reactions and updates status, assignee and unread state. The message composer sends through server-side WhatsApp services. Messages retain Meta's message ID for status updates and reply references. Manual assignment uses the responder's user ID, not the separate profile-row ID.

### 6.6 WhatsApp settings and credentials

`whatsapp-config.ts` persists the account connection. `/api/whatsapp/config` verifies/saves/tests/resets it; `/api/whatsapp/config/details` returns safe form metadata and supports media-mirroring preferences. Owner/admin checks apply to changes. The browser does not read the access token directly from the database.

### 6.7 Message templates and quick replies

Templates are Meta-managed message definitions synchronized into the local catalogue. The application supports template management/send payloads and lifecycle updates received through Meta webhooks. Quick replies are account-owned reusable text or interactive snippets; they are not automatically approved Meta templates.

### 6.8 Broadcasts

Broadcasts resolve an audience from contacts/filters or supplied recipients, freeze recipient template parameters, and persist campaign/recipient records transactionally. Delivery runs server-side, with a campaign lock, per-recipient results, resume scopes and final counters/status. The UI polls progress. Creation is capped at 1,000 supplied recipients per request in the current implementation; this is an application bound, not a statement of Meta's limits.

Delivery uses Next.js post-response work rather than a durable external queue. A process failure can leave work for resume, and a provider success followed by a database failure is an ambiguous delivery boundary. Do not describe broadcasts as an exactly-once delivery system.

### 6.9 Conversation flows

`src/lib/flows/engine.ts` executes a stored graph. `flow_runs` keeps the active node, captured variables and status; `flow_run_events` provides an audit trail. Supported node types include start, send message, buttons, list, media, collect input, condition, set tag, handoff and end. Per-contact coordination prevents concurrent replies from executing the same transition simultaneously.

These CRM conversation flows are not the separate Meta WhatsApp Flows form API. In particular, the current node union does not contain an implemented general HTTP-fetch node.

### 6.10 Event automations

`src/lib/automations/engine.ts` responds to configured events and executes step trees. Steps include sends, tags, assignments, contact updates, deal creation, closing conversations, conditions, waits and outbound webhook POSTs. Execution logs and pending waits are stored in PostgreSQL.

The `send_webhook` step can POST to an allowed public URL with interpolated content and custom headers. It checks HTTP success but does not capture the response JSON into flow variables for a later reply. It is not a complete request/response integration node.

### 6.11 AI assistant and knowledge

Optional per-account AI configuration holds encrypted provider keys and behavior settings. Modules cover message context, draft generation, playground, auto-reply, handoff and usage accounting. Knowledge documents are chunked and indexed with PostgreSQL full-text search. Optional embeddings are stored as `real[]` and ranked using SQL cosine calculations; pgvector is not required by this implementation. Account-configured embeddings credentials enable that additional path.

Index replacement is transactional and checks for stale document content. Provider calls happen outside SQL transactions. AI responses are subject to account configuration and human/flow takeover rules; the application is not unconditionally AI-driven.

### 6.12 Notifications, presence and polling

The browser uses named inbox, notification, unread-count and presence endpoints. Active conversation/reaction updates use approximately 3-second polling; general summaries and presence use approximately 10 seconds. Polling avoids overlap and normally pauses in hidden tabs, with focus refresh. Browser-message notifications intentionally support hidden-tab polling and suppress the initial historical backlog.

### 6.13 Uploads and media

Uploads use `/api/uploads/[bucket]`; media is served through `/media/[...path]`. Allowed buckets are `avatars`, `chat-media` and `flow-media`. Files have generated object IDs; PostgreSQL stores metadata and ownership. Serving checks distinguish intended public media from private content. Public attachment URLs are necessary when Meta must download a file for sending.

Inbound attachments can be mirrored locally. The mirror validates size/type and falls back to the original/proxy handling when copying fails. Paths and symlink checks prevent a supplied filename from becoming arbitrary filesystem access.

### 6.14 Public API and API keys

`/api/v1` exposes contacts, conversations, messages, broadcasts, account information and webhook management. API keys are hashed; capabilities are explicit scopes such as `messages:send`, `contacts:read` and `broadcasts:send`. Keys remain bound to their account and do not impersonate an owner. Key management is restricted to authorized account administrators.

### 6.15 Outbound event webhooks

This is distinct from Meta's inbound webhook. Accounts can register external event destinations. The server signs outgoing JSON, checks destination safety and records failures. Delivery is best-effort with one short-timeout attempt per dispatch; repeated failures can disable an endpoint. There is no durable retry queue/backoff service in the current implementation.

### 6.16 Background jobs

`npm run jobs` calls `/api/automations/cron` and `/api/flows/cron` approximately every minute using `x-cron-secret`. The routes validate `AUTOMATION_CRON_SECRET`. They claim due automation waits and sweep abandoned flow runs. This scheduler must run separately from the browser. Production can use a managed scheduler calling the same protected endpoints.

### 6.17 Optional MCP adapter

The `mcp-server/` package exposes the public API as tools to MCP clients. It needs an instance URL and scoped API key; optional write/broadcast guards control what it exposes. It is not required to start the CRM or connect WhatsApp.

## 7. CRM accounts and WhatsApp configuration

### 7.1 Three different identities

| Term                    | Meaning                                                                            |
| ----------------------- | ---------------------------------------------------------------------------------- |
| CRM user                | A person logging into this application                                             |
| CRM account             | A business/team inside this application                                            |
| Meta Business Portfolio | Meta's container for business assets and access assignments                        |
| WABA                    | A WhatsApp Business Account on Meta; can contain business phone-number assets      |
| Meta application        | The developer integration authorized to call Meta APIs and receive webhooks        |
| Phone Number ID         | Meta's object ID for a WhatsApp number; different from the actual telephone number |

The current relationship is:

```text
CRM account A -> one whatsapp_config row -> Phone Number ID A -> WABA A
    + Owner / Admin / Agent users share this connection

CRM account B -> one whatsapp_config row -> Phone Number ID B -> WABA B
    + Its own team and isolated CRM records
```

The same WABA may own several numbers at Meta, but this CRM currently stores only one configured number per CRM account. The configuration UI checks whether a number is already claimed by another account. Multiple-number inbox selection within one CRM account is future work.

### 7.2 Stored WhatsApp fields

| Field                                 | Stored purpose                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------- |
| `account_id`                          | Business/team that owns the connection                                          |
| `user_id`                             | User recorded when the configuration is saved; not the account-sharing boundary |
| `phone_number_id`                     | Sender-number object used by Meta API requests and inbound routing              |
| `waba_id`                             | Parent WhatsApp Business Account                                                |
| `access_token`                        | Encrypted credential for authorized Meta API calls                              |
| `verify_token`                        | Encrypted value chosen for webhook verification                                 |
| `status`, `connected_at`              | Connection metadata                                                             |
| `registered_at`, `subscribed_apps_at` | Recorded setup milestones                                                       |
| `last_registration_error`             | Diagnostics from registration                                                   |
| `mirror_inbound_media`                | Whether incoming media should be copied locally                                 |

Both tokens are encrypted using AES-256-GCM. `ENCRYPTION_KEY` is application-level and must survive backups/deployment. Changing it without re-encrypting records makes saved credentials unreadable. The six-digit registration PIN is passed to Meta when needed and is not one of the persisted configuration fields.

### 7.3 Application-level Meta settings

`META_APP_SECRET` authenticates inbound webhook signatures; it is not the per-account access token or the verify token. The implementation accepts a comma-separated list of app secrets for installations using several Meta applications. `META_APP_ID` is an application-level setting used by relevant app/subscription/template-upload operations; it is not stored separately in each `whatsapp_config` row.

One properly authorized Meta application can serve multiple WABAs/accounts. A new Meta developer application per CRM user or per agent is unnecessary. Serving unrelated businesses, however, requires the corresponding Meta permissions and approved onboarding access; a row in our database does not grant that permission.

## 8. How Meta authorizes a business-number connection

The authorization chain is:

```text
Business controls its WABA and number
        -> user/system user has the required asset access
        -> token is issued for the Meta application with the required permissions
        -> server calls Meta using that token and Phone Number ID
        -> Meta checks authorization before accepting the operation
```

The primary permissions used are `whatsapp_business_messaging` for messaging operations and `whatsapp_business_management` for management operations. Additional permissions may be needed for the particular portfolio/customer-onboarding operations you choose; do not request every business permission by default. [M1]

The project currently uses **manual credential onboarding**: an authorized administrator obtains the IDs and token in Meta and enters them in CRM Settings. It does not automatically create Meta business assets, obtain another company's consent, or exchange an Embedded Signup authorization code.

These are separate actions:

1. **Verify ownership of a real phone number:** Meta's onboarding may send an SMS/voice verification code.
2. **Register the number for Cloud API:** `POST /{PHONE_NUMBER_ID}/register`, with a six-digit two-step verification PIN where applicable. The PIN is not the SMS ownership code. [M3]
3. **Subscribe the WABA to the app:** `POST /{WABA_ID}/subscribed_apps` enables the application subscription for webhook events.
4. **Configure and verify the app's callback:** enter a reachable HTTPS callback and matching verify token, and subscribe to the relevant webhook fields.

Registration activates/registers the phone for API use; it is not itself the WABA webhook subscription. The current source contains older comments that loosely combine these concepts.

## 9. Development, Live mode, publication and App Review

### 9.1 Your existing test-number experiment

Your old Supabase-backed test already exercised the Meta side: an application existed, the WhatsApp product/use case was configured, a test number was available, a recipient was allowed, and a token could send a test message. Those Meta assets are independent of Supabase. They can be reused with the local PostgreSQL application, subject to token validity and callback changes.

Test assets and permitted recipients are a limited development environment. Success there proves the basic integration path, not that the application is approved to onboard unrelated businesses or that a real number has completed production onboarding.

### 9.2 What “publish” means here

| Action                                      | What it changes                                                                         |
| ------------------------------------------- | --------------------------------------------------------------------------------------- |
| Run/deploy the CRM                          | Makes this Next.js server available locally or on your hosting                          |
| Expose a public HTTPS callback              | Lets Meta deliver webhooks; ngrok can provide this during development                   |
| Switch/release the Meta application to Live | Changes availability beyond its development context, subject to Meta requirements       |
| App Review / Advanced Access                | Grants approved use of requested permissions, particularly customer/business onboarding |
| Business verification                       | Verifies the business identity when Meta requires it                                    |
| Add/verify/register a real number           | Makes that particular business-number asset usable through the relevant API setup       |

For public onboarding of other businesses, Meta's official Embedded Signup collection explicitly describes App Review and Advanced Access before release. Required scopes depend on the flow/version; the collection includes business-management permissions, while messaging operations also need their applicable WhatsApp permission. Follow the current dashboard's requested-access checklist rather than treating a Live toggle as approval. [M2]

For your own assets, do not assume that the entire third-party Tech Provider review process is mandatory just to continue testing. Conversely, do not assume that a test token is sufficient for production. Review the actual token scopes, asset access, app status and production onboarding requirements shown for your application.

The current repository cannot complete Meta review for you. It also has no customer-facing “Connect with Facebook”/Embedded Signup implementation. If the product is to onboard many independent businesses, that is a separate integration project beyond removing Supabase.

## 10. Connecting your existing Meta test number

1. Start PostgreSQL and the CRM at `http://localhost:3000`.
2. Create/sign into a **local CRM account**. The old Supabase login was not imported.
3. Open the same Meta developer application used for the earlier test. Locate its test Phone Number ID, WABA ID and a valid access token. If the development token expired, generate a new one.
4. In local CRM Settings -> WhatsApp, enter those values and choose a verify token. Do not substitute your actual displayed telephone number for the Phone Number ID.
5. Keep the correct `META_APP_SECRET` and `ENCRYPTION_KEY` in private `.env.local`. Save the configuration as the account owner/admin.
6. Run `npx ngrok http 3000` and copy the HTTPS origin.
7. Set `APP_PUBLIC_URL` to that origin and restart the CRM so outgoing attachment URLs can be reached by Meta. Keep `BETTER_AUTH_URL=http://localhost:3000` while accessing the UI through localhost.
8. Set Meta's callback to `https://YOUR-NGROK-HOST/api/whatsapp/webhook`, and enter the same verify token. Subscribe to `messages` and any required template lifecycle fields.
9. Confirm the WABA/app subscription using the connection checks. The test number may not need a registration PIN; the save route supports saving verified test credentials without one.
10. Send a test template to a permitted recipient, then send a message from that recipient to the test number and confirm it appears in the local inbox. Reply through the CRM.

The UI currently builds its displayed callback from the browser origin. When the UI is opened through localhost, it can therefore display a localhost callback. Use the **public ngrok URL** in Meta even if the displayed value is localhost. Update Meta and `APP_PUBLIC_URL` whenever the tunnel hostname changes. There is no separate incoming polling API that replaces this callback.

Saving credentials locally does not copy any WhatsApp connection row from Supabase, nor does it change the hosted project's database. Avoid leaving an old application/server using the same intended webhook setup when determining which instance is receiving your test traffic.

## 11. Connecting a real business number

For a business you control, the overall procedure is:

1. Use a Meta business portfolio and Meta application with the relevant WhatsApp setup.
2. Add/select the WABA and business number in the applicable Meta onboarding interface. Complete number ownership verification and other required setup, such as business details or payment configuration where applicable.
3. Check the number's existing WhatsApp registration state. A number already used in a consumer/Business app may require a supported migration or coexistence onboarding path. This CRM does not implement coexistence onboarding; do not delete an existing WhatsApp account merely on the basis of this document.
4. Assign the appropriate app/WABA assets to an authorized user/system user and obtain a token with the required scopes. Use a suitable production token rather than relying on the temporary dashboard token. Long-lived/no-expiry tokens can still be revoked or invalidated. [M1]
5. Complete the production/Live and verification steps required by Meta for the chosen use case. For other businesses' assets, use the approved customer-onboarding/Tech Provider path instead of assuming manual token sharing replaces approval.
6. Enter the number's IDs and token in that business's CRM account. Provide the registration PIN when the registration operation requires it; verify both number registration and WABA subscription.
7. Configure a stable public HTTPS webhook, matching verify token and webhook fields.
8. Verify an actual inbound message, a CRM reply, delivery/read updates and an attachment. A green credential check alone does not verify all four.

The application saves credentials but has no general automatic token-renewal/onboarding workflow. Plan to manage token validity and access assignments in Meta.

For serving independent customer businesses at scale, the likely future approach is Embedded Signup: the customer signs in to Meta, selects/creates their authorized assets, grants access, and the application processes the returned authorization/onboarding results. Meta's official workspace identifies Embedded Signup as its onboarding solution for partners/providers. This describes future work, not a feature already present here. [M4]

## 12. Meta API calls used by this project

### 12.1 Version and authorization

`src/lib/whatsapp/meta-api.ts` currently pins the Graph API base to:

```text
https://graph.facebook.com/v21.0
```

This is the version in the project, not a claim that v21.0 is Meta's latest version. API-version upgrades need their own compatibility check. Requests use `Authorization: Bearer <account access token>` where required. The server decrypts the selected account's token; the UI does not construct a Meta call using a database password or Supabase key.

### 12.2 External Meta endpoints

All paths below are relative to that Graph API base unless stated otherwise.

| Method | Endpoint                                                                         | Use in the project                                                                      |
| ------ | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| GET    | `/{PHONE_NUMBER_ID}?fields=id,display_phone_number,verified_name,quality_rating` | Verify token/number and obtain display metadata                                         |
| GET    | `/{WABA_ID}/phone_numbers`                                                       | Confirm the entered number belongs to the WABA                                          |
| POST   | `/{PHONE_NUMBER_ID}/register`                                                    | Register the number using `messaging_product` and PIN when needed                       |
| POST   | `/{WABA_ID}/subscribed_apps`                                                     | Subscribe the WABA to the app                                                           |
| GET    | `/{WABA_ID}/subscribed_apps`                                                     | Inspect app subscription state                                                          |
| POST   | `/{PHONE_NUMBER_ID}/messages`                                                    | Send text, templates, media, buttons/lists, reactions and relevant read/typing payloads |
| GET    | `/{WABA_ID}/message_templates`                                                   | Synchronize the template catalogue                                                      |
| POST   | `/{WABA_ID}/message_templates`                                                   | Submit/create a template                                                                |
| POST   | `/{META_TEMPLATE_ID}`                                                            | Update supported template fields                                                        |
| DELETE | `/{WABA_ID}/message_templates?name=...&hsm_id=...`                               | Delete a template; the optional Meta template ID restricts the language variant         |
| POST   | `/{APP_ID}/uploads`                                                              | Start a resumable upload for template media samples                                     |
| POST   | `/{UPLOAD_SESSION_ID}`                                                           | Upload the sample file bytes                                                            |
| GET    | `/{MEDIA_ID}`                                                                    | Obtain media metadata/download URL                                                      |
| GET    | Meta-returned download URL                                                       | Download incoming media for local mirroring/proxying                                    |

The message, registration and subscription endpoint families are present in Meta's official API collections. [M3] [M5]

### 12.3 Internal application endpoints

| Endpoint                                                                    | Caller and purpose                                   |
| --------------------------------------------------------------------------- | ---------------------------------------------------- |
| `POST /api/whatsapp/config`                                                 | CRM owner/admin saves connection after validation    |
| `GET /api/whatsapp/config`                                                  | CRM connection-health check; may call Meta           |
| `GET /api/whatsapp/config/details`                                          | Safe metadata for the settings form                  |
| `PATCH /api/whatsapp/config/details`                                        | Media-mirroring preference                           |
| `DELETE /api/whatsapp/config`                                               | Reset the local account connection                   |
| `POST /api/whatsapp/send`                                                   | Authenticated agent sends an inbox message           |
| `POST /api/whatsapp/react`                                                  | Agent sends a reaction                               |
| `GET /api/whatsapp/config/verify-registration`                              | Inspect registration readiness                       |
| `POST /api/whatsapp/templates/sync`                                         | Synchronize templates from Meta                      |
| `POST /api/whatsapp/templates/submit`                                       | Submit a template to Meta                            |
| `PATCH /api/whatsapp/templates/[id]`, `DELETE /api/whatsapp/templates/[id]` | Update/delete an individual template                 |
| `GET /api/whatsapp/media/[mediaId]`                                         | Authenticated media proxy for referenced inbox media |
| `/api/broadcasts` and `/api/whatsapp/broadcast/[id]/resume`                 | Campaign management and server-side delivery/resume  |
| `GET /api/whatsapp/webhook`                                                 | Meta callback verification challenge                 |
| `POST /api/whatsapp/webhook`                                                | Meta incoming messages/status/template events        |
| `GET /api/inbox/poll`                                                       | Browser refreshes account inbox data                 |
| `/api/v1/...`                                                               | External integrations use scoped CRM API keys        |

The internal CRM API and external Meta Graph API are different layers. A CRM API key cannot be substituted for a Meta access token.

### 12.4 Example text-message request

```http
POST https://graph.facebook.com/v21.0/{PHONE_NUMBER_ID}/messages
Authorization: Bearer {ACCOUNT_ACCESS_TOKEN}
Content-Type: application/json
```

```json
{
  "messaging_product": "whatsapp",
  "recipient_type": "individual",
  "to": "CUSTOMER_PHONE_NUMBER",
  "type": "text",
  "text": { "body": "Please provide your order number." }
}
```

The code also handles business-scoped recipient identities where supplied by Meta. Template/media/interactive messages have different payloads but use the same message endpoint. The send path follows Meta's supported messaging rules; the application's existing ordinary-text/template distinction must not be read as support for every newer Meta messaging feature.

## 13. Outgoing and incoming message journeys

### 13.1 Outgoing message

```text
Agent clicks Send
 -> browser POST /api/whatsapp/send
 -> session, role, origin and rate checks
 -> resolve account and conversation/contact ownership
 -> load that account's whatsapp_config
 -> decrypt the Meta access token
 -> POST Meta /{PHONE_NUMBER_ID}/messages
 -> receive Meta message ID
 -> insert local message and update conversation preview
 -> later status webhooks update sent/delivered/read/failed
```

The provider call is outside the SQL transaction. If Meta accepts but persistence fails, the result must be treated as accepted-but-not-saved rather than blindly resent; otherwise duplicate customer messages are possible. The local send service includes handling for this boundary.

### 13.2 Webhook verification

Meta calls `GET /api/whatsapp/webhook` with `hub.mode`, `hub.verify_token` and `hub.challenge`. The route checks the configured encrypted verify tokens and returns the challenge for a match. This proves callback setup; it does not import previous conversations.

### 13.3 Incoming message and account routing

```text
Customer sends a WhatsApp message
 -> Meta sends POST to the shared public webhook
 -> verify x-hub-signature-256 using configured META_APP_SECRET
 -> acknowledge and process post-response work
 -> read metadata.phone_number_id
 -> find matching whatsapp_config
 -> obtain that row's account_id
 -> resolve the account's customer/contact and conversation
 -> insert message with replay protection
 -> update unread/preview information
 -> dispatch eligible flows, automations, AI and outbound events
 -> browser polls local inbox and displays the result
```

One shared webhook can serve multiple CRM accounts because the receiving **Phone Number ID** selects the configuration/account. The customer sender's number identifies the customer within that account; it does not identify which business owns the inbox.

Template lifecycle events can instead identify the WABA, which the template-event repository resolves to a local configuration/account. Message delivery/read/failure events are matched using stored Meta message IDs and the receiving account context.

Exact webhook message retries are deduplicated in PostgreSQL. Flow consumption influences which automation/AI responses run, preventing the intended flow reply path from competing with an automatic AI answer. Processing in `after()` remains in-process work, not a durable inbound message queue.

## 14. Flows, automations and the order-status scenario

Your desired conversation is:

```text
"My order status"
 -> keyword trigger
 -> ask "What is your order number?"
 -> collect_input stores vars.order_number
 -> POST your order-status API
 -> read its response
 -> send the result to the customer
```

The first three steps and replies using captured variables are supported by the current conversation flow engine. The general API request/response step is **not** implemented as a flow node. The automation webhook step sends a POST but does not expose response JSON as variables for the next reply.

Completing this scenario therefore needs an additional integration: for example, a validated HTTP action node with response-field mapping, or a backend order-service adapter that calls the order API and sends its result through the shared message service. That future change needs request authentication, destination controls, timeouts, response validation, error replies and tests. Supabase removal did not add that feature.

## 15. Configuration and operation

### 15.1 Main environment variables

| Variable                                         | Purpose                                           |
| ------------------------------------------------ | ------------------------------------------------- |
| `DATABASE_URL`                                   | Restricted application-role PostgreSQL connection |
| `AUTH_DATABASE_URL`                              | Authentication-role connection                    |
| `WORKER_DATABASE_URL`                            | Worker and coordination connections               |
| `MIGRATION_DATABASE_URL`                         | Schema-owner migration connection                 |
| `BETTER_AUTH_SECRET`                             | Local authentication secret                       |
| `BETTER_AUTH_URL`                                | Canonical authentication origin                   |
| `ENCRYPTION_KEY`                                 | Encrypt/decrypt stored provider credentials       |
| `META_APP_SECRET`                                | Validate inbound Meta signatures                  |
| `META_APP_ID`                                    | App-specific Meta operations where used           |
| `APP_PUBLIC_URL`                                 | Public origin for media URLs fetched externally   |
| `LOCAL_STORAGE_ROOT`                             | Optional filesystem upload-root override          |
| `AUTOMATION_CRON_SECRET`                         | Authenticate the scheduled-job endpoints          |
| `JOBS_BASE_URL`                                  | Optional scheduler target override                |
| `SMTP_URL`, `SMTP_FROM`                          | Production authentication email delivery          |
| `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_APP_LOCALE` | Public site metadata and UI locale                |

The `.env.local.example` file provides placeholders. `.env.local` contains private installation values and must not be committed or pasted into documentation. Database credentials, Meta access tokens, Meta app secret and verify token are different credentials with different purposes.

### 15.2 Start locally

From the repository root:

```powershell
npm run db:check
npm run db:migrate
npm run dev
```

Open `http://localhost:3000`. In another terminal:

```powershell
npm run jobs
```

For a one-time scheduler check: `npm run jobs -- --once`. For the production-style local build: `npm run build`, then `npm start`. The current build emits standalone output for Docker; `next start` can warn about that configuration. Docker uses its standalone `server.js` entry point and copies static/public assets.

The current installation's roles and database are already configured. Do not repeat bootstrap or upload historical Supabase migration files. `npm run db:migrate` applies all pending current SQL files in order and is safe to rerun when their checksums are unchanged.

### 15.3 Backups and eventual deployment

Back up the PostgreSQL database, `local-data/uploads` and the private configuration/encryption key. The database alone does not contain the uploaded file bytes. Build output under `.next` is replaceable and is not a backup.

For deployment, the current architecture needs a persistent Next.js server, PostgreSQL, persistent upload storage, HTTPS, a scheduler and SMTP for account email. DigitalOcean is a possible host, but no DigitalOcean infrastructure has been provisioned by this migration. Filesystem uploads need a persistent volume; multiple app instances would need shared/object storage or a deliberately shared filesystem.

## 16. Verification, limitations and future work

### 16.1 Recorded evidence

During the migration verification on 11 October 2026:

- The full suite passed: **1,004 tests in 117 files**.
- Type checking and the production build passed.
- ESLint reported **0 errors and 62 warnings**; it was not warning-free.
- Migration `007_invitation_safety.sql` was applied to the actual local database; prior migrations were preserved.
- All four configured PostgreSQL role connections passed.
- Actual PostgreSQL HTTP smoke checks covered signup, account context, contacts/import/notes, pipelines/deals, uploads/public media, flow/automation CRUD, quick replies, knowledge CRUD/reindex, broadcast drafts and authenticated pages. Temporary records were cleaned up.
- The per-contact worker lock was checked using two actual concurrent PostgreSQL connections.
- Independent review identified flow concurrency, invitation safety, assignment-ID and stale-role issues; targeted regression tests were added and the findings fixed.

On 29 October 2026, the login/session endpoints responded and the four configured local database connections were checked again when restarting the project. This documentation update does not claim a fresh full test run or a fresh live Meta/provider verification.

### 16.2 Boundaries to keep visible

- The migration removed a runtime service dependency; it did not grant Meta permissions or publish your Meta application.
- No hosted Supabase customer data was imported.
- Your previous successful live test was on the earlier version. Repeat an inbound/reply test after saving the configuration locally.
- Live Meta delivery, production SMTP and paid AI-provider behavior were not exercised by the automated migration tests.
- One configured WhatsApp number and one active account membership per user are current model limits.
- Embedded Signup, automatic customer onboarding and general token refresh are not implemented.
- A general flow HTTP request/response node is not implemented.
- Background webhook/broadcast processing is in-process, not a durable queue; outbound event webhooks have no durable retry service.
- Compatible unmanaged-schema adoption is manual review work; the migration runner refuses unexpected tables rather than deleting them.
- Historical reports/comments can describe the old system; use current source and standalone migrations when changing behavior.

For detailed migration history, read [feature-remove-supabase.md](feature-remove-supabase.md) and [MIGRATION_RESUME.md](MIGRATION_RESUME.md). Earlier progress entries are chronological checkpoints, not the final architecture reference. The runnable setup guide is [LOCAL_SETUP.md](LOCAL_SETUP.md).

## 17. Source references

### 17.1 Current repository sources

- [Package versions and commands](package.json)
- [Pool purposes and credentials](src/lib/db/pool.ts)
- [Transactions and connection release](src/lib/db/transaction.ts)
- [Membership and identity](src/lib/db/context-core.ts), [membership revalidation](src/lib/db/context.ts)
- [Local authentication configuration](src/lib/auth/config.ts)
- [WhatsApp configuration repository](src/lib/db/whatsapp-config.ts)
- [Save/test/reset connection route](src/app/api/whatsapp/config/route.ts)
- [Meta HTTP helpers and pinned API version](src/lib/whatsapp/meta-api.ts)
- [Credential encryption](src/lib/whatsapp/encryption.ts)
- [Inbound webhook](src/app/api/whatsapp/webhook/route.ts), [signature validation](src/lib/whatsapp/webhook-signature.ts)
- [Inbound SQL and deduplication](src/lib/db/inbound.ts)
- [Send endpoint](src/app/api/whatsapp/send/route.ts), [shared send service](src/lib/whatsapp/send-message-local.ts)
- [Flow node types](src/lib/flows/types.ts), [flow runtime](src/lib/flows/engine.ts)
- [Automation runtime](src/lib/automations/engine.ts)
- [AI persistence](src/lib/db/ai-store.ts), [knowledge processing](src/lib/ai/knowledge.ts)
- [Storage filesystem](src/lib/storage/filesystem.ts)
- [Outbound webhook delivery](src/lib/webhooks/deliver.ts)
- [Local scheduler](scripts/local-jobs.mjs)
- [Migration instructions](database/README.md), [current SQL migrations](database/migrations/)
- [Public API guide](docs/public-api.md), [multi-WABA guide](docs/multi-waba.md)

### 17.2 Official Meta references

These links were checked/researched on 29 October 2026. Some developer documentation requires a logged-in Meta session. Dashboard eligibility and current permission requirements remain authoritative for your application.

- **[M1]** [Meta's official Cloud API collection: assets, access tokens and permissions](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api?entity=request-13382743-d0e227d1-e520-4b12-a8f6-32657a52d26e)
- **[M2]** [Meta's official Embedded Signup collection: onboarding and release access](https://www.postman.com/meta/whatsapp-business-platform/documentation/du6gzjv/embedded-signup)
- **[M3]** [Meta's official Register Phone request](https://www.postman.com/meta/whatsapp-business-platform/request/zb2u18b/register-phone)
- **[M4]** [Meta's official WhatsApp Business Platform workspace](https://www.postman.com/meta/whatsapp-business-platform/overview)
- **[M5]** [Meta's official Cloud API message/subscription endpoint documentation](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api?entity=request-13382743-bfd53137-07a0-4f88-a0bc-a15615a6dee2)
- [Meta developer Get Started](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started)
- [Meta Embedded Signup App Review](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/app-review)
- [Meta onboarding customers as a Tech Provider](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider)

Repository descriptions above come from the local code. Future onboarding suggestions are identified as future work. No access tokens, app secrets, database passwords or customer data are included in this document.
