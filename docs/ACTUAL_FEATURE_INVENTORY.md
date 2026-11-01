# WACRM Actual Feature Inventory & Implementation Audit

**Classification Categories:**
- **[A] Implemented in Code & DB:** Full end-to-end production functionality.
- **[B] Partially Implemented:** Operational core exists; secondary features or edge-cases incomplete.
- **[C] UI Exists / Incomplete Backend:** Screen rendered, but some actions lack persistence.
- **[D] Backend Exists / Incomplete UI:** API endpoints and DB exist, but UI is rudimentary or missing.
- **[E] Database Exists / Incomplete Workflow:** Migration created, but lifecycle logic uncompleted.
- **[F] Mock / Demo Functionality:** In-memory fallback or mock store used when DB tables are empty.
- **[G] Not Implemented / Planned:** Speculative or future architectural hook.

---

## Comprehensive Feature Matrix

| Feature | Category | Frontend Screen | Backend API / Service | Database Tables | Status Notes |
| :--- | :---: | :--- | :--- | :--- | :--- |
| **1. WhatsApp Shared Inbox** | **[A]** | `src/app/(dashboard)/inbox/page.tsx` | `/api/whatsapp/send`, `/api/whatsapp/react`, `/api/whatsapp/media/[id]` | `conversations`, `messages`, `contacts` | Full real-time inbox with text, media, reactions, read receipts, and member assignment. |
| **2. Contacts & Customer CRM** | **[A]** | `src/app/(dashboard)/contacts/page.tsx` | `/api/v1/contacts`, `/api/v1/contacts/[id]` | `contacts`, `contact_tags` | Tag filtering, phone deduplication, CSV export/import, search, and custom fields. |
| **3. Sales Pipelines & Kanban** | **[A]** | `src/app/(dashboard)/pipelines/page.tsx` | Client Supabase direct + RPCs | `pipelines`, `pipeline_stages`, `deals` | Drag-and-drop Kanban board with deal value calculation, currency formatting, and stage transitions. |
| **4. Broadcast Campaigns** | **[A]** | `src/app/(dashboard)/broadcasts/page.tsx`, `/new`, `/[id]` | `/api/whatsapp/broadcast`, `/api/v1/broadcasts` | `broadcasts`, `broadcast_recipients`, `message_templates` | Template-based batch messaging with rate limiting, variable interpolation, and delivery metrics. |
| **5. Legacy Rule Automations** | **[A]** | `src/app/(dashboard)/automations/page.tsx`, `/[id]/edit` | `/api/automations`, `/api/automations/engine`, `/api/automations/cron` | `automations`, `automation_logs` | Trigger-action rules (keyword match, contact tag added, deal stage changed) with execution logs. |
| **6. Visual Flow Builder** | **[A]** | `src/app/(dashboard)/flows/page.tsx`, `/[id]/page.tsx` | `/api/flows`, `/api/flows/[id]/activate`, `/api/flows/cron` | `flows`, `flow_runs`, `flow_run_steps` | Interactive `@xyflow/react` canvas, multi-branching, delay timers, and auto-layout via Dagre. |
| **7. AI Reply Assistant** | **[A]** | Inbox quick reply drawer | `/api/ai/draft`, `/api/ai/config`, `/api/ai/test` | `ai_configs`, `profiles` | Multi-LLM provider support (Groq, OpenAI, Ollama) generating contextual response drafts. |
| **8. AI Knowledge Base** | **[B]** | `src/app/(dashboard)/settings/page.tsx` (AI tab) | `/api/ai/knowledge`, `/api/ai/knowledge/reindex` | `ai_knowledge_docs` | Document upload and indexing supported; semantic vector search requires `pgvector` enabled in Supabase. |
| **9. Dashboard & Analytics** | **[A]** | `src/app/(dashboard)/dashboard/page.tsx` | Client Supabase queries with SQL aggregation | `messages`, `conversations`, `broadcasts`, `deals` | Interactive Recharts showing message volume, response times, delivery rates, and pipeline revenue. |
| **10. Team Accounts & Invites** | **[A]** | `src/app/(dashboard)/settings/page.tsx` (Team tab) | `/api/account/invitations`, `/api/invitations/[token]/redeem` | `accounts`, `account_invitations`, `profiles` | SHA-256 secure invite links, role pre-selection, and automatic member onboarding. |
| **11. Roles & Permissions** | **[A]** | Enforced across UI navigation & API routes | `src/lib/auth/roles.ts`, `requireRole()` | `account_role_enum` (`owner`, `admin`, `agent`, `viewer`) | RLS enforcement at PostgreSQL level and route-guarding in API handlers. |
| **12. Public REST API** | **[A]** | API Documentation in `/docs` | `/api/v1/*` (contacts, messages, broadcasts, webhooks) | `api_keys` | External programmatic integration with SHA-256 hashed API keys. |
| **13. Outbound Webhooks** | **[A]** | `src/app/(dashboard)/settings/page.tsx` (Developers) | `/api/v1/webhooks`, `/api/v1/webhooks/[id]` | `webhook_endpoints`, `webhook_deliveries` | HMAC-SHA256 signed event delivery on message received, deal updated, and contact created. |
| **14. Products & Catalog** | **[A]** | `src/app/(dashboard)/products/page.tsx` | `/api/products`, `/api/products/[id]`, `/api/products/seed` | `products` (Migration 032, 033, 036) | Full CRUD, image media uploads, price, SKU uniqueness per account, and category organization. |
| **15. Multi-Location Inventory** | **[B]** | Embedded in Products dialogs | `/api/inventory` | `inventory_items`, `inventory_transactions` | Tables and API exist; advanced multi-warehouse transfer UI is simplified. |
| **16. Razorpay Integration** | **[A]** | Settings (Payments tab) & Inbox attachment | `/api/payments/config`, `/api/payments/webhook/razorpay` | `payment_gateway_configs` | Encrypted keys, in-chat payment link generation, and automated HMAC signature verification webhook. |
| **17. Stripe Integration** | **[A]** | Settings (Payments tab) & Inbox attachment | `/api/payments/config`, `/api/payments/webhook/stripe` | `payment_gateway_configs` | Stripe Checkout sessions, encrypted secrets, and automated webhook reconciliation. |
| **18. WhatsApp Payment Orders**| **[A]** | Inbox Payment modal & timeline events | `/api/payments/create-link` | `payment_orders` | Real-time payment link dispatch into conversations and automatic order completion on webhook. |
| **19. SaaS Subscriptions** | **[A]** | `src/app/(dashboard)/settings/page.tsx` (Billing tab) | `/api/billing/checkout`, `/api/billing/portal`, `/api/billing/webhook` | `subscriptions`, `plans` | Stripe Customer Portal, plan tier gating, and webhooks for subscription management. |
| **20. Enterprise Approvals** | **[B]** | `src/app/(dashboard)/approvals/page.tsx` | `/api/approvals`, `/api/approvals/[id]` | `approval_requests` (Migration 034) | 4-Eyes Principle for price overrides, refunds, and bulk broadcasts with manager sign-off. |
| **21. Audit Logging** | **[A]** | Database level / Admin view | Supabase queries | `audit_logs` (Migration 034) | Append-only security audit log recording user actions, IP addresses, and payload diffs. |
| **22. Demo Product Store** | **[F]** | `src/lib/commerce/demo-store.ts` | Fallback in `/api/products` | In-memory `DEMO_PRODUCTS` array | Activates gracefully only if Supabase `products` table does not exist or during seed errors. |
