# Chat Chacha — Customization Log

Every change made to the original wacrm codebase. When pulling upstream
updates, these are the files to protect. See UPSTREAM_SYNC.md for the process.

## Branding

| File | What changed | Date |
|------|-------------|------|
| `messages/en.json` | `Sidebar.title` set to "Chat Chacha" | 2026-07 |
| `src/app/layout.tsx` | Page title, description, and favicon path | 2026-07 |
| `src/components/layout/sidebar.tsx` | Brand mark replaced with `/logo.png` | 2026-08-13 |
| `src/app/(auth)/login/page.tsx` | Brand mark replaced with `/logo.png` | 2026-08-13 |
| `src/app/(auth)/signup/page.tsx` | Brand mark replaced with `/logo.png` | 2026-08-13 |
| `src/app/icon.tsx` | **Deleted** — generated purple favicon | 2026-08-13 |

All brand-mark edits are commented `CHATCHACHA CUSTOM` in the source.

## Files added (not in upstream — cannot conflict)

| File | Purpose |
|------|---------|
| `public/logo.png` | Chat Chacha logo, used in sidebar and auth pages |
| `src/app/icon.png` | Static favicon, replaces the generated one |
| `.github/workflows/deploy.yml` | Auto-deploy to DigitalOcean on push to main |
| `CHATCHACHA_CHANGES.md` | This file |
| `UPSTREAM_SYNC.md` | Upstream merge runbook |

## Recurring fixes

**`uuid_generate_v4()` in migrations** — this Supabase project does not have the
`uuid-ossp` function available. Any new migration using it must be changed to
`gen_random_uuid()` before `supabase db push`:

```powershell
Get-ChildItem supabase\migrations\*.sql | ForEach-Object { (Get-Content $_.FullName) -replace 'uuid_generate_v4\(\)', 'gen_random_uuid()' | Set-Content $_.FullName }
```

**`@swc/helpers` missing from lockfile** — merges sometimes drop this entry,
which breaks `npm ci` in CI while local builds still pass. Fix:

```powershell
npm install @swc/helpers@0.5.23
```

## Reverted / not currently applied

**Invite-only signup** — a guard in `src/app/(auth)/signup/page.tsx` reading
`NEXT_PUBLIC_INVITE_ONLY`. Reverted because it was placed above the `useState`
calls, violating React's rules of hooks and failing CI. If reinstated, it must
sit **after every hook** and before the first JSX return. The env var is