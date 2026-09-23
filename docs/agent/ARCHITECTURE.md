# Architecture Reference

This document describes the codebase **as it actually exists**, verified
by direct inspection of the repo — not inferred from the framework name.
It is the ground truth `IMPLEMENTATION_PLAN.md` should be checked
against; where the plan's assumptions differ from this document, this
document wins.

Regenerate the relevant section here if a task in the implementation
plan changes something described below (new route group, new lib
module, new design token) — keep this file honest as the codebase
grows.

---

## 1. Stack (exact versions, from `package.json`)

| Layer               | Choice                                                                                                                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework           | Next.js 16.3.5, App Router, Turbopack dev server                                                                                                                                                |
| UI runtime          | React 19.2.4                                                                                                                                                                                    |
| Language            | TypeScript ^6, `tsc --noEmit` for typecheck                                                                                                                                                     |
| Styling             | Tailwind CSS v4 (`@tailwindcss/postcss`)                                                                                                                                                        |
| Component kit       | shadcn (`style: "base-nova"`) on top of **`@base-ui/react`** — not Radix. Check an existing `components/ui/*.tsx` file before assuming Radix APIs.                                              |
| Icons               | `lucide-react`                                                                                                                                                                                  |
| DB / Auth / Storage | Supabase (`@supabase/ssr`, `@supabase/supabase-js`)                                                                                                                                             |
| Drag & drop         | `@dnd-kit/core` + `@dnd-kit/sortable` (used by the pipeline kanban board — relevant if replacing it with a mobile swipe view)                                                                   |
| Flow builder canvas | `@xyflow/react` (React Flow) + `@dagrejs/dagre` for auto-layout                                                                                                                                 |
| i18n                | `next-intl` — see §5, this is not optional to skip                                                                                                                                              |
| Charts              | `recharts`, plus a local `components/tremor/*` chart wrapper set                                                                                                                                |
| Forms/validation    | no dedicated form library dependency found (no react-hook-form/zod in `package.json`) — check `components/contacts/contact-form.tsx` for the actual pattern in use before introducing a new one |
| Toasts              | `sonner`, wrapped by `components/themed-toaster.tsx`                                                                                                                                            |
| Tests               | `vitest` (`npm run test`, `npm run test:watch`)                                                                                                                                                 |

**Node:** `>=20.0.0`. **Package manager:** npm (`packageManager: npm@10.9.9` — do not switch to pnpm/yarn).

### Scripts (from `package.json` / `CONTRIBUTING.md`) — the only commands to trust

```
npm run dev           # Turbopack dev server, port 3000
npm run build          # production build (also runs Next's own typecheck)
npm run typecheck      # tsc --noEmit, fast TS-only pass
npm run lint            # ESLint
npm run format          # Prettier --write
npm run format:check    # Prettier check-only (CI)
npm run test             # vitest run
npm run test:watch      # vitest watch
```

Run `typecheck`, `lint`, `format:check`, and `test` before considering any task done — this matches what CI actually runs.

---

## 2. Directory map (verified, `src/`)

