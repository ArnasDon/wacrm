# WACRM Integration Status & Connectivity Audit

This document details the operational status, security posture, configuration, and verification mechanisms for all external third-party integrations in WACRM.

---

## 1. Meta WhatsApp Cloud API (Graph API v21.0)

| Attribute | Implementation Detail |
| :--- | :--- |
| **API Base & Version** | `https://graph.facebook.com/v21.0` |
| **Authentication** | Bearer Token (AES-256-GCM encrypted in `whatsapp_config.access_token`) |
| **Account Identifiers** | WABA ID (`waba_id`) for templates and billing; Phone Number ID (`phone_number_id`) for message dispatch |
| **Auto-Healing Feature** | Implemented in `src/lib/whatsapp/meta-api.ts` (`getWabaIdFromPhoneNumber`). If a user mistakenly enters the Phone Number ID in the WABA ID field, WACRM automatically resolves the true parent WABA ID from Meta and heals the database record. |
| **Inbound Webhook** | `/api/whatsapp/webhook` verifying `X-Hub-Signature-256` HMAC with App Secret. |
| **Template Management** | Synchronize catalog from Meta (`/api/whatsapp/templates/sync`), create & submit for review (`/submit`), edit existing (`PATCH /templates/[id]`), and resilient deletion (`DELETE /templates/[id]`) that cleans local records if Meta returns object not found. |
| **Interactive Features** | Button quick replies, interactive list menus, location sharing, media uploads (audio/opus, images, PDFs, videos), and emoji reactions. |

---

## 2. Payment Gateways: Razorpay & Stripe

### Razorpay Integration
- **Key Storage:** Key ID and Key Secret encrypted in `payment_gateway_configs` (`provider = 'razorpay'`).
- **Payment Link Generation:** Created via Razorpay Payment Links API with auto-generated reference IDs, custom description, and customer phone tagging.
- **Webhook Processing:** `/api/payments/webhook/razorpay` verifies HMAC signature using `crypto.createHmac('sha256', secret)`.
- **Supported Events:** `payment_link.paid`, `payment.captured`, `order.paid`.
- **State Transition:** Updates `payment_orders.status = 'paid'`, records transaction ID, and adds an interactive payment badge in the WhatsApp conversation.

### Stripe Integration
- **Key Storage:** Publishable Key and Secret Key encrypted in `payment_gateway_configs` (`provider = 'stripe'`).
- **Payment Link Generation:** Uses Stripe Checkout Sessions or Payment Links API with line items, currency conversion, and metadata linking to `account_id` and `conversation_id`.
- **Webhook Processing:** `/api/payments/webhook/stripe` verifies `stripe-signature` header via Stripe SDK.
- **Supported Events:** `checkout.session.completed`, `payment_intent.succeeded`.

---

## 3. AI Providers: Groq, OpenAI & Ollama

- **Client Abstraction:** `src/lib/ai/client.ts` provides a unified interface across model providers.
- **Groq:** Ultra-low latency inference using models such as `llama-3.3-70b-versatile` or `mixtral-8x7b-32768`.
- **OpenAI:** GPT-4o, GPT-4o-mini, and text-embedding-3-small for knowledge base vector embeddings.
- **Ollama (Self-Hosted):** Direct local connection for privacy-conscious enterprise deployments.
- **Capabilities:**
  - In-chat contextual response drafting based on the latest 10 messages.
  - Sentiment analysis and conversation summarization.
  - RAG knowledge base search against indexed company documents.

---

## 4. Public Developer API & Outbound Webhooks

- **Authentication:** `X-API-Key` or `Authorization: Bearer <token>` hashed with SHA-256 against `api_keys.key_hash`.
- **Public Endpoints (`/api/v1/*`):**
  - Contacts: List, Create, Update, Delete.
  - Conversations & Messages: Query history, send outbound messages.
  - Broadcasts: Trigger campaigns programmatically.
  - Webhooks: Register, list, test, and delete outbound event subscriptions.
- **Outbound Webhook Delivery:**
  - Events: `message.received`, `message.sent`, `contact.created`, `deal.stage_changed`, `payment.completed`.
  - Signature: `X-WACRM-Signature: sha256=<hex_hmac>` using endpoint secret.
  - Delivery History: Recorded in `webhook_deliveries` with status code, attempt count, and response payload.
