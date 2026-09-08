# Nexara WACRM — Cross-Platform Rebuild Architecture & Implementation Plan

## Purpose

This document captures the recommended architecture for rebuilding Nexara WACRM as a cross-platform product supporting:

- Web
- iOS
- Android
- One shared backend
- One shared domain/API contract layer
- One React Native mobile application serving both iOS and Android

The goal is to give Claude/Codex a precise architectural target before implementation begins.

---

# 1. Executive Architecture Decision

## Recommended stack

### Web
- Next.js
- Existing shadcn/ui-based web interface
- TypeScript

### Mobile
- Expo
- React Native
- Expo Router
- iOS + Android from one mobile codebase

### Backend
- Cloudflare Workers
- TypeScript
- Application/service layer
- Repository layer
- D1
- R2
- Vectorize
- Queues where required

### Shared packages

```text
packages/
├── domain/
├── contracts/
├── api-client/
├── auth-client/
└── utils/
```

### Server-only code

```text
server/
├── application/
├── infrastructure/
├── repositories/
├── providers/
└── workers/
```

## Critical principle

"One codebase" should mean:

> One repository, one TypeScript ecosystem, one backend, one domain/contracts layer, and one React Native mobile application serving both iOS and Android.

It does **not** mean that the Next.js web UI is directly reused as the native iOS/Android UI.

The presentation layer should be:

```text
Web      → Next.js + shadcn
iOS      → Expo + React Native
Android  → Expo + React Native
```

Everything platform-independent should be shared.

---

# 2. Target Architecture

```text
                         NEXARA WACRM
                              │
                ┌─────────────┴─────────────┐
                │                           │
             WEB APP                   MOBILE APP
             Next.js                  Expo / React Native
             shadcn                   iOS + Android
                │                           │
                └─────────────┬─────────────┘
                              │
                    Shared TypeScript Layer
                              │
             ┌────────────────┼────────────────┐
             │                │                │
          Domain          Contracts        API Client
             │                │                │
             └────────────────┼────────────────┘
                              │
                              ▼
                     Cloudflare API
                              │
                     Application Services
                              │
             ┌────────────────┼────────────────┐
             │                │                │
             ▼                ▼                ▼
            D1               R2            Vectorize
             │
          Queues
             │
       External Providers
             │
     WhatsApp / AI / Push / etc.
```

---

# 3. Monorepo Structure

Recommended structure:

```text
nexara-wacrm/
│
├── apps/
│   ├── web/
│   │   ├── app/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── lib/
│   │   └── next.config.*
│   │
│   └── mobile/
│       ├── app/
│       │   ├── (auth)/
│       │   ├── (tabs)/
│       │   ├── conversations/
│       │   ├── contacts/
│       │   ├── broadcasts/
│       │   └── settings/
│       ├── components/
│       ├── hooks/
│       ├── services/
│       ├── store/
│       ├── app.config.ts
│       └── eas.json
│
├── packages/
│   ├── domain/
│   │   ├── entities/
│   │   ├── value-objects/
│   │   ├── enums/
│   │   └── rules/
│   │
│   ├── contracts/
│   │   ├── auth/
│   │   ├── conversations/
│   │   ├── contacts/
│   │   ├── messages/
│   │   ├── broadcasts/
│   │   ├── wallet/
│   │   └── automation/
│   │
│   ├── api-client/
│   │   ├── client.ts
│   │   ├── auth.ts
│   │   ├── conversations.ts
│   │   ├── contacts.ts
│   │   └── messages.ts
│   │
│   ├── auth-client/
│   └── utils/
│
├── server/
│   ├── application/
│   │   ├── auth/
│   │   ├── conversations/
│   │   ├── contacts/
│   │   ├── messages/
│   │   ├── broadcasts/
│   │   ├── wallet/
│   │   └── automation/
│   │
│   ├── infrastructure/
│   │   ├── database/
│   │   ├── storage/
│   │   ├── vectorize/
│   │   ├── queues/
│   │   └── cache/
│   │
│   ├── repositories/
│   ├── providers/
│   │   ├── whatsapp/
│   │   ├── ai/
│   │   ├── notifications/
│   │   └── media/
│   │
│   └── workers/
│
├── tests/
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

---

# 4. Important Package Boundary

The existing idea of a broad `packages/core` should be changed.

Do **not** make `packages/core` contain:

- D1 bindings
- R2 bindings
- Vectorize bindings
- Cloudflare Worker objects
- server repositories
- server-only environment access

Those are server-only.

## Correct separation

```text
packages/domain
packages/contracts
packages/api-client
packages/auth-client
packages/utils
```

versus:

```text
server/application
server/infrastructure
server/repositories
server/providers
```

### Mobile must never directly import

```text
D1Database
R2Bucket
VectorizeIndex
CloudflareEnv
Worker bindings
server repositories
```

Mobile communication should always be:

```text
Mobile
   ↓ HTTPS
