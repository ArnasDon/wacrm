# Nexara WACRM — Rebuild & Cross-Platform Architecture v2

> **Decision-oriented implementation plan**
>
> This version supersedes the previous rebuild plan.
>
> The two assumptions that must be challenged before major implementation are:
>
> 1. **D1 as the system of record for a high-volume WhatsApp inbox**
> 2. **A full greenfield rewrite of a live 104-file production product**
>
> The target remains Web + iOS + Android, but the migration strategy is now:
>
> **Incremental strangler migration for the existing Web product + greenfield mobile application + Nexara framework conversion + database-provider seam.**

---

# 1. Executive Decision

## Target product

Nexara WACRM should ultimately provide:

```text
Web
iOS
Android
   │
   └── shared application/API/domain contracts
              │
              ▼
        Nexara Framework
              │
       CRM application modules
              │
              ▼
       Provider abstractions
              │
       ┌──────┴──────┐
       │             │
      D1          PostgreSQL/Neon
```

But **we do not commit to D1 as the permanent system of record before workload validation**.

Likewise, **we do not rewrite the existing web product from scratch**.

---

# 2. The Five Architecture Challenges

Before implementation, explicitly answer these five questions.

## Challenge 1 — Is D1 suitable for the messaging workload?

The previous plan assumed D1 without sufficiently stress-testing:

- incoming WhatsApp message volume
- concurrent writes
- conversation updates
- unread counters
- message fan-out
- webhook bursts
- broadcast writes
- automation writes
- realtime polling
- attachment metadata
- wallet transactions
- tenant growth
- database size growth
- replication/read consistency

### Required decision

Benchmark:

```text
D1
vs
PostgreSQL / Neon
```

using representative WACRM workloads.

Do not choose based only on feature checklists.

---

# 3. D1 vs Neon Pressure Test

## 3.1 The workload to model

The critical workload is not simply:

```text
CRUD CRM
```

It is closer to:

```text
WhatsApp webhook burst
        ↓
message persistence
        ↓
conversation state update
        ↓
unread count update
        ↓
assignment / automation
        ↓
push notification
        ↓
multiple clients reading inbox
```

A single inbound message can therefore create multiple reads/writes and downstream events.

---

# 4. Benchmark Scenarios

Build a repeatable load-test harness.

## Scenario A — Normal messaging

Example target:

```text
100 messages/sec
```

Measure:

- write latency
- p50
- p95
- p99
- error rate
- queue delay
- transaction latency

---

## Scenario B — Burst

Example:

```text
1,000 messages/sec
for 30–60 seconds
```

Measure:

- write contention
- queue backlog
- database throttling
- API latency
- recovery time

---

## Scenario C — Large tenant

Simulate:

```text
1 tenant
10M+ messages
```

Measure:

- conversation listing
- message history
- search
- unread counts
- assignment queries
- pagination
- index effectiveness

---

## Scenario D — Multi-tenant concurrency

Example:

```text
10,000 tenants
100–500 active tenants
simultaneously receiving messages
```

Measure:

- tenant isolation
- hot partitions / hot rows
- index performance
- write contention
- noisy-neighbor effects

---

## Scenario E — Inbox fan-out

One incoming message should trigger:

```text
message insert
conversation update
unread update
event
notification
multiple client reads
```

Measure end-to-end latency:

```text
WhatsApp webhook
        ↓
database
        ↓
API
        ↓
client sees message
```

---

# 5. D1 Decision Criteria

D1 should remain the system of record only if the benchmark demonstrates acceptable:

- sustained write throughput
- burst handling
- transaction latency
- database size characteristics
- query performance
- concurrency behaviour
- operational simplicity
- cost
- consistency characteristics

Do not decide from theoretical maximums alone.

---

# 6. Preserve the PostgreSQL/Neon Escape Hatch

Even if D1 wins the benchmark, the application must not become coupled to D1 APIs.

Use:

```text
Application Service
        ↓
Repository Interface
        ↓
Database Provider
```

Example:

```ts
interface ConversationRepository {
  findById(input: {
    accountId: string;
    conversationId: string;
  }): Promise<Conversation | null>;

  list(input: ConversationListInput): Promise<ConversationPage>;

  updateStatus(input: UpdateConversationStatusInput): Promise<void>;
}
```

