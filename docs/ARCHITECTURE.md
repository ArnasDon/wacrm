# Architecture (§5/§22)

Modular monolith — `src/app` (routes + API) → `src/lib` (business
logic, provider abstractions) → Supabase (Postgres + Auth + Storage +
RLS). No microservices, no message queue, no ORM, no GraphQL layer.
This was true of the wacrm foundation and every Rimula phase kept it
true rather than introducing a parallel architecture.

```
Browser
  │  next-intl UI chrome (labels/buttons only — NOT content data localization)
  ▼
src/app/(dashboard)/**        Next.js App Router pages — mostly "use client",
                               query Supabase directly (RLS-scoped) OR call
src/app/api/**                 an internal API route for anything needing
                               server-side authorization/validation before
                               a write (routing decisions, RPC calls, admin-
                               gated mutations).
  │
  ▼
src/lib/**                    Business logic + provider abstractions.
                               Routes never import a provider SDK or call
                               fetch() against a third party directly —
                               always through one of these interfaces.
  │
  ▼
Supabase Postgres              RLS via is_account_member(account_id, min_role)
  (+ Auth, Storage, Realtime)  on every account-scoped table. SECURITY DEFINER
                               RPCs are the supervised escape hatch for the
                               handful of writes RLS can't express directly
                               (e.g. an admin editing a teammate's row).
```

## Provider abstractions (§2)

One interface per external capability; business logic depends on the
interface only, never a concrete provider or raw SDK call.

| Interface                      | Location                                | Implementations                                                                                                                                                                                                                                |
| ------------------------------ | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WhatsAppService`              | `src/lib/whatsapp/service.ts`           | `MetaWhatsAppService` (real Cloud API) / `DemoWhatsAppService` (fully simulated, zero credentials). Selected per-account by `accounts.demo_mode_enabled` — a deliberate override that wins even if real credentials are also configured.       |
| `LeadRoutingService`           | `src/lib/routing/service.ts`            | One implementation — Market BA → Regional BA → Unassigned, strategy read from `ba_routing_settings` (round_robin / lowest_open_leads / manual). No provider split needed; routing has no external vendor.                                      |
| `ProductCatalogueService`      | `src/lib/products/catalogue-service.ts` | `StubProductCatalogueService` only (Phase 8) — every call throws a typed `CatalogueNotConfiguredError` rather than faking success. The real Meta Catalog Batch API shape is documented in the file for a future `MetaProductCatalogueService`. |
| AI provider (OpenAI/Anthropic) | `src/lib/ai/`                           | Selected per `ai_configs` row; same "one interface, pluggable provider" shape, pre-dating Rimula.                                                                                                                                              |
| `TranslationService` (manual)  | Content Studio's localization panel     | The interface _is_ the manual-entry UI — a BA typing into `ContentTranslation` fields. No AI translation provider exists (dropped, Phase 8 — see `IMPLEMENTATION_PLAN.md`).                                                                    |
| `TextToSpeechService`          | —                                       | Not built — dropped, Phase 8. `VoiceNote` is BA-recorded audio only (`voice_notes.source` is hardcoded `'recorded'` at every write site; `'tts'` remains a valid-but-unused CHECK value).                                                      |

Every provider implementation that talks to a real external API goes
through a single hardened call path rather than bare `fetch()`:
`src/lib/whatsapp/meta-api.ts`'s `metaFetch` wraps every Cloud API
call with retry-with-backoff on 429/5xx/network failures (honoring
`Retry-After`) and a classified `MetaApiError` on terminal failure
(Phase 8).

## Domain modules (`src/lib`)

| Directory                                                     | Owns                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth/`, `account/`                                           | Role model (`AccountRole`, `hasMinRole`), server-side account-context resolution (`requireRole`), account-scoped Supabase context for API routes                                                                                                                                                              |
| `whatsapp/`                                                   | `WhatsAppService` + providers, the Cloud API client (`meta-api.ts`), inbound webhook event handlers (shared by the real webhook and `DemoWhatsAppService`), phone-number matching, broadcast send/resume                                                                                                      |
| `automations/`, `flows/`                                      | The two no-code engines — trigger-condition-action automations, and the visual Flows builder's runtime                                                                                                                                                                                                        |
| `content/`                                                    | Content Studio pipeline helpers (audience resolution, scheduling)                                                                                                                                                                                                                                             |
| `products/`                                                   | `ProductCatalogueService`                                                                                                                                                                                                                                                                                     |
| `routing/`                                                    | `LeadRoutingService`, `createLead()` (the shared Lead-creation path used by both direct Lead creation and CustomerRequest-to-Lead conversion)                                                                                                                                                                 |
| `dashboard/`                                                  | Two aggregation modules side by side: `queries.ts` (original wacrm dashboard — conversations, pipeline value, response time, activity feed) and `rimula-analytics.ts` (funnel/campaign/product analytics, entirely Rimula-specific). Both are plain client-side Supabase aggregation; RLS scopes every query. |
| `analytics/`                                                  | `writeProductInteraction` — the `product_interactions` counterpart to `whatsapp/engagement.ts`'s `writeEngagementEvent`                                                                                                                                                                                       |
| `webhooks/`                                                   | Outbound webhook delivery (`webhook_endpoints`), signing, SSRF guarding                                                                                                                                                                                                                                       |
| `api-keys/`, `api/`                                           | Public API (`/api/v1`) auth — hashed scoped API keys, cursor-paginated list responses                                                                                                                                                                                                                         |
| `contacts/`, `conversations/`, `inbox/`, `media/`, `storage/` | Foundation CRM helpers — contact tagging/dedup, conversation resolution, inbox composer support, Supabase Storage upload/public-URL helpers                                                                                                                                                                   |
| `ai/`                                                         | AI provider abstraction, knowledge base (pgvector retrieval), usage logging                                                                                                                                                                                                                                   |

