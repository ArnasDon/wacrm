# WACRM Repository Understanding & Architecture Guide

**Repository:** `https://github.com/VALANDPIYUSH18/wacrm`  
**Upstream Source:** Fork of `ArnasDon/wacrm` (v0.7.0)  
**Framework & Runtime:** Next.js 16.2.6 (App Router + Turbopack), React 19.2.4, Node.js >= 20.0.0, TypeScript 6.0  
**Database & Auth:** Supabase (PostgreSQL 15+, Row Level Security, Auth, Realtime, Storage)  
**Primary Purpose:** Self-hostable, multi-tenant WhatsApp Business Cloud API CRM platform with shared team inbox, visual flow builder, contacts & deals pipeline, broadcasts, AI reply assistant, commerce catalog, and in-chat payments.

---

## 1. System Architecture Overview

WACRM is architected as an event-driven Next.js App Router application built directly on top of Supabase PostgreSQL:

```
                          ┌───────────────────────────┐
                          │   Meta WhatsApp Cloud     │
                          │   Graph API (v21.0)       │
                          └─────────────┬─────────────┘
                                        │ Webhook & REST API
                                        ▼
┌──────────────────┐      ┌───────────────────────────┐      ┌───────────────────────────┐
│ Client Browser   │◄────►│ Next.js 16 (App Router)   │◄────►│ Supabase Database (PG15)  │
│ (React 19, CSS4) │      │ API Routes, Auth, Engine  │      │ 36 Migrations, RLS, RPCs  │
└──────────────────┘      └─────────────┬─────────────┘      └───────────────────────────┘
                                        │
                         ┌──────────────┴──────────────┐
                         ▼                             ▼
              ┌─────────────────────┐       ┌─────────────────────┐
              │ Payment Gateways    │       │ AI Services         │
              │ Razorpay & Stripe   │       │ Groq, OpenAI, Ollama│
              └─────────────────────┘       └─────────────────────┘
```

---

## 2. Multi-Tenant Architecture & Account Sharing

### Evolution: Single User → Account Tenancy
Prior to migration 017 (`017_account_sharing.sql`), WACRM was single-tenant per user (`auth.uid() = user_id`).
Migration 017 converted the entire schema into account-level multi-tenancy:
1. **Accounts Table (`accounts`)**:
   - Represents the organization or business entity.
   - `owner_user_id` denormalizes ownership.
2. **Membership & Profiles (`profiles`)**:
   - Every user belongs to an `account_id` with an `account_role_enum` (`owner`, `admin`, `agent`, `viewer`).
3. **Security Definer Function (`is_account_member`)**:
   - Core PostgreSQL function checking if `auth.uid()` has at least `min_role` in `account_id`:
   ```sql
   is_account_member(account_id, 'viewer' | 'agent' | 'admin' | 'owner')
   ```
4. **Row Level Security (RLS)**:
   - All domain tables (`contacts`, `conversations`, `messages`, `pipelines`, `deals`, `broadcasts`, `message_templates`, `flows`, `products`, `payment_orders`, etc.) have RLS enabled with `is_account_member(account_id, min_role)`.
5. **Team Invitations (`account_invitations`)**:
   - Secure invitation links hashed with SHA-256 (`token_hash`), expiring within 7 days.

---

## 3. Core Functional Domains

### A. WhatsApp Messaging & Shared Inbox
- **Meta API Integration:** `src/lib/whatsapp/meta-api.ts` connects to Meta Graph API v21.0.
- **Inbound Webhook:** `src/app/api/whatsapp/webhook/route.ts` handles signature verification (`X-Hub-Signature-256`), deduplication (`wamid`), conversation threading, contact auto-creation, media downloading (`chat-media` storage), and auto-triggering workflows.
- **Outbound Dispatcher:** `src/lib/whatsapp/send-message.ts` dispatches text, reaction, media (image, audio, document, video), and template messages with language fallback resolution.
- **Real-time Inbox:** `src/app/(dashboard)/inbox/page.tsx` utilizes Supabase Realtime channels for instant message arrival, typing indicators, read receipts, and member presence.

### B. Visual Flow Builder & Automations Engine
- **Visual Builder:** Built with `@xyflow/react` and `@dagrejs/dagre` at `src/app/(dashboard)/flows/[id]/page.tsx`.
- **Node Primitives:** Start, Message, Button Menu, Condition/Router, Add/Remove Tags, Update Deal Stage, Webhook/HTTP, AI Generate, and Delay nodes.
- **Execution Engine:** `src/lib/flows/engine.ts` executes state machines, tracking execution history in `flow_runs` and `flow_run_steps`.
- **Background Cron:** `src/app/api/flows/cron/route.ts` and `src/app/api/automations/cron/route.ts` resume delayed execution steps.

### C. Contacts, CRM Pipelines & Deals
- **Contact Management:** `src/app/(dashboard)/contacts/page.tsx` supports bulk tag operations, phone deduplication, custom attributes, and search.
- **Sales Pipelines:** `src/app/(dashboard)/pipelines/page.tsx` provides Kanban boards with `@dnd-kit` drag-and-drop across customizable stages with revenue tracking.

### D. Commerce & In-Chat Payments
- **Catalog:** `src/app/(dashboard)/products/page.tsx` backed by `products` table and `inventory_items` multi-location inventory ledger.
- **Merchant Gateways:** `src/app/api/payments/config/route.ts` manages encrypted Razorpay and Stripe API keys.
- **Payment Links:** `src/app/api/payments/create-link/route.ts` generates branded payment links sent directly into WhatsApp conversations.
- **Webhooks:** `src/app/api/payments/webhook/razorpay/route.ts` and `src/app/api/payments/webhook/stripe/route.ts` verify cryptographic signatures, update order state to `paid`, adjust inventory reservations, and append payment event badges in the inbox.

### E. AI Copilot & Knowledge Base
- **Multi-Provider AI:** `src/lib/ai/client.ts` supports Groq, OpenAI, and Ollama.
- **Draft Suggestions:** `src/app/api/ai/draft/route.ts` generates contextual customer replies based on conversation history.
- **Vector Knowledge Base:** `src/app/api/ai/knowledge/route.ts` indexes company FAQs, policies, and product details with pgvector embeddings for RAG retrieval.

---

## 4. Key Files and Directory Map

- `src/app/`: Next.js 16 App Router pages, layout, and API route handlers.
- `src/components/`: Modular React components (inbox, flows, pipelines, products, contacts, UI).
- `src/lib/`: Core backend logic (whatsapp, commerce, flows, ai, auth, supabase).
- `supabase/migrations/`: 36 sequential PostgreSQL schema migrations.
- `docs/`: Comprehensive project, business, and technical documentation.
