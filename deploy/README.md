# Deploying wacrm + listmonk as one product

One domain, one login, one contact database — two engines underneath
that your users never see as separate.

```
        crm.example.com          (Caddy — one door, automatic HTTPS)
                 │
      ┌──────────┴───────────┐
      │                      │
  wacrm (Next.js)      listmonk (Go)
  the only UI  ──API──▶ email engine, headless
      │                      │
  Supabase              listmonk-db
  (external)            (in this stack)
```

## Why two services instead of one merged app

Two reasons, and they point the same way.

**Technical.** listmonk is a compiled Go binary that serves its own Vue
frontend. wacrm is a Next.js app. There is no process to merge them
into — "one codebase" would mean rewriting one of them.

**Legal.** listmonk is AGPL-3.0; wacrm is MIT. Running listmonk as an
_unmodified upstream image_ that you call over HTTP keeps the AGPL
scoped to listmonk itself — which is already public — and leaves your
wacrm fork MIT and yours. Vendoring or forking listmonk's source into
your repo would pull your whole product under AGPL, obliging you to
publish it to anyone who uses the hosted service. This stack is built
to keep that boundary intact, and `docker-compose.yml` pins an official
image rather than building from source for exactly that reason.

You still get one product. The seam is invisible to users.

## Try it locally first (one command)

Runs the whole thing on your machine, production-shaped, against the
local Supabase from `npx supabase start`:

```bash
cd deploy
cp .env.example .env        # fill in; point NEXT_PUBLIC_SUPABASE_URL
                            # at your machine's LAN IP, not localhost
docker compose -f docker-compose.local.yml up -d --build
COMPOSE_FILE=docker-compose.local.yml sh setup-api-user.sh
# paste the token into .env, then:
docker compose -f docker-compose.local.yml up -d
```

Open **http://localhost:8090**. Change the port with `HOST_PORT` in
`.env` if that one is taken.

> **Why the LAN IP.** `NEXT_PUBLIC_SUPABASE_URL` is compiled into the
> browser bundle, so it must be an address the *browser* can reach —
> which rules out `localhost` (inside a container that means the
> container) and `host.docker.internal` (doesn't resolve in a
> browser). Your machine's LAN IP works for both.

## What you need

- A VPS with Docker and Docker Compose (1 GB RAM works; 2 GB is
  comfortable)
- A domain with an A record pointed at it
- A Supabase project — free tier is fine
- An SMTP provider for outbound email (Amazon SES, Postmark, Mailgun,
  Resend…). listmonk sends through it; it is not a mail server itself.

## Setup

### 1. Supabase

Create a project, then apply the CRM schema (40 migrations, including
`040_email_steps.sql` which this integration adds):

```bash
supabase link --project-ref <your-ref>
supabase db push
```

### 2. Configure

```bash
cd deploy
cp .env.example .env
$EDITOR .env
```

Generate the two secrets it asks for:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"  # ENCRYPTION_KEY
openssl rand -hex 24                                                       # LISTMONK_DB_PASSWORD
```

Leave `LISTMONK_API_TOKEN` blank for now — it doesn't exist yet.

### 3. First boot

```bash
docker compose up -d --build
```

listmonk creates its schema and admin user on first start.

### 4. Create the API user wacrm authenticates as

```bash
sh setup-api-user.sh
```

Paste the printed `LISTMONK_API_TOKEN` into `.env`, then:

```bash
docker compose up -d
```

> **Why this is its own step.** listmonk's API users are not the same
> as its login users — an admin password is rejected by the API with
> `invalid API credentials`. And listmonk **caches API users in memory
> at boot**, so creating one requires a restart before it's accepted.
> The script does both in the right order; doing it by hand and
> skipping the restart produces a correct-looking token that fails.

### 5. Point SMTP at your provider

Open `https://crm.example.com/email-admin/` → **Settings → SMTP**, and
enter your provider's host, port, and credentials. Send the test
message. Nothing sends until this is done.

### 6. Set up WhatsApp

Sign in to the CRM → **Settings → WhatsApp**, and enter your phone
number ID, WABA ID, and permanent access token. Set the Meta webhook
URL to:

```
https://crm.example.com/api/whatsapp/webhook
```

### 7. Schedule the cron drains

Automation and flow **Wait** steps need an external pinger — nothing
inside the stack schedules itself. Add to the host's crontab:

```cron
*/5 * * * * curl -fsS -H "x-cron-secret: $AUTOMATION_CRON_SECRET" https://crm.example.com/api/automations/cron
*/5 * * * * curl -fsS -H "x-cron-secret: $AUTOMATION_CRON_SECRET" https://crm.example.com/api/flows/cron
```

Both return 503 until `AUTOMATION_CRON_SECRET` is set.

## What "one platform" means here

Every email capability is a native page or step inside the CRM. There
is no second admin panel and no second login.

| Where | What |
|---|---|
| **Email → Campaigns** | Newsletters: compose, preview, test-send, send, track |
| **Email → Lists** | Mailing lists + **Sync contacts** (CRM → subscribers) |
| **Email → Templates** | *Automation emails* (complete emails with a subject, used by automations and flows) and *Newsletter layouts* (wrappers around a campaign body) |
| **Email → Settings** | SMTP credentials, sender identity, test send |
| **Automations** | Two new steps: **Send Email** and **Add to Mailing List** — alongside the WhatsApp steps, in the same builder |
| **Flows** | New **Send email** node — alongside the WhatsApp nodes, on the same canvas |

