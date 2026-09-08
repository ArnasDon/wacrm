# Nexara WACRM — Final Architecture Model (V1)

Adapter-model, framework-first. Nexara = platform; WACRM = first vertical; Meta = underlying WhatsApp provider; Nexara Credits = customer billing. Only what WACRM needs now is built (v6 §8).

## 1. Layers

```
┌──────────────────────────────────────────────────────────────┐
│ presentation                                                 │
│   apps/web    Next.js 16 + shadcn/ui   (primary)             │
│   apps/mobile Expo + React Native      (later; onboarding    │
│               web-first, mobile opens web ES via deep link)  │
└───────────────────────────┬──────────────────────────────────┘
                            │ typed api-client (packages/api-client)
┌───────────────────────────▼──────────────────────────────────┐
│ application / services   (modules/*/application)             │
│   authorize (PermissionService) → act via ports → Result<T>  │
└───────────────────────────┬──────────────────────────────────┘
                            │ ports (interfaces only)
┌───────────────────────────▼──────────────────────────────────┐
│ domain      (modules/*/domain, packages/domain, packages/contracts)
│   entities, value objects, zod contracts, status machines    │
└───────────────────────────▲──────────────────────────────────┘
                            │ implements ports
┌───────────────────────────┴──────────────────────────────────┐
│ infrastructure  (modules/*/infrastructure)                   │
│   repositories (SQL, tenant-scoped), provider impls          │
└───────────────────────────┬──────────────────────────────────┘
                            │ uses
┌───────────────────────────▼──────────────────────────────────┐
│ core providers (nexara/): DatabaseProvider · AuthProvider ·   │
│   StorageProvider · VectorProvider · PaymentProvider ·        │
│   NotificationProvider · WhatsAppProvider · MetaBusinessProvider
│   UsageMeter · EventBus · PlatformProvider · PermissionService │
└───────────────────────────┬──────────────────────────────────┘
                            │ wired ONLY in nexara/container
┌───────────────────────────▼──────────────────────────────────┐
│ vendors:  D1 | Neon (benchmark)  ·  R2  ·  Vectorize  ·        │
│   Queues  ·  jose  ·  Razorpay/…  ·  Expo Push/APNs/FCM  ·     │
│   Meta Graph / WhatsApp Cloud API                             │
└──────────────────────────────────────────────────────────────┘
```

**The one rule (guard-enforced):** business code depends on interfaces only; vendor SDKs live in `*/providers/*` + container. Every infrastructure SQL statement filters `account_id`. `check-architecture.mjs` blocks CI.

## 2. Platform vs WACRM boundary

- **Nexara platform (`nexara/`)** owns: identity/auth, organizations/tenancy, permissions, billing/credits + UsageMeter, providers, events, notifications, observability, audit. Single authoritative credit system.
- **WACRM (`modules/`)** owns: meta-onboarding, whatsapp, contacts, conversations, messages, inbox, broadcasts/campaigns, automation, templates. Consumes platform capabilities — never re-implements them.

```
WACRM WhatsApp usage → Nexara UsageMeter → Nexara CreditLedger   ✅
WACRM Wallet / WACRM Credits / WACRM Billing                     ❌ (one Nexara credit system)
```

## 3. Modules (build order)

1. **identity** — users, sessions, refresh_tokens, email_tokens, device_installations; extended AuthProvider. (AUTH_EXTENSION.md)
2. **organizations** — accounts/tenancy, memberships, roles, invitations, platform-admin.
3. **billing/credits** — plans, subscriptions, credit_wallet, credit_ledger, usage_records, pricing_rules, payment_transactions, UsageMeter (reserve/settle). **Design now; ledger/settlement code gated on two gates.** (CREDITS_BILLING_DESIGN.md)
4. **meta-onboarding** — Embedded Signup wizard, state machine, MetaBusinessProvider. (META_ONBOARDING_FLOW.md)
5. **whatsapp** — WhatsAppProvider (MetaWhatsAppProvider), send/webhook/media/templates. Separate from MetaBusinessProvider.
6. **contacts / conversations / messages / inbox** — core CRM.
7. **broadcasts / automation** — after core messaging reliable; broadcast send hits UsageMeter.

## 4. Providers (interfaces)

| Provider | V1 impl | Swap seam |
|---|---|---|
| `DatabaseProvider` | D1 **or** Neon (benchmark) | `DATABASE_PROVIDER` |
| `AuthProvider` (extended) | `JwtAuthProvider` (jose) | interface |
| `StorageProvider` | R2 (signed direct upload) | interface |
| `VectorProvider` | Vectorize | interface |
| `PaymentProvider` | market-first (Razorpay/INR likely) | interface |
| `NotificationProvider` | Expo Push → APNs/FCM | interface |
| `WhatsAppProvider` | MetaWhatsAppProvider | interface |
| `MetaBusinessProvider` | Meta Graph (onboarding/Embedded Signup) | interface |
| `UsageMeter` | WhatsApp usage only | provider-neutral; settlement target swappable (Tech-Provider vs Solution-Partner) |

## 5. First production vertical slice (the acceptance test)

```
Create Organization → Purchase/allocate Nexara Credits → Meta Embedded Signup
→ Connect WhatsApp → Send message → Meta processes → Usage recorded
→ Credits reserved/settled → Message appears in Inbox
```
Correctness invariants (DB benchmark acceptance): no negative balance, no double debit, no duplicate settlement, no lost reservation.

## 6. Async / realtime

- **Queues** (Cloudflare) for webhook ingest, broadcast pacing, automation, notification delivery, reconciliation, media processing. API returns fast.
- **Realtime V1 = foreground polling + push + incremental sync** behind a `RealtimeProvider`; WebSocket/DO only if UX/scale proves it needed.

## 7. Deploy

Cloudflare Workers via OpenNext, custom domain `wacrm.nexaragroups.com`. **Workers Paid (~$5/mo)** required (SSR 1102 + Queues/Cron/DO). Reconcile `wrangler.toml` routes+secrets before deploy (dashboard drift). Separate D1/R2/secrets per env (dev/staging/prod).
