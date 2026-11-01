# WACRM Production Readiness Fix Plan

**Repository:** `VALANDPIYUSH18/wacrm`  
**Target:** Multi-Tenant Production SaaS Platform  
**Architecture:** Next.js 16 (App Router), Supabase PostgreSQL (36 Migrations, RLS), Meta Graph API v21.0  
**Testing Baseline:** 71 test files, 634 tests passing (Vitest). Turbopack build verified.

---

## Master Problem & Resolution Matrix

| Phase | Finding ID | File Path(s) | Severity | Root Cause | Proposed Solution |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Phase 1: Multi-Tenant Security** | **P1-1** | `src/app/api/admin/clients/route.ts:L21` | **High** | In `process.env.NODE_ENV === 'development'`, any user without configured admin emails is treated as a platform superadmin, leaking all tenant accounts. | Restrict platform superadmin check strictly to `PLATFORM_ADMIN_EMAILS` or `profiles.role === 'superadmin'`. |
| **Phase 1: Multi-Tenant Security** | **P1-2** | `src/app/api/payments/create-link/route.ts:L109-121` | **Medium** | Fallback message insert uses `getAdmin()` without verifying that `conversationId` and `senderId` belong to the same caller's account. | Pass validated `accountId` to ensure message creation cannot cross-post into another account's conversation. |
| **Phase 1: Multi-Tenant Security** | **P1-3** | `src/lib/storage/upload-media.ts` | **Medium** | Storage bucket media paths must consistently prefix by `account_id` rather than raw user ID so account members can access shared media while preventing cross-tenant access. | Ensure media uploads consistently use `account_id/kind/timestamp-filename` with storage RLS validation. |
| **Phase 2: Webhook Reliability** | **P2-1** | `supabase/migrations/001_initial_schema.sql`, `src/app/api/whatsapp/webhook/route.ts:L684` | **Critical** | `messages.message_id` (`wamid`) lacks a database-level `UNIQUE` constraint. Concurrent webhook deliveries or retries from Meta insert duplicate message rows. | Add migration enforcing `UNIQUE(message_id)` on `messages` (where `message_id IS NOT NULL`) and use `onConflict: 'message_id', ignoreDuplicates: true`. |
| **Phase 2: Webhook Reliability** | **P2-2** | `src/app/api/whatsapp/webhook/route.ts:L256-264` | **High** | Inbound webhook uses Next.js `after()`, returning 200 immediately before `processWebhook` completes. If DB write fails, Meta assumes success and never retries. | Ensure fatal DB errors in initial ingestion are monitored, or acknowledge after critical idempotency record is locked. |
| **Phase 2: Webhook Reliability** | **P2-3** | `src/app/api/whatsapp/webhook/route.ts:L430` | **Medium** | Status update handler (`handleStatusUpdate`) updates `messages.status` without checking recipient status progression. A delayed 'delivered' event after a 'read' event could regress message state. | Enforce status ladder monotonicity (`sent` -> `delivered` -> `read`). Do not regress from `read` back to `delivered`. |
| **Phase 3: Inventory & Order Safety** | **P3-1** | `src/lib/governance/service.ts:L196-235` | **Critical** | When `adjust_inventory_quantity` RPC is not installed, fallback checks quantity in Node.js memory before updating (`quantity_on_hand: Math.max(0, ...)`), which causes check-then-write race conditions when two customers buy the last item simultaneously. | Ensure PostgreSQL migration installs atomic RPC `adjust_inventory_quantity` with `FOR UPDATE` row lock and database check constraint `CHECK (quantity_on_hand >= 0)`. |
| **Phase 3: Inventory & Order Safety** | **P3-2** | `src/app/api/payments/create-link/route.ts`, `src/lib/commerce/service.ts` | **High** | Payment link generation does not reserve product stock when order is initiated, risking overselling between link generation and customer payment. | Support inventory reservation state (`quantity_reserved`) during payment link generation with timeout release. |
| **Phase 4: Payments & Webhooks** | **P4-1** | `src/app/api/payments/webhook/razorpay/route.ts:L114` | **Critical** | Webhook verification must strictly check cryptographic HMAC with merchant's encrypted secret. If missing or invalid, must reject immediately with 400. | Audit signature verification, idempotency on `payment_orders.id`, and enforce strict status transition so duplicate webhooks cannot double-trigger fulfillment. |
| **Phase 4: Payments & Webhooks** | **P4-2** | `src/app/api/payments/webhook/stripe/route.ts:L78` | **High** | Stripe webhook reconciliation matches order solely by metadata `order_id`. If `order_id` is missing or mismatched, payment succeeds on Stripe but hangs as 'pending' in CRM. | Add fallback lookup by Stripe session/payment_intent ID in `payment_orders.provider_order_id`. |
| **Phase 5: Meta API & Broadcasts** | **P5-1** | `src/app/api/whatsapp/broadcast/route.ts:L140` | **High** | Broadcast batch processing executes in a single HTTP request with a sleep loop. For lists > 500 contacts, this risks hitting serverless function timeout (maxDuration / 300s). | Implement batch chunking with resumable campaign state (`status: 'in_progress'`, tracking `sent_count`) so failed/timed-out broadcasts resume without duplicate sends. |
| **Phase 6: AI Knowledge Base** | **P6-1** | `src/lib/ai/knowledge.ts:L85`, `src/app/api/ai/knowledge/route.ts` | **Medium** | Knowledge base query falls back to full-text or substring match if `pgvector` RPC `match_knowledge_docs` fails. | Add clear telemetry and UI indicator distinguishing between semantic vector search (when pgvector is enabled) and keyword search. |
| **Phase 7: Remove Demo Fallbacks** | **P7-1** | `src/lib/commerce/demo-store.ts`, `src/app/api/products/seed/route.ts:L32` | **Medium** | `/api/products/seed` falls back to `resetDemoProducts` in memory if the table is missing, disguising DB errors as success. | Remove silent demo store fallback in production. Return explicit error if DB table is unmigrated. |
| **Phase 8: Full Feature Testing** | **P8-1** | Across all 21 functional domains | **Medium** | End-to-end integration test coverage for cross-tenant multi-user scenarios. | Build automated multi-tenant test suites simulating two businesses (Tenant A and Tenant B) with owner, agent, and viewer roles. |
| **Phase 9: Production Quality** | **P9-1** | CI / TypeScript / Test suite | **Low** | Ongoing verification of 100% test pass rate, Turbopack production builds, and ESLint. | Maintain zero TypeScript errors and continuous automated test verification on every change. |

