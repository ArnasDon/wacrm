# Plan: Admin-driven provisioning + role-based settings visibility

**Goal:**
1. **No public signup for now.** The **super admin** (platform admin) creates a business account, does the WhatsApp/Meta setup for it, and creates the users who access it.
2. In **Settings**, each business user sees **only the actions their role needs** — platform-admin actions (Meta setup, billing config, provisioning) are not shown to business users at all.

**Status:** Completed & Shipped (Migration `040_provisioning_trigger.sql`, `/admin/provisioning`, provisioning APIs, settings rail role-gating).

### Confirmed decisions
- **Roles:** super admin (platform operator) → **business admin** (manages their own account's business settings + team) → **operators** (agents; use the CRM, no settings management). Reuses the existing `account_role_enum` (owner/admin/agent/viewer) from migration 017.
- **Meta setup:** super admin does it **manually in Meta Business Manager**, then pastes credentials into the admin console per business. **Embedded Signup / in-app Meta onboarding is deferred** (large separate project).
- Depends on / extends the platform-admin concept introduced in [recharge-credits-model-plan.md](recharge-credits-model-plan.md) (`platform_admins` table + `is_platform_admin()`).

---

## 1. What exists today (build on this)
- **Roles + predicates:** `src/lib/auth/roles.ts` — `canEditSettings` (admin+), `canManageMembers` (admin+), `canSendMessages` (agent+), `canViewOnly` (viewer). Server RLS mirrors these via `is_account_member(account_id, min_role)`.
- **Signup trigger:** `handle_new_user` (migration 017) auto-creates a personal account + owner profile for **every** new `auth.users` row.
- **Settings IA:** `src/components/settings/settings-sections.ts` (section list) + `settings-rail.tsx` (renders **all** sections to **all** members — no gating yet) + `settings/page.tsx` (maps section → panel).
- **WhatsApp config form:** `src/components/settings/whatsapp-config.tsx` writes `whatsapp_config` (the exact fields the super admin will fill per business).
- **Members / invitations:** `src/components/settings/members-tab.tsx`, `account_invitations` + redeem RPCs (migration 019).

---

## 2. Defer public signup
- Locate the signup route/page (the `(auth)` group — mirrors the login/signup split referenced in `settings/page.tsx`). **Disable or route-guard it** so it's not reachable (redirect to login with a "contact your administrator" message). Keep the login page.
- Leave `handle_new_user` in place — it's still used, but provisioning drives it (see §3). Public sign-ups simply have no entry point.

---

## 3. Provisioning flow (super admin console, `/admin`)

All under a new **`/admin`** area, every page + API route guarded by `is_platform_admin()` server-side (never UI-only). This is the same console that hosts billing config from the recharge plan.

### 3a. Create a business account (+ its business admin)
Because `accounts.owner_user_id` is `NOT NULL` and the `handle_new_user` trigger already creates one account per new user, the simplest path is:
1. Super admin route `POST /api/admin/accounts` — uses the **Supabase Admin API** (service role) to create the **business-admin** auth user (email + temp password, or an invite email). The trigger creates their account (they become `owner`) + profile.
2. The route then sets that account's **business name** (and later branding) and returns the account id.
> Result: the business admin's auto-created account **is** the business account. No orphan accounts.

### 3b. WhatsApp/Meta setup per business (manual credentials)
- Super admin route `POST /api/admin/accounts/[id]/whatsapp` — service-role **upsert into `whatsapp_config`** for the target `account_id` with the fields the super admin pasted from Meta Business Manager: `phone_number_id`, WABA id, `access_token` (encrypt via the existing `encrypt()`), `verify_token`, display number, `status`.
- Reuse the **field set + validation** from `src/components/settings/whatsapp-config.tsx`, but render it in the admin console and target a chosen account (not the caller's own). Encryption/token handling stays identical to the existing path.
- **Deferred:** an in-app "Connect WhatsApp" using Meta's Embedded Signup endpoints. Note it as a future epic; not built now.

### 3c. Create users for an account
- Super admin route `POST /api/admin/accounts/[id]/users` — creates an auth user attached to the **existing** account (not a new personal one) with a chosen role (`admin` for a business admin, `agent` for an operator).
- **Attach-to-existing mechanism:** create the auth user with `user_metadata` carrying `provision_account_id` + `provision_role`, and **modify `handle_new_user`** to honor them:
  ```sql
  -- inside handle_new_user, before the default create-personal-account path:
  IF NEW.raw_user_meta_data ? 'provision_account_id' THEN
    INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
    VALUES (NEW.id,
            COALESCE(NEW.raw_user_meta_data->>'full_name',''),
            COALESCE(NEW.email,''),
            (NEW.raw_user_meta_data->>'provision_account_id')::uuid,
            COALESCE((NEW.raw_user_meta_data->>'provision_role')::account_role_enum,'agent'));
    RETURN NEW;   -- do NOT create a personal account
  END IF;
  ```
  Keep the existing default branch for the §3a business-admin creation (no provision metadata → owner of a fresh account).
- Alternatively reuse the existing **invitation** system (create an invitation with the role, then create/send it) if you prefer not to touch the trigger — but direct creation with provision metadata matches "admin creates users" best.

### 3d. Admin console surfaces (minimum)
- Accounts list → per account: business name, WhatsApp status, wallet balance, users.
- Actions: create account, edit WhatsApp credentials, add/remove users + set role, billing (rate override, recharge mode, manual top-up — from the recharge plan).

---

## 4. Role-based settings visibility (business users)

### 4a. Add visibility metadata to each section
In `settings-sections.ts`, extend `SectionMeta` with a `minRole` (and drop platform-only sections from business settings entirely):
```ts
export interface SectionMeta {
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
  group: 'top' | 'account' | 'workspace';
  minRole: AccountRole; // lowest role that may SEE this section
}
```

### 4b. Recommended mapping (business Settings page)
| Section | Who sees it | Notes |
|---|---|---|
| overview | all (`viewer`) | Landing. |
| profile | all | Own profile. |
| security | all | Own password. |
| appearance | all | Theme. |
| **business** (branding) | `admin` | New — logo/name (see branding plan). |
| templates | `admin` | Business admin manages; operators use them in the composer, not here. |
| quick-replies | `admin` | Same. |
| fields | `admin` | Tags & custom fields. |
| deals | `admin` | Pipeline/currency. |
| usage (wallet/recharge) | `admin` | Balance + recharge + history. (Operators may get a read-only balance view — optional.) |
| members | `admin` | Business admin manages their own operators; role changes still go through admin-guarded endpoints. |
| api | `admin` | API keys. |
| **whatsapp** | **removed from business Settings** | Meta setup is super-admin-only (admin console). Optionally show business admin a **read-only** "WhatsApp connected: yes/no" indicator, but never the config form. |

Net effect: an **operator** sees only Overview, Profile, Security, Appearance (+ optional read-only balance). A **business admin** sees the full business set above (no Meta setup, no billing-rate config).

### 4c. Wire the gating
- `settings-rail.tsx`: filter `SETTINGS_SECTIONS` to those where `hasMinRole(currentRole, meta.minRole)` before rendering. Get `currentRole` from `useAuth` (extend it to expose `account_role` if it doesn't already).
- `settings/page.tsx` / `resolveSection`: if a URL `?tab=` points at a section the role can't see (or the removed `whatsapp`), fall back to Overview so a deep link can't reveal a gated panel. Also don't mount the gated panel.
- These are **UX gates**; the real protection is RLS (writes already require the right role) — keep both.

---

## 5. Security / correctness checklist
- [ ] Every `/admin/*` page and `/api/admin/*` route re-checks `is_platform_admin()` server-side.
- [ ] User-creation route sets `provision_account_id`/`provision_role`; the trigger attaches to the existing account and never creates an orphan personal account for operators.
- [ ] Business admins can manage only **their own** account's members/settings (RLS `is_account_member(account_id,'admin')` already enforces this).
- [ ] Settings rail filters by role, and gated panels are not mounted even via a crafted `?tab=`.
- [ ] Signup entry point removed/guarded; login unaffected.
- [ ] WhatsApp credentials entered by super admin are encrypted with the existing `encrypt()` before storage.

---

## 6. Files touched
- **Migration:** modify `handle_new_user` to honor `provision_account_id`/`provision_role` (new migration, idempotent `CREATE OR REPLACE`).
- **New admin console:** `src/app/(admin)/admin/...` pages + `src/app/api/admin/accounts/route.ts`, `.../[id]/whatsapp/route.ts`, `.../[id]/users/route.ts` (all `is_platform_admin`-gated, service role).
- **Edit:** `settings-sections.ts` (add `minRole`, drop `whatsapp` from business set), `settings-rail.tsx` (filter by role), `settings/page.tsx` (fallback + don't mount gated panels), `use-auth` (expose `account_role` if missing).
- **Edit:** disable/guard the signup route.
- **Reuse:** `whatsapp-config.tsx` field set/validation inside the admin console.

---

## 7. Verification
1. Public `/signup` is unreachable; `/login` works.
2. Super admin creates an account → a business-admin user exists, owns a named account.
3. Super admin pastes Meta credentials → `whatsapp_config` populated for that account; business inbox/broadcasts work.
4. Super admin adds an operator → the operator logs in and lands in the **same** account (no new personal account), role `agent`.
5. Operator's Settings shows only Overview/Profile/Security/Appearance; no WhatsApp/templates/billing.
6. Business admin's Settings shows the full business set but **no** Meta setup form and **no** billing-rate config.
7. Non-platform-admin hitting `/admin` or `/api/admin/*` → 403.