## Authorization (§14)

Tenancy is per-account, not per-user. Every domain table carries
`account_id NOT NULL`; RLS policies call `is_account_member(account_id,
min_role)`, a `SECURITY DEFINER` Postgres function so the check itself
can't be bypassed by a misconfigured client-side query. `user_id`
columns (a pre-multi-tenancy legacy on most foundation tables) are
audit/assignment only — never used for isolation.

Rimula roles map onto the existing `account_role_enum`:
Admin → `owner`/`admin`, BA → `agent`, read-only stakeholder →
`viewer`. Customers are never app users — they interact over WhatsApp
only, and must never see another customer's data, internal notes, or
internal analytics.

Server-side enforcement is the real boundary; the UI additionally
gates actions as "shown but disabled with a tooltip," never hidden,
so a role change is visible without a page reload teaching a user
what they can't do.

## Demo Mode (§3/§20)

The single most load-bearing architectural decision in this build:
every WhatsApp-touching code path — `/api/whatsapp/send`, the
webhook, the broadcast sender, the automations engine, the Flows
runner — goes through `WhatsAppService`, never Meta's SDK/API
directly. `DemoWhatsAppService` implements the identical interface
with simulated send/deliver/read/reaction/inbound, writing into the
**same** tables (`messages`, `broadcast_recipients`,
`engagement_events`, ...) production analytics reads. This is what
makes "full funnel exercisable end-to-end with zero Meta credentials"
possible at all — there is no parallel fake-analytics system to keep
in sync with the real one.

## Testing (§21)

`vitest`, node environment, colocated `*.test.ts(x)` files. Route
tests mock `@/lib/auth/account`'s `requireRole` and assert on
validation/authorization/response shape; library tests either exercise
real logic against a hand-rolled fake Supabase query builder (chosen
per test file's needs — see `src/lib/dashboard/rimula-analytics.test.ts`
for the most complete example) or, where the real network/timing
behavior matters (retry/backoff), stub `fetch` and use Vitest's fake
timers (`src/lib/whatsapp/meta-api.retry.test.ts`). CI
(`.github/workflows/`) runs `typecheck` + `build` on every PR, and a
separate migrations workflow replays every file in
`supabase/migrations/` against a throwaway Postgres container to catch
SQL errors no test suite exercising a mocked client ever could.
