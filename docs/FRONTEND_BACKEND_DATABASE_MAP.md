# WACRM Frontend-to-Backend-to-Database Map

This reference maps every frontend route, interactive component, API endpoint, and database table across the WACRM codebase.

---

## Complete Route & Data Mapping

### 1. Shared Inbox & Real-time Messaging
- **Frontend Route:** `/inbox` (`src/app/(dashboard)/inbox/page.tsx`)
- **Key Components:**
  - `ConversationList` (`src/components/inbox/conversation-list.tsx`)
  - `ChatWindow` (`src/components/inbox/chat-window.tsx`)
  - `MessageComposer` (`src/components/inbox/message-composer.tsx`)
  - `PaymentLinkModal` (`src/components/inbox/payment-link-modal.tsx`)
  - `AIReplyDrawer` (`src/components/inbox/ai-reply-drawer.tsx`)
- **Backend Endpoints:**
  - `POST /api/whatsapp/send` (Text & outbound templates)
  - `POST /api/whatsapp/react` (Message emoji reactions)
  - `GET /api/whatsapp/media/[mediaId]` (Encrypted media retrieval)
  - `POST /api/payments/create-link` (In-chat payment link generation)
  - `POST /api/ai/draft` (AI reply drafting)
- **Database Tables:**
  - `conversations` (channel metadata, unread count, contact link)
  - `messages` (inbound/outbound body, status, wamid, reactions)
  - `contacts` (customer phone, name, tags)
  - `payment_orders` (in-chat payment tracking)

---

### 2. Contacts Management
- **Frontend Route:** `/contacts` (`src/app/(dashboard)/contacts/page.tsx`)
- **Key Components:**
  - `ContactsTable` (`src/components/contacts/contacts-table.tsx`)
  - `ContactDetailDialog` (`src/components/contacts/contact-detail-dialog.tsx`)
  - `TagFilter` (`src/components/contacts/tag-filter.tsx`)
- **Backend Endpoints:**
  - `GET /api/v1/contacts`, `POST /api/v1/contacts`
  - `PATCH /api/v1/contacts/[id]`, `DELETE /api/v1/contacts/[id]`
  - Direct Supabase Client queries with RLS filtering
- **Database Tables:**
  - `contacts` (account_id, name, phone, email, custom_fields)
  - `contact_tags` (tag associations)

---

### 3. Sales Pipelines & Deals
- **Frontend Route:** `/pipelines` (`src/app/(dashboard)/pipelines/page.tsx`)
- **Key Components:**
  - `PipelineBoard` (`src/components/pipelines/pipeline-board.tsx`)
  - `DealCard` (`src/components/pipelines/deal-card.tsx`)
  - `DealDialog` (`src/components/pipelines/deal-dialog.tsx`)
- **Backend Endpoints:**
  - Supabase client queries & transaction RPCs
- **Database Tables:**
  - `pipelines` (id, account_id, name, is_default)
  - `pipeline_stages` (id, pipeline_id, name, order_index, color)
  - `deals` (id, account_id, stage_id, contact_id, title, value, currency)

---

### 4. Broadcast Campaigns & Templates
- **Frontend Routes:**
  - `/broadcasts` (`src/app/(dashboard)/broadcasts/page.tsx`)
  - `/broadcasts/new` (`src/app/(dashboard)/broadcasts/new/page.tsx`)
  - `/broadcasts/[id]` (`src/app/(dashboard)/broadcasts/[id]/page.tsx`)
- **Key Components:**
  - `BroadcastList`, `BroadcastWizard`, `TemplateSelector`
- **Backend Endpoints:**
  - `POST /api/whatsapp/broadcast` (Trigger batch execution)
  - `POST /api/whatsapp/templates/sync` (Sync from Meta WABA)
  - `POST /api/whatsapp/templates/submit` (Submit new template to Meta)
  - `PATCH /api/whatsapp/templates/[id]` (Edit template)
  - `DELETE /api/whatsapp/templates/[id]` (Delete template)
- **Database Tables:**
  - `broadcasts` (name, template_id, status, total_count, sent_count)
  - `broadcast_recipients` (contact_id, wamid, status, error_message)
  - `message_templates` (meta_template_id, name, language, status, components)

---

### 5. Visual Flow Builder & Automations
- **Frontend Routes:**
  - `/flows` (`src/app/(dashboard)/flows/page.tsx`)
  - `/flows/[id]` (`src/app/(dashboard)/flows/[id]/page.tsx`)
  - `/flows/[id]/runs` (`src/app/(dashboard)/flows/[id]/runs/page.tsx`)
  - `/automations` (`src/app/(dashboard)/automations/page.tsx`)
- **Key Components:**
  - `FlowCanvas` (`src/components/flows/flow-canvas.tsx`)
  - `NodeSidebar`, `CustomNodes` (Start, Message, Action, Condition, Delay)
- **Backend Endpoints:**
  - `GET /api/flows`, `POST /api/flows`, `PATCH /api/flows/[id]`
  - `POST /api/flows/[id]/activate` (Publish flow)
  - `POST /api/flows/cron` (Background execution resumption)
- **Database Tables:**
  - `flows` (nodes, edges, status, trigger_type)
  - `flow_runs` (contact_id, status, current_node_id, context_data)
  - `flow_run_steps` (execution trace & step output)

---

### 6. Commerce & Products Catalog
- **Frontend Route:** `/products` (`src/app/(dashboard)/products/page.tsx`)
- **Key Components:**
  - Product catalog table, create/edit modal, media image uploader
- **Backend Endpoints:**
  - `GET /api/products`, `POST /api/products`
  - `PATCH /api/products/[id]`, `DELETE /api/products/[id]`
  - `POST /api/products/seed` (Catalog initialization)
  - `GET /api/inventory`, `POST /api/inventory`
- **Database Tables:**
  - `products` (title, description, price, currency, sku, image_url)
  - `inventory_items` (product_id, location_name, quantity_on_hand, quantity_reserved)
  - `payment_gateway_configs` (encrypted keys for Razorpay & Stripe)
  - `payment_orders` (order tracking, payment link, amount, status)

---

### 7. Governance & Approvals
- **Frontend Route:** `/approvals` (`src/app/(dashboard)/approvals/page.tsx`)
- **Key Components:**
  - Approval requests table, approve/reject modals
- **Backend Endpoints:**
  - `GET /api/approvals`, `POST /api/approvals`, `PATCH /api/approvals/[id]`
- **Database Tables:**
  - `approval_requests` (request_type, status, requested_by, reviewed_by, payload)
  - `audit_logs` (immutable event ledger)

---

### 8. Settings & Account Management
- **Frontend Route:** `/settings` (`src/app/(dashboard)/settings/page.tsx`)
- **Key Tabs & Modules:**
  - WhatsApp Account (WABA setup, embedded signup, phone registration)
  - Team & Members (Invites, role management, transfer ownership)
  - Payments & In-Chat Commerce (Razorpay & Stripe key configuration)
  - AI Configuration (Groq / OpenAI API keys, knowledge base docs)
  - Developer & API Keys (External REST API credentials & webhooks)
  - Billing & Plan Subscriptions (Stripe Customer Portal)
- **Backend Endpoints:**
  - `/api/whatsapp/config`, `/api/account/members`, `/api/account/invitations`
  - `/api/payments/config`, `/api/ai/config`, `/api/account/api-keys`, `/api/billing/*`
- **Database Tables:**
  - `whatsapp_config`, `accounts`, `profiles`, `account_invitations`
  - `api_keys`, `webhook_endpoints`, `subscriptions`