Implementations:

```text
D1ConversationRepository
PostgresConversationRepository
```

The application should not know which one is active.

---

# 7. Database Provider Configuration

The deployment should be able to choose:

```text
DATABASE_PROVIDER=d1
```

or:

```text
DATABASE_PROVIDER=postgres
```

The application should resolve the provider through the Nexara dependency container.

Example:

```text
Config
  ↓
Nexara Container
  ↓
DatabaseProvider
  ↓
Repositories
```

No feature module should directly import D1 or Neon SDKs.

---

# 8. Greenfield vs Strangler Decision

## Existing situation

There is already a:

```text
working
shipping
104-file
production product
```

Therefore a complete web rewrite is high risk.

The new strategy is:

> **Strangler migration for Web + greenfield Mobile.**

---

# 9. Strangler Architecture

During migration:

```text
                         Client
                           │
                    Existing Web App
                           │
                 ┌─────────┴─────────┐
                 │                   │
           Existing Feature      Migrated Feature
                 │                   │
            Old Backend         Nexara Framework
                 │                   │
                 └─────────┬─────────┘
                           │
                     Shared Provider
                           │
                         Data
```

A feature moves only when the replacement is verified.

---

# 10. No Long No-Ship Window

The migration must preserve the ability to ship production changes.

Target:

```text
Existing production
      ↓
Introduce framework
      ↓
No visible behaviour change
      ↓
Migrate one module
      ↓
Release
      ↓
Migrate next module
      ↓
Release
```

Do not wait until the entire application is rewritten.

---

# 11. Migration Principle

For every module:

```text
Inventory
   ↓
Characterize existing behaviour
   ↓
Define contract
   ↓
Implement Nexara version
   ↓
Run old/new comparison
   ↓
Route traffic
   ↓
Observe
   ↓
Remove old implementation
```

---

# 12. Nexara Framework Is the Architecture

The objective is not to create a generic new monorepo architecture beside Nexara.

The objective is:

> **Convert WACRM into the Nexara framework.**

The implementation must therefore explicitly use the existing Nexara concepts:

```text
guards
container
providers
dependency injection
module boundaries
configuration
events
workflows
authorization
storage
database abstraction
```

The exact names should follow the existing `nexara-repo-framework` implementation after repository inspection.

Do not invent parallel abstractions when an existing Nexara abstraction already solves the problem.

---

# 13. Framework Conversion Rule

Before creating a new abstraction:

1. Search `nexara-repo-framework`.
2. Determine whether an equivalent capability already exists.
3. Reuse it if appropriate.
4. Extend it if necessary.
5. Only create a new abstraction if the framework genuinely lacks the capability.

This is mandatory.

---

# 14. Nexara Responsibility Model

The framework should own reusable infrastructure capabilities.

Examples:

```text
Nexara Framework
├── container
├── guards
├── providers
├── authorization
├── configuration
├── database abstraction
├── storage abstraction
├── events
├── workflows
├── notifications
├── observability
└── common runtime utilities
```

WACRM owns business functionality.

Examples:

```text
WACRM
├── conversations
├── contacts
├── messages
├── broadcasts
├── wallet
├── automation
├── WhatsApp workflows
└── CRM rules
```

---

# 15. Repository Shape

Do not assume a new structure until the actual Nexara framework repository is inspected.

The desired conceptual structure is:

```text
nexara-repo-framework/
│
├── framework/
│   ├── container/
│   ├── guards/
│   ├── providers/
│   ├── auth/
│   ├── database/
│   ├── storage/
│   ├── events/
│   ├── workflows/
│   └── observability/
│
├── modules/
│   └── wacrm/
│       ├── conversations/
│       ├── contacts/
│       ├── messages/
│       ├── broadcasts/
│       ├── wallet/
│       └── automation/
│
├── apps/
│   ├── web/
│   └── mobile/
│
└── ...
```

This is a conceptual target, not permission to restructure the repository blindly.

---

# 16. First Implementation Step — Repository Reconnaissance

Before changing code, inspect:

```text
nexara-repo-framework
existing WACRM repository
deployment configuration
database schemas
provider integrations
authentication
API routes
frontend routes
background workers
queues
environment variables
tests
CI/CD
```