---

## Phased Execution Roadmap

### Phase 1: Multi-Tenant Security & Isolation
- Step 1.1: Platform Superadmin privilege hardening (`src/app/api/admin/clients/route.ts`).
- Step 1.2: Audit and test cross-tenant boundary protections in `requireRole` and RLS.
- Step 1.3: Add comprehensive multi-tenant isolation integration test suite (`src/lib/auth/multi-tenant.test.ts`) validating that Tenant A cannot access Tenant B's contacts, conversations, deals, products, or payment orders.

### Phase 2: WhatsApp Webhook Reliability & Deduplication
- Step 2.1: Implement database unique constraint and idempotent insertion for `messages.message_id` (`wamid`).
- Step 2.2: Enforce status update monotonicity (prevent regression from `read` to `delivered`).
- Step 2.3: Add automated tests simulating duplicate webhook delivery and concurrent retries.

### Phase 3: Inventory & Order Safety
- Step 3.1: Enforce atomic stock updates and verify PostgreSQL `adjust_inventory_quantity` RPC.
- Step 3.2: Verify `CHECK (quantity_on_hand >= 0)` constraint handling to guarantee zero overselling.

### Phase 4: Payments & Webhook Reconciliation
- Step 4.1: Test Razorpay and Stripe webhook verification with valid and forged HMAC signatures.
- Step 4.2: Ensure payment orders transition idempotently and reflect in chat timeline.

### Phase 5: Meta API & Broadcast Reliability
- Step 5.1: Implement resumable broadcast state tracking to prevent duplicate message sends upon retry.

### Phase 6: AI Knowledge Base Isolation & Grounding
- Step 6.1: Verify account-scoped RAG document retrieval and graceful fallbacks.

### Phase 7: Demo Fallback Cleanup
- Step 7.1: Remove silent in-memory demo fallbacks in production endpoints.

### Phase 8 & 9: Complete Verification & Final Deliverables
- Step 8.1: Run all unit and integration test suites.
- Step 8.2: Produce `PRODUCTION_FIX_LOG.md`, `MANUAL_TEST_CASES.md`, `SECURITY_TEST_REPORT.md`, `MULTI_TENANT_TEST_REPORT.md`, and `PRODUCTION_READINESS_REPORT.md`.
