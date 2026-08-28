# Supabase keep-alive heartbeat

`GET`/`POST /api/internal/heartbeat` runs one minimal, read-only query
against Supabase (`accounts` — `select('id').limit(1)`) so a free or
idle project doesn't get paused for inactivity. It has no CRM
functionality of its own and does nothing unless something calls it —
see the route's own doc comment
([src/app/api/internal/heartbeat/route.ts](../src/app/api/internal/heartbeat/route.ts))
for the full design rationale.

It is **not** triggered by anything in the browser (no
`setInterval`, no client-side timer) — it only runs when an external
scheduler makes an HTTP request to it. Pick ONE of the two options
below; either fully satisfies "runs even when nobody has the CRM
open."

## 1. Configure the secret

Set `HEARTBEAT_SECRET` in your deployment's environment variables
(same place you set `SUPABASE_SERVICE_ROLE_KEY`, etc. — Vercel
project settings, hPanel, your `.env` on a VPS/Docker host). Generate
one with:

```bash
openssl rand -hex 32
```

Any long random string works — it's compared with a constant-time
check, never logged, never sent to the browser. The endpoint returns
`503` until this is set, so nothing runs unauthenticated by accident.

## 2. Point a scheduler at it

### Option A — Vercel Cron (only if you're deployed on Vercel)

A [`vercel.json`](../vercel.json) at the repo root already declares:

```json
{
  "crons": [{ "path": "/api/internal/heartbeat", "schedule": "0 0 * * *" }]
}
```

This ships with your next deploy automatically — no dashboard step to
enable it. Two things to know:

- **Frequency**: the schedule above is once a day (`0 0 * * *`,
  midnight UTC). That's deliberate — Vercel's **Hobby** plan caps
  cron jobs to at most once per day regardless of what you configure,
  so this is the schedule that works unmodified on every Vercel plan.
  It's still far more than enough: Supabase pauses free projects
  after about a week of zero API activity, not a day. If you're on
  **Pro or higher** and want a bigger safety margin, change the
  schedule to e.g. `0 */6 * * *` (every 6 hours) or `0 */12 * * *`
  (every 12) — no other change needed.
- **Auth**: Vercel's cron trigger does not let you attach a custom
  `Authorization` header per job. Instead, Vercel has its own
  convention: if you set an environment variable named `CRON_SECRET`,
  Vercel automatically sends `Authorization: Bearer <CRON_SECRET>` on
  every cron-triggered request. To make that line up with this
  endpoint's own `HEARTBEAT_SECRET` check, **set `CRON_SECRET` to the
  exact same value as `HEARTBEAT_SECRET`** in your Vercel project's
  environment variables. No code change needed either way.

If you're not certain your plan/setup actually fires Vercel Cron
reliably (it's silently a no-op on some preview/misconfigured
projects), verify with Option B's manual test below, or use Option C
instead — nothing about this app requires Vercel specifically.

### Option C — External scheduler (works regardless of where you host)

This is the **more robust choice if you're not sure you're on Vercel,
or on a Hobby plan and want tighter-than-daily coverage**: it doesn't
depend on your hosting platform, your Vercel plan tier, or (unlike a
GitHub Actions `schedule:` workflow) on the repository itself having
recent pushes — GitHub auto-disables scheduled workflows after 60
days of repo inactivity, which is exactly the kind of quiet period a
keep-alive is meant to survive. A dedicated external cron service has
none of these caveats.

[cron-job.org](https://cron-job.org) is free and needs no server of
your own:

1. Create a free account.
2. **Create cronjob** → URL: `https://YOUR-DOMAIN/api/internal/heartbeat`
3. **Schedule**: every 6–12 hours (e.g. "Every 6 hours").
4. **Advanced → Request headers** → add:
   - Name: `Authorization`
   - Value: `Bearer YOUR_HEARTBEAT_SECRET`
5. Request method: `GET` (or `POST` — both work).
6. Save. cron-job.org shows the last execution's HTTP status and lets
   you trigger one manually to confirm it works.

Any similar service (EasyCron, healthchecks.io's ping+cron combo,
your own VPS's `crontab` with `curl`, ...) works the same way — the
only requirements are: hit the URL on a schedule, send the
`Authorization: Bearer <HEARTBEAT_SECRET>` header.

You can run BOTH Option A and Option C at once — they're independent
and idempotent (each call is just a read), so there's no harm in
belt-and-braces coverage.

## Verifying it's actually working

- **From the scheduler's own dashboard**: Vercel → your project →
  Cron Jobs tab shows each run's timestamp and status. cron-job.org's
  job page shows the same.
- **From Supabase**: project dashboard → Database → look at recent
  API/database activity — you should see a request roughly every
  time the scheduler fires.
- **Manually, without exposing the secret in shell history**: see
  below.

## Testing the endpoint manually (without leaking the secret)

Don't paste the raw secret into a command that lands in your shell
history or a screen-shared terminal. Instead:

```bash
read -s HEARTBEAT_SECRET   # prompts, doesn't echo, doesn't get logged
curl -X GET "https://YOUR-DOMAIN/api/internal/heartbeat" \
  -H "Authorization: Bearer $HEARTBEAT_SECRET"
```

A working call returns `200` with `{"ok":true,"message":"Supabase
heartbeat succeeded.",...}`. `401` means the secret sent doesn't
match `HEARTBEAT_SECRET` on the server; `503` means `HEARTBEAT_SECRET`
isn't set in that deployment's environment yet.
