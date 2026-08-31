# Master build sequence

Ordered plan of record for the current wacrm feature set. Each phase lists its dependency and the detailed plan doc to follow. Build top-to-bottom; phases with the same number can run in parallel.

Already shipped:
- **2 broadcast messages/minute** ([broadcast-two-per-minute-plan.md](broadcast-two-per-minute-plan.md))
- **Phase 0 — Platform-admin foundation** ([00-build-sequence.md](#phase-0--platform-admin-foundation-shipped))
- **Phase 1 — Inbox reply export** ([inbox-reply-export-plan.md](inbox-reply-export-plan.md))
- **Phase 2 — Per-account branding** ([business-branding-upload-plan.md](business-branding-upload-plan.md))
- **Phase 3 — Recharge / credits model** ([recharge-credits-model-plan.md](recharge-credits-model-plan.md))
- **Phase 4 — Provisioning & settings visibility** ([provisioning-and-settings-visibility-plan.md](provisioning-and-settings-visibility-plan.md))

---

## Dependency map (what blocks what)

```
Phase 0  Platform-admin foundation  ──┬──▶ Phase 3  Recharge / credits [SHIPPED]
                                      └──▶ Phase 4  Provisioning + settings visibility [SHIPPED]

Phase 1  Inbox reply export      (independent — SHIPPED)
Phase 2  Per-account branding    (independent — SHIPPED)
```

---

## Phase 0 — Platform-admin foundation *(SHIPPED)*
- `platform_admins` table + `is_platform_admin()` helper.
- `/admin` console layout with server-side 403 guard.
- Accounts list landing page & API route `GET /api/admin/accounts`.

---

## Phase 1 — Inbox reply export *(SHIPPED)*
- `GET /api/inbox/export` (session-scoped, RLS-isolated) returning UTF-8 BOM CSV.
- Export button in conversation list header.

---

## Phase 2 — Per-account branding *(SHIPPED)*
- Migration `038_account_branding.sql`: `accounts.logo_url`, `business_name`, `account-logos` bucket.
- Business Profile settings panel (`src/components/settings/business-profile-form.tsx`).
- Workspace header and sidebar branding display.

---

## Phase 3 — Recharge / credits *(SHIPPED)*
- Migration `039_billing_credits.sql`: `billing_settings`, `account_wallets`, `credit_transactions`, `recharge_orders`, atomic `debit_message()` and `credit_wallet()` RPCs.
- Charge helpers (`src/lib/billing/charge.ts`) wired to template message sends & broadcast queue processor.
- Platform Admin Billing console (`/admin/billing`) for global rate, currency, recharge modes, and manual top-up.
- Business Wallet API `GET /api/billing/wallet`.

---

## Phase 4 — Provisioning + settings visibility *(SHIPPED)*
- Migration `040_provisioning_trigger.sql`: `handle_new_user` updated to honor `provision_account_id` and `provision_role` metadata.
- Account Provisioning API (`POST /api/admin/accounts`), User Provisioning API (`POST /api/admin/accounts/[id]/users`), Super Admin WhatsApp Setup API (`POST /api/admin/accounts/[id]/whatsapp`).
- Platform Admin Provisioning console (`/admin/provisioning`).
- Role-gated settings rail visibility (`minRole` per section).
