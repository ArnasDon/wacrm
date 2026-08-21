# Billing (Asaas) — foundation only, not wired up

This directory is intentionally empty of integration code. The
platform operator decided to hold off on turning on real billing
until later, but wanted the schema and UI shells in place now so
switching it on later is a scoped, additive change rather than a
redesign.

## What exists today

- `organizations.billing_status` (`trial` | `active` | `past_due` |
  `canceled`, default `'trial'`) — migration 044.
- `organizations.asaas_customer_id` (nullable `TEXT`) — migration 044.
- `organizations.plan` (nullable `TEXT`) — migration 044.
- A "Faturamento" section in the store owner's own Settings, showing a
  static "coming soon, you're still free" message — no form, nothing
  clickable except a support contact link.
- `billing_status` shown read-only on each store's card in
  `/painel-a17c94fe2b6d` and on `/painel-a17c94fe2b6d/lojas/[id]`.

**None of the above is read by any access-control rule.**
`organizations.status` (`active` / `suspended`, migration 042) is
still the only column that blocks a member's access — see that
migration's own security-model note. `billing_status` is inert until
the work below actually implements something that reads it.

## What still needs to be built, and where

1. **Create the Asaas customer when a store is created.** Both store-
   creation paths — `POST /api/platform/organizations` (platform admin
   creating one) and `POST /api/auth/store-signup` (a store owner
   signing themselves up) — call `bootstrapStoreOrganization()`
   (`src/lib/organizations/bootstrap.ts`). That's the one place to add
   an Asaas `customers` API call once it's real: create the customer
   right after the organization row is created, store the returned id
   in `organizations.asaas_customer_id`. Keep it best-effort with clear
   logging (like the existing `authDeleteFailures` handling in the
   delete-organization route) rather than failing the whole signup if
   Asaas is briefly down.

2. **A webhook endpoint to receive payment confirmations.** New route,
   e.g. `POST /api/webhooks/asaas`, mirroring the existing
   provider-webhook pattern (`src/app/api/uazapi/webhook/[accountId]/
   [secret]/route.ts`) for the shared-secret-in-the-URL authentication
   approach, since Asaas (like uazapi/Z-API) doesn't sign its webhook
   payloads with anything comparable to Meta's HMAC. It updates
   `organizations.billing_status` based on the event
   (`PAYMENT_CONFIRMED` → `active`, `PAYMENT_OVERDUE` → `past_due`,
   subscription cancellation → `canceled`), matched by
   `asaas_customer_id`.

3. **The field that actually triggers suspension.** Do NOT add a
   second, parallel access check on `billing_status` directly. Once
   `billing_status` flips to `past_due` or `canceled` (from the
   webhook above), that handler should update `organizations.status`
   to `'suspended'` too — reusing the exact same enforcement path
   migration 042 already built (`is_account_member()`'s suspension
   check, `my_account_suspended()`, the dashboard's "access suspended"
   screen) instead of inventing a new one. `organizations.status`
   stays the single source of truth for "is this account blocked
   right now," regardless of *why* (manual admin action or billing).

4. **The Settings → Faturamento section** (`src/components/settings/
   billing-settings.tsx` once built) becomes the natural home for a
   real payment method / invoice history UI, and the platform admin's
   read-only `billing_status` display becomes actionable (e.g. "resend
   invoice," "change plan").

## Why this shape

Keeping billing_status separate from organizations.status means a
manual platform-admin suspension and an automatic billing-driven
suspension can never fight each other or get confused — `status` is
always the one true "can this org's members do anything right now"
answer, and `billing_status` is always just "what does Asaas currently
say about payment," a fact feeding into that decision rather than a
second decision-maker.
