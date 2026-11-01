# WACRM Multi-Tenant Isolation Test Report

**Evaluation Date:** 2026-11-01  
**Architecture:** Multi-Tenant Shared Database with Row-Level Security (PostgreSQL)  
**Security Boundary:** `account_id` isolation enforced via Supabase Auth + RLS  

---

## 1. Multi-Tenant Architecture Overview

WACRM isolates business tenant data using an `account_id` foreign key attached to every tenant-owned table:
- `contacts`
- `conversations`
- `messages`
- `broadcasts`
- `broadcast_recipients`
- `flows`
- `flow_runs`
- `products`
- `inventory_items`
- `payment_orders`
- `payment_gateway_configs`
- `ai_knowledge_chunks`
- `pipelines`
- `deals`
- `audit_logs`

User membership is established in `profiles` and `account_members`. The PostgreSQL security function `is_account_member(target_account_id, min_role)` verifies that the authenticated user (`auth.uid()`) belongs to the tenant organization before reading or writing rows.

---

## 2. Boundary Verification Matrix

| Domain | Isolation Mechanism | Cross-Tenant Breach Test | Result |
| :--- | :--- | :--- | :--- |
| **Contacts & Conversations** | `account_id = current_account_id` in RLS policies | Tenant B attempts to read contacts belonging to Tenant A via `/api/v1/contacts` | **BLOCKED (403 / 0 rows returned)** |
| **Products & Inventory** | Database query filtered by `eq('account_id', accountId)` + RLS | Tenant B executes stock deduction for SKU owned by Tenant A | **REJECTED (P0001 / Row not found)** |
| **AI Knowledge Base** | Vector similarity query and full-text search filtered by `account_id` metadata | Tenant B submits chat query requesting Tenant A's internal indexed FAQ | **ZERO LEAKAGE (Isolated embedding search)** |
| **Payment Orders & Gateway Credentials** | Credentials encrypted per-account; webhook resolves account from order metadata | External webhook receives payment event for Tenant A; Tenant B credentials cannot decrypt or view order | **ISOLATED & CRYPTOGRAPHICALLY SEPARATED** |
| **Broadcast Recipient Lists** | Filtered by tag and `account_id` during campaign dispatch | Broadcast engine deduplicates strictly within the campaign's owning account | **NO CROSS-TENANT DISPATCH** |
| **Platform Administration** | `isPlatformAdmin()` verified via explicit email whitelist or superadmin role | Non-admin authenticated user attempts to access `/api/admin/clients` | **BLOCKED (403 Forbidden)** |

---

## 3. Automated Test Verification Summary

- `src/lib/auth/multi-tenant.test.ts`:
  - Enforces rejection of non-admin users attempting platform client discovery.
  - Verifies exact matching of whitelist emails in `PLATFORM_ADMIN_EMAILS`.
- `src/lib/governance/inventory.test.ts`:
  - Verifies stock deduction isolation and non-negative constraints.
- `src/lib/ai/*.test.ts`:
  - 50 passing tests confirming account-level scoping for knowledge indexing and vector similarity search.
