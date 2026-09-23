# Repo Operations — Fork, Sync, Environments, CI/CD

Everything here is verified against what's actually in the repo — the
existing `.github/workflows/`, `Dockerfile`, `docker-compose.yml`, and
`docs/docker.md` — not a generic template. Where this doc proposes
something that doesn't exist yet (a deploy pipeline), it's flagged
explicitly as new.

---

## 1. Fork setup & remotes

You're building on top of `ArnasDon/wacrm`. Set up two remotes so you
can keep pulling upstream fixes without losing your customizations:

```bash
git clone https://github.com/<your-org>/<your-fork>.git
cd <your-fork>
git remote add upstream https://github.com/ArnasDon/wacrm.git
git remote -v
# origin    → your fork (push/pull)
# upstream  → the original template (pull only, never push)
```

### Two things to fix immediately after forking — both currently point at the upstream maintainer, not you

- **`.github/CODEOWNERS`** currently requires `@ArnasDon` as a reviewer on every PR (paired with a branch-protection rule, per the file's own comment). On your fork this either blocks every PR on a reviewer who'll never approve, or silently does nothing if you haven't mirrored that branch-protection rule. Change it to your own team/handle.
- **`.github/dependabot.yml`** lists `ArnasDon` as the reviewer for both the npm and GitHub Actions update groups. Change both `reviewers:` blocks to your team, or Dependabot PRs will request review from someone outside your org.

---

## 2. Pulling upstream fixes into your fork

Do this periodically (e.g. monthly, or when you know upstream shipped a
security fix) — on a dedicated branch, never directly onto `main`:

```bash
git fetch upstream
git checkout -b sync/upstream-$(date +%Y-%m-%d)
git merge upstream/main
```

**Why this tends to stay clean**: `docs/agent/AGENT_GUARDRAILS.md`
already establishes that your agent-driven work adds new files
(new routes, new `lib/` modules, new migrations numbered _after_ the
current highest) rather than rewriting existing ones. Upstream's
changes and your changes are then mostly touching different files,
which is what keeps a merge low-conflict over time. The files most
likely to actually conflict are ones you were told to treat as
sensitive anyway — `middleware.ts`, `lib/rate-limit.ts`,
`lib/auth/*` — so a conflict there is a signal to review carefully,
not just accept-theirs/accept-yours.

**On conflict:**

1. Never blindly take "theirs" on `supabase/migrations/*` — if upstream added a migration file with the same number range as one of yours, renumber **yours** to come after theirs; never renumber a file that's already merged to your `main` and potentially applied to a real database.
2. Run the full CI checks locally (`npm run lint && npm run typecheck && npm run test && npm run build`, plus `supabase db reset --local --no-seed` — see §5) before opening the sync PR.
3. Open the sync as a normal PR through your usual review process — don't merge it directly, even though it's "just" a sync.

---

## 3. Local development setup

```bash
git clone https://github.com/<your-org>/<your-fork>.git
cd <your-fork>
cp .env.local.example .env.local     # fill in the values below
npm install
npm run dev                            # Turbopack dev server, localhost:3000
```

### Env vars (from `.env.local.example` — the exact set the app reads)

| Variable                        | Where it comes from                                                                                                                                                    |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Your local/dev Supabase project settings                                                                                                                               |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same                                                                                                                                                                   |
| `SUPABASE_SERVICE_ROLE_KEY`     | Same — **never** exposed client-side, server-only                                                                                                                      |
| `ENCRYPTION_KEY`                | Generate a random 64-char hex string yourself (used to encrypt stored WhatsApp/AI credentials at rest — see `lib/whatsapp/encryption.ts`)                              |
| `META_APP_SECRET`               | Your Meta Business App, once registered (see `docs/multi-waba.md`)                                                                                                     |
| `NEXT_PUBLIC_SITE_URL`          | `http://localhost:3000` locally                                                                                                                                        |
| `NEXT_PUBLIC_APP_LOCALE`        | One of `en \| ko \| pt \| es` — this is **baked into the client bundle at build time** (see `docs/docker.md`), so switching it means a rebuild, not just an env change |

### Local Supabase

Don't point local dev at your production Supabase project. Either:

- **Cloud, dev-tier project** — simplest, create a second free-tier Supabase project dedicated to local dev, run migrations against it.
- **Supabase CLI, fully local** — `supabase start` runs Postgres + Studio in Docker on your machine; this is also exactly what `.github/workflows/migrations.yml` does in CI (see §5), so it's the closest thing to a guaranteed-clean environment.

Run every migration against whichever you choose, in order:

```bash
supabase db reset --local --no-seed     # if using the CLI's local stack
# or apply supabase/migrations/*.sql in order via the Studio SQL editor
# against a cloud dev project
```

### Folder/environment layout recommendation

Keep one `.env.local` per machine (git-ignored, never committed — confirm this against `.gitignore`), and track the **shape** of required vars only via `.env.local.example`. Don't create `.env.staging` / `.env.production` files in the repo itself; those values belong in your hosting platform's secret store (§6), not in git, even encrypted.

---

## 4. Remote environments (staging + production)

Mirror local, but as three fully separate Supabase projects and, ideally, separate Meta test numbers so a bug in staging can't touch a real client's WhatsApp number:

| Environment | Supabase project      | Meta number         | Purpose                                |
| ----------- | --------------------- | ------------------- | -------------------------------------- |
| Local       | dev-tier or CLI-local | Meta test number    | day-to-day development                 |
| Staging     | dedicated project     | second test number  | pilot agency, pre-release verification |
| Production  | dedicated project     | real client numbers | paying customers                       |

Each environment's env vars live in that environment's hosting platform (Vercel project settings, or your container host's secret manager) — never in a repo file, per §3.

---

## 5. CI — what already exists (don't rebuild this, extend it)

Two workflows already run in `.github/workflows/`:

### `ci.yml` — on every PR and push to `main`

Runs, in order: `npm ci` → `npm run lint` → `npm run typecheck` → `npm test` → `npm run build`, using dummy placeholder env vars (documented in the workflow's own comments) so the build's non-null assertions on Supabase config are satisfied without touching a real service.

### `migrations.yml` — on any PR/push touching `supabase/**`

Boots a real Postgres in a container via the Supabase CLI (pinned to `2.113.0` — a deliberate pin, not staleness, per the file's own comment), runs `supabase db reset --local --no-seed` to replay **every** migration from an empty database in filename order, then asserts the resulting schema with `supabase/ci/verify-schema.sql`. The workflow's own header comment explains this replaced a previously broken "Supabase Preview" check that silently never applied a single migration — this is your real safety net for schema changes, not a formality.

**Action needed, not code**: confirm branch protection on `main` actually requires both these checks (and CODEOWNERS review) to pass before merge — a workflow existing in `.github/workflows/` does not by itself block a merge; that's a separate GitHub repo setting (Settings → Branches → branch protection rule → "Require status checks to pass").

**When adding a new migration** (Sections D, E, F, L of `IMPLEMENTATION_PLAN.md`), `migrations.yml` runs automatically — you don't need a new workflow, just a correctly-numbered file in `supabase/migrations/`.

---

## 6. CD — this does not exist yet; you need to add it

There's no deploy workflow in `.github/workflows/` today. Two reasonable paths, given what's already in the repo:

### Option A — container deploy (fits the existing `Dockerfile` directly)

Add `.github/workflows/deploy.yml`: on push to `main` (after `ci.yml` passes), build the image using the existing multi-stage `Dockerfile`, push to a registry (GitHub Container Registry is the path of least friction — no extra account, auth via `GITHUB_TOKEN`), then trigger your host to pull the new image (a webhook, a `docker compose pull && up -d` over SSH, or your platform's own image-based deploy). Remember from `docs/docker.md`: `NEXT_PUBLIC_*` vars are build args, baked in at image-build time — the workflow needs them as build secrets, and changing one means a new image, not just a restart.

### Option B — platform deploy (Vercel or similar)

Skip the Docker path for the app itself and connect the repo directly to Vercel's own GitHub integration — it deploys on push to `main` automatically without a custom workflow. This is less work to set up but means maintaining `Dockerfile`/`docker-compose.yml` purely for self-hosting docs/local parity rather than as your actual deploy path — decide this deliberately rather than ending up with two half-maintained deploy stories.

**Recommendation**: since the repo already treats the Dockerfile as a first-class, documented deploy path (`docs/docker.md` is detailed and clearly maintained), Option A is more consistent with the existing project's own choices — but either works. Whichever you pick, gate it behind `ci.yml` and `migrations.yml` passing first, never deploy on a red build.

### Either way, add this before your first paying customer

- A staging deploy triggered on push to a `staging` branch, separate from the production deploy on `main` — gives you a place to run the pilot (per `IMPLEMENTATION_PLAN.md` Section N) without touching real client data.
- A rollback plan: for Option A, keep the previous image tag available and know the one command to redeploy it; for Option B, use the platform's built-in instant-rollback feature.

---

## 7. Suggested branch strategy, tied to the implementation plan

```
main         → production, protected, deploys automatically (§6)
staging      → optional, mirrors main for pilot testing
section/C    → one branch per IMPLEMENTATION_PLAN.md section (per its own Section-0 rule:
section/D       one section = one branch = one PR)
section/E
...
sync/upstream-YYYY-MM-DD   → periodic upstream merges (§2), never long-lived
```

Merge each `section/*` branch to `main` (or `staging` first, if you're running one) only after `ci.yml` and `migrations.yml` are both green and `PROGRESS.md` is updated — per the workflow already defined in `docs/agent/AGENT_GUARDRAILS.md`.