So one journey can mix channels:

```
Trigger: new contact
  → Send WhatsApp message   "Thanks for reaching out!"
  → Add to Mailing List     Newsletter
  → Wait                    1 day
  → Send Email              "Your brochure" (personalised)
```

Email steps read the contact's email from the CRM. A contact with **no
email address is skipped, not failed** — the run continues, and the
log says `skipped: contact has no email address`. WhatsApp-only
contacts hitting an email step is a normal case, not a broken
automation.

Inside an automation email, these are filled in per recipient:

```
{{ .Tx.Data.contact.first_name }}   {{ .Tx.Data.contact.name }}
{{ .Tx.Data.contact.email }}        {{ .Tx.Data.contact.phone }}
{{ .Tx.Data.contact.company }}      {{ .Tx.Data.vars.<flow variable> }}
{{ .Tx.Data.message.text }}          (the inbound WhatsApp text, automations only)
```

## Using it

Everything is under one login at your domain:

| Path                 | What                                             |
| -------------------- | ------------------------------------------------ |
| `/inbox`             | WhatsApp shared inbox                            |
| `/contacts`          | Contacts — the source of truth for both channels |
| `/email`             | Campaigns, composed and sent from the CRM UI     |
| `/email/lists`       | Mailing lists + **Sync contacts**                |
| `/email/subscribers` | Subscribers, showing which are also CRM contacts |
| `/email-admin/`      | listmonk's own admin — SMTP, bounces, analytics  |

**The sync is the join.** _Email → Lists → Sync contacts_ copies CRM
contacts into a mailing list as subscribers, carrying the contact id
and phone number in listmonk's `attribs` field. That is what lets you
segment on CRM facts from inside listmonk, e.g.:

```sql
subscribers.attribs->>'source' = 'wacrm'
```

Contacts with no email address cannot become subscribers; the sync
reports how many were in that position rather than quietly dropping
them.

## Testing email delivery locally (no real SMTP needed)

The local Supabase stack includes **Mailpit**, a mail catcher with an
inbox at <http://127.0.0.1:54324>. Point the email engine at it and
every email the CRM sends lands there instead of the internet:

```bash
# let the engine reach Mailpit's SMTP port (one-off; redo after `down`)
docker network connect supabase_network_wacrm deploy-listmonk-1
```

Then in the CRM: **Email → Settings** → host `supabase_inbucket_wacrm`,
port `1025`, encryption `none`, authentication `none` → Save → Send test.
Open <http://127.0.0.1:54324> and it is there. This is how the
end-to-end proof for this integration was run.

## Operating notes

- **One WhatsApp number per account.** `whatsapp_config` is unique per
  account (and per phone number id). Inbound messages for a number
  that is not configured are dropped with a `No config found for
  phone_number_id` line in the CRM's logs — check that first if
  automations "don't fire".

- **Why not Mautic as well?** It was evaluated for this stack. Mautic
  would add a third engine (PHP + MySQL + cron + worker, ~1 GB RAM) with
  its own UI and its own `/api` — the same collision that forced
  listmonk off the shared origin — to provide automations and flows the
  CRM already has. Adding email steps to the CRM's own builders gives
  the same outcome inside one product. Mautic's GPL-3.0 carries the
  same copyleft concern as listmonk's AGPL if it were fused rather than
  isolated. It is not part of this deployment.
- **listmonk is not published to the host.** Only Caddy reaches it.
  The `/email-admin/` route is the one way in from outside — delete
  that block from the `Caddyfile` to close it entirely; the Email
  section keeps working, since wacrm talks to listmonk over the
  internal Docker network.
- **Unsubscribe and tracking links must stay reachable.** The
  `/subscription/*`, `/link/*`, `/campaign/*` and `/archive` routes in
  the `Caddyfile` are what recipients hit. A dead unsubscribe link is a
  spam-complaint magnet and, under CAN-SPAM and GDPR, a legal problem.
- **One listmonk instance backs one wacrm account.** listmonk is
  single-tenant. wacrm tags the lists it creates with the account id,
  which makes ownership legible, but it is **not** a security boundary.
  Do not point two customers' accounts at one listmonk.
- **Email deliverability is DNS work, not code.** Set SPF, DKIM and
  DMARC for your sending domain at your provider. Skipping this is the
  single most common reason campaigns land in spam.

## Backups

Two databases, two backups:

```bash
# listmonk
docker compose exec -T listmonk-db pg_dump -U listmonk listmonk | gzip > listmonk-$(date +%F).sql.gz
```

Supabase handles its own (Dashboard → Database → Backups; daily on
paid plans — on free tier, take your own with `supabase db dump`).

## Troubleshooting

**`npm ci` fails during build with "package.json and package-lock.json
are not in sync".** The lockfile must be the one committed to the repo.
npm 11 prunes optional-peer entries that the build image's npm 10 still
expects, so a local `npm install` on a newer npm can desync it. Restore
it before building:

```bash
git checkout -- package-lock.json
```

**`invalid API credentials` from the Email section.** Either the API
user isn't type `api`, or listmonk wasn't restarted after it was
created — it caches API users at boot. Re-run `setup-api-user.sh`,
which does both.

## Updating

```bash
git pull
docker compose up -d --build
```

listmonk's image is pinned to a specific version. Bump it in
`docker-compose.yml` deliberately and read that release's notes first —
an unattended major upgrade is not something a mailing list should
discover for you.
