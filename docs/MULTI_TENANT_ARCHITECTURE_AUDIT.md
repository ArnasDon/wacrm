# WACRM Multi-Tenant Architecture & Security Audit

This document examines multi-tenant data isolation across WACRM, reviewing PostgreSQL Row Level Security (RLS), Migration 017 account sharing, cross-account boundaries, and service-role API operations.

---

## 1. Tenancy Architecture: Account-Level Isolation

WACRM implements a **shared-database, shared-schema, row-level isolated** multi-tenant model.
- Every business or workspace is represented by an `accounts` record (`accounts.id`).
- All domain tables reference `account_id UUID REFERENCES accounts(id) ON DELETE CASCADE`.
- User identity is managed by Supabase Auth (`auth.users`).
- The link between user and tenant is established in `profiles`:
  ```sql
  profiles.user_id -> auth.users.id
  profiles.account_id -> accounts.id
  profiles.account_role -> 'owner' | 'admin' | 'agent' | 'viewer'
  ```

---

## 2. Row Level Security (RLS) Mechanics

The foundation of multi-tenant security in PostgreSQL is the SECURITY DEFINER function introduced in migration 017:

```sql
CREATE OR REPLACE FUNCTION is_account_member(target_account_id UUID, min_role account_role_enum DEFAULT 'viewer')
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.user_id = auth.uid()
      AND profiles.account_id = target_account_id
      AND (
        CASE profiles.account_role
          WHEN 'owner' THEN 4
          WHEN 'admin' THEN 3
          WHEN 'agent' THEN 2
          WHEN 'viewer' THEN 1
          ELSE 0
        END
      ) >= (
        CASE min_role
          WHEN 'owner' THEN 4
          WHEN 'admin' THEN 3
          WHEN 'agent' THEN 2
          WHEN 'viewer' THEN 1
          ELSE 0
        END
      )
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;
```

### Table-by-Table RLS Policy Audit:
- **`contacts`**: Select by `viewer`, insert/update by `agent`, delete by `admin`.
- **`conversations` & `messages`**: Select by `viewer`, insert/update by `agent`.
- **`pipelines`, `pipeline_stages`, `deals`**: Read by `viewer`, manage deals by `agent`, modify stages by `admin`.
- **`broadcasts` & `message_templates`**: Read by `viewer`, execute/submit by `agent`.
- **`flows` & `flow_runs`**: Read by `viewer`, author/activate by `agent`.
- **`products` & `inventory_items`**: Read by `viewer`, insert/update by `agent`, delete by `admin`.
- **`payment_gateway_configs`**: Select/Insert/Update strictly by `admin`, delete by `owner`.
- **`approval_requests`**: Viewable by `viewer`, created by `agent`, approved/rejected exclusively by `admin` or `owner`.
- **`audit_logs`**: Read-only by `admin`, inserts only via internal triggers or security definer procedures.

---

## 3. Cross-Account Boundary Checks

### A. Foreign Key References
- Tables linking two entities (e.g., `deals` linking `contact_id` and `stage_id`) carry `account_id` on both parent and child tables.
- **Verification:** An agent in Account A cannot link a contact belonging to Account B to a deal in Account A because RLS prevents the agent from reading Account B's contacts.

### B. Unique Constraints Scoped by Account
- Phone Numbers: Migration 022 (`022_contact_phone_dedup.sql`) scopes uniqueness to `(account_id, phone)` rather than globally across the database. Two separate tenants can have the same customer phone number without collision.
- Product SKUs: Migration 036 (`036_products_sku_unique_and_inventory_policy.sql`) ensures `UNIQUE(account_id, sku)`. Different businesses can use identical SKU codes.
- WhatsApp Business Account: `whatsapp_config` enforces `UNIQUE(account_id)` — each tenant connects their own distinct WABA and phone number.

---

## 4. API Layer: Service-Role vs User-Scoped Client

Certain backend routes use the Supabase Service Role client (`SUPABASE_SERVICE_ROLE_KEY`) to bypass RLS for system operations. An audit of service-role usage revealed:

1. **Inbound WhatsApp Webhook (`/api/whatsapp/webhook`)**:
   - *Requirement:* Runs without user session when Meta sends asynchronous webhook payloads.
   - *Protection:* Resolves `whatsapp_config` by `phone_number_id`, deriving the exact `account_id` before inserting messages or updating contacts.
2. **Inbound Payment Webhooks (Razorpay & Stripe)**:
   - *Requirement:* Unauthenticated webhook from payment gateways.
   - *Protection:* Validates HMAC signature against the merchant's encrypted webhook secret in `payment_gateway_configs`. Orders are queried strictly matching `order_id` and the verified merchant configuration.
3. **Background Cron Jobs (`/api/flows/cron`, `/api/automations/cron`)**:
   - *Requirement:* Scheduled tasks running without user context.
   - *Protection:* Processes runs partitioned by `account_id` with execution batch limits and mutual exclusion locks.
4. **Standard User Endpoints**:
   - Enforce authentication via `requireRole('agent' | 'admin' | 'owner')` in `src/lib/auth/account.ts`, extracting `accountId` from the verified user session and validating membership before any database query.
