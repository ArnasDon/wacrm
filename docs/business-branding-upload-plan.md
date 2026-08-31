# Plan: Per-account business branding (logo + name) shown across the workspace

**Goal:** Let each business account upload its **logo** and set its **business name**, and have both render in that account's workspace (sidebar / header) — white-label per tenant.

**Status:** Completed & Shipped (Migration `038_account_branding.sql`, `BusinessProfileForm`, Header & Sidebar branding).

**Scope decision (confirmed):** Per **business account** (not a single global brand). Each account's branding is visible only to its own members.

---

## 1. What already exists (build on this)
- **`accounts` table** (`supabase/migrations/017_account_sharing.sql`): `id`, `name`, `owner_user_id`. RLS already lets **admins+** UPDATE their own account (`accounts_update` policy = `is_account_member(id, 'admin')`), and all members SELECT it.
- **Avatar upload pattern** to mirror exactly: `src/components/settings/profile-form.tsx` (~line 124) uses `supabase.storage.from('avatars').upload(path, file)` then `.getPublicUrl(path)`. Bucket defined in `supabase/migrations/008_profile_avatars_storage.sql` (public bucket, 2 MB limit, path `{uid}/avatar-<ts>.<ext>`, RLS keyed on first path segment).
- **Settings IA**: `src/components/settings/settings-sections.ts` defines sections. Branding fits a new **`business`** section in the `workspace` group (admin-only), or extend the existing `appearance` section.

---

## 2. Data model

### 2a. Migration — add branding columns to `accounts`
New file `supabase/migrations/0XX_account_branding.sql`:
```sql
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS logo_url TEXT,
  ADD COLUMN IF NOT EXISTS business_name TEXT; -- display name; falls back to accounts.name
```
> `accounts.name` already exists but is the internal account name (defaults to the owner's full name/email at signup). Keep it, and add `business_name` as the **editable display brand**. The UI shows `business_name || name`.

### 2b. Migration — `account-logos` storage bucket + RLS
Mirror `008_profile_avatars_storage.sql`, but scope writes to **account admins** using the account id as the first path segment (`account-logos/{account_id}/logo-<ts>.<ext>`):
```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('account-logos', 'account-logos', TRUE, 2097152,
        ARRAY['image/png','image/jpeg','image/webp','image/svg+xml'])
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Account logos are publicly readable" ON storage.objects;
CREATE POLICY "Account logos are publicly readable"
  ON storage.objects FOR SELECT USING (bucket_id = 'account-logos');

-- Only admins+ of the account whose id is the first path segment may write.
DROP POLICY IF EXISTS "Account admins manage their logo" ON storage.objects;
CREATE POLICY "Account admins manage their logo"
  ON storage.objects FOR ALL
  USING (
    bucket_id = 'account-logos'
    AND is_account_member(((storage.foldername(name))[1])::uuid, 'admin')
  )
  WITH CHECK (
    bucket_id = 'account-logos'
    AND is_account_member(((storage.foldername(name))[1])::uuid, 'admin')
  );
```
> `is_account_member(uuid, account_role_enum)` already exists (migration 017). Confirm the `::uuid` cast on the path segment is valid in the storage-policy context; if a malformed path could throw, guard with a regex check on `name` first.

---

## 3. Upload + save flow (UI)

### 3a. New settings section: "Business profile" (admin-only)
- Add `'business'` to `SETTINGS_SECTIONS` and a `SECTION_META.business` entry (group `workspace`, an icon like `Building2`), in `src/components/settings/settings-sections.ts`.
- Gate it admin-only (the rail already supports hiding non-admin items — follow how `members`/`api` visibility is handled on the settings page).
- Build `src/components/settings/business-profile-form.tsx` mirroring `profile-form.tsx`:
  - **Logo**: file input (png/jpeg/webp/svg, ≤2 MB), preview, upload to `account-logos/{account_id}/logo-<Date.now()>.<ext>`, then `getPublicUrl`, then `update accounts set logo_url = ...`.
  - **Business name**: text input bound to `accounts.business_name`.
  - Save via `supabase.from('accounts').update({ business_name, logo_url }).eq('id', accountId)` — RLS enforces admin-only. Show a success/error toast (sonner, as elsewhere).
  - Resolve `accountId` from the auth/profile (same way other components do — `profiles.account_id`).

### 3b. Old logo cleanup (optional)
On replacing a logo, best-effort `remove()` the previous file so the bucket doesn't accumulate orphans. Not required for v1.

---

## 4. Reflect branding across the workspace

### 4a. Branding source
Add an account-branding loader so layout chrome can read `{ business_name, name, logo_url }`. Two options:
- **Preferred:** extend the existing auth/account context (`src/hooks/use-auth.ts` and whatever provides `profile`) to also expose the account row (or add `useAccountBranding()` that queries `accounts` by `profile.account_id` once and caches). Realtime is nice-to-have (a logo change reflects on next load otherwise).

### 4b. Render sites
- **`src/components/layout/sidebar.tsx`** — the account strip currently shows role chips; render `logo_url` (fallback to an initial-based avatar) + `business_name || name` as the workspace brand at the top.
- **`src/components/layout/header.tsx`** — if it shows an app/brand mark, swap it for the account brand.
- Use `next/image` with the public URL; give a sensible fallback (first letter of the business name in a colored circle) when `logo_url` is null, matching the `AvatarFallback` pattern already used for user avatars.

### 4c. Out of scope (flag for later)
- **Pre-auth pages** (login, invite acceptance) can't resolve an account, so they keep the default app brand. True per-tenant login theming (custom domains/subdomains) is a separate, larger effort.
- Browser tab favicon/title per account — later.

---

## 5. Security / tenancy checklist
- [ ] Logo writes limited to account **admins+** (storage RLS + `accounts` RLS both enforce this — no service role on the client path).
- [ ] Path is always `{account_id}/...`; never trust a client-supplied account id — derive it from the session profile.
- [ ] SVG is allowed in the bucket for crisp logos; if you'd rather avoid SVG's script surface, drop `image/svg+xml` from `allowed_mime_types` and accept raster only.

---

## 6. Files touched
- **New migration:** `supabase/migrations/0XX_account_branding.sql` (columns) + bucket/policies (same or a second migration file).
- **New:** `src/components/settings/business-profile-form.tsx`.
- **Edit:** `src/components/settings/settings-sections.ts` (add `business` section), the settings page renderer (mount the new section + admin gate).
- **Edit:** `src/components/layout/sidebar.tsx`, `src/components/layout/header.tsx` (render brand).
- **Edit:** auth/account context or a new `useAccountBranding` hook.
- **i18n:** add labels for the new section + form to the settings message catalog.

---

## 7. Verification
1. As an account **admin**, upload a logo and set a business name → sidebar/header update (after reload) to show them.
2. As an **agent/viewer**, the Business profile section is hidden and the `accounts` update is rejected by RLS.
3. Log in as a **different account** → its own (or default) branding shows; the first account's logo is never visible.
4. Logo > 2 MB or wrong MIME → rejected with a clear message.