```
src/
  app/
    (auth)/                     # login, signup, forgot-password — route group, shared layout.tsx
    (dashboard)/                 # every authenticated dashboard page — route group, shared layout.tsx + dashboard-shell.tsx
      dashboard/page.tsx
      contacts/page.tsx
      inbox/page.tsx
      pipelines/page.tsx
      automations/  (list, new, [id]/edit, [id]/logs)
      flows/        (list, [id], [id]/runs)
      broadcasts/   (list, new, [id])
      agents/page.tsx           # AI playground/usage
      notifications/page.tsx
      settings/page.tsx
    join/[token]/page.tsx        # invite-acceptance flow, own layout.tsx
    api/
      account/…                  # account, members, invitations, api-keys, transfer-ownership
      ai/…                       # autoreply, draft, knowledge, playground, usage, config
      automations/…
      flows/…
      contacts/[id]/tags/…
      invitations/[token]/…
      quick-replies/…
      whatsapp/…                 # config, webhook, send, broadcast, media, templates, react
      v1/…                        # the PUBLIC API — see §4
    layout.tsx / page.tsx / icon.tsx / globals.css
  components/
    ui/            # shadcn primitives — button, card, dialog, input, select, tabs, sheet, etc.
    layout/        # sidebar.tsx, header.tsx, mode-toggle.tsx, account-access-alert.tsx
    dashboard/      # metric-card, activity-feed, pipeline-donut, response-time-chart, skeleton, empty-state
    inbox/           # message-bubble, message-composer, message-thread, conversation-list, template-picker, …
    pipelines/       # pipeline-board, deal-card, deal-form, pipeline-settings, pipeline-analytics
    flows/            # flow-builder, flow-canvas (React Flow), flow-editor-state, node-config-form
    automations/     # automation-builder.tsx
    contacts/         # contact-detail-view, contact-form, custom-fields-manager, import-modal
    broadcasts/       # step1..step4 wizard components
    settings/          # one file per settings sub-panel (whatsapp-config, ai-config, members-tab, …)
    interactive/       # WhatsApp interactive-message builder/preview
    presence/           # presence-dot, presence-heartbeat
    tremor/              # local chart wrapper components (not the npm `tremor` package)
  hooks/            # use-auth, use-realtime, use-presence, use-can, use-theme, use-total-unread, …
  i18n/              # next-intl request.ts + message-safety tests
  lib/
    supabase/        # client.ts (browser), server.ts (SSR/server components)
    auth/             # account.ts, api-context.ts, roles.ts, invitations.ts — see §3
    api/v1/            # shared helpers for the public API — pagination.ts, respond.ts, contacts.ts, conversations.ts
    api-keys/          # keys.ts (hash/format), scopes.ts, store.ts
    whatsapp/           # the single largest module — meta-api.ts, send-message.ts, webhook handling, templates, encryption, phone-utils, …
    automations/        # engine.ts, builder-tree.ts, templates.ts, admin-client.ts
    flows/                # engine.ts, edges.ts, validate.ts, templates.ts, admin-client.ts
    ai/                    # generate.ts, embeddings.ts, knowledge.ts, context.ts, providers/{anthropic,openai}.ts
    contacts/              # dedupe.ts, parse-contact-csv.ts, tag-write.ts, tag-events.ts
    dashboard/              # queries.ts, types.ts, date-utils.ts — read this before building the Team dashboard
    webhooks/                # deliver.ts, sign.ts, ssrf.ts, endpoints.ts, events.ts
    rate-limit.ts             # in-memory limiter — see §6, this is a known scaling caveat, not a bug
    currency.ts, themes.ts, utils.ts
  middleware.ts          # session refresh + auth-page redirects — see §3, fragile, has an explicit bug-history comment
  types/index.ts           # the canonical TypeScript shape of every DB entity — read before writing a query
```

Almost every non-trivial `lib/` file has a substantial header comment explaining _why_, not just what. **Match this documentation style** in new files — a one-line JSDoc is not sufficient for anything touching auth, money, or tenant isolation in this codebase.

---

## 3. Auth & tenancy pattern

Two parallel authentication paths, both documented in-code:

- **Dashboard (human) auth** — Supabase cookie session, resolved server-side via `lib/auth/account.ts` (`getCurrentAccount`-style helper). Role comes from `profiles.account_role`, typed as `AccountRole` in `lib/auth/roles.ts`.
- **Public API (`/api/v1/*`) auth** — `lib/auth/api-context.ts`'s `requireApiKey(request, scope)`. No Supabase session exists for an API caller; the key lookup itself establishes `accountId`, and **every downstream query must explicitly filter by that `accountId`** — RLS doesn't help here because the query runs on a service-role client. Read the full header comment in that file before writing any new `/api/v1` route; it explains this discipline directly.