Produce:

```text
ARCHITECTURE_GAP_REPORT.md
```

The report must identify:

```text
Existing capability
Nexara equivalent
Reuse / Adapt / Build / Remove
Migration risk
Dependencies
```

---

# 17. Capability Classification

Every major capability must be classified.

| Capability | Decision |
|---|---|
| Nexara container | USE |
| Nexara guards | USE |
| Nexara provider system | USE |
| Existing working UI | PRESERVE initially |
| Existing WhatsApp integration | PRESERVE until replacement verified |
| Authentication | ADAPT/REUSE where possible |
| Database abstraction | USE/EXTEND |
| D1 adapter | BUILD only if D1 wins |
| Postgres adapter | BUILD if benchmark/requirements justify |
| Push notifications | BUILD/ADAPT |
| Mobile UI | BUILD |
| Realtime | DEFER until required |
| Offline sync | BUILD only to required level |
| Media upload | ADAPT |
| Idempotency | USE existing framework capability if available |
| Wallet ledger | BUILD carefully |
| Observability | USE Nexara capability if available |

The final decisions must be based on repository inspection.

---

# 18. Ship the First Valuable Slice Early

The first milestone should NOT be:

```text
Web + Mobile + all modules
```

It should be:

```text
Existing Web
      ↓
Nexara framework
      ↓
WhatsApp
      ↓
Conversation
      ↓
Message persistence
      ↓
Inbox
```

The objective is:

> **Web parity + WhatsApp end-to-end first.**

---

# 19. Recommended Delivery Sequence

## Phase 0 — Architecture Gate

Before significant coding:

```text
1. Inspect Nexara framework
2. Inspect WACRM
3. Produce gap report
4. Benchmark D1 vs Neon/Postgres
5. Define database provider seam
6. Define strangler boundaries
```

Deliverables:

```text
ARCHITECTURE_GAP_REPORT.md
DATABASE_DECISION.md
MIGRATION_MAP.md
```

No major rewrite before this gate passes.

---

# 20. Phase 1 — Nexara Framework Introduction

Goal:

> Introduce Nexara without changing product behaviour.

Tasks:

- integrate Nexara container
- integrate guards
- integrate provider system
- integrate configuration
- integrate logging/observability
- integrate authorization primitives
- establish module boundaries
- preserve current routes
- preserve current APIs

Production should remain functional.

---

# 21. Phase 2 — Data Access Seam

Implement:

```text
DatabaseProvider
Repository interfaces
Transaction abstraction
Migration mechanism
```

Potential implementations:

```text
D1
PostgreSQL/Neon
```

Do not expose either implementation outside infrastructure/provider code.

---

# 22. Phase 3 — WhatsApp Core Strangler

Prioritize:

```text
Webhook
Message ingestion
Conversation persistence
Message sending
Conversation list
Conversation detail
Unread state
Assignment
```

Flow:

```text
WhatsApp
   ↓
Webhook
   ↓
Nexara Guard
   ↓
Idempotency
   ↓
Message Service
   ↓
Repository
   ↓
Database
   ↓
Event
   ↓
Web Inbox
```

---

# 23. Phase 4 — Web Parity

Migrate the web features incrementally.

Recommended priority:

```text
1. Inbox
2. Conversations
3. Contacts
4. Templates
5. Assignments
6. Broadcasts
7. Wallet
8. Automation
9. Settings
10. Administration
```

After each module:

```text
test
observe
release
```

---

# 24. Phase 5 — Mobile Track

Only after the core application/API boundaries are stable.

Use:

```text
Expo
React Native
Expo Router
```

One mobile application:

```text
iOS + Android
```

The mobile application consumes the same:

```text
API contracts
domain types
API client
authorization definitions
```

but has its own native UI.

---

# 25. Mobile Authentication

Web:

```text
secure httpOnly session cookie
```

Mobile:

```text
short-lived access token
+
rotating refresh token
```

Store mobile credentials using secure OS-backed storage.

Required:

- login
- logout
- refresh
- rotation
- revocation
- password reset
- email verification
- invitation flow
- device sessions
- optional biometric unlock

---

# 26. Mobile Push Notifications

Required architecture:

```text
WhatsApp inbound
       ↓
Message Service
       ↓
Event
       ↓
Notification Service
       ↓
Push provider
       ↓
iOS / Android
```

Device registration:

```text
device_installations
--------------------
id
user_id
account_id
platform
push_token
device_id
app_version
last_seen_at
enabled
created_at
updated_at
```

Notification payload:

```json
{
  "type": "new_message",
  "accountId": "acc_123",
  "conversationId": "conv_456",
  "messageId": "msg_789"
}
```

The server must still authorize access after the app opens the conversation.

---

# 27. Mobile Lifecycle

Foreground:

```text
authenticate
refresh session
validate push token
sync changes
refresh active conversation
```

Background:

```text
stop aggressive polling
persist local state
wait for push
```

On notification tap:

```text
push
 ↓
deep link
 ↓
conversation
 ↓
incremental sync
```

---

# 28. Mobile Sync

Do not build a huge offline-first system unless the product actually requires it.

V1 should support:

- persistent cache
- retry
- foreground synchronization
- incremental changes
- optimistic UI where safe
- duplicate prevention

Possible approach:

```text
Expo
 ↓
TanStack Query
 ↓
persistent cache
 ↓
Nexara API
```

Full SQLite/offline-first functionality can be introduced only if user requirements justify it.

---

# 29. Idempotency

Use idempotency for all important side effects.

Minimum:

```text
WhatsApp messages
webhooks
wallet operations
broadcasts
automation actions
media commits
```

Example:

```http
POST /api/app/conversations/:id/messages

Idempotency-Key: <unique-client-operation-id>
```

A retry must not create a duplicate provider operation.

---

# 30. Media

Use direct storage upload where possible.

```text
Mobile/Web
   ↓
Nexara API
   ↓
signed upload
   ↓
R2
   ↓
attachment commit
```

Do not proxy large media unnecessarily through application workers.

Validate:

- MIME
- extension
- size
- ownership
- signed URL expiry

---

# 31. Deep Links

Support:

```text
/invite/:token
/reset-password/:token
/verify-email/:token
/conversations/:id
```

Use Universal Links/App Links so a common URL can open the native app when installed.

---

# 32. Wallet

Wallet must be treated as financial state.

Use:

```text
atomic balance mutation
+
immutable ledger
+
idempotency
```

Prefer:

```sql
UPDATE wallets
SET balance = balance - ?
WHERE account_id = ?
AND balance >= ?
```

Then verify affected rows.

Ledger:

```text
wallet_ledger
-------------
id
account_id
type
amount
balance_before
balance_after
reference_type
reference_id
idempotency_key
created_at
```

---

# 33. Tenant Isolation

Every request must resolve tenant context from authenticated identity/membership.

Do not trust arbitrary:

```text
accountId
```

from clients.

Repository queries must be tenant-scoped.

Bad:

```sql
SELECT *
FROM conversations
WHERE id = ?
```

Good:

```sql
SELECT *
FROM conversations
WHERE id = ?
AND account_id = ?
```

Tenant isolation tests are mandatory.

---

# 34. Realtime

Do not make WebSocket/realtime a Phase 1 dependency.

Start with:

```text
foreground polling
+
push notifications
+
incremental sync
```

Only add WebSocket/realtime if actual UX requirements justify it.

The Nexara provider abstraction should make the transport replaceable.

---

# 35. Provider Architecture

Use Nexara's provider system wherever available.

Conceptually:

```text
WhatsAppProvider
AIProvider
NotificationProvider
StorageProvider
DatabaseProvider
```

Implementations:

```text
MetaWhatsAppProvider
GeminiProvider
OpenAIProvider
ExpoPushProvider
R2StorageProvider
D1DatabaseProvider
PostgresDatabaseProvider
```

Business modules should depend on provider interfaces.

---

# 36. Error Model

Use one consistent API error contract.

```ts
type ApiError = {
  code: string;
  message: string;
  requestId: string;
  details?: unknown;
};
```

Suggested codes:

```text
AUTH_REQUIRED
FORBIDDEN
NOT_FOUND
VALIDATION_ERROR
RATE_LIMITED
INSUFFICIENT_BALANCE
IDEMPOTENCY_CONFLICT
PROVIDER_ERROR
TEMPORARY_UNAVAILABLE
```

