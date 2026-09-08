# Nexara WACRM — Rebuild Architecture v5 (addendum to v2)

> Supersedes the open decisions in v2 and the v3/v4 addenda. This document locks the current architecture decisions for the Nexara WACRM rebuild. The goal is to build WACRM on the Nexara framework without prematurely building the broader Nexara OS provider ecosystem.

---

## 0. Executive Direction

WACRM is being rebuilt as the **first production vertical on the Nexara platform**.

The architecture must therefore separate:

- **Nexara platform capabilities** — identity, organizations, permissions, billing/credits, events, notifications, providers, etc.
- **WACRM business capabilities** — WhatsApp, conversations, contacts, campaigns, automation, Meta onboarding, etc.

The first commercial provider flow is deliberately narrow:

```text
Customer
   ↓
Nexara Billing / Credits
   ↓
WACRM WhatsApp
   ↓
Meta WhatsApp Business Platform
```

Do **not** implement a generalized AI/voice/provider credit marketplace in this phase. The billing architecture should be extensible, but the only production usage meter initially implemented is **WhatsApp → Meta usage**.

---

## Decision 1 — Drop Supabase entirely

- **No Supabase** anywhere — not as the old store, not for auth, not for storage.
- Database is resolved through the framework `DatabaseProvider`: **D1 vs Neon/Postgres decided by the benchmark gate**.
- Business modules never import a database SDK directly.
- Keep database access behind the framework/provider boundary so the selected database can be changed without rewriting business modules.
- Storage → `StorageProvider` / R2.
- Vector → `VectorProvider` / Vectorize.
- There is one new system of record; do not create a permanent Supabase/new-DB split-brain.

### Database benchmark gate

Before locking D1 or Neon/Postgres, benchmark the actual WACRM workload:

- sustained message writes
- burst writes
- concurrent tenants
- conversation/inbox reads
- message history pagination
- webhook ingestion
- idempotent event processing
- 10M+ message scale simulation
- p95/p99 latency
- operational complexity
- realistic monthly cost

The result must be recorded in `DATABASE_DECISION.md`.

---

## Decision 2 — Auth uses the Nexara framework `AuthProvider`

The framework already provides the authentication seam. Use and extend it; do not add Auth.js or Supabase Auth.

```ts
interface AuthProvider {
  login(c: Credentials): Promise<Session>;
  logout(accessToken: string): Promise<void>;
  getCurrentUser(accessToken: string): Promise<AuthUser | null>;
  getSession(accessToken: string): Promise<Session | null>;
  verifyPermission(user: AuthUser, permission: Permission): boolean;

  refresh(refreshToken: string): Promise<Session>;
  revokeSession(sessionId: string): Promise<void>;
  revokeAllSessions(userId: UserId): Promise<void>;
  listSessions(userId: UserId): Promise<DeviceSession[]>;
  requestPasswordReset(email: string): Promise<void>;
  resetPassword(token: string, newPassword: string): Promise<void>;
  verifyEmail(token: string): Promise<void>;
  acceptInvitation(token: string, password: string): Promise<Session>;
}
```

New adapter-portable tables:

- `users`
- `sessions`
- `refresh_tokens`
- `email_tokens`
- `device_installations`

Rules:

- Web: access token in secure httpOnly cookie; server-side refresh rotation.
- Mobile: short-lived access token + rotating refresh token in OS secure storage.
- Password hashing must be Workers-safe; do not use Node-only `bcrypt`.
- RBAC remains the framework `PermissionService`; the server is the final authority.

---

## Decision 3 — Create a NEW canonical repository from the framework + WACRM

Neither existing repository remains the canonical product repository.

- `wacrm` is a fork of the public upstream repository and carries upstream history/license considerations.
- `nexara-repo-framework` is the private Nexara framework.

Create a **new canonical Nexara WACRM repository** containing:

```text
apps/
  web/
  mobile/

modules/
  wacrm/
  meta-onboarding/

nexara/
  runtime/
  providers/
  auth/
  permissions/
  billing/
  events/
  notifications/

packages/
  domain/
  contracts/
  api-client/
```

The exact directory names must follow the real Nexara framework conventions discovered during the architecture-gap review. Do not invent a second generic framework beside the existing Nexara framework.

WACRM functionality is migrated into modules rather than rewritten from scratch.

Keep the framework architecture guard active in CI.

Preserve the upstream WACRM MIT/license attribution requirements when porting code.

Because the current product has a small production footprint, use a **controlled one-time migration** rather than building a complex long-running strangler migration. The provider boundaries still need to remain clean.

---

# Decision 4 — Nexara Credits are the customer billing layer

Nexara is the **customer-facing billing layer**.

The customer should purchase/use **Nexara Credits**, not interact directly with individual provider billing mechanics inside the WACRM application.

For the initial product, the only implemented credit-consuming provider is:

```text
Nexara Credits
      ↓
WhatsApp Usage
      ↓
Meta WhatsApp Business Platform
```

### Important scope boundary

Do not build credit consumption for all future Nexara providers now.

Future providers such as:

- AI models
- voice providers
- transcription
- image generation
- other communication providers

may use the same billing abstraction later, but they are **deferred**.

The abstraction must be provider-neutral; the first implementation is WhatsApp-specific.

---

## Nexara Billing / Credits responsibilities

The Nexara platform owns:

- customer plans
- subscriptions
- credit wallets
- credit purchases
- credit ledger
- usage records
- pricing rules
- payment transactions
- balance checks
- insufficient-credit handling
- idempotency
- tenant isolation
- billing auditability

Initial entities:

- `plans`
- `subscriptions`
- `credit_wallets`
- `credit_ledger`
- `credit_purchases`
- `usage_records`
- `payment_transactions`
- `pricing_rules`

### Credit Ledger

The ledger must be immutable.

Every credit change must have a traceable reason, for example:

```text
purchase
monthly_grant
promotional_credit
whatsapp_usage
refund
manual_adjustment
expiry
```

Never update a customer's balance without creating the corresponding ledger entry.

### Usage Meter

Create a platform-level abstraction such as:

```ts
interface UsageMeter {
  reserve(input: UsageRequest): Promise<UsageReservation>;
  settle(reservationId: string, actualUsage: Usage): Promise<void>;
  release(reservationId: string): Promise<void>;
}
```

However, only the **WhatsApp usage implementation** is required now.

Where actual usage is known only after provider processing, use:

```text
reserve → execute → settle
```

Where usage is deterministic, debit atomically with an idempotency key.

### Idempotency

Every usage debit must support an idempotency key so webhook retries, worker retries, or duplicate provider events cannot double-charge the customer.

### Insufficient credits

When the customer has insufficient Nexara Credits:

- do not silently send a paid WhatsApp operation
- return a deterministic insufficient-credit state
- surface the requirement to purchase/top-up credits
- record the rejected attempt where appropriate

---

# Decision 5 — WhatsApp → Meta is the first billing integration

WACRM owns the customer experience.

Meta remains the underlying WhatsApp Business Platform.

The first commercial/usage flow is:

```text
Customer
   │
   │ purchases Nexara Credits
   ▼
Nexara Billing
   │
   │ credits available
   ▼
WACRM WhatsApp
   │
   │ message operation
   ▼
Meta WhatsApp Business Platform
   │
   │ provider usage/cost
   ▼
Nexara Usage + Credit Ledger
```

The system must keep **three concepts separate**:

1. **Nexara Credits** — what the customer purchases/uses.
2. **WhatsApp/Meta usage** — what the customer consumes.
3. **Meta commercial billing relationship** — how Nexara ultimately settles Meta/provider charges.

Do not expose Meta's commercial billing model as the Nexara customer billing model.

### Meta commercial model is a Phase 0 validation item

Do not assume that Nexara automatically qualifies to receive an aggregated Meta invoice or act as the billing intermediary.

The architecture must support Nexara being the customer billing layer, while the exact Meta partner/credit-line/commercial arrangement remains subject to Meta approval and eligibility.

This must be verified before production launch.

Required answers:

1. What Meta partner status does Nexara need?
2. Can Nexara use Embedded Signup in production?
3. Can Nexara onboard and manage customer WABAs?
4. Who receives Meta's usage invoice?
5. Can Nexara operate under a Meta credit-line/provider billing model?
6. What commercial/security requirements apply?
7. What happens when a customer's Nexara Credits reach zero?
8. Can Nexara suspend messaging automatically?
9. How are refunds, failed payments and chargebacks handled?

Document the result in `META_COMMERCIAL_BILLING_MODEL.md`.

---

# Decision 6 — In-app Meta / WhatsApp onboarding is required

Every new business account must complete Meta + WhatsApp Business setup through Nexara before messaging/campaign functionality is enabled.

Create a dedicated `meta-onboarding` module.

### Primary onboarding path

Use Meta Embedded Signup as the primary customer-facing onboarding flow.

Manual credential entry remains an admin-assisted fallback.

### Onboarding flow

```text
created
   ↓
meta_connected
   ↓
phone_registered
   ↓
webhook_verified
   ↓
template_ready
   ↓
complete
```

Guided steps:

1. Connect Meta through Embedded Signup.
2. Receive/store the required WABA and phone identifiers.
3. Complete phone registration as required.
4. Configure and verify webhook delivery.
5. Sync message templates.
6. Verify account/token/phone/webhook health.
7. Mark onboarding complete and unlock messaging/campaign features.

Failure/retry states must be supported. A failed provider call must not permanently lock the customer in an intermediate state.

Secrets such as system-user/access tokens are server-side only.

### Provider separation

Do not combine Meta Business onboarding responsibilities with generic WhatsApp messaging logic.

Use separate abstractions conceptually equivalent to:

```text
MetaBusinessProvider
        ↓
MetaOnboardingService
        ↓
WhatsAppProvider
```

This keeps Meta business-account provisioning separate from ongoing WhatsApp messaging.

---

# Decision 7 — Web-first Meta onboarding; mobile is an Action Center

Embedded Signup is browser-oriented.

Therefore:

- Web is the primary onboarding surface.
- Mobile can initiate/open the secure web onboarding flow.
- Completion can return to mobile through a controlled deep-link flow.

Mobile is **not a mini CRM**.

Its primary purpose is the Nexara Action Center:

- Home
- Work Hub
- Notifications
- Approvals
- Calendar
- Clients
- WhatsApp/inbox actions where useful

---

# Platform vs WACRM boundary

## Nexara platform owns

```text
Identity
Organizations
Memberships
Roles
Permissions
Work
Activities
Notifications
Files
Billing
Credits
Events
Provider abstractions
```

## WACRM owns

```text
Meta Onboarding
WhatsApp Accounts
Contacts
Conversations
Messages
Broadcasts
Campaigns
Automation
WhatsApp Templates
WhatsApp-specific usage
```

WACRM may **consume** Nexara platform capabilities but must not recreate them internally.

For example:

```text
WACRM WhatsApp usage
        ↓
Nexara UsageMeter
        ↓
Nexara CreditLedger
```

not:

```text
WACRM Wallet
WACRM Credits
WACRM Billing
Nexara Billing
```

There should be one authoritative Nexara credit system.

---

# First production vertical slice

The first end-to-end implementation should prove the complete commercial path:

```text
Organization
    ↓
Subscription
    ↓
Nexara Credit Wallet
    ↓
Meta Embedded Signup
    ↓
WhatsApp onboarding
    ↓
WhatsApp message
    ↓
WhatsApp usage measurement
    ↓
Nexara credit debit
    ↓
Immutable credit ledger
    ↓
Inbox / conversation
```

This vertical slice is more important than implementing every WACRM screen first.

It validates the core Nexara business model.

---

# Payment provider abstraction

Nexara Billing should use a payment-provider abstraction.

For example:

```ts
interface PaymentProvider {
  createPayment(input: PaymentRequest): Promise<PaymentIntent>;
  verifyPayment(input: PaymentVerification): Promise<PaymentResult>;
  refund(input: RefundRequest): Promise<RefundResult>;
}
```

The first payment provider may be selected based on the launch market, but the billing domain must not be hard-coded to a single payment SDK.

Credits are granted only after server-side payment verification/webhook confirmation.

---

# Phase 0 — Mandatory architecture gates

Before substantial implementation, produce:

- `00_NEXARA_ARCHITECTURE_DECISIONS.md`
- `ARCHITECTURE_GAP_REPORT.md`
- `DATABASE_DECISION.md`
- `MIGRATION_MAP.md`
- `NEW_REPO_PLAN.md`
- `AUTH_EXTENSION.md`
- `CREDITS_BILLING_DESIGN.md`
- `META_FEASIBILITY_POC.md`
- `META_ONBOARDING_FLOW.md`
- `META_COMMERCIAL_BILLING_MODEL.md`
- `DO_NOT_BUILD_YET.md`

### Phase 0 must answer

- What parts of the real Nexara framework can be reused directly?
- What WACRM code can be ported directly?
- What needs adaptation?
- What needs new implementation?
- D1 or Neon/Postgres based on benchmark evidence?
- Can Meta Embedded Signup work end-to-end in a production-like POC?
- What Meta permissions/App Review/partner requirements apply?
- What Meta commercial billing model is available to Nexara?
- Can Nexara operate the customer-facing credit model without violating provider terms?

---

# Complexity gate

For every requested capability, classify it as:

```text
USE      = already provided by Nexara framework
ADAPT    = exists in WACRM and needs framework integration
BUILD    = genuinely missing and required
DEFER    = future capability; do not build now
```

Do not build infrastructure merely because it may be useful in the future.

The architecture should be future-proof, but implementation should remain focused on the first production vertical slice.

---

# Security / operational carry-overs

The implementation must also address:

- platform-admin MFA
- audit logging for billing/role/onboarding actions
- tenant isolation
- credit ledger integrity
- usage idempotency
- per-client/API rate limits where required
- AI spend caps when AI is introduced later
- Workers Paid cost floor
- itemized infrastructure costs for D1/R2/Vectorize/Queues as applicable
- secure secret storage
- webhook signature/verification handling
- retry-safe provider operations

AI spend controls are future-facing for this phase; they should not become a reason to build the full AI billing subsystem now.

---

# Final architectural principle

Nexara is the platform.

WACRM is the first vertical.

Meta is the underlying WhatsApp provider.

Nexara Credits are the customer-facing billing abstraction.

For the current release:

```text
Nexara
  ├── Platform
  │    ├── Identity
  │    ├── Organizations
  │    ├── Permissions
  │    ├── Work
  │    ├── Notifications
  │    └── Billing / Credits
  │
  └── WACRM
       ├── Meta Onboarding
       ├── WhatsApp
       ├── Conversations
       ├── Contacts
       ├── Campaigns
       └── Automation
              │
              ▼
       Meta WhatsApp Business Platform
```

Build this path completely first.

Do not generalize beyond WhatsApp billing until the WhatsApp commercial, onboarding, usage-metering and credit-debit path is proven in production.