**Roles**: `"owner" | "admin" | "agent" | "viewer"`, ranked in that order (`roleRank` in `lib/auth/roles.ts`). Never compare role strings directly anywhere — always call the existing predicates (`canManageMembers`, `canEditSettings`, `canSendMessages`, `canViewOnly`, `canDeleteAccount`, `canTransferOwnership`) or add a new one there if a task needs a capability that doesn't exist yet. This is explicitly called out in the file as "the single source of truth."

**`middleware.ts`** handles session refresh and auth-page redirects. It carries an explicit comment about a prior production bug (#288: refreshed cookies not propagating on redirect responses, causing wedged sessions after idling) and the fix pattern (`withRefreshedCookies`). Any new redirect branch added to this file must go through that same helper — copy the pattern, don't bypass it.

---

## 4. Public API (`/api/v1`) pattern

Every `/api/v1/*` route follows the same shape (see `app/api/v1/contacts/route.ts` for the reference example):

```ts
try {
  const ctx = await requireApiKey(request, "contacts:read"); // scope string, see lib/api-keys/scopes.ts
  // ctx.supabase  — service-role client
  // ctx.accountId — scope every query by this, explicitly
  ...
} catch (err) {
  return toApiErrorResponse(err);
}
```

Shared helpers already exist for pagination (`lib/api/v1/pagination.ts`) and consistent error/response envelopes (`lib/api/v1/respond.ts`) — use them rather than hand-rolling response shapes in a new route. Any new public-API resource (e.g. `properties`, `site_visits`) should get its own scope constant in `lib/api-keys/scopes.ts` and its own `lib/api/v1/<resource>.ts` helper module, mirroring `contacts.ts` / `conversations.ts`.

---

## 5. i18n — not optional

`next-intl` is wired in, with message files at repo-root `messages/{en,es,ko,pt}.json`. **New user-facing strings go into these files, not inline as hardcoded English**, or the existing i18n test suite (`i18n/messages.test.ts`, `i18n/icu-safety.test.ts`) will fail and the string will silently not translate. For an MVP timeline, at minimum update `en.json` for every new string and leave the other three for a follow-up task — but always go through the message-key mechanism, never a raw string in JSX.

---

## 6. Known, intentional trade-offs (don't "fix" these without a scaling need)

- **`lib/rate-limit.ts` is in-memory, single-process.** The file's own header comment states this is a deliberate trade-off for a single-instance VPS deployment (the template's default target) and explicitly says to swap to Redis/Upstash only if horizontal scaling is introduced, keeping the same return shape. Don't silently rewrite this unless a task specifically calls for horizontal scaling.
- **Deal/Pipeline account-scoping**: `types/index.ts` shows `Pipeline` and `Deal` carrying `user_id`, not an explicit `account_id` field on the TypeScript type — unlike `Contact` and `CustomField`, which do show `account_id`. **Before extending the pipelines/deals schema (Section D of the implementation plan), check migrations 017/040 and the live schema directly** to confirm how tenancy is actually enforced for these two tables (join through `user_id` → account, or a column the type just hasn't been updated to reflect) rather than assuming either way.
- **`profiles.role`** (the free-form legacy column from migration 001) is dead code per its own doc-comment — never read it; use `profiles.account_role` (migration 017) instead.

---

## 7. Design tokens — reuse, don't reinvent

`src/app/globals.css` already defines a full shadcn-style CSS variable token set: `--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`, `--border`, `--input`, `--ring`, `--sidebar*` (7 variables for the sidebar specifically), and `--chart-1` through `--chart-5`. **A mobile design pass should extend this existing token set with a small number of new semantic variables** (e.g. status-pill colors for the real estate pipeline stages, SLA-badge thresholds) rather than introducing a parallel token system — `components.json` confirms `cssVariables: true` and `baseColor: "neutral"` as the established convention.

---

## 8. Local setup (from `CONTRIBUTING.md`, verified against `.env.local.example`)

```bash
cp .env.local.example .env.local   # fill in Supabase + Meta creds
npm install
npm run dev
```

Required env vars (from `.env.local.example`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY`, `META_APP_SECRET`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_APP_LOCALE`.
