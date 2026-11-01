# WACRM Manual Test Cases & Quality Assurance Guide

This manual test suite provides exact browser verification steps, inputs, expected API responses, and database validation points across all 21 functional domains in WACRM.

---

## Test Suite Index

1. [Auth & Onboarding](#1-auth--onboarding)
2. [Workspace Creation & Member Invites](#2-workspace-creation--member-invites)
3. [Roles & Permissions](#3-roles--permissions)
4. [Dashboard & Analytics](#4-dashboard--analytics)
5. [WhatsApp Shared Inbox](#5-whatsapp-shared-inbox)
6. [Contacts & Tags](#6-contacts--tags)
7. [Sales Pipelines & Kanban](#7-sales-pipelines--kanban)
8. [Broadcast Campaigns](#8-broadcast-campaigns)
9. [Message Templates & Meta Sync](#9-message-templates--meta-sync)
10. [Visual Flow Builder](#10-visual-flow-builder)
11. [Rule-Based Automations](#11-rule-based-automations)
12. [AI Reply Assistant](#12-ai-reply-assistant)
13. [AI Knowledge Base Documents](#13-ai-knowledge-base-documents)
14. [Products Catalog & SKUs](#14-products-catalog--skus)
15. [Multi-Location Inventory Tracking](#15-multi-location-inventory-tracking)
16. [Razorpay Payment Gateway](#16-razorpay-payment-gateway)
17. [Stripe Payment Gateway](#17-stripe-payment-gateway)
18. [WhatsApp Payment Link Generation](#18-whatsapp-payment-link-generation)
19. [Public Developer REST API](#19-public-developer-rest-api)
20. [Outbound Webhooks](#20-outbound-webhooks)
21. [Enterprise Approvals & Audit Trail](#21-enterprise-approvals--audit-trail)

---

### 1. Auth & Onboarding
* **URL:** `/login` & `/signup`
* **Test Action:** Create a new business owner account at `/signup`.
* **Expected UI:** Verification email sent or immediate redirect to `/dashboard`. First-time onboarding modal opens.
* **Database Check:** Row created in `auth.users`, `accounts`, and `profiles` with `account_role = 'owner'`.

### 2. Workspace Creation & Member Invites
* **URL:** `/settings` -> "Team" tab
* **Test Action:** Generate an invite link for an `agent` role. Open link in incognito window (`/join/[token]`).
* **Expected UI:** Prompted to sign up or log in. Upon acceptance, the user joins the inviter's organization.
* **Database Check:** Row updated in `account_invitations` with `accepted_at` set; `profiles.account_id` matches the inviter's account.

### 3. Roles & Permissions
* **URL:** Log in as `viewer` role.
* **Test Action:** Attempt to click "+ Add Contact", "+ Add Deal", or modify WhatsApp Settings.
* **Expected UI:** Mutation buttons disabled; direct API calls return `403 Forbidden`.
* **Database Check:** RLS blocks updates.

### 4. Dashboard & Analytics
* **URL:** `/dashboard`
* **Test Action:** Change date range filter from "Last 7 Days" to "Last 30 Days".
* **Expected UI:** Charts re-render with aggregated message counts, conversation volume, and pipeline revenue.

### 5. WhatsApp Shared Inbox
* **URL:** `/inbox`
* **Test Action:** Open a conversation. Send a text message, attach an image/PDF, and add an emoji reaction.
* **Expected UI:** Message appears immediately in chat timeline with status checkmarks; reaction renders below the message.
* **Database Check:** Row inserted in `messages` with `conversation_id`, `content_type`, and `sender_type = 'agent'`.

### 6. Contacts & Tags
* **URL:** `/contacts`
* **Test Action:** Click "+ Add Contact", enter name and E.164 phone (`+919876543210`), and assign tag `VIP`.
* **Expected UI:** Contact appears in list. Search by tag `VIP` filters correctly.
* **Database Check:** Row created in `contacts` with `UNIQUE(account_id, phone)` constraint respected.

### 7. Sales Pipelines & Kanban
* **URL:** `/pipelines`
* **Test Action:** Drag a deal card from "Lead" stage to "Closed Won" stage.
* **Expected UI:** Card smoothly drops into the new stage column. Total stage value updates automatically.
* **Database Check:** `deals.stage_id` updated; `updated_at` updated.

### 8. Broadcast Campaigns
* **URL:** `/broadcasts/new`
* **Test Action:** Select an approved template, pick target contacts by tag, and click "Send Campaign".
* **Expected UI:** Campaign status transitions from `sending` to `sent` with progress bar.
* **Database Check:** Row created in `broadcasts`; rows created in `broadcast_recipients` with `whatsapp_message_id`.

### 9. Message Templates & Meta Sync
* **URL:** `/broadcasts` -> "Templates" tab
* **Test Action:** Click "Sync from Meta".
* **Expected UI:** Loading indicator spins and catalog populates with templates approved on WhatsApp Manager.
* **Draft Deletion:** Click "Delete" on any draft template; template is removed immediately without error.

### 10. Visual Flow Builder
* **URL:** `/flows/[id]`
* **Test Action:** Drag a "Start" node and connect to a "Message" node with text "Welcome!". Click "Activate Flow".
* **Expected UI:** Node connections snap smoothly. Status badge changes to "Active".
* **Database Check:** `flows.is_active` set to `true`; `flows.nodes` and `flows.edges` saved.

### 11. Rule-Based Automations
* **URL:** `/automations/new`
* **Test Action:** Set trigger: "Message Received matching keyword 'demo'" -> Action: "Add Tag 'Lead'".
* **Expected UI:** Rule saves in list. When customer sends 'demo', contact receives tag 'Lead'.
* **Database Check:** Log recorded in `automation_logs`.

### 12. AI Reply Assistant
* **URL:** `/inbox` (inside any conversation)
* **Test Action:** Click the "AI Draft Reply" button in the composer.
* **Expected UI:** Drawer opens with drafted response based on conversation history. Clicking "Insert" populates the composer.

### 13. AI Knowledge Base Documents
* **URL:** `/settings` -> "AI" tab
* **Test Action:** Upload a company FAQ PDF or text document. Click "Index Document".
* **Expected UI:** Document status shows "Indexed" with chunk count.
* **Database Check:** Rows inserted in `ai_knowledge_chunks` with `account_id` isolation.

### 14. Products Catalog & SKUs
* **URL:** `/products`
* **Test Action:** Click "+ Add Product". Enter title: "Premium Widget", Price: `1499`, SKU: `WIDGET-001`, Currency: `INR`.
* **Expected UI:** Product card displays with badge "Active".
* **Database Check:** Row inserted in `products` with `account_id` and unique SKU constraint.

### 15. Multi-Location Inventory Tracking
* **URL:** `/products` -> Click "Inventory" on a product.
* **Test Action:** Adjust "Main Warehouse" stock from `10` to `8`.
* **Expected UI:** Quantity on hand updates to `8`. Reorder alert triggers if below threshold.
* **Database Check:** Item updated in `inventory_items`; audit trail logged in `audit_logs`.

### 16. Razorpay Payment Gateway
* **URL:** `/settings` -> "Payments" tab
* **Test Action:** Enter test Razorpay Key ID and Key Secret. Click "Save Credentials".
* **Expected UI:** Badge turns green: "Razorpay Configured".
* **Database Check:** Keys encrypted with AES-256-GCM in `payment_gateway_configs`.

### 17. Stripe Payment Gateway
* **URL:** `/settings` -> "Payments" tab
* **Test Action:** Enter test Stripe Publishable Key and Secret Key. Click "Save Credentials".
* **Expected UI:** Badge turns green: "Stripe Configured".
* **Database Check:** Keys stored in `payment_gateway_configs`.

### 18. WhatsApp Payment Link Generation
* **URL:** `/inbox` (inside a conversation)
* **Test Action:** Click the "₹" payment attachment icon. Select "Premium Widget", Amount `1499`, Gateway "Razorpay", click "Send Payment Link".
* **Expected UI:** Interactive payment message dispatched to customer with secure payment link.
* **Database Check:** Row created in `payment_orders` with status `pending`.

### 19. Public Developer REST API
* **URL:** `POST /api/v1/contacts` with header `X-API-Key: wacrm_...`
* **Test Action:** Send payload `{"name": "API Contact", "phone": "+919876543299"}`.
* **Expected UI:** Returns `201 Created` with contact JSON.
* **Database Check:** Contact created and linked to the API key's owning `account_id`.

### 20. Outbound Webhooks
* **URL:** `/settings` -> "Developers" tab
* **Test Action:** Register webhook URL `https://webhook.site/...` subscribed to event `message.received`. Click "Send Test Ping".
* **Expected UI:** Test ping delivered successfully with HMAC signature header `X-WACRM-Signature`.
* **Database Check:** Delivery logged in `webhook_deliveries`.

### 21. Enterprise Approvals & Audit Trail
* **URL:** `/approvals`
* **Test Action:** As agent, submit a price override request. Log in as admin and click "Approve".
* **Expected UI:** Status transitions to "Approved". Audit entry displayed in audit log table.
* **Database Check:** `approval_requests.status` updated to `approved`; entry written in `audit_logs`.
