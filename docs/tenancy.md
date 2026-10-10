# Tenant model

> **Status of the isolation claim in this document.** The RLS policies on the four
> tables named below were read and confirmed to predicate access on `auth.uid()`,
> and the proxy's role was read to be attribution only. **This covers 4 of the 27
> tables that carry `account_id` — not all of them.** A behavioural check with real
> users is still `UNVERIFIED` — see
> [Scope of this evidence](#scope-of-this-evidence--read-before-drawing-conclusions)
> and [Isolation verification](#isolation-verification). Nothing in this document
> should be read as proof that isolation holds at runtime; it documents the
> *mechanism*, names how much of it was checked, and names the proof that is
> still owed. Every claim below is tagged `READ` (read from a file in this repo),
> `MEASURED` (something was executed, and the command is named), or `INFERRED`
> (reasoned from the two, not observed). Statements carrying no tag are the
> author's framing, not evidence.

## The model, in one paragraph

`accounts` is a tenant. `accounts.slug` is its subdomain label. `tenants` is the
operator's record of who owns which account. RLS policies predicate access on
`auth.uid()`, resolving the caller through `profiles.user_id`; the proxy only
attributes a request to a tenant. That "only" is a READ of `src/proxy.ts` and
`src/lib/tenant/header.ts` on 2026-10-03: the proxy writes `x-tenant-slug` and no
code in `src/` or `supabase/` reads it back, so it carries no authority in this
repo. It is a statement about the current code, not a guarantee about the
header's future use. Reading the policy text does not by itself prove isolation
at runtime — behavioural verification with real users remains `UNVERIFIED` (Task
5, step 3).

## Provisioning a client by hand

Run this in the Supabase SQL Editor. **Which statement you use depends on
whether the user already has an account** — and the trigger decides that, not
you.

Every user who signed up through the app already has one, created by the
`handle_new_user` trigger on `auth.users`. That account has **no slug**, and
assigning one is the normal case:

```sql
UPDATE accounts SET slug = 'acme'
WHERE owner_user_id = '<auth-user-uuid>' AND slug IS NULL;
```

The `slug IS NULL` guard is load-bearing. Without it the statement silently
**overwrites the slug of an existing tenant** — `MEASURED` on 2026-10-03 against
local Postgres (measured by the author on a development database; not independently re-verified): dropping the guard rewrote `hermes-probe` in place, inside a
transaction that was rolled back. Match 0 rows on a user who already has a slug
means the guard fired, not that something went wrong.

Only for a user with **no** account does the insert apply, and it must name a
real `auth.users` id — `accounts.owner_user_id` is a foreign key, so a
made-up uuid fails:

```sql
INSERT INTO accounts (name, slug, owner_user_id)
VALUES ('Acme Trading', 'acme', '<auth-user-uuid-from-auth-users>');
INSERT INTO tenants (slug, account_id, owner_email)
VALUES ('acme', (SELECT id FROM accounts WHERE slug = 'acme'), 'owner@acme.com');
```

Both statements above were executed against local Postgres on 2026-10-03 inside
transactions that were rolled back (measured by the author on a development database; not independently re-verified).

**Neither path is verified end to end, and this is a documentation gap rather than
a proven functional failure.** Specifically:

- The `UPDATE` path above sets `accounts.slug` only. It does **not** create the
  `tenants` row, so an account provisioned this way has no `tenants` record. The
  `INSERT` path does create both, but only when the user genuinely has no account.
- Which statements an operator actually needs to run together — and whether the
  two writes should be wrapped in one transaction so they succeed or roll back
  together — **has not been tested**. The commands here are the ones that were
  individually executed; the combined procedure is not.

So treat this section as a starting point, not a verified runbook. If the
`tenants` record is what you provision against, confirm the full sequence against a
real tenant before relying on it.

**`idx_accounts_one_per_owner` is a plain index, not a constraint.** It is
created by `CREATE UNIQUE INDEX` (READ: `017_account_sharing.sql:73`), so
`ALTER TABLE ... DROP CONSTRAINT` fails with *"constraint does not exist"* —
`MEASURED` on 2026-10-03 against local Postgres (measured by the author on a development database; not independently re-verified). To remove it for a probe, the
statement is:

```sql
DROP INDEX idx_accounts_one_per_owner;
```

**Do not work around the collision case.** Two tenants cannot share a subdomain
label: `accounts_slug_key` is a unique index (READ:
`047_tenant_foundation.sql:204`), and the second insert fails on it. `MEASURED`
on 2026-10-03 against local Postgres (measured by the author on a development database; not independently re-verified) — two accounts, two distinct owners, the
same slug:

```
ERROR:  duplicate key value violates unique constraint "accounts_slug_key"
DETAIL:  Key (slug)=(acme) already exists.
```

That is the behaviour the constraint produces, and it is the intended one —
`INFERRED` from `047_tenant_foundation.sql:204` (`CREATE UNIQUE INDEX
accounts_slug_key`), not executed as a test. Resolve it by choosing a different
slug, not by dropping or deferring the index. The same constraint bounds the
migration's auto-assigned slugs to the 64 `name-N` variants per basename (READ:
`generate_series(1, 64)` at `047_tenant_foundation.sql:130`), so a 65th
same-named account needs an explicit slug. That bound is what the SQL says; it
has not been exercised with 65 colliding rows.

## What is deliberately not here

No control panel. No billing. No automated backups — MEASURED by reading
`docs/`, `src/`, and `supabase/`: there is no provisioning UI, no billing
integration, and no backup job in this repo as of 2026-10-03. Provisioning is
manual until somebody builds those. This document is the only procedure found
here, but "the whole of the operator's procedure" was not independently
confirmed — there may be undocumented steps known only to the operator.

## Going live on subdomains

**Almost everything on this list is outside the codebase — but not all of it.**
The four steps below are infrastructure. One resolver defect is not, and it is
described immediately after them; do not read the list as "no code change is
needed":

1. A base domain you control.
2. A wildcard `*.domain` DNS record pointing at the app.
3. A wildcard TLS certificate covering that domain.
4. `LOCALHOST_TENANT` removed from the environment.

**Subdomain forms with three or more labels resolve today. The apex form does
not, and it will not without a code change.** `resolveTenantFromHost()` returns
the second-to-last label, so `crm.acme.com` and `www.acme.com` resolve to `acme`
— READ: `src/lib/tenant/resolve.ts:43`; MEASURED: `npx vitest run
src/lib/tenant/resolve.test.ts` on 2026-10-03, 10/10 passing, plus a scratch
script importing the real function directly (see the table below).

A host with **fewer than three** labels takes a different branch
(`resolve.ts:27-29`) and **never** derives its slug from the hostname.
`acme.com` does **not** resolve to `acme`. It returns
`process.env.LOCALHOST_TENANT` when that variable is set, and `null` when it is
not. MEASURED, calling the real function:

| host | `LOCALHOST_TENANT=hermes-probe` | `LOCALHOST_TENANT` unset |
|---|---|---|
| `acme.com` | `hermes-probe` | `null` |
| `nour-abbass.com` | `hermes-probe` | `null` |
| `co.uk` | `hermes-probe` | `null` |
| `crm.acme.com` | `acme` | `acme` |
| `crm.acme.co.uk` | `co` | `co` |
| `127.0.0.1` | `null` | `null` |

The apex result tracks the *environment variable*, not the hostname — so it is a
global override, not per-domain resolution. That collides with step 4 above:
removing `LOCALHOST_TENANT` before go-live turns the apex form from "resolves to
the wrong tenant" into "resolves to no tenant". Note also that
`resolve.test.ts` asserts `acme.com -> null` only because its `beforeEach`
deletes `LOCALHOST_TENANT`; that test does not cover the go-live configuration.

**File this as a tracked defect before go-live.** No issue number or URL is
recorded here, and none should be invented. It belongs in this project's issue
tracker, attached to `src/lib/tenant/resolve.ts`, with a title in the shape of
*"apex / two-label hostnames resolve to `LOCALHOST_TENANT` instead of `null`"* —
the table above as the reproduction, and the public-suffix limitation below as a
linked item. It is a resolver code change, not a DNS, certificate, or
environment step, so it cannot be closed by editing the checklist above.

A raw IP resolves to `null` (MEASURED, `127.0.0.1` -> `null` above), and the
proxy then deletes the tenant header rather than forwarding a guessed one (READ:
`src/lib/tenant/header.ts` deletes when the slug is null). Keep that distinct
from access control: no header is not a closed door. The header is not read
anywhere in `src/` or `supabase/` (MEASURED by grep across both trees,
2026-10-03), so deleting it changes attribution, not authorisation.

One known limitation, documented rather than fixed: the resolver splits on dots
without a public-suffix list, so `crm.acme.co.uk` resolves to `co` rather than
`acme` (MEASURED: the same probe returns `co`). Add a PSL dependency before
serving any two-label TLD.

## Scope of this evidence — read before drawing conclusions

The table below is **not** a statement that account isolation is verified. It
records exactly how much was checked.

**Relationship to [Isolation verification](#isolation-verification).** That
section runs four assertions over the same four tables and is the only place a
`pg_policies` query was executed. This section is the census around it — wider in
table count, weaker in evidence: it was assembled by reading migrations, not by
querying a database. Where the two could be read as disagreeing, the narrower
claim is the one to keep:

- Isolation verification says 4 named tables were read from the live database.
  This section says nothing was checked on the other 23. It does not upgrade
  that, and the wider census does not upgrade the narrower check.
- This section reports `automation_pending_executions` as reachable through the
  service role. That is a READ of application code, and it is **not** one of the
  four assertions; isolation verification did not test it and does not cover it.
- Neither section establishes runtime isolation. Both say so in their own words,
  and the two statements agree.

**Checked: the four tables named in the table** — `contacts`, `deals`,
`conversations`, `automations`.

**Not checked: the other tables that carry `account_id`.** A census found 27 such
tables. That 27 was re-derived on 2026-10-03 by parsing
`supabase/migrations/*.sql` — 12 tables declare `account_id` in `CREATE TABLE`
and 16 gain it via `ALTER TABLE ... ADD COLUMN` in `017_account_sharing.sql`;
the union is 27 once `accounts` itself is excluded, because `accounts` carries
`owner_user_id` and only *mentions* `profiles.account_id` in a comment. The
census was a static read of the migration files, not a `pg_catalog` query
against a live database, so it reflects the migrations as written rather than the
schema actually deployed. The queries above cover 4 of them, so nothing here
should be read as having verified the remaining 23. The census also surfaced two
tables whose policies differ from the `is_account_member` model. **This document
does not settle whether either difference is intended, and nothing below should be
read as settling it.** What it supports is narrower. Both differences were *read*
in the migrations, and the migrations carry comment text that states an intent for
one of the two — but comment text is evidence about what a migration says, not a
record of a design decision. No ADR, design note, or issue in this repo records
someone accepting either deviation from `is_account_member` (MEASURED by grep over
`docs/` and `.superpowers/` for `deliberat`, `intend`, `by design` and `on purpose`
on lines also naming `notifications` or `automation_pending_executions`: the only
hits are the two rows of the table below, in this file). The one editorial change
made to the earlier wording of this table was an accuracy fix on the
`automation_pending_executions` row — "protected by default, not exposed"
overstated the client-role protection and hid the service-role bypass — and it was
not a judgement about intent:

| Table | Model | Why it differs (basis stated) |
|---|---|---|
| `notifications` | per-**user**: `auth.uid() = user_id` | READ, `027_notifications.sql`: the policy `notifications_select` is `USING (auth.uid() = user_id)`. The table is scoped per user, not per tenant — a different model, not a missing policy. Whether that is the *intended* scope is a design judgement; nothing measured here settles it. |
| `automation_pending_executions` | RLS enabled, **zero policies** | Three facts, in this order. **(1) For an ordinary PostgREST client on the `anon` or `authenticated` role, zero policies denies every row.** INFERRED, not measured. **(2) For server-side paths, zero policies provide **NO** protection: RLS is bypassed entirely, and this table is read and written through `supabaseAdmin()` at `cron/route.ts:35,48` and `engine.ts:308,882`, so it is reachable from those server-side paths. Whether that reachability is *intended* is a design judgement this document does not settle; what is supported here is the mechanism — a service-role client is not subject to these policies at all. **(3) Whether such a path is safe therefore rests entirely on that path's own authentication, not on RLS.** The cron path does authenticate, before any database call — see the evidence block below, which also records where the resumed-run tenancy scope comes from and two scope limits on the secret check. **Classification: 🟡 documentation**; "protected by default, not exposed" is wrong because it overstates the protection and hides the service-role bypass. |

**Evidence for the `automation_pending_executions` row above.** Read on 2026-10-03;
no database command was run for it and no client-role request was made.

- **Zero policies, established.** READ: `006_automations.sql:138` is
  `ALTER TABLE automation_pending_executions ENABLE ROW LEVEL SECURITY;`, and the
  comment at `006:139-140` states the intent ("No SELECT/INSERT/UPDATE/DELETE policy
  for authenticated users — all access is server-side via the service-role key").
  MEASURED by grep over `supabase/migrations/`: a case-sensitive grep for the
  table name returns **10 occurrences**, and all 10 are listed below; none is a
  `CREATE POLICY` on it — the two that look like they could be are indexes
  (`006:136`, `017:307`); `017:466-468` is the comment block that reserves the
  table for the service role; `017:214` names it in a backfill array; `017:188`
  and `017:288` are the `ALTER TABLE` statements that add and then constrain
  `account_id`; `006:119` is the `CREATE TABLE`; `010:211` names it in a comment
  on `flow_runs`; and `022:71` is a one-shot dedup `UPDATE` inside a
  `SECURITY DEFINER` function. A case-**insensitive** grep returns **11** — the
  extra hit is the upper-case section header `-- AUTOMATION_PENDING_EXECUTIONS` at
  `006:109`, which is a banner comment, not a `CREATE` or `ALTER` reference to the
  table. The list below therefore covers all case-sensitive `CREATE`/`ALTER`
  references plus the comment mentions, and the count stated here is the
  case-sensitive one. So "zero policies" is **READ** from the migrations, not from
  `pg_policies`.
- **Denial for `anon`/`authenticated` is INFERRED**, from the two above plus
  documented Postgres RLS semantics (RLS enabled, no policy, non-bypassing role ⇒ no
  rows). Nothing here measured it for this table, and
  [Isolation verification](#isolation-verification) does not cover this table at all.
- **RLS is bypassed on the service-role paths, and the table is reachable there.**
  READ: `src/lib/automations/admin-client.ts:10-13` builds the client with
  `process.env.SUPABASE_SERVICE_ROLE_KEY`. This table is read and written through it
  at `cron/route.ts:35` (`select('*')` on due rows), `cron/route.ts:48` (the
  `status = 'running'` claim), `engine.ts:308` (the `wait`-step insert) and
  `engine.ts:882` (`markPending`). The migration says the same about itself at
  `006:116-117` ("Service-role only ... the engine uses the service-role client.
  No user policy exposed") and `017:466-468`.
- **The cron path authenticates before it queries.** READ,
  `src/app/api/automations/cron/route.ts:19-31`:

  ```ts
  19|  const expected = process.env.AUTOMATION_CRON_SECRET
  20|  if (!expected) {
  21|    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  22|  }
  23|  const supplied = request.headers.get('x-cron-secret') ?? ''
  ...
  26|  if (
  27|    suppliedBuf.length !== expectedBuf.length ||
  28|    !timingSafeEqual(suppliedBuf, expectedBuf)
  29|  ) {
  30|    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  31|  }
  ```

  Four specifics, because "it has a secret check" is not the whole answer:

  1. **Before any database call.** The first `supabaseAdmin()` call is `route.ts:33`
     and the first query is `route.ts:34-40` — both after the gate.
  2. **An unset secret disables the route, it does not open it.** `route.ts:20-21`
     returns `503` when `AUTOMATION_CRON_SECRET` is missing, so the handler does no
     work at all in that state.
  3. **Timing.** The byte comparison is `timingSafeEqual` (`route.ts:1,28`), but
     `route.ts:27` short-circuits on the length check *before* reaching it, so a
     length mismatch is decided without the constant-time call. INFERRED from the
     code: this leaks the secret's length and nothing more; it is not a
     content-disclosure oracle. Also note the credential is the `x-cron-secret`
     header only — **this route has no `Authorization: Bearer` check**.
  4. **Response body.** The handler returns only a count —
     `{ processed: 0 }` (`route.ts:43`) or `{ processed }` (`route.ts:73`) — and no
     row data, so an authenticated call does not read rows back out. On a PostgREST
     failure it echoes `error.message` to the caller (`route.ts:42`).
- **What scopes the work a resumed row causes.** READ, and this is where the code's
  own comments matter. The cron passes `row.account_id` at `route.ts:59-61`, but
  `engine.ts:154-159` documents that field as *"Audit-only; the automation row
  carries account_id for tenancy"* and *"just here to mirror the row shape"* — so
  `pending.account_id` is **not** what scopes the run. The scope comes from the
  automation row: `engine.ts:168-172` reads `automations` by `pending.automation_id`
  with **no** `account_id` filter, and that row's `account_id` is what the step
  handlers scope writes by (`engine.ts:528-529,575-581,600,643-644,671-676,682-686`).
  `markPending` (`engine.ts:880-885`) updates by the row's own `id` only, and the
  insert at `engine.ts:308-321` does write `account_id: args.automation.account_id`
  (`engine.ts:311`). Every service-role step is scoped to the automation row's tenant,
  so the row's own `account_id` being audit-only is consistent — **INFERRED**, not
  measured, and it is a code read, not a behavioural test. Two scope limits are
  stated rather than smoothed over: `runAutomationsForTrigger`'s contact-ownership
  guard (`engine.ts:78-93`) is **not** re-run on the resume path, and the
  `contact_tags` steps say in their own comments that they rely on that guard
  (`engine.ts:462-465`, `501-505`); and `automation_pending_executions.automation_id`
  is a bare single-column FK (`006:121`), so nothing at the schema level forces the
  row's `account_id` and its automation's `account_id` to agree. **This document does
  not claim the resume path is safe** — only that its safety is its own
  authentication and its own account scoping, and that neither was tested here.
- **The other two service-role routes that can reach the `engine.ts:308` insert each
  authenticate by their own means.** READ: `POST /api/automations/engine` calls
  `requireRole('agent')` before dispatch (`engine/route.ts:16`, resolving
  `ctx.accountId` at `:17`), and the Meta webhook HMAC-verifies before dispatch
  (`whatsapp/webhook/route.ts:226-231`, `401` on failure; the GET verify-token branch
  is at `:142-208`). **The only other writer of this table anywhere is
  `public.merge_duplicate_contacts()`**, a `SECURITY DEFINER` function
  (`022_contact_phone_dedup.sql:41`) whose `UPDATE` at `022:71` is
  `REVOKE ALL ... FROM PUBLIC` (`022:111`) and invoked once at migration time
  (`022:114`) — not a client-reachable path.
- **Why this is 🟡 documentation and not a finding.** Every gate above was verified by
  reading a file, not by making a request. The cron route authenticates, so no
  unauthenticated path to this table was found — the original sentence was wrong in
  the direction that hides the service-role bypass and overstates the client-role
  protection, not because it concealed an open endpoint. **Classification: 🟡
  documentation, with one behaviour still `UNVERIFIED`:** that the secret gate
  actually rejects a bad `x-cron-secret` at runtime was not executed here. Per the
  repo's own convention, do not promote this row to a security finding without
  either a runtime check on the gate or a recorded test that exercises it.


`tenants` is likewise RLS-enabled with zero policies (READ:
`047_tenant_foundation.sql:225`, no `CREATE POLICY ... ON tenants` in any
migration), which is why owner-only visibility there would be a new policy
rather than an existing one. Nothing in `src/` queries `tenants` (MEASURED by
grep, 2026-10-03), so no reader depends on it today.

**Service role is the standing caveat on every row of this table.** Five call
sites build a `SUPABASE_SERVICE_ROLE_KEY` client (`src/lib/ai/admin-client.ts`,
`src/lib/automations/admin-client.ts`, `src/lib/flows/admin-client.ts`,
`src/app/api/whatsapp/webhook/route.ts`,
`src/app/api/whatsapp/config/route.ts` — READ 2026-10-03). Service-role calls do
not pass through these policies at all. A policy read therefore says nothing
about what those paths can reach, and nothing in this document should be read as
covering them.

**This was a read of the schema. No request was made as a signed-in user**, so no
conclusion about runtime isolation is drawn from either table.

## Isolation verification

`src/lib/tenant/isolation.sql` is the script. It is deliberately **not** a vitest
file, and the reasoning is that a mocked RLS assertion would test the mock rather
than the database (`INFERRED` — a design rationale, not a measurement). It runs
against the real local database, and it is a SQL script: it queries `pg_policies`
and `pg_proc`, so what it reads is policy *text*, not enforced behaviour.

**Executed against local Postgres on 2026-10-03.** Results, as recorded at the
time of that run; they are **not** re-verified by this edit, which ran no
database command:

| # | Assertion | Tables | Result |
|---|---|---|---|
| 1 | tenant accounts exist and are distinct | `accounts` | `hermes-probe`, `nour-abbass` — 2 rows |
| 2 | SELECT policies predicate on `is_account_member(account_id)` | 4 named tables | confirmed on all four |
| 3 | `is_account_member` resolves the caller through `auth.uid()` | function | `uses_auth_uid = t` |
| 4 | no named table bypasses `is_account_member` on read | 4 named tables | `0` |

Assertions 3 and 4 are stop-the-line gates. Both passed. **Assertion 4's `0` is
scoped to those four tables** — it is not a statement about the other 23, and it
is scoped further still: `pg_policies` describes the policy set, not what any
client is permitted to do, and service-role callers bypass RLS entirely. A `0`
here is a statement about policy *text* on four named tables. See
[Scope of this evidence](#scope-of-this-evidence--read-before-drawing-conclusions)
for the wider census; this section deliberately claims no more than that section
does about the same four tables.

**What this does not establish.** Assertions 1–4 read policy *text*. They
confirm the mechanism exists and is wired to `auth.uid()` — the mechanism is
present and named, which is a statement about the schema, not about enforcement.
They do not demonstrate that a signed-in user of tenant A is refused tenant B's
rows — that requires two real tenants with real rows, each read back through
PostgREST under that tenant's own JWT. That check is **step 3 of Task 5 and is
`UNVERIFIED`**.

It was attempted and deliberately stopped. The fixture path required inserting
users into `auth.users` directly, and GoTrue (`v2.197.0`) then failed to
authenticate them — `converting NULL to string is unsupported` on
`confirmation_token`. That error shows only what GoTrue could not read; it does
**not** establish that setting the column to an empty string is the fix, and the
default is inconsistent across the token columns (`email_change_token_current`
and `phone_change_token` default to `''`, `confirmation_token` and
`recovery_token` default to `NULL`). There is no `auth.create_user` function and
no admin API configured, so a direct insert is a bypass of provisioning rather
than a supported path. The fixtures were deleted and the database returned to
its recorded baseline (`2 / 2 / 2 / 1 / 2 / 10` across users, accounts,
profiles, contacts, identities, stages; zero leftover probe rows) (measured by the author on a development database; not independently re-verified).

Two corrections to that list, both re-derived on 2026-10-03 by reading the
migrations rather than by querying the database:

- **`stages` is not a table name in this repo.** MEASURED by grep over
  `supabase/migrations/`: no `CREATE TABLE ... stages` exists; the table is
  **`pipeline_stages`** (`001_initial_schema.sql:248`). The bare `stages` label
  is almost certainly shorthand, but as written it names a table an operator
  cannot count against. Treat the sixth position as `pipeline_stages`.
- **`identities` is an `auth.*` table, not a `public.*` one.** READ:
  `.superpowers/sdd/2026-10-01-multi-tenant-foundation/task-3-report.md:334`
  lists it in the dump-replay FK order (`identities` -> `users`), alongside
  other `auth` tables. It should be written `auth.identities` for the same
  reason.

The counts themselves are **not** re-verified here: no database query was run
for this edit, so the six numbers stand as recorded in
`.superpowers/sdd/2026-10-01-multi-tenant-foundation/progress.md:427-429`, not as
measured values. One of them may be wrong — that same file at line 113 records
the fixtures as "a pipeline with 5 stages", which does not obviously match a
count of `10` in the sixth position. Do not rely on this row for a
restore decision until someone re-counts it; re-running the count is the only
way to settle it.

**To close it:** create both tenants through a supported path — the Supabase
admin API or the dashboard UI — then read `/rest/v1/contacts` as each tenant's
owner and confirm the result sets differ. Do not reproduce it by inserting into
`auth.users`.

## Signup provisioning is not solved

A user who signs up through the app gets an account from the `handle_new_user`
trigger (READ: `handle_new_user` is defined in `001_initial_schema.sql` and
re-referenced in `017`/`018`/`034`/`047`), and that account has **no slug**.
`INFERRED` from the migrations, not measured at runtime: no migration assigns
`accounts.slug` from the trigger — `047_tenant_foundation.sql` backfills the
column once, at migration time — so the trigger cannot supply a slug for a
signup that happens after that backfill. The slug backfill in migration 047 only
assigns slugs to accounts that existed when it ran; it does not provision for
future signups. Until that is built, every new tenant needs the manual
provisioning step above. `047_tenant_foundation.sql:115-116` says the same thing
about itself: "There is no provisioning path that assigns a slug today (no
trigger, no RPC, no application write touches accounts.slug)".

**What a slug-less account means for the proxy.** The proxy maps a *hostname* to
a slug; it does not resolve users or accounts from slugs, and it has no notion of
a signed-in user. So a missing account slug does not "resolve the user to no
tenant" — the request still resolves whatever the *hostname* maps to, or nothing
if the hostname is unknown. **What that means for the data a user can read is not
determined here and has not been tested**; see the isolation sections above, where
the behavioural check remains `UNVERIFIED`.