---

# 37. Observability

Every request should carry:

```text
request_id
account_id
user_id
```

Mobile requests may additionally include:

```text
device_id
app_version
platform
```

Provider operations:

```text
provider
provider_request_id
operation
latency
status
```

Never log secrets or authentication tokens.

---

# 38. Security

Minimum requirements:

- tenant isolation
- authorization
- input validation
- rate limiting
- webhook signature verification
- idempotency
- secure web cookies
- secure mobile token storage
- refresh token rotation
- signed media URLs
- file validation
- audit logging
- secrets management
- least privilege

Use existing Nexara security capabilities before implementing new ones.

---

# 39. Testing Strategy

## Existing system characterization

Before migration, capture current behaviour.

Test:

```text
API responses
status codes
side effects
database changes
provider calls
permissions
```

This becomes the regression baseline.

## Unit

Test:

- domain rules
- permissions
- wallet
- idempotency
- status transitions

## Integration

Test:

- repositories
- database provider
- API
- provider adapters
- queues/events

## E2E

Web:

```text
Playwright
```

Mobile:

```text
critical native flows
```

---

# 40. Database Compatibility Tests

If both D1 and Postgres adapters exist, the same repository contract tests should run against both.

Example:

```text
ConversationRepositoryContractTests

✓ create
✓ get
✓ list
✓ pagination
✓ update
✓ concurrent update
✓ tenant isolation
✓ transaction behaviour
```

This ensures the database escape hatch is real rather than theoretical.

---

# 41. D1 vs Neon Decision Record

Create:

```text
DATABASE_DECISION.md
```

It must contain:

```text
Workload assumptions
Benchmark methodology
D1 results
Postgres/Neon results
Cost model
Operational model
Consistency model
Scaling risks
Decision
Revisit triggers
```

Example:

```text
Decision:
D1 for V1

Revisit if:
- sustained write throughput exceeds X
- p95 exceeds Y
- database size exceeds Z
- queue backlog exceeds N
- tenant growth exceeds M
```

The actual thresholds must come from measurement, not arbitrary guesses.

---

# 42. Staffing / Complexity Gate

The previous architecture included a large amount of custom infrastructure.

Do not build all of it simply because it is architecturally possible.

For each capability:

```text
Can Nexara already provide it?
Can Cloudflare/Expo/provider tooling provide it?
Can an existing library provide it?
Can we defer it?
```

Only then:

```text
Build custom
```

---

# 43. Complexity Budget

Prioritize:

### Must build now

```text
framework integration
database abstraction
WhatsApp
messaging
tenant isolation
authentication
idempotency
web migration
```

### Build for mobile

```text
native auth
push
deep links
media
lifecycle
basic sync
```

### Defer unless required

```text
full offline-first
custom WebSocket infrastructure
complex background processing
advanced local database
custom notification infrastructure
```

---

# 44. First Value Milestone

The first meaningful production milestone should be:

```text
Existing Web
     ↓
Nexara Framework
     ↓
WhatsApp webhook
     ↓
Message ingestion
     ↓
Database
     ↓
Conversation
     ↓
Inbox
     ↓
Send reply
```

Success criteria:

```text
Real WhatsApp message arrives
→ persisted once
→ appears in inbox
→ operator replies
→ outbound message sent
→ status persisted
→ no duplicate on retry
→ tenant isolation verified
```

This should ship before broad mobile development.

---

# 45. Mobile Milestone

After the above is stable:

```text
Expo app
   ↓
Login
   ↓
Inbox
   ↓
Conversation
   ↓
Send
   ↓
Push
   ↓
Deep link
```

This is the first mobile release candidate.

Do not require full Web feature parity before shipping mobile.

---

# 46. Migration Rules

## Rule 1

**Do not rewrite working code merely to make it look cleaner.**

## Rule 2

**Do not remove the old implementation until the new implementation is proven.**

## Rule 3

**Do not couple business modules to D1 or Neon.**

## Rule 4

**Do not create framework abstractions that already exist in Nexara.**

## Rule 5

**Do not build mobile infrastructure before the core API boundaries are stable.**

## Rule 6

**Do not add realtime/WebSockets before measuring whether polling + push is sufficient.**

