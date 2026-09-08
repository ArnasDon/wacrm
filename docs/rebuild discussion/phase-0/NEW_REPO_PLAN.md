# NEW_REPO_PLAN — Canonical Nexara WACRM Repository

Neither existing repo is canonical: `wacrm` = public-upstream fork (MIT, upstream history); `nexara-repo-framework` = private framework. Create a **new canonical repo** merging both.

## Target layout
```
apps/
  web/            Next.js 16 + shadcn (port of current wacrm UI)
  mobile/         Expo + React Native (later)
nexara/           framework base (from nexara-repo-framework src/core)
  container/  providers/  auth/  permissions/  events/  billing/  observability/
modules/          WACRM business (ported from wacrm src/lib + src/app)
  identity/ organizations/ billing/ meta-onboarding/ whatsapp/
  contacts/ conversations/ messages/ inbox/ broadcasts/ automation/
packages/
  domain/  contracts/(zod)  api-client/
db/               schema + forward-only migrations (D1 or Neon)
scripts/          check-architecture.mjs (re-pointed at nexara/ + modules/)
tests/            vitest + playwright
```
Tooling: pnpm workspaces + Turborepo. Node ≥20. Guard blocking in CI.

## Merge method
1. Init new repo. Copy `nexara-repo-framework/src/core|shared|infrastructure` → `nexara/`. Bump Next 15.3 → 16.2 / React 19.2 to match wacrm.
2. Port wacrm features from `src/lib/*` + `src/app/*` into `modules/*` (domain/application/infrastructure/presentation). **Port code, not fork lineage** — do not carry upstream git history into the new canonical repo.
3. Move shared types + zod contracts into `packages/domain` + `packages/contracts`; web + mobile + server consume them.
4. Re-point `check-architecture.mjs` allow-list to `nexara/*/providers`, `nexara/container`, `apps/*/_services`. Keep rules: no SDK leakage, no SQL in services, tenant_id on every infra SQL.
5. **License/attribution:** wacrm is MIT — retain the upstream `LICENSE` + copyright notice for ported code as MIT requires. Add Nexara's own license/notice for new code. Record provenance in a `NOTICE` file.

## Deploy carry-over
Custom domain `wacrm.nexaragroups.com`, Workers Paid, KV `NEXARA_KV`, Queue `wacrm-jobs`, D1 `wacrm-db` already in wrangler.toml. Reconcile routes+secrets vs CF dashboard before first deploy.

## Decision needed
Repo hosting: new repo under `nexara-groups` org (origin), private. Confirm name (e.g. `nexara-wacrm`).
