# WACRM Existing Bugs, Technical Risks & Edge-Case Analysis

This document provides a realistic, production-focused assessment of potential points of failure, edge-case risks, and architectural constraints identified during the code audit.

---

## 1. High Priority Bugs & Vulnerabilities (Resolved & Monitored)

### A. Meta WABA ID vs Phone Number ID Confusion (Resolved)
- **The Issue:** Meta's Business Manager exposes multiple numeric IDs. Users frequently copy the Phone Number ID (e.g., `1536182334670094`) into the WABA ID field in WhatsApp Settings. This triggers Meta Error #100 (`Unsupported get request. Object does not exist...`) on all `/message_templates` operations.
- **Resolution Implemented:** Built `getWabaIdFromPhoneNumber` in `src/lib/whatsapp/meta-api.ts`. The sync, submit, and delete endpoints now detect this error, query Meta for the parent WABA ID, auto-heal `whatsapp_config.waba_id`, and retry.
- **Resilient Deletion:** If a template was deleted directly on Meta or exists only as a local draft, the DELETE handler gracefully falls through to purge the local record rather than throwing 502 and locking the user.

### B. Template Language Code Mismatch (Meta Error #132001) (Resolved)
- **The Issue:** Sending a template whose language code was registered as `en` (or Gujarati `gu` / Hindi `hi`), while the send call defaulted to `en_US`, produces `Meta API error: (#132001) Template name does not exist in the translation`.
- **Resolution Implemented:** `src/lib/whatsapp/send-message.ts` queries `message_templates` by name within the account to dynamically extract the registered translation code before dispatching to Meta.

### C. Base UI Menu Hierarchy Crash (Error #31) (Resolved)
- **The Issue:** In `@base-ui/react`, using `MenuPrimitive.GroupLabel` outside a `<Menu.Group>` parent throws an invariant violation (Error #31). In the visual flow canvas, clicking "+ Add node" crashed the canvas.
- **Resolution Implemented:** Replaced `MenuPrimitive.GroupLabel` in `src/components/ui/dropdown-menu.tsx` with a standard styled HTML `div` and wrapped node category groups with `<DropdownMenuGroup>` in the flow builder.

---

## 2. Technical Risks & Architecture Edge Cases

### 1. Inbound Webhook Concurrency & Deduplication
- **Risk:** Meta guarantees *at-least-once* webhook delivery. In high-traffic scenarios or network retries, the same message event can arrive twice within milliseconds.
- **Current Safeguard:** `src/app/api/whatsapp/webhook/route.ts` records `wamid` on messages. Postgres enforces `UNIQUE(wamid)` across messages.
- **Edge Case:** When two identical webhook requests hit serverless instances simultaneously, a check-then-write race can cause an unhandled constraint exception on the second request. Ensure all message insertions use `onConflict: 'wamid', ignoreDuplicates: true`.

### 2. Large Scale Broadcast Throttling
- **Risk:** Meta WhatsApp Business Cloud API enforces strict tier limits (Tier 1: 1,000 conversations/24h, Tier 2: 10,000, Tier 3: 100,000, Tier 4: Unlimited).
- **Current Safeguard:** `src/app/api/whatsapp/broadcast/route.ts` implements batch chunking and sleep intervals between dispatches.
- **Recommendation:** For campaigns larger than 5,000 recipients, utilize background job queues (e.g., pg_boss or Vercel Queues) rather than running long-lived loops within a single HTTP request handler, which risks exceeding serverless execution timeouts (300s).

### 3. Service Role Database Access in Payment Webhooks
- **Risk:** Inbound webhooks from Razorpay and Stripe use the Supabase Service Role client to bypass RLS and record payments.
- **Mitigation:**
  - Razorpay: Cryptographic HMAC-SHA256 signature verification matches `X-Razorpay-Signature` against the account's decrypted secret key.
  - Stripe: Webhook signature verified using `stripe.webhooks.constructEvent()`.
  - Orders are updated strictly matching the verified merchant `account_id` and `order_id`.

### 4. Vector Knowledge Base pgvector Dependency
- **Risk:** AI Knowledge base search (`/api/ai/knowledge`) requires the `vector` extension enabled in Supabase PostgreSQL (`CREATE EXTENSION IF NOT EXISTS vector`).
- **Mitigation:** If pgvector is disabled on a self-hosted instance, the system provides a keyword/full-text search fallback, but semantic relevance will be reduced until pgvector is activated.

### 5. Multi-Location Inventory Negative Stock Prevention
- **Risk:** High concurrent purchase volume on limited-stock products can lead to race conditions where two customers checkout the last item simultaneously.
- **Mitigation:** In migration 034, `inventory_items.quantity_on_hand` has a check constraint `CHECK (quantity_on_hand >= 0)`. Any transaction that attempts to decrement inventory below zero is rejected by Postgres, preventing overselling.