## Rule 7

**Every side effect must be evaluated for idempotency.**

## Rule 8

**Every tenant-scoped operation must enforce tenant context server-side.**

## Rule 9

**Production must remain shippable throughout the migration.**

## Rule 10

**Architecture decisions must be backed by workload evidence where possible.**

---

# 47. Revised Roadmap

```text
                    ┌─────────────────────────┐
                    │       PHASE 0            │
                    │ Architecture Gate        │
                    │                         │
                    │ Nexara inspection        │
                    │ WACRM inspection         │
                    │ D1 vs Neon benchmark     │
                    │ Migration map            │
                    └────────────┬────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │       PHASE 1            │
                    │ Nexara Integration       │
                    │                         │
                    │ Container                │
                    │ Guards                   │
                    │ Providers                │
                    │ Config                   │
                    │ Observability            │
                    └────────────┬────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │       PHASE 2            │
                    │ Data Access Seam          │
                    │                         │
                    │ Repository contracts     │
                    │ D1 adapter               │
                    │ Postgres adapter         │
                    └────────────┬────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │       PHASE 3            │
                    │ WhatsApp + Web           │
                    │                         │
                    │ Inbox                    │
                    │ Messages                 │
                    │ Contacts                 │
                    │ Assignment               │
                    └────────────┬────────────┘
                                 │
                                 ▼
                         FIRST PRODUCTION
                              VALUE
                                 │
                    ┌────────────┴────────────┐
                    │                         │
                    ▼                         ▼
             CONTINUE WEB               MOBILE TRACK
             STRANGLER                  Expo/RN
                    │                         │
                    ▼                         ▼
              Web parity              Auth + Push
              Broadcasts              Inbox
              Wallet                  Conversation
              Automation              Media
                    │                  Deep links
                    │                  Sync
                    └────────────┬────────────┘
                                 │
                                 ▼
                         HARDEN + SCALE
```

---

# 48. What Is Explicitly Rejected

The following previous assumptions are rejected unless later justified.

## Rejected: Full web greenfield rewrite

Reason:

```text
working production product
+
existing customers
+
existing revenue
+
long no-ship window
=
unnecessary risk
```

Use strangler migration.

---

## Rejected: D1 as an unquestioned permanent database

Reason:

```text
WhatsApp messaging
+
high write concurrency
+
fan-out
+
large message history
+
inbox reads
=
requires workload validation
```

D1 may still win.

But the decision must be evidence-based.

---

## Rejected: Generic architecture replacing Nexara framework

Reason:

The requirement is to convert the product into Nexara framework, not create a competing architecture.

---

## Rejected: Build mobile and web simultaneously

Reason:

It delays first production value.

Web + WhatsApp should ship first.

---

## Rejected: Build every custom infrastructure capability

Reason:

Complexity and security surface.

Reuse:

```text
Nexara
Cloudflare
Expo
existing libraries
provider capabilities
```

before custom implementation.

---

# 49. What Is Retained From the Previous Plan

The following recommendations remain valid:

### Mobile

- Expo + React Native
- one mobile codebase for iOS + Android
- Expo Router
- native authentication
- secure token storage
- push notifications
- app lifecycle handling
- deep links
- direct R2 media uploads
- basic persistent cache/sync

### Backend

- provider adapters
- tenant isolation
- server-side authorization
- idempotency
- immutable wallet ledger
- queue-based asynchronous processing
- consistent API errors
- observability

### Architecture

- shared TypeScript contracts
- shared domain concepts
- server-only infrastructure
- provider independence
- incremental realtime evolution

---

# 50. Final Architecture Decision

The target is:

> **A Nexara-framework-based WACRM platform where the existing Web product is incrementally strangled into the framework, WhatsApp messaging is made reliable and scalable first, the database is selected through a D1-vs-Neon workload benchmark, and a greenfield Expo mobile application is introduced after the core application/API boundaries stabilize.**

The architecture therefore has four deliberate characteristics:

```text
1. Framework-first
   → Nexara owns reusable runtime capabilities

2. Data-provider independent
   → D1 and Postgres/Neon remain replaceable

3. Migration-safe
   → existing production system keeps shipping

4. Mobile-native
   → Expo provides iOS + Android without maintaining
      separate native codebases
```