Typed API Client
   ↓
Cloudflare API
   ↓
Application Services
   ↓
Repositories
   ↓
D1 / R2 / Vectorize
```

---

# 5. Shared Domain Layer

The domain package should contain only platform-independent concepts.

Examples:

```text
Account
User
Role
Permission
Contact
Conversation
Message
Broadcast
Automation
Wallet
WalletTransaction
Campaign
Template
Attachment
```

Also include:

- enums
- validation rules
- pure business rules
- value objects
- status transitions
- permission definitions

Example:

```ts
export type ConversationStatus =
  | "open"
  | "pending"
  | "closed";
```

Do not put database access into domain objects.

---

# 6. Shared API Contracts

Use Zod or an equivalent schema system.

Example:

```ts
const SendMessageRequest = z.object({
  conversationId: z.string(),
  text: z.string().min(1),
  attachments: z.array(AttachmentInput).optional(),
});
```

The same contract should be used by:

```text
Next.js
Expo
Cloudflare API
Tests
```

This prevents web/mobile/backend request shapes from drifting apart.

---

# 7. API Architecture

Use two logical API surfaces.

## First-party application API

```text
/api/app/*
```

Used by:

- Web
- iOS
- Android

Examples:

```text
POST   /api/app/auth/login
POST   /api/app/auth/refresh
POST   /api/app/auth/logout

GET    /api/app/conversations
GET    /api/app/conversations/:id
POST   /api/app/conversations/:id/messages

GET    /api/app/contacts
POST   /api/app/contacts

GET    /api/app/wallet
GET    /api/app/wallet/ledger

POST   /api/app/broadcasts
POST   /api/app/automations
```

## Public/external API

```text
/api/v1/*
```

Used by:

- customer integrations
- external applications
- partner integrations

Do not make the mobile application depend directly on the public integration API.

Both APIs should ultimately use the same application/service layer.

---

# 8. Authentication Architecture

## Web

Use:

```text
httpOnly secure cookie
```

with appropriate:

- SameSite configuration
- CSRF protection
- session expiry
- logout
- refresh handling

## Mobile

Native apps should not rely on browser cookie behavior as the fundamental authentication mechanism.

Recommended:

```text
Mobile
  ↓
short-lived access token
  +
rotating refresh token
  ↓
iOS Keychain / Android Keystore
```

Expo SecureStore can be used for secure local token storage.

## Required authentication features

Implement:

- login
- logout
- refresh
- refresh-token rotation
- refresh-token revocation
- password reset
- email verification
- invitation acceptance
- multi-device sessions
- session/device listing
- session revocation
- optional biometric unlock

---

# 9. Push Notification Architecture

Push notifications are required for a CRM/mobile inbox.

Example:

```text
Incoming WhatsApp message
          ↓
Cloudflare Worker
          ↓
Conversation Service
          ↓
Database
          ↓
Notification Service
          ↓
Expo Push / APNs / FCM
          ↓
iOS / Android
```

Create:

```text
NotificationProvider
```

with an initial implementation such as:

```text
ExpoPushNotificationProvider
```

Potential device table:

```sql
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

The system must support:

- device registration
- token refresh
- multiple devices
- disable notifications
- logout cleanup
- notification routing
- invalid-token cleanup

---

# 10. Realtime Architecture

Do not treat polling and realtime as the same concern.

## V1

Foreground:

```text
Web/Mobile
   ↓
Polling
   ↓
API
```

## Future

```text
Web/Mobile
   ↓
WebSocket / realtime channel
   ↓
RealtimeProvider
```

## Background mobile

Do not rely on continuous polling.

Use:

```text
Push notification
      ↓
User opens app
      ↓
Incremental synchronization
```

Recommended separation:

```text
RealtimeProvider
NotificationProvider
SyncProvider
```

---

# 11. Mobile Synchronization

Mobile applications need resilient handling of:

- poor connectivity
- Wi-Fi/4G/5G transitions
- background/foreground transitions
- retries
- stale data
- duplicate requests

At minimum use a persistent API cache.

Example:

```text
Expo Mobile
     ↓
TanStack Query
     ↓
Persistent cache
     ↓
API
```

Potentially add SQLite later if true offline functionality is required.

## Define these behaviours

### Retry

Network errors should retry with backoff.

### Optimistic updates

Useful for:

- marking conversations read
- assigning conversations
- simple status changes

### Message sending

Must have:

- client-generated request ID
- idempotency key
- server message ID
- delivery status

### Incremental sync

Example:

```text
GET /api/app/sync?cursor=abc123
```

Response:

```json
{
  "cursor": "abc456",
  "changes": []
}
```

---

# 12. Idempotency

Idempotency must be first-class.

Important operations:

- sending WhatsApp messages
- wallet debit
- broadcasts
- automation execution
- webhook handling
- media commit
- mobile retries

Example:

```http
POST /api/app/messages

Idempotency-Key: 9e7d...
```

Server must guarantee that retrying the same logical operation does not create a duplicate side effect.

This is especially important when:

```text
User taps Send
       ↓
Request reaches server
       ↓
Response is lost
       ↓
Mobile retries
```

The retry must not send two WhatsApp messages.

---

# 13. Wallet Architecture

Wallet operations require strong concurrency protection.

Avoid:

```text
SELECT balance
       ↓
application checks balance
       ↓
UPDATE balance
```

Prefer an atomic conditional update:

```sql
UPDATE wallets
SET balance = balance - ?
WHERE account_id = ?
  AND balance >= ?
```

Then verify:

```text
rows_written === 1
```

If zero rows were updated:

```text
insufficient balance
```

or another concurrency condition occurred.

## Immutable ledger

Use:

```text
wallets
wallet_ledger
```

The ledger should be append-only.

Example:

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

Never use the mutable balance column as the complete audit trail.

---

# 14. D1 Consistency

Cloudflare D1 supports transactional operations and session-based consistency features.

The database provider should explicitly model consistency requirements.

Possible abstraction:

```ts
db.read({
  consistency: "normal"
});
```

or:

```ts
db.read({
  consistency: "session"
});
```

This becomes important when read replication is introduced.

Example:

```text
POST message
    ↓
write
    ↓
immediate GET conversation
```

The user should not see stale state after a successful write.

---

# 15. Media Architecture

WhatsApp CRM will likely require:

- images
- documents
- audio
- video
- voice messages
- camera capture

Do not unnecessarily proxy large media through the Worker.

Recommended flow:

```text
Mobile
   ↓
Request signed upload
   ↓
Cloudflare API
   ↓
Signed R2 upload URL
   ↓
Mobile uploads directly to R2
   ↓
API commits attachment record
```

Create:

```text
MediaService
```

Responsibilities:

- upload authorization
- MIME validation
- file-size validation
- signed URL creation
- attachment metadata
- download URL generation
- cleanup
- virus/security scanning if required

---

# 16. Deep Linking

Deep links should be designed before mobile release.

Required cases:

```text
/invite/:token
/reset-password/:token
/verify-email/:token
/conversations/:id
```

Notification:

```text
Push notification
      ↓
tap
      ↓
/conversations/123
```

Universal Links / Android App Links should allow the same web URL to intelligently open the native application when installed.

---

# 17. WhatsApp Conversation Model

The conversation system should be designed around stable IDs.

Example:

```text
Account
   ↓
Contact
   ↓
Conversation
   ↓
Messages
   ↓
Attachments
```

Do not identify conversations only by phone number.

Use internal IDs:

```text
account_id
contact_id
conversation_id
message_id
```

External provider identifiers should be stored separately:

```text
provider
provider_conversation_id
provider_message_id
```

This keeps the system provider-independent.

---

# 18. Provider Adapter Architecture

The adapter strategy is good and should remain.

Example:

```text
server/providers/
├── whatsapp/
│   ├── WhatsAppProvider.ts
│   └── MetaWhatsAppProvider.ts
│
├── ai/
│   ├── AIProvider.ts
│   ├── OpenAIProvider.ts
│   └── GeminiProvider.ts
│
├── notifications/
│   ├── NotificationProvider.ts
│   └── ExpoPushNotificationProvider.ts
│
└── media/
    └── R2MediaProvider.ts
```

Application services should depend on interfaces, not concrete providers.

Example:

```ts
interface WhatsAppProvider {
  sendMessage(input: SendMessageInput): Promise<SendMessageResult>;
}
```

---

# 19. Tenant Isolation

Every business operation must enforce account/tenant ownership.

Never trust:

```text
accountId
```

from the client.

Resolve account from:

```text
authenticated session
+
membership
+
authorization
```

Every repository query should have tenant constraints.

Bad:

```sql
SELECT * FROM conversations WHERE id = ?
```

Good:

```sql
SELECT *
FROM conversations
WHERE id = ?
  AND account_id = ?
```

Tenant isolation should be tested systematically.

---

# 20. Authorization

Define permissions centrally.

Example:

```text
conversation.read
conversation.write
conversation.assign
contact.read
contact.write
broadcast.create
broadcast.send
wallet.read
wallet.manage
automation.manage
settings.manage
```

The same permission definitions can be shared by web and mobile.

The server remains the final authority.

---

# 21. Mobile UI Strategy

Do not attempt to force shadcn/web components into React Native.

Instead:

```text
Web Design System
→ shadcn/ui

Mobile Design System
→ React Native components
```

Share:

- design tokens
- colors
- spacing
- typography definitions
- icon semantics
- domain terminology
- validation rules

Do not necessarily share the actual UI components.

---

# 22. Mobile Navigation

Use Expo Router.

Suggested structure:

```text
app/
├── (auth)/
│   ├── login.tsx
│   ├── forgot-password.tsx
│   └── verify-email.tsx
│
├── (tabs)/
│   ├── index.tsx
│   ├── conversations.tsx
│   ├── contacts.tsx
│   ├── broadcasts.tsx
│   └── settings.tsx
│
├── conversations/
│   └── [id].tsx
│
├── contacts/
│   └── [id].tsx
│
├── broadcasts/
│   └── [id].tsx
│
└── settings/
    └── ...
```

---

# 23. Mobile App Lifecycle

Explicitly handle:

```text
active
inactive
background
terminated
```

On foreground:

```text
1. Validate auth
2. Refresh session if needed
3. Register/validate push token
4. Synchronize changes
5. Refresh active conversation
```

On background:

```text
1. Stop aggressive polling
2. Persist pending local state
3. Rely on push notifications
```

---

# 24. Notifications and Conversation Routing

Notification payload example:

```json
{
  "type": "new_message",
  "accountId": "acc_123",
  "conversationId": "conv_456",
  "messageId": "msg_789"
}
```

When tapped:

```text
Notification
    ↓
Expo Router
    ↓
/conversations/conv_456
```

Server must validate that the authenticated user can access that conversation.

Never trust the notification payload as an authorization mechanism.

---

# 25. Background Work

Use queues for work that should not block API responses.

Examples:

```text
incoming webhook
      ↓
queue
      ↓
message processing
      ↓
notification
```

Other queue candidates:

- broadcasts
- media processing
- AI summarization
- embeddings
- automation execution
- webhook retries
- analytics
- notification delivery

API requests should return quickly whenever work can be asynchronous.

---

# 26. Error Handling

Create a shared error model.

Example:

```ts
type ApiError = {
  code: string;
  message: string;
  requestId: string;
  details?: unknown;
};
```

Example codes:

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

Mobile and web can then handle errors consistently.

---

# 27. Observability

Every request should have:

```text
request_id
account_id
user_id
device_id (when applicable)
```

For provider operations also log:

```text
provider
provider_request_id
operation
latency
status
```

Do not log:

- access tokens
- refresh tokens
- passwords
- full sensitive message payloads unless explicitly required
- secrets

---

# 28. Security Requirements

Minimum:

- secure cookies on web
- secure token storage on mobile
- refresh token rotation
- authorization on every server operation
- tenant isolation
- rate limiting
- input validation
- MIME validation
- file-size limits
- signed R2 URLs
- webhook signature verification
- idempotency
- audit logging
- secret management
- least-privilege provider credentials

---

# 29. Release Architecture

## Environments

```text
development
staging
production
```

Each environment must have separate:

- D1 database
- R2 buckets
- secrets
- provider credentials
- notification configuration
- API URLs

## Mobile configuration

Use:

```text
app.config.ts
eas.json
```

Define:

```text
development build
preview/staging build
production build
```

Bundle identifiers:

```text
com.nexara.wacrm
```

or an agreed production identifier.

---

# 30. CI/CD

Recommended:

```text
Pull Request
   │
   ├── Typecheck
   ├── Lint
   ├── Unit Tests
   ├── API Contract Tests
   ├── Web Build
   └── Mobile Validation
```

Main branch:

```text
Cloudflare deployment
Web deployment
Preview mobile build
```

Release:

```text
Release tag
   ├── Production Worker
   ├── Production Web
   ├── iOS production build
   └── Android production build
```

---

# 31. App Store / Play Store Requirements

Plan for:

- privacy policy
- terms
- account deletion
- notification permissions
- camera permissions
- photo/media permissions
- microphone permission if applicable
- data collection disclosures
- crash monitoring
- versioning
- minimum supported app version
- App Store signing
- Play Store signing

These should not be left until the final week.

---

# 32. Testing Strategy

## Unit

Test:

- domain rules
- permissions
- wallet logic
- idempotency
- status transitions

## Integration

Test:

- D1
- repositories
- API endpoints
- provider adapters
- queue handlers

## Contract

Ensure:

```text
Web
Mobile
Backend
```

all conform to the same API schemas.

## E2E

Web:

```text
Playwright
```

Mobile:

```text
Expo-compatible E2E strategy
```

Test critical flows:

```text
Login
Conversation list
Open conversation
Send message
Receive message
Mark read
Assign conversation
Contact creation
Broadcast
Wallet debit
Push notification
Deep link
Logout
```

---

# 33. Migration Strategy

This should remain a greenfield rebuild rather than a risky in-place rewrite.

Recommended sequence:

```text
Phase 0
Architecture + monorepo

Phase 1
Database + repositories

Phase 2
Authentication + authorization

Phase 3
Core APIs

Phase 4
Web UI migration

Phase 5
Mobile application

Phase 6
WhatsApp/provider integration

Phase 7
Realtime + notifications

Phase 8
Wallet/broadcast/automation

Phase 9
Testing + hardening

Phase 10
Production migration
```

---

# 34. Phase 0 — Foundation

Deliver:

```text
pnpm workspace
Turbo
TypeScript
apps/web
apps/mobile
packages/domain
packages/contracts
packages/api-client
packages/auth-client
server
```

Also establish:

- linting
- formatting
- testing
- environment configuration
- CI
- dependency policy

Do not begin feature implementation until package boundaries are stable.

---

# 35. Phase 1 — Database

Implement:

```text
D1 schema
migrations
repositories
transactions
tenant isolation
indexes
```

Repositories should never expose raw database bindings to application code.

Example:

```ts
conversationRepository.findById({
  accountId,
  conversationId
});
```

---

# 36. Phase 2 — Authentication

Implement:

```text
Web session
Mobile access token
Refresh token
Token rotation
Logout
Password reset
Email verification
Invitation
Device sessions
```

Test:

```text
expired token
revoked token
stolen refresh token
wrong tenant
wrong role
multi-device login
```

---

# 37. Phase 3 — Core API

Build:

```text
Contacts
Conversations
Messages
Users
Teams
Assignments
Templates
Attachments
```

Every endpoint must include:

- authentication
- authorization
- tenant validation
- input schema validation
- consistent errors
- request IDs

---

# 38. Phase 4 — Web

Migrate the existing Next.js experience.

Preserve existing UX where it is good.

Do not duplicate business logic inside React components.

Frontend should call:

```text
shared api-client
```

instead of directly implementing server semantics.

---

# 39. Phase 5 — Mobile

Start with the core operator workflow.

Priority:

```text
1. Login
2. Inbox
3. Conversation
4. Send message
5. Receive notification
6. Contacts
7. Conversation assignment
8. Profile/settings
```

Do not build every web feature on mobile before validating the primary mobile workflow.

---

# 40. Phase 6 — WhatsApp Integration

Use provider adapters.

Flow:

```text
WhatsApp webhook
       ↓
Webhook verification
       ↓
Idempotency
       ↓
Queue
       ↓
Message service
       ↓
D1
       ↓
Push notification
```

Outgoing:

```text
Mobile/Web
    ↓
API
    ↓
Message Service
    ↓
Wallet validation if applicable
    ↓
WhatsApp Provider
    ↓
Provider response
    ↓
D1
```

---

# 41. Phase 7 — Realtime + Push

Start with:

```text
polling
+
push notifications
```

Then add WebSocket/realtime only if required by UX or scale.

This avoids prematurely increasing infrastructure complexity.

---

# 42. Phase 8 — Wallet/Broadcast/Automation

Build after the core messaging flow is reliable.

Wallet:

```text
atomic balance update
+
immutable ledger
+
idempotency
```

Broadcast:

```text
campaign
→ recipients
→ queue
→ provider
→ result
→ wallet ledger
```

Automation:

```text
trigger
→ rule evaluation
→ queued action
→ provider
→ result
```

---

# 43. Phase 9 — Hardening

Before production:

- tenant isolation tests
- security review
- rate-limit testing
- idempotency testing
- provider failure tests
- retry tests
- database migration tests
- mobile offline/poor-network tests
- push notification tests
- deep-link tests
- media upload tests
- wallet concurrency tests
- load testing

---

# 44. Phase 10 — Production

Use staged rollout:

```text
Internal users
      ↓
Small production cohort
      ↓
Expanded cohort
      ↓
Full rollout
```

For mobile:

```text
TestFlight
Google Play internal testing
      ↓
Closed/beta
      ↓
Production
```

Keep the old system available until the new system has demonstrated stability.

---

# 45. Definition of Done

A feature is not complete merely because the API works.

For each feature:

```text
Domain rule
    ↓
API contract
    ↓
Backend service
    ↓
Repository
    ↓
Web UI
    ↓
Mobile UI
    ↓
Authorization
    ↓
Tenant isolation
    ↓
Error handling
    ↓
Observability
    ↓
Tests
```

---

# 46. Critical Architectural Rules for Claude/Codex

These rules should be treated as non-negotiable.

## Rule 1 — No direct database access from clients

Never:

```text
Web → D1
Mobile → D1
```

Always:

```text
Web/Mobile → API → Application Service → Repository → D1
```

## Rule 2 — No server dependencies in mobile

Never import:

```text
Cloudflare bindings
D1
R2
Vectorize
Worker environment
server repositories
```

into Expo.

## Rule 3 — Shared contracts are mandatory

Web, mobile and backend must consume the same schemas wherever practical.

## Rule 4 — Server authorization is authoritative

Client-side permissions are only UX.

## Rule 5 — Every tenant-scoped query includes tenant context

Never trust client-supplied account IDs.

## Rule 6 — Side effects require idempotency

Especially:

```text
messages
wallet
broadcasts
automation
webhooks
```

## Rule 7 — Mobile background work must not rely on polling

Use push notifications.

## Rule 8 — Large media should use direct R2 uploads

Avoid unnecessary Worker proxying.

## Rule 9 — Provider implementations must stay behind interfaces

Do not leak Meta/WhatsApp/AI provider-specific logic throughout the application.

## Rule 10 — Do not over-share UI code

Share domain/API/business concepts, not incompatible Web/RN components.

---

# 47. Final Recommended Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                        NEXARA WACRM                         │
└─────────────────────────────────────────────────────────────┘

       ┌────────────────────┐       ┌──────────────────────┐
       │       WEB          │       │       MOBILE         │
       │                    │       │                      │
       │ Next.js            │       │ Expo / React Native  │
       │ shadcn/ui          │       │ iOS + Android        │
       └─────────┬──────────┘       └──────────┬───────────┘
                 │                             │
                 └──────────────┬──────────────┘
                                │
                       Shared TypeScript
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                 │
           Domain           Contracts         API Client
              │                 │                 │
              └─────────────────┼─────────────────┘
                                │
                                ▼
                       Cloudflare Workers
                                │
                       Application Services
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
        ▼                       ▼                       ▼
       D1                      R2                  Vectorize
        │
      Queues
        │
   ┌────┼───────────────┬────────────────┐
   │    │               │                │
WhatsApp AI          Notifications     Automation
Provider Providers   Expo/APNs/FCM     Workers
```

---

# 48. Final Decision

### Use:

```text
Web:
Next.js + shadcn

Mobile:
Expo + React Native

Backend:
Cloudflare Workers

Database:
D1

Storage:
R2

Vector search:
Vectorize

Shared:
TypeScript + Domain + Contracts + API Client

Async:
Cloudflare Queues

Notifications:
Expo Push initially, abstraction for APNs/FCM later
```

### Avoid:

```text
Flutter
Capacitor/WebView as the primary mobile strategy
Direct D1 access from clients
One giant shared core package
Browser-cookie-only mobile authentication
Background mobile polling
Provider-specific logic inside UI
Non-idempotent message/wallet operations
```

---

# 49. Architecture Assessment

The existing rebuild direction is fundamentally sound.

The strongest parts are:

- greenfield migration
- adapter/provider architecture
- Cloudflare-native backend
- D1/R2/Vectorize
- tenant isolation
- modular application structure
- shared TypeScript ecosystem

The major areas that must be added before implementation are:

1. Native mobile authentication
2. Push notification architecture
3. Mobile synchronization/cache
4. Idempotency
5. First-party mobile API boundary
6. Deep linking
7. Media upload architecture
8. Mobile lifecycle handling
9. Release/store pipeline
10. Clear server/client package boundaries

With these additions, the target becomes a robust:

> **single-repository, cross-platform Nexara WACRM system with one web application, one iOS/Android mobile application, one backend, and shared domain/API contracts.**

---

# 50. Instruction to the Implementation Agent

Before modifying code:

1. Inspect the complete existing repository.
2. Identify the existing modules, APIs, database models and provider integrations.
3. Map them against this architecture.
4. Produce a migration gap report.
5. Do not blindly rewrite working functionality.
6. Preserve existing external API behaviour where compatibility is required.
7. Identify server-only dependencies.
8. Create the monorepo/package boundaries first.
9. Move shared contracts/domain code into shared packages.
10. Keep infrastructure inside `server/`.
11. Implement authentication before protected business APIs.
12. Implement tenant isolation before exposing data APIs.
13. Implement idempotency before message/wallet side effects.
14. Implement push/device registration before mobile notification-dependent UX.
15. Add tests for each migrated module.
16. Do not deploy intermediate experimental architecture to production.
17. Validate locally/staging first.
18. Only deploy production after migration verification.

The implementation agent should prioritize correctness, security, tenant isolation, idempotency and backward compatibility over speed of migration.
