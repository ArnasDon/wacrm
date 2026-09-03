# Deploying to Railway

This guide deploys the full app to [Railway](https://railway.com). The app
is a full-stack **Next.js 16** server (32 API routes, a WhatsApp webhook,
SSR auth) — it must run as a long-lived Node process, **not** a static
site. Your database/auth/storage stays on **Supabase** (managed); Railway
only runs the Next.js app.

A `railway.json` at the repo root pins the build/start commands, so a
freshly connected service is reproducible.

---

## Prerequisites

- A GitHub account with this repo (a fork is fine).
- A [Railway](https://railway.com) account.
- Your existing **Supabase** project (URL + anon key + service-role key).
- A **Meta for Developers** app with WhatsApp configured (App Secret, and
  App ID if you submit image-header templates).
- Node ≥ 20 locally if you want to generate secrets.

> **FFmpeg**: inbox voice notes transcode browser recordings to Ogg/Opus
> server-side (`/api/media/voice-note`). The service builds with the repo's
> **Dockerfile** (`railway.json` → `builder: DOCKERFILE`), which installs
> FFmpeg in its runtime stage — nothing to configure. Don't switch back to
> the Nixpacks builder: its generated plan ignored `nixpacks.toml` and
> shipped images without FFmpeg, while baking runtime secrets into
> build-arg layers.

---

## 0. Pre-flight: rotate secrets (recommended)

`.env.local` is gitignored and was never committed, so nothing leaked to
GitHub. Still, treat any secret that has been shared (chat, screen-share,
old laptops) as compromised and rotate before going live:

- **Supabase keys** — Supabase Dashboard → Project Settings → API →
  regenerate the `anon` and `service_role` keys.
- **`ENCRYPTION_KEY`** — generate a fresh 32-byte hex value:

  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```

  > ⚠️ Rotating `ENCRYPTION_KEY` orphans every WhatsApp token already
  > encrypted under the old key — affected users must re-save their
  > WhatsApp settings to reconnect. On a brand-new deploy with no live
  > tokens this is harmless. If you already have connected numbers, keep
  > the current key instead.

- **`AUTOMATION_CRON_SECRET`** — generate a long random string:

  ```bash
  openssl rand -hex 32
  ```

Never paste any of these into the repo. They go in the Railway dashboard
(next section).

---

## 1. Create the Railway service

1. Railway → **New Project** → **Deploy from GitHub repo**.
2. Select this repository.
3. If the Next.js app lives in a subdirectory of the repo (e.g. `wacrm/`),
   open the service → **Settings** → set **Root Directory** to that
   subdirectory so `railway.json` and `package.json` are found.
4. Railway auto-detects Next.js via Nixpacks and reads `railway.json` for
   the build (`npm ci && npm run build`) and start (`npm run start`)
   commands. Don't override them.

Railway injects a `PORT` env var at runtime; `next start` binds to it
automatically — no extra configuration needed.

---

## 2. Environment variables

Add these under the service → **Variables**. Mark nothing as "public" by
hand — the `NEXT_PUBLIC_*` prefix already controls client exposure.

### Required (app won't start without these)

| Variable                        | Where to get it                                                            |
| ------------------------------- | -------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase → Project Settings → API → Project URL                            |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → `anon` key                             |
| `SUPABASE_SERVICE_ROLE_KEY`     | Supabase → Project Settings → API → `service_role` key (**server secret**) |
| `ENCRYPTION_KEY`                | 64 hex chars (see step 0) — encrypts WhatsApp tokens                       |
| `META_APP_SECRET`               | Meta for Developers → App Settings → Basic → App Secret                    |

### Recommended

| Variable                 | Value                                                                                                                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_SITE_URL`   | Your canonical public URL, e.g. `https://crm.example.com` (no trailing slash). Used for sitemap/OG and for links built without an incoming request (cron). Set after you know your domain (step 4), then redeploy. |
| `AUTOMATION_CRON_SECRET` | Long random string (see step 0). Protects the two cron endpoints. Required if you use automation **Wait** steps or want the flow stale-run sweep.                                                                  |

### Optional (only if you use the feature)

| Variable               | Purpose                                                                                                                                            |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `META_APP_ID`          | Needed only to submit message templates with an **image** header.                                                                                  |
| `ALLOWED_INVITE_HOSTS` | Comma-separated hostname allow-list for invite URLs (defense-in-depth on multi-host setups). Usually unnecessary if `NEXT_PUBLIC_SITE_URL` is set. |

---

## 3. First deploy

Trigger the deploy (Railway does this automatically on connect, and on
every push to the connected branch). Watch the build logs:

1. `npm ci` installs dependencies.
2. `npm run build` runs the Next.js production build (includes typecheck).
3. `npm run start` boots the server.

When it's live, Railway gives you a `*.up.railway.app` URL. Open it and
confirm the login page renders.

---

## 4. Custom domain

1. Service → **Settings** → **Networking** → **Custom Domain**, add your
   domain and create the CNAME record Railway shows at your DNS provider.
2. Once it resolves (TLS is automatic), set `NEXT_PUBLIC_SITE_URL` to the
   `https://` form of that domain and **redeploy** so the value bakes into
   the client build.

---

## 5. Schedule the two cron endpoints

The app exposes two scheduled endpoints that need an external pinger:

- `GET /api/automations/cron` — drains automation **Wait** steps.
- `GET /api/flows/cron` — sweeps stale flow runs.

Both require the header `x-cron-secret: <AUTOMATION_CRON_SECRET>`.

### Option A — Railway Cron service (keeps everything on Railway)

1. In the same project → **New** → **Empty Service** (or a small Docker /
   shell service).
2. Give it the **same** `AUTOMATION_CRON_SECRET` variable, plus your app's
   public URL as e.g. `APP_URL`.
3. Set a **Cron Schedule** (service → Settings → Cron Schedule), e.g.
   `*/5 * * * *` (every 5 minutes), and a start command that curls both
   endpoints:

   ```bash
   curl -fsS -H "x-cron-secret: $AUTOMATION_CRON_SECRET" "$APP_URL/api/automations/cron"; \
   curl -fsS -H "x-cron-secret: $AUTOMATION_CRON_SECRET" "$APP_URL/api/flows/cron"
   ```

   A Railway cron service runs the command on the schedule, then exits.

### Option B — External scheduler

Use a free service like [cron-job.org](https://cron-job.org) or a GitHub
Actions scheduled workflow to issue the same two authenticated `GET`s on
your interval. Every 1–5 minutes is typical.

> If you don't use Wait steps and don't care about the stale-run sweep,
> you can skip cron entirely — the rest of the app works without it.

---

## 6. Wire up the Meta WhatsApp webhook

1. In your Meta app → WhatsApp → Configuration, set the **Callback URL** to:

   ```
   https://<your-domain>/api/whatsapp/webhook
   ```

2. Set the **Verify Token** to whatever your WhatsApp settings expect (set
   during in-app onboarding), and subscribe to the message-related fields.
3. Confirm `META_APP_SECRET` in Railway matches the app — the webhook
   rejects any POST whose HMAC-SHA256 signature doesn't verify.

---

## 7. End-to-end verification

- [ ] App loads at your domain; login/signup page renders.
- [ ] You can sign up / sign in (Supabase auth round-trips).
- [ ] Settings → connect a WhatsApp number succeeds.
- [ ] Sending a test message works; an inbound reply appears in the Inbox
      (confirms the webhook reaches `/api/whatsapp/webhook`).
- [ ] A manual `curl` to `/api/automations/cron` with the secret header
      returns `200` (cron path healthy).

---

## Notes & gotchas

- **Not static.** Static hosts (GitHub Pages, S3, Netlify static) cannot
  run this app — the API routes and webhook need a Node server.
- **Supabase is separate.** Railway runs only the app; do not provision a
  Postgres add-on. All data/auth/storage stays in your Supabase project,
  which enforces Row-Level Security.
- **Secrets live in Railway**, never in the repo. `.env.local` is for local
  development only and is gitignored.
- **Redeploys on push.** Every push to the connected branch rebuilds.
  Server secrets persist across deploys; `NEXT_PUBLIC_*` values are baked
  into the client bundle at build time, so changing them requires a
  redeploy.