---

# 51. Implementation Agent Instructions

Before writing or modifying significant code:

## Step 1 — Inspect

Inspect the complete:

```text
nexara-repo-framework
WACRM repository
```

including:

- source
- package manifests
- configuration
- migrations
- API routes
- provider integrations
- auth
- workers
- queues
- tests
- CI/CD

---

## Step 2 — Map

Create:

```text
ARCHITECTURE_GAP_REPORT.md
```

with:

```text
WACRM component
Current implementation
Nexara equivalent
Action:
  USE
  ADAPT
  BUILD
  DEFER
  REMOVE
Risk
Dependencies
```

---

## Step 3 — Benchmark

Create:

```text
DATABASE_DECISION.md
```

and benchmark:

```text
D1
PostgreSQL/Neon
```

using representative messaging workloads.

Do not make the database decision before this analysis unless there is a compelling existing constraint.

---

## Step 4 — Introduce Nexara

Integrate:

```text
container
guards
providers
configuration
authorization
observability
database abstraction
```

without breaking existing production functionality.

---

## Step 5 — Establish Strangler Boundary

Select one high-value module.

Recommended:

```text
Conversations + Messages
```

Route only that module through Nexara.

Leave unrelated functionality on the existing implementation.

---

## Step 6 — Ship

The first production target is:

```text
WhatsApp
→ webhook
→ Nexara
→ persistence
→ Web inbox
→ reply
```

Do not wait for mobile.

---

## Step 7 — Continue Migration

Migrate modules individually.

Every module must:

```text
pass tests
pass regression checks
pass tenant-isolation checks
pass observability checks
be monitored in production
```

before removing the old implementation.

---

## Step 8 — Mobile

Once the core API/domain/provider boundaries are stable:

```text
apps/mobile
```

with:

```text
Expo
React Native
Expo Router
```

Implement the smallest useful native workflow first:

```text
Login
→ Inbox
→ Conversation
→ Send
→ Push
→ Deep link
```

---

# 52. Non-Negotiable Guardrails for Claude/Codex

Before changing architecture, ask:

```text
Does Nexara already solve this?
```

Before choosing D1:

```text
Did we benchmark the actual workload?
```

Before rewriting code:

```text
Can this be strangled incrementally?
```

Before adding infrastructure:

```text
Can an existing platform/provider handle it?
```

Before creating a database query:

```text
Is tenant scope enforced?
```

Before implementing a side effect:

```text
What happens if the request is retried?
```

Before implementing mobile background behaviour:

```text
Can push + foreground sync solve this?
```

Before adding WebSockets:

```text
Have we demonstrated that polling + push is insufficient?
```

Before removing old code:

```text
Has the new implementation been proven in production?
```

---

# 53. Definition of Done

The rebuild is complete only when:

```text
✓ WACRM runs on Nexara framework
✓ Existing Web functionality has been migrated safely
✓ WhatsApp messaging is production reliable
✓ Database provider is replaceable
✓ D1/Neon decision is evidence-based
✓ Tenant isolation is enforced
✓ Authentication is secure
✓ Side effects are idempotent
✓ Wallet is concurrency-safe
✓ Mobile runs on iOS
✓ Mobile runs on Android
✓ Push notifications work
✓ Deep links work
✓ Media upload works
✓ Basic mobile sync works
✓ Observability exists
✓ Critical flows are covered by tests
✓ Production migration is reversible
```

---

# 54. Bottom Line

Do **not** start by rebuilding everything.

Start by proving the two risky assumptions:

```text
             ┌─────────────────────┐
             │ Is D1 good enough?  │
             └──────────┬──────────┘
                        │
             ┌──────────▼──────────┐
             │ Can we migrate      │
             │ without stopping    │
             │ product delivery?   │
             └──────────┬──────────┘
                        │
                        ▼
                 Nexara conversion
                        │
                        ▼
                 WhatsApp + Web
                        │
                        ▼
                  First release
                        │
                        ▼
                   Mobile app
```

The objective is **not** to produce the cleanest architecture on day one.

The objective is to produce a **better architecture without destroying a working product**, while preserving the ability to change the database and add native mobile capabilities later.

That is the architecture this implementation should follow.
