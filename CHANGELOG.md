# Changelog

User-visible changes in `wacrm`. Self-hosters: when pulling an update,
check this file for any **migration required** notes and apply the
matching SQL files from `supabase/migrations/` against your Supabase
project before restarting the app.

Versions follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Pre-1.0, `MINOR` bumps cover new modules; `PATCH` bumps cover bug fixes
and polish.

## [0.14.1] — 2026-08-20

**Migration required:** `supabase/migrations/054_fix_ambiguous_contact_id_column_reference.sql`

Fixes `POST /api/content/[id]/schedule` returning a 500 with no
detail for every real (non-empty) audience. Root cause, found only
after the route's silent-swallow error paths were fixed to actually
log: `create_content_broadcast_with_recipients` (053) raised

```
code:    42702
message: column reference "contact_id" is ambiguous
details: It could refer to either a PL/pgSQL variable or a table
         column.
```

`RETURNS TABLE(broadcast_id UUID, recipient_id UUID, contact_id UUID)`
implicitly declares those three names as PL/pgSQL variables for the
whole function body (same as OUT parameters). The unqualified
`RETURNING id, contact_id` inside the recipient-insert CTE then
collides with the outer `contact_id` — Postgres's default
`#variable_conflict = error` refuses to guess which one you meant.
Never caught by `npm run test` because that suite mocks `db.rpc()`
everywhere; nothing exercises the real PL/pgSQL short of a live call,
which is exactly how this shipped in 053 unnoticed.

Fix: qualify the `RETURNING` target with a table alias
(`INSERT INTO broadcast_recipients AS br (...) ... RETURNING br.id,
br.contact_id`) rather than renaming the `RETURNS TABLE` columns —
renaming those would change the RPC's actual wire contract (the JSON
keys `src/app/api/content/[id]/schedule/route.ts`'s
`rpcRows[0].broadcast_id` and `src/app/api/whatsapp/broadcast/
route.ts` read) for no benefit, since the ambiguity only exists
inside the SQL statement itself.

`create_broadcast_with_recipients` (037/038/052) — the template-
broadcast sibling every existing Broadcasts send already goes
through — has the exact same `RETURNS TABLE` shape and the exact same
unqualified `RETURNING id, contact_id`. Same latent bug, fixed in the
same migration rather than left sitting in a hot path that just
hadn't been hit by a real multi-recipient call yet in this
environment.

### Also in this pass

- `src/app/api/content/[id]/schedule/route.ts`: three of its four
  `500`-returning branches (`content` lookup, `content_translations`
  lookup, `accounts.demo_mode_enabled` lookup) returned with **zero**
  logging — the literal mechanism behind "server log shows only the
  500 line." All three now log before returning. The RPC-failure log
  now prints `message`/`details`/`hint`/`code` as separate fields
  (a bare `console.error('...', rpcErr)` can have its second argument
  dropped by some log pipelines) plus the recipient count and a
  5-id sample, so the next real failure is diagnosable from the log
  alone.
- `src/lib/content/audience.ts`'s `resolveAudienceContacts` now logs
  the same structured detail before throwing, instead of relying
  solely on the generic `[toErrorResponse] uncategorized error`
  catch-all to surface it.
- Test: `src/app/api/content/[id]/schedule/route.test.ts` (new) —
  covers a multi-recipient (3-contact) schedule end to end: every
  resolved `contact.id` is forwarded to the RPC, a multi-row RPC
  response (one row per recipient, shared `broadcast_id`) is read
  correctly, `content.status` only flips to `Scheduled` after the RPC
  actually succeeds, and a Postgres-error RPC response (modeled on
  the exact 42702 above) 500s cleanly without flipping content status.
  This pins down the app-side contract; it cannot exercise the real
  PL/pgSQL itself since `db.rpc()` is mocked, same as the rest of this
  suite. No Docker/Supabase CLI is available in this environment to
  add a live-Postgres regression test for the SQL fix directly — that
  side of the fix is covered by `.github/workflows/migrations.yml`,
  which already replays every migration from scratch against a real
  local Postgres on every PR touching `supabase/**`.

Verified: typecheck, lint (0 errors, unchanged 37 pre-existing
warnings), test (897/897 — 894 existing + 3 new), and build all pass.
format:check reports the same 361-file pre-existing baseline as
before this change.

## [0.14.0] — 2026-08-19

Completes Phase 4 (§23): §20's demo chain now runs end-to-end —
`publish -> demo message -> simulated delivery -> simulated
read/reaction -> engagement events in the database`. Builds on the
0a54eb1 groundwork checkpoint (find-or-create extraction,
`engagement.ts` writer, `source`-threaded `inbound-events.ts`
handlers), which was committed behavior-neutral with nothing yet
passing `source: 'demo'`. This is the commit that actually wires it.

### Added

- `simulateDemoBroadcastReaction` (`demo-simulate.ts`) — a broadcast/
  content-publish send never creates a `messages` row (only
  `broadcast_recipients` tracks it), so there's no target for
  `handleReaction`'s `message_reactions` upsert to attach to. This
  writes the `engagement_events` row directly instead — a reaction on
  a broadcast is already "engagement with a post" without needing a
  `message_reactions` row (§13).
- `simulateDemoInboundMessage` (`demo-simulate.ts`) — the "simulated
  inbound messages" deliverable. Resolves/creates the contact's
  conversation via `findOrCreateConversation` (the same lookup a real
  inbound webhook uses — from the groundwork commit), inserts a
  `messages` row, bumps the conversation via
  `bump_conversation_on_inbound`, reopens it if closed, then calls
  `flagBroadcastReplyIfAny(..., 'demo')`, which both flips the
  matching `broadcast_recipients` row to `replied` and writes the
  REPLY `engagement_events` row. Reply text is drawn from a small,
  deliberately generic acknowledgment pool ("Thanks for the update!",
  "Got it, appreciate it.", etc.) — never a fabricated customer claim
  (§2). Does NOT dispatch to Flows/automations/AI-reply or create a
  `CustomerRequest` — that's Phase 6's commercial-funnel territory,
  not this phase's engagement-event scope.
- Tests: `engagement.test.ts`, `demo-simulate.test.ts`,
  `inbound-events.test.ts` — 28 new cases covering
  `writeEngagementEvent`'s campaign_id resolution and error-swallowing,
  every `simulateDemo*` function's `source` tagging (the core
  requirement this phase was building toward), and
  `handleStatusUpdate`/`handleReaction`/`flagBroadcastReplyIfAny`'s
  new engagement-event writes (including the negative cases: no event
  for a `sent` transition, a ladder regression, a non-broadcast
  message, or a reaction removal).

### Changed

- `demo-simulate.ts`: `simulateDemoDeliveryAndRead` and
  `simulateDemoReaction` now pass `source: 'demo'` into
  `handleStatusUpdate`/`handleReaction` — previously neither did, so
  every event these produced was indistinguishable from a real one in
  `engagement_events` (the real webhook's default is `source:
  'whatsapp'`). This was the core gap the groundwork commit flagged
  as still open.
- `send-message.ts`: after a demo send's delivered/read simulation,
  a 25% chance also simulates a reaction (`simulateDemoReaction`) —
  bounded so a demo inbox doesn't look unrealistically uniform (a
  reaction on literally every message would read as fake precisely
  because it's too consistent).
- `broadcast-core.ts`'s `deliverBroadcast` and `content/deliver.ts`'s
  `deliverContentBroadcast`: after a demo recipient's delivered/read
  simulation, independent 30%/15% chances simulate a broadcast
  reaction / an inbound reply respectively. `BroadcastPlan.planned`
  entries and `broadcast-resume.ts`'s resume path both gained
  `contactId` (needed to call the new simulate functions per
  recipient); `BroadcastPlan` itself gained `accountId`.

Verified: typecheck, lint (0 errors, unchanged 37 pre-existing
warnings), test (894/894 — 866 existing + 28 new; the full suite was
also run 3x in a row specifically to rule out flakiness from the new
`Math.random()`-gated simulate calls, since those paths are real,
unmocked code in the broadcast/send-message test fixtures — no
flakiness observed, because every `simulateDemo*` export swallows its
own errors, so even a fixture that doesn't model a table a simulate
call touches just logs and moves on), and build all pass. format:check
reports exactly the same 361-file pre-existing baseline as before this
change; every file this phase touched or created is formatted clean
(including `inbound-events.ts`/`find-or-create.ts`/`engagement.ts`
from the prior groundwork commit, which turned out not to have been
verified against format:check at the time — fixed here).

## [0.13.2] — 2026-08-19

Documents how the three cron-drained endpoints
(`/api/automations/cron`, `/api/flows/cron`, `/api/content/cron`) are
meant to be triggered — previously undocumented anywhere in the repo
despite existing since `automations`/`flows` shipped; `.env.local.example`
pointed at a `docs/automations-and-cron.md` that was never created.
New "Scheduled jobs (cron)" section in `README.md`: the exact `curl`
command for local dev, and production guidance (Vercel Cron Job /
host crontab / external scheduled pinger — same mechanism works for
all three, nothing platform-specific). `.env.local.example`'s
`AUTOMATION_CRON_SECRET` comment now names all three endpoints and
points at the README section instead of the missing doc file.

Doc-only — no code change.

## [0.13.1] — 2026-08-19

Fixes a wrong assumption from the previous release: Content Studio's
localization editor treated Punjabi as left-to-right, reasoning it was
written in Gurmukhi script. In the Pakistani context this platform
targets, Punjabi is written in Shahmukhi (Perso-Arabic script), which
is right-to-left — so it belongs alongside Urdu and Pashto, not Roman
Urdu. `docs/RIMULA_BUILD_SPEC.md` §10 corrected to state this
explicitly; `LocalizationPanel`'s `RTL_LANGUAGES` set now includes
`pa`, and its editor/preview `dir` handling follows. No schema or API
change — display-only.

## [0.13.0] — 2026-08-19

Ships Phase 3 (§23): the Content Studio — content creation, media,
manual localization (with voice notes), review/approval, and
scheduling. UI + API only, per the phase's own scope note: `content`,
`content_translations`, and `voice_notes` already existed (migration
046); the one genuine schema gap was `broadcasts` not yet knowing how
to carry a content-backed (non-template) send.

> **Migration required:** apply
> `supabase/migrations/053_rimula_content_scheduling.sql`. It adds
> `broadcasts.content_id`/`broadcasts.language`, drops
> `broadcasts.template_name`'s `NOT NULL` (a Content Studio post is
> free text/media, not a Meta template — a new CHECK constraint
> requires at least one of the two), and adds
> `create_content_broadcast_with_recipients`, the content-post sibling
> of `create_broadcast_with_recipients` (037/038/052) — same atomic
> parent+recipients pattern, so a recipient-insert failure can never
> orphan a parent broadcast.

### Added

- **Content Studio pages** (`/content`, `/content/new`, `/content/[id]`):
  list with status filter tabs; a create form (title, type, body,
  media upload into the existing `chat-media` bucket via
  `uploadAccountMedia`); a detail page combining the original-copy
  editor, a localization panel per language, and review/approve/
  schedule actions. New "Content" sidebar + mobile-header nav entry
  (§7 — extends the existing nav rather than a second surface).
- **`LocalizationPanel`** — one Urdu/Pashto/Punjabi/Roman-Urdu tab per
  language. Urdu and Pashto render `dir="rtl"`; Punjabi and Roman Urdu
  don't (§10 names Urdu/Pashto specifically as RTL — Punjabi in
  Gurmukhi script and Roman Urdu are both LTR, not lumped in on a
  guess). Manual entry only, no AI translation, exactly as specified —
  a BA writes each language directly into its own field and it's
  persisted as its own `content_translations` row; the source `content`
  row is never overwritten.
- **`VoiceNoteRecorder`** — reuses the inbox composer's exact capture
  path (`opus-recorder` + the vendored `/opus/` encoder worker, CSP
  already permits `microphone=(self)`) trimmed down to record ->
  upload -> hand back the storage path, plus a plain file-upload
  fallback. Audio lands in `chat-media` under the standard
  `account-<account_id>/...` path.
- **`src/lib/content/audience.ts`** (`resolveAudienceContacts`) — turns
  a `{ roles?, markets? }` selector into the Members it currently
  matches (confirmed WhatsApp, opted in). Called both when scheduling
  (to size the audience) and again by the cron drain at send time (so
  a Member who joins in between is still included) — one definition
  of "who does this post reach," not two that could drift.
- **`src/lib/content/deliver.ts`** (`deliverContentBroadcast`) — the
  content-backed sibling of `deliverBroadcast`: sends free text/media
  (the requested language's translation when one is set, else the
  source body) through `WhatsAppService` instead of a Meta template,
  reusing the delivery-lock mutex (038) and `finalizeBroadcastStatus`
  unchanged. Demo sends get `simulateDemoDeliveryAndRead` exactly like
  every other WhatsApp send path already does. Reflects the outcome
  back onto `content.status` (`Published`/`Failed`), but only once no
  other scheduled broadcast remains for that content item — a still-
  pending Urdu send doesn't get clobbered the moment the English one
  goes out.
- **`GET /api/content/cron`** — drains due Content Studio posts
  (`content_id IS NOT NULL AND status='scheduled' AND scheduled_at <=
  now()`). Same `AUTOMATION_CRON_SECRET` header + constant-time
  compare as `GET /api/flows/cron` — one secret, one pattern, per
  §10's explicit instruction not to invent a new one. There is no
  separate "send immediately" code path: a caller that wants an
  immediate send just schedules for `now`, and the next cron tick
  picks it up — one send path instead of two that could silently
  drift apart.
- Content CRUD/workflow routes: `GET/POST /api/content`,
  `GET/PATCH/DELETE /api/content/[id]`,
  `GET/POST /api/content/[id]/translations` (+ `DELETE .../[language]`),
  `GET/POST /api/content/[id]/voice-notes` (+ `DELETE .../[id]`),
  `POST /api/content/[id]/submit` (Draft -> In Review, agent+),
  `POST /api/content/[id]/approve` (In Review -> Approved or back to
  Draft, **admin+ only** — approval is an admin action per §11/§14,
  not something a BA can rubber-stamp on their own submission),
  `POST /api/content/[id]/schedule` (Approved -> a new `broadcasts`
  row; agent+). A BA may only write a translation for a language in
  their own `profiles.languages` (§14) — admins/owners are exempt;
  enforced in the route (RLS can't read the caller's own profile row
  without a dedicated helper, which migration 046's header explicitly
  deferred to this phase).
- Demo-vs-real is frozen at schedule time (reads
  `accounts.demo_mode_enabled` once, same as every other send path
  since the Phase 2 correction) and a resume would need to honor that
  same frozen choice — `create_content_broadcast_with_recipients`
  takes `p_is_demo` directly rather than re-deriving it, so a content
  post can't switch demo/real mid-flight either.

Verified: typecheck, lint (0 errors, unchanged 37 pre-existing
warnings), test (866/866 — 846 existing + 20 new covering audience
resolution, content delivery incl. demo-mode simulation, approval's
admin-only enforcement, and the BA-language translation permission
boundary), and build all pass (all new `/content*` and `/api/content*`
routes appear in the route table). format:check reports exactly the
same 361-file
pre-existing baseline as before this change — the handful of
pre-existing files this phase touched (`sidebar.tsx`, `header.tsx`,
`upload-media.ts`, `en.json`) were already in that set; every
brand-new file this phase added is formatted clean.

Known gaps, stated rather than hidden: no product/campaign picker in
the create form (Products/Campaigns management UI doesn't exist until
Phase 5); no list view of a content item's scheduled broadcasts on its
detail page; a scheduled post always sends via `sendText`/`sendMedia`,
never a Meta template — for a real (non-demo) account that means
Meta's 24-hour customer-service-window rule applies exactly as it
already does everywhere else in this codebase, which is a real Meta
constraint being surfaced honestly, not a bug.

## [0.12.0] — 2026-08-19

Two corrections to the WhatsAppService rollout, requested before
starting Phase 3:

1. **Demo Mode is now an explicit Settings switch, not an inference.**
   Previously an account silently used `DemoWhatsAppService` whenever
   `whatsapp_config` happened to be missing. That's gone — whether an
   account sends live or simulated traffic is now the
   `accounts.demo_mode_enabled` toggle (Settings → WhatsApp, §15,
   directly under the connection status). Demo Mode **on** wins even
   if real config also exists (a deliberate override — an admin may
   want to demo/train without risking a real send). Demo Mode **off**
   with no config now **fails loudly** — `resolveWhatsAppService`
   throws `WhatsAppNotConfiguredError` (mapped to a 400 at every call
   site) instead of silently simulating. A persistent, non-dismissible
   `DemoModeBanner` renders above every page whenever Demo Mode is on,
   so an operator can never be left to discover it by accident.
2. **Demo-originated records are now identifiable in the data.**
   `messages.is_demo` mirrors the existing `messages.ai_generated`
   precedent exactly — set at every send call site when
   `DemoWhatsAppService` was used. `broadcasts.is_demo` extends the
   same principle to campaigns, for the identical reason: demo and
   real activity share the same tables and code path, so analytics
   needs an explicit way to tell them apart.

> **Migration required:** apply
> `supabase/migrations/052_rimula_demo_mode_and_markers.sql`. It adds
> `accounts.demo_mode_enabled` (`DEFAULT true`, then backfilled to
> `false` specifically for accounts that already have a
> `whatsapp_config` row — so an existing self-hosted deployment
> already sending real WhatsApp traffic keeps doing so after
> upgrading, rather than silently switching to simulated sends),
> `messages.is_demo`, `broadcasts.is_demo`, and a new
> `create_broadcast_with_recipients` overload carrying an `is_demo`
> parameter through the atomic broadcast-creation RPC.

### Added

- `accounts.demo_mode_enabled` + the Settings toggle in
  `WhatsAppConfig` (direct client-side update via RLS, mirroring the
  existing `mirror_inbound_media` switch — no new API route). Shown
  and usable even when no `whatsapp_config` row exists yet, since
  that's the primary out-of-the-box case.
- `DemoModeBanner` (`src/components/layout/demo-mode-banner.tsx`),
  wired into `DashboardShell` alongside the existing
  `AccountAccessAlert` — same "render nothing on the happy path,
  otherwise be impossible to miss" precedent, applied to the opposite
  problem (silent invisible *mode*, not silent invisible *error*).
- `WhatsAppNotConfiguredError` (`service.ts`) and
  `resolveWhatsAppServiceForBroadcast(db, accountId, wasDemo)` — the
  latter is what a broadcast **resume** calls instead of
  `resolveWhatsAppService`: a resume must never re-derive demo-vs-real
  from the account's *current* setting, only continue whatever the
  broadcast started as (its own persisted `is_demo`), so a campaign
  can never switch mid-flight just because someone flipped the
  account toggle between the original send and a later resume pass.
- `messages.is_demo` set at all five message-persisting send call
  sites (`send-message.ts`, `automations/meta-send.ts`,
  `flows/meta-send.ts` ×3); `broadcasts.is_demo` set once at creation
  in `broadcast-core.ts`.

### Changed

- `resolveWhatsAppService` reads `accounts.demo_mode_enabled` first;
  `whatsapp_config` is only consulted when Demo Mode is off. Every
  call site (`send-message.ts`, `broadcast-core.ts`,
  `broadcast-resume.ts`, `/api/whatsapp/broadcast`,
  `/api/whatsapp/react`) now catches `WhatsAppNotConfiguredError` and
  maps it to the same 400 shape a missing config used to produce
  before the previous commit's refactor — the "fail loudly" behavior
  is back, now correctly conditioned on the explicit setting rather
  than triggering it silently as a fallback.

Verified: typecheck, lint (0 errors, unchanged 37 pre-existing
warnings), test (846/846 — 8 new/replaced cases directly covering the
new demo_mode_enabled branch logic, incl. the resume-must-not-switch
guarantee), and build all pass. format:check reports exactly the same
361-file pre-existing baseline as before this change; the 3 files this
commit fully owns (`service.ts`, `service.test.ts`,
`demo-mode-banner.tsx`) are formatted clean. `en.json`/`ko.json` both
gained the new `Settings.whatsapp.demoMode*` and `DemoMode.banner*`
keys, kept in parallel per the existing bilingual-messages convention.

## [0.11.0] — 2026-08-19

Completes the other half of Phase 2 (§23): the `WhatsAppService`
provider abstraction and `DemoWhatsAppService` (§3). Every Meta call
site in the send/receive funnel — `/api/whatsapp/send`, the dashboard
and public-API broadcast senders (+ resume), `/api/whatsapp/react`,
the automations engine, and the Flows runner — now goes through one
interface instead of importing `@/lib/whatsapp/meta-api` directly,
mirroring the existing AI-provider pattern (`src/lib/ai/`). An account
with no `whatsapp_config` row now sends through `DemoWhatsAppService`
automatically instead of erroring — **the app runs the full send path
with zero Meta credentials**, per §3. No migration — code only.

### Added

- **`src/lib/whatsapp/service.ts`** — the `WhatsAppService` interface
  (`sendText`/`sendTemplate`/`sendMedia`/`sendInteractiveButtons`/
  `sendInteractiveList`/`sendReaction`) and `resolveWhatsAppService(db,
  accountId)`, the single chokepoint that decides Meta vs. demo. No
  call site queries `whatsapp_config` directly any more — one lookup,
  one answer to "does this account have Meta creds?". Also centralizes
  the legacy-ciphertext self-heal that previously only ran on the
  manual-send path.
- **`MetaWhatsAppService`** (`providers/meta-whatsapp-service.ts`) —
  thin adapter over the existing, already-tested `meta-api.ts` send
  functions; changes *who* calls them, not what they do. Owns the
  phone-variant retry ("recipient not in allowed list") that used to
  be duplicated inline at seven call sites — now lives once.
- **`DemoWhatsAppService`** (`providers/demo-whatsapp-service.ts`) —
  every send resolves instantly against a synthetic `demo-...` id, no
  network call, no template/recipient validation (there's nothing
  real to validate against).
- **`src/lib/whatsapp/inbound-events.ts`** — `handleStatusUpdate` /
  `handleReaction` (+ helpers) moved verbatim out of the webhook route
  so they're callable from outside a real Meta webhook. Zero behaviour
  change — a pure extraction, still covered by the existing 15
  webhook tests.
- **`src/lib/whatsapp/demo-simulate.ts`** — `simulateDemoDeliveryAndRead`
  drives a just-sent demo message through `delivered` → `read` using
  the *exact same* `handleStatusUpdate` a real Meta status webhook
  would call, so `messages.status`, `broadcast_recipients` counters,
  and webhook fan-out all update identically regardless of transport
  (§20: same tables production analytics reads, no parallel fake
  system). Wired in after every demo send. `simulateDemoReaction` is
  implemented and exported but not yet wired into a call site —
  reaction simulation needs a conversationId/contactId pair not
  currently threaded through the broadcast fan-out loop; documented
  as ready for Phase 3/4 to pick up. Simulated *inbound* messages
  (a synthetic customer reply) are likewise left for that later
  full-funnel wiring, not invented here.

### Changed

- `sendMessageToConversation` (`send-message.ts`), `automations/meta-send.ts`,
  `flows/meta-send.ts` (all three senders), `broadcast-core.ts`
  (`createBroadcast`/`deliverBroadcast`), `broadcast-resume.ts`
  (`planBroadcastResume`), `/api/whatsapp/broadcast`, and
  `/api/whatsapp/react` all now resolve a `WhatsAppService` instead of
  loading `whatsapp_config` and calling `meta-api.ts` inline. A missing
  config used to throw `whatsapp_not_configured` (400) — it now means
  "use the demo service" everywhere except nowhere: there is no longer
  a code path where the absence of Meta credentials is a hard error.
  HMAC-SHA256 webhook signature verification and existing rate limits
  (`checkRateLimit`/`RATE_LIMITS`) are untouched — this refactor only
  touches the *sending* side, never the webhook's inbound
  authentication or the per-route rate gates.

Out of scope for this change (Meta-specific admin/setup, not the
send/receive funnel §3 names): WhatsApp registration
(`/api/whatsapp/config*`), template lifecycle management
(`/api/whatsapp/templates/*`), and the inbound-media proxy
(`/api/whatsapp/media/[mediaId]`, `getMediaUrl`/`downloadMedia`) —
these still call `meta-api.ts` directly, unchanged.

## [0.10.0] — 2026-08-19

Adds Markets/Regions and extends `contacts` into `Member` and
`profiles` into `BA` (Phase 2 of the build plan in
`docs/RIMULA_BUILD_SPEC.md` §23 — schema + seed only; the
`WhatsAppService`/`DemoWhatsAppService` abstraction §23 also lists
under Phase 2 is not part of this change). No table is replaced —
`contacts`/`profiles` are widened in place, same as every extension
the spec calls for in §9.0.

> **Migration required:** apply, in order,
> `supabase/migrations/049_rimula_markets_regions.sql`,
> `050_rimula_member_fields.sql`, and `051_rimula_ba_fields.sql`. Then
> re-run `npm run db:seed` for local/dev — it now seeds the full §19
> Member volumes (844 contacts) instead of the small placeholder set
> Phase 1 shipped.

### Added

- **`markets`, `regions`** (049) — settings-class lookup tables (admin+
  writes, any member reads, mirrors `product_categories`) backing the
  `region`/`market` fields on both `Member` and `BA` below. A market
  optionally belongs to a region; §12's BA routing (`Market BA →
  Regional BA → Unassigned`) is the reason these are real FKs with
  stable ids rather than free-text columns that could drift ("Lahore"
  / "lahore" / "LHR").
- **`contacts` extended into `Member`** (050): `role` (Mechanic/Truck
  Driver/Truck Owner/BA/Other — the exact §8 community audience
  roles), `region_id`/`market_id` (FK into 049), `vehicle`/
  `vehicle_type` (self-reported, deliberately not linked to the
  Phase 1 `vehicles` catalog), `opt_in_status`, `whatsapp_status`
  (drives the §19 "WhatsApp confirmed" metric), `community_status`,
  `joined_date` (backfilled from `created_at` for existing rows, not
  defaulted to today), `last_engagement`.
- **`profiles` extended into `BA`** (051): `region_id`/`market_id` (FK
  into 049), `ba_status` (named to avoid a third ambiguous bare
  `status`/`role` column on this already-overloaded table — see
  migration 041's `profiles.role` vs `profiles.account_role` note),
  `open_leads` (denormalized counter, maintained by BA-routing logic
  landing in a later phase), `capacity`, `languages` (reuses the exact
  `ur`/`ps`/`pa`/`ur-Roman` codes `content_translations.language`
  already uses, so §14's "BA may edit translations for languages in
  their own `languages` field" is a direct array-membership check with
  no code-mapping layer). Partial indexes on `(account_id, market_id)`
  / `(account_id, region_id) WHERE ba_status = 'active'` for the §12
  routing hot path.
- **`scripts/seed.ts` now seeds the full §19 Member population**: 844
  `contacts` rows (202 Mechanic / 255 Truck Owner / 387 Truck Driver,
  619 with `whatsapp_status = 'confirmed'` — 154/187/278 per segment,
  matching the reference table exactly) spread evenly across the 20
  seeded markets. The 20 named individuals the Phase 1 seed already
  used (referenced by `customer_requests`/`trials`) are preserved as
  specific rows within their matching role segment — a bulk-generated
  pool (first name × last name cross product) fills the rest. The
  single demo login also gets usable `BA` fields set (region, market,
  `languages: ['ur','ps','pa']`, capacity) so it's a coherent
  assignment/verification/translation target elsewhere in the seed,
  not an admin with every BA field null.

## [0.9.0] — 2026-08-19

Adds the net-new Rimula Community Growth Platform schema (Phase 1 of
the build plan in `docs/RIMULA_BUILD_SPEC.md` §23): the Product
catalog, Vehicle compatibility, Campaigns, Customer Requests, Trials,
Content/localization/voice notes, engagement/attribution analytics,
and the WhatsApp catalogue sync log — plus a re-runnable demo seed
script. No existing table is modified; every table below is new.

> **Migration required:** apply, in order,
> `supabase/migrations/040_rimula_community_groups.sql`,
> `041_rimula_products.sql`, `042_rimula_vehicles.sql`,
> `043_rimula_campaigns.sql`, `044_rimula_customer_requests.sql`,
> `045_rimula_trials.sql`, `046_rimula_content.sql`,
> `047_rimula_engagement_analytics.sql`, and
> `048_rimula_whatsapp_sync_log.sql`. Then, for local/dev only, run
> `npm run db:seed` to populate demo data — **never** run it against a
> hosted/production project; it provisions a demo login via the
> Supabase Admin API (`SUPABASE_SERVICE_ROLE_KEY`, which bypasses RLS).

### Added

- **`community_groups`** (040) — generic brand→audience broadcast
  destinations (§8); the seed script creates the single MVP
  "Rimula Announcements" row.
- **`product_categories`, `products`, `product_images`,
  `product_applications`, `product_claims`** (041) — the Product
  catalog. Each claim carries its own `draft/pending_review/approved/rejected`
  lifecycle, separate from the product's own `status`, so "only
  administrator-approved data may be shown as fact" is enforceable
  per-claim, not just per-product.
- **`vehicles`, `product_vehicles`** (042) — Vehicle Type/Manufacturer/
  Model/Engine records and the verified compatibility join to
  Products. This join table is the only source of truth the app may
  ever show a customer as a compatibility fact.
- **`campaigns`** (043) — groups content + broadcasts + a product for
  funnel attribution (§13).
- **`customer_requests`** (044) — the funnel's second-half entry
  point; can originate from demo WhatsApp, real WhatsApp, a product
  page, a campaign, manual entry, or a Flows `collect_input`/
  `condition` branch.
- **`trials`** (045) — `NEW → REQUESTED → ASSIGNED → SCHEDULED → COMPLETED → CONVERTED / CANCELLED`,
  optionally linked back to a `customer_requests` row and forward to a
  `deals` row once a phase 6 Lead exists.
- **`content`, `content_translations`, `voice_notes`** (046) — the
  Content Studio pipeline and its Urdu/Pashto/Punjabi/Roman-Urdu
  content-data localization, kept deliberately separate from the
  existing `next-intl` UI-chrome localization (§10). Voice notes and
  product images both reuse the existing `chat-media` storage bucket
  (migration 023) rather than a new bucket.
- **`engagement_events`, `product_interactions`** (047) — the
  dashboard/funnel event log and the PRODUCT → CAMPAIGN → CONTENT →
  CUSTOMER → LEAD → TRIAL → CONVERSION attribution trail (§13).
  Append-only: readable by any account member, written only by the
  service role (mirrors `automation_logs` / `ai_usage_log`).
- **`whatsapp_sync_log`** (048) — WhatsApp product catalogue sync
  state per product (P1, schema now per §11 — automation wired in a
  later phase).
- **`scripts/seed.ts`** (run via `npm run db:seed`) — a re-runnable
  local/dev seed script covering every table above: 5 categories, 10
  products (mixed approval/lifecycle states on purpose), 8 vehicles,
  17 verified compatibility rows, 3 campaigns, 20 demo contacts, 6
  content items with translations and voice notes, 10 customer
  requests, 6 trials, and engagement/product-interaction event rows
  generated by looping over campaigns/products × event types.
  Programmatic (`@supabase/supabase-js`, the same admin-client pattern
  as `src/lib/automations/admin-client.ts`) rather than a hand-written
  SQL file — every statement it issues is a plain Postgres
  INSERT/DELETE via the client library, so there's no SQL dialect to
  get wrong. Provisions its demo login through the Supabase Admin API
  (`auth.admin.createUser`) instead of writing to `auth.users`
  directly. Does **not** yet seed §19's full Member/BA demographic
  volumes (that needs the `contacts`/`profiles` columns Phase 2
  adds).

## [0.8.1] — 2026-07-10

Fixes inbound chats fragmenting into multiple threads for the same
number.

> **Migration required:** apply `supabase/migrations/036_conversation_contact_dedup.sql`
> (merges any existing duplicate conversations into the oldest thread —
> no messages are lost — then adds a `UNIQUE (account_id, contact_id)`
> index so one contact can only ever have one conversation).

### Fixed

- **Duplicate chats for a single contact.** An inbound message could
  create a second conversation for a contact under a race (Meta retries a
  delivery, or a batch fans out to concurrent runs). Once two existed,
  the `.single()` lookup errored on every later message and the webhook
  created yet another conversation each time, snowballing into a wall of
  duplicate chats. The find-or-create now resolves to the oldest existing
  thread and a DB unique index makes the one-conversation-per-contact
  rule authoritative. The same hardening was applied to the public-API
  conversation resolver. (Issue #363)

## [0.8.0] — 2026-07-08

Polishes the AI auto-reply bot: it's now **visible and controllable from
the inbox**, its **handoff actually hands off**, and its **token spend is
logged**.

> **Migration required:** apply `supabase/migrations/033_ai_reply_polish.sql`
> (adds `messages.ai_generated`, `ai_configs.handoff_agent_id`,
> `conversations.ai_handoff_summary`, and the `ai_usage_log` table).

### Added

- **"AI" badge in the inbox.** Replies the bot sent are tagged with a
  small ✨ AI badge, so agents can tell an automated reply from their own
  or a Flow's at a glance. (New `messages.ai_generated` flag; only the
  auto-reply bot sets it.)
- **Take over / Resume from the thread.** A banner on AI-handled
  conversations lets an agent **Take over** (pauses the bot for that
  thread and assigns it to them) or **Resume AI** (hands the thread back
  and clears the pause). Backed by `POST /api/ai/autoreply/[id]`.
- **Real handoff.** When the bot bails (can't help, or hits the reply
  cap) it now (1) routes the conversation to a configurable **handoff
  target** — a specific agent, or the unassigned queue — and (2) leaves a
  short **internal note** summarizing the exchange for whoever picks it
  up. Assigning fires the existing assignment notification. Pick the
  target under **AI Agents → Setup → Hand off to**.
- **Token-usage logging + dashboard.** Every draft and auto-reply records
  its provider token counts to the new `ai_usage_log` table
  (admin-readable). A new **AI Agents → Usage** tab (admin-only) charts
  daily token spend on your BYO key with per-mode and per-model
  breakdowns, backed by `GET /api/ai/usage`. Counts only — no message
  content is stored or shown.

### Changed

- Auto-reply now has an **account-wide rate limit** (30/min) on top of
  the existing per-conversation cap, so a burst of inbound can't run your
  provider key past its limit. Over the limit, inbounds simply wait in
  the inbox for a human instead of being auto-answered.

## [0.7.0] — 2026-07-02

Promotes the AI assistant to a first-class **AI Agents** section in the
sidebar — it's no longer tucked inside Settings.

### Added

- **AI Agents (sidebar).** A dedicated `/agents` area with two tabs:
  - **Playground** — a test chat to message your agent and see its
    grounded, multi-turn replies (and where it would hand off to a human)
    *before* it ever answers a real customer. Runs the exact same path as
    the auto-reply bot (knowledge-base retrieval + your provider), and
    works even before you flip the master switch on, so you can try, then
    enable. Backed by `POST /api/ai/playground`.
  - **Setup** — the provider/key, business context, knowledge base, and
    auto-reply controls (moved here from Settings → AI Assistant).

### Changed

- The AI configuration moved out of **Settings → AI Assistant** into the
  new **AI Agents** section. No data change — same account config, new
  home. No migration required.

## [0.6.0] — 2026-07-02

Adds an **AI knowledge base** so the assistant (0.5.0) can answer from
your own content instead of handing off. Paste FAQs, policies, or
product details under **Settings → AI Assistant → Knowledge base**; the
relevant excerpts are retrieved into every draft and auto-reply.

### Added

- **Knowledge base with hybrid retrieval.** Lexical Postgres full-text
  search works for every account with no extra credentials. Optional
  **semantic search** (pgvector, OpenAI `text-embedding-3-small`) turns
  on when you add an **embeddings key** — semantic-primary, topped up
  with lexical to fill the result set. Anthropic-only accounts (Anthropic
  has no embeddings API) keep the lexical path with zero extra setup.
- **Knowledge base manager** in Settings — add/edit/delete documents and
  a **Reindex** action to backfill embeddings after adding a key. Both
  drafts and the auto-reply bot are grounded in the retrieved excerpts,
  and the prompt still instructs the model to hand off (auto-reply) or
  say it will follow up (draft) when the KB doesn't cover the question.
  **Migration required:** apply `supabase/migrations/030_ai_knowledge.sql`
  (enables `pgvector`; adds `ai_knowledge_documents` + `ai_knowledge_chunks`
  and an `embeddings_api_key` column on `ai_configs`).

## [0.5.0] — 2026-07-02

Adds the **AI reply assistant** — bring-your-own-key. Each account
pastes its own OpenAI or Anthropic key under **Settings → AI
Assistant**; wacrm calls the provider directly with that key, so
there's no per-seat AI fee and your conversation data never leaves
your own infrastructure for a wacrm-run service. The key is stored
AES-256-GCM-encrypted at rest (same as WhatsApp tokens) and never
returned to the client after saving.

### Added

- **AI-drafted replies in the inbox.** A ✨ button in the composer
  (agent+) reads the recent conversation and drops a suggested reply
  into the box for the agent to edit and send. Read-only server-side —
  `POST /api/ai/draft` never sends or stores anything. Respects your
  business context / persona from the settings prompt.
- **AI auto-reply bot.** When enabled, inbound messages that no
  deterministic Flow consumed and that have no agent assigned get an
  automatic LLM reply. Bounded by a per-conversation cap
  (`auto_reply_max_per_conversation`, default 3) and a clean human
  handoff: when the model can't confidently help — or the customer
  asks for a person — it stays silent and leaves the message for a
  human, and won't auto-reply on that thread again until re-enabled.
  Flows always win over the bot.
- **Settings → AI Assistant** (admin+ to edit): pick provider + model,
  paste your key, add business context/tone, toggle the assistant and
  auto-reply, set the per-conversation cap, and **Test key** against
  the provider before saving.
- Providers: OpenAI (Chat Completions) and Anthropic (Messages) behind
  one interface; model is a free-text field with sensible defaults, so
  you can point it at any current model your key can access.
  **Migration required:** apply
  `supabase/migrations/029_ai_reply.sql` (adds `ai_configs` +
  per-conversation auto-reply columns on `conversations`).

## [0.4.0] — 2026-07-01

Completes the public API (#245): **outbound event webhooks** so
automations can *react* to activity instead of polling.

### Added

- **Outbound event webhooks (`/api/v1/webhooks`).** Register an HTTPS
  endpoint (scope `webhooks:manage`) to be POSTed to when an event
  happens in your account — `message.received`, `message.status_updated`,
  or `conversation.created`. Manage endpoints with
  `GET/POST /api/v1/webhooks` and `GET/PATCH/DELETE /api/v1/webhooks/{id}`.
  Each delivery is signed with an `X-Wacrm-Signature`
  (HMAC-SHA256 over `timestamp.body`) so receivers can verify
  authenticity and reject replays; the signing secret is returned once
  at creation and stored encrypted. Delivery is best-effort — an
  endpoint that fails repeatedly is auto-disabled after a threshold of
  consecutive failures. See `docs/public-api.md`.
  **Migration required:** apply
  `supabase/migrations/028_webhook_endpoints.sql`.
  ([#245](https://github.com/ArnasDon/wacrm/issues/245))

## [0.3.0] — 2026-07-01

Multi-user accounts ship. Every wacrm install is multi-tenant on the
database side: a single user's signup creates a fresh "account", and
every row is scoped to that account rather than to the user directly.
This release also opens the user-visible **Members** surface — invite
teammates by link, manage their roles, transfer ownership — to all
users. The `'account_sharing'` beta gate that hid it during
development is removed (mirrors the Flows soft-GA in 0.2.0). Existing
self-hosted instances keep working: every existing user is backfilled
as the sole owner of their own account and sees identical data, and a
solo owner who never invites anyone sees the same single-user app they
always did.

### Added

- **Public REST API (`/api/v1`) — groundwork.** A scoped, revocable
  **API key** system so you can drive wacrm from your own scripts and
  automations. Create keys under **Settings → API keys** (admin+),
  grant only the scopes each integration needs, and authenticate with
  `Authorization: Bearer <key>`. Keys are account-scoped and stored
  hashed (plaintext shown once). This release ships the auth layer,
  scopes, per-key rate limiting, the management UI, and a
  `GET /api/v1/me` probe to verify a key. See
  `docs/public-api.md`. **Migration required:** apply
  `supabase/migrations/026_api_keys.sql`. ([#245](https://github.com/ArnasDon/wacrm/issues/245))
- **Public REST API — data endpoints.** Built on the key auth above,
  so external automations can read and drive the CRM:
  - `POST /api/v1/messages` — send a text / template / media message to
    a phone number; finds-or-creates the contact + conversation
    (`messages:send`).
  - `GET/POST /api/v1/contacts`, `GET/PATCH /api/v1/contacts/{id}` —
    list (search + tag filter), create (find-or-create by phone), read,
    and update contacts, including tags (`contacts:read` /
    `contacts:write`).
  - `GET /api/v1/conversations`, `GET /api/v1/conversations/{id}`, and
    `GET /api/v1/conversations/{id}/messages` — browse conversations and
    their message history with delivery status (`conversations:read` /
    `messages:read`).
  - `POST /api/v1/broadcasts` + `GET /api/v1/broadcasts/{id}` — launch a
    template broadcast to a recipient list and poll its progress
    (`broadcasts:send`).
  All list endpoints share one cursor-pagination contract
  (`{ data, meta: { next_cursor } }`). No migration required — the
  scopes already existed and the tables are unchanged. Outbound event
  webhooks (react to inbound messages) are the remaining roadmap item.
  See `docs/public-api.md`. ([#245](https://github.com/ArnasDon/wacrm/issues/245))

### Changed

- **Tenancy moves from per-user to per-account.** RLS on every
  domain table (contacts, conversations, messages, broadcasts,
  automations, flows, pipelines, templates, tags, …) now checks
  account membership via a new SECURITY DEFINER helper
  `is_account_member(account_id, min_role)` instead of
  `auth.uid() = user_id`. The `user_id` columns stay on every row
  for assignment / audit but no longer enforce isolation.
- **WhatsApp config is one-per-account, not one-per-user.** The
  `whatsapp_config.UNIQUE(user_id)` constraint is replaced by
  `UNIQUE(account_id)`.
- **`flow_runs` idempotency key swaps to `(account_id, contact_id)`**
  so two accounts sharing a contact phone number can each run their
  own flows independently.
- **The signup trigger (`handle_new_user`) now also creates a
  personal account** and links the new profile to it as `owner`.

### Changed

- **Flow-media storage is now account-scoped.** Migration 016
  pathed uploaded files under `auth.uid()/...`, which orphaned
  flow media when a teammate left a shared account. New uploads
  go under `account-<account_id>/...` and any account member
  with the right role can edit them. Legacy paths remain
  writable by the original uploader for backward compatibility.
- **Webhook contact lookup now pre-filters in SQL.** Previously
  pulled every contact in an account just to JS-filter to one
  row by phone — fine when account = one user, painful when
  account = team. Pre-filter by phone suffix on the database
  side; re-apply `phonesMatch` on the (typically 0-2 row)
  candidate set.

### Migration required

- `supabase/migrations/020_account_sharing_followups.sql` —
  composite partial indexes on `automations(account_id,
  trigger_type) WHERE is_active` and `flows(account_id) WHERE
  status='active'` for the engine dispatch hot path; updated
  `flow-media` storage RLS to allow account-member writes under
  the new path convention. Idempotent.

- **Role-aware UI gating across the app.** The inbox composer's
  send button + textarea, the "New broadcast / automation / flow"
  buttons, the "Add pipeline / deal" buttons, and the "Add /
  Import contact" buttons are now disabled-with-tooltip for
  viewers (and for agents on settings-class actions). Choice:
  show-but-disable rather than hide, so the UI never feels
  silently broken to a teammate looking at a feature they don't
  yet have permission for.
- **Sidebar surfaces the active account** above the user info
  whenever the account name differs from your own — i.e. once
  you've renamed the account or joined a shared one. A default
  solo account is named after you, so the strip stays hidden to
  avoid duplicating your name in the footer.
- **Members is open to all users.** The `account_sharing` beta
  flag that hid the Settings → Members tab and the sidebar
  account strip during development is gone; the multi-user
  surface is now part of the standard app. (Same soft-GA move as
  Flows in 0.2.0.)

### Fixed

- **Inbound WhatsApp messages now land in the shared inbox.** The
  webhook + automations + flows engines used to route inbound
  events by `user_id`, which after the 017 migration only matched
  the WhatsApp config owner's automations / flows — teammates'
  rules never fired. PR 8 of the multi-user series flips every
  lookup to `account_id` so any member of the account sees the
  inbound message and any teammate's automation or flow can react
  to it. Also fixes incipient NOT NULL violations on
  `automation_logs`, `automation_pending_executions`, `flow_runs`,
  and `deals` — those tables gained `account_id NOT NULL` in 017
  but the engines hadn't yet been updated to populate it.

### Added

- **Duplicate phone numbers are now prevented across contacts.** A
  phone number can no longer become more than one contact in the same
  account. Adding a contact whose number already exists is blocked
  with a link to the existing record (and a softer warning for
  near-matches that share their last 8 digits); CSV import de-dupes
  within the file and against existing contacts, reporting
  "X imported, Y duplicates skipped". The rule is enforced by a
  database unique index on the normalized number, so the WhatsApp
  webhook, the form, import, and any future path all agree. Existing
  duplicates are merged into the oldest contact on upgrade (their
  conversations, deals, notes, and tags are re-pointed, nothing is
  lost). Closes #212.
- **Configurable default deal currency.** Each account can now pick
  its default currency under **Settings → Deals** (admin+); the app
  previously hardcoded USD throughout. New deals default to it, and
  pipeline-stage totals, the dashboard "Open Deals Value" card, the
  pipeline-value donut, and automation-created deals all use it.
  Existing deals keep the currency they were saved with — totals are
  shown in the account default with no exchange-rate conversion (one
  currency per account). Full guide:
  [Default currency](https://wacrm.tech/docs/settings#deals).
- **Members tab in Settings.** The user-facing surface for the
  multi-user APIs below, available to everyone (no beta flag). From
  Settings → **Members** an admin or owner can: see who's on the
  account with their role and join date, invite teammates by
  generating a one-time share link (pick the role + optional
  expiry), revoke pending invites, change a member's role, remove a
  member, and — as owner — transfer ownership. Recipients accept via
  a public `/join/[token]` page. Full guide:
  [Members docs](https://wacrm.tech/docs/members).
- **Account & member management API** — server-side endpoints
  backing the Members tab. All routes are role-gated and
  return Supabase-RLS-scoped data.
  - `GET /api/account` — caller's account + role. Any member.
  - `PATCH /api/account` — rename the account. Admin+.
  - `GET /api/account/members` — list members. Email visible to
    admin+ only; agents/viewers see name + avatar + role +
    joined date.
  - `PATCH /api/account/members/[userId]` — change a member's
    role. Admin+. Owner promotion/demotion goes through the
    transfer endpoint instead.
  - `DELETE /api/account/members/[userId]` — remove a member.
    Admin+. The removed user keeps their login and is moved to a
    freshly-created personal account (mirror of the signup flow).
  - `POST /api/account/transfer-ownership` — owner only. Atomic
    swap with the named member.
- **Invitation API + redeem flow** — the no-email, link-only
  invite path that powers the Members tab's "Invite member" button
  and the `/join/[token]` accept page.
  - `GET /api/account/invitations` — list outstanding (admin+).
  - `POST /api/account/invitations` — create an invite, returns
    the plaintext token + share URL **exactly once** (we store
    only the SHA-256 hash on the row). Body
    `{ role, expiresInDays?, label? }`. Admin+.
  - `DELETE /api/account/invitations/[id]` — revoke (admin+).
  - `GET /api/invitations/[token]/peek` — public, per-IP
    rate-limited. Returns `{ ok, account_name, role, expires_at }`
    or `{ ok: false, reason }` so the join page can render
    "You're being invited to <Account> as <Role>".
  - `POST /api/invitations/[token]/redeem` — authenticated.
    Atomically moves the caller's profile to the inviter's
    account and cleans up the orphan personal account. Refuses
    with 409 if the caller's current account already contains
    domain data (no silent data loss).

### Migration required

Apply against your Supabase project before deploying this version:

- `supabase/migrations/017_account_sharing.sql` — introduces the
  `accounts` and `account_invitations` tables plus an
  `account_role_enum` type; adds `account_id` to every
  user-scoped table and backfills it; rewrites every RLS policy;
  replaces the new-user trigger. Idempotent. **No data loss** —
  every existing user is mapped to a freshly-created account
  with role `owner` and every existing row of theirs is linked
  to that account.
- `supabase/migrations/018_account_member_rpcs.sql` — adds three
  `SECURITY DEFINER` RPCs (`set_member_role`,
  `remove_account_member`, `transfer_account_ownership`) that
  back the member-management API. They self-check the caller's
  role and raise SQLSTATE `42501` / `22023` on forbidden / bad
  input so the API layer can map cleanly to 403 / 400.
  Idempotent.
- `supabase/migrations/019_invitation_rpcs.sql` — adds two
  `SECURITY DEFINER` RPCs: `peek_invitation` (anonymous read by
  token hash, returns a fixed-shape JSON envelope) and
  `redeem_invitation` (authenticated atomic move + orphan
  cleanup, with a domain-data safety check). Both bypass the
  RLS that would otherwise block their reads/writes. Idempotent.
- `supabase/migrations/021_account_default_currency.sql` — adds
  `accounts.default_currency` (`TEXT NOT NULL DEFAULT 'USD'`, with a
  3-letter-code `CHECK`) backing the configurable default currency.
  Idempotent; existing accounts backfill to `USD`. **Apply before
  deploying** — the app now reads this column when loading the
  account, so an un-migrated database breaks account loading.
- `supabase/migrations/022_contact_phone_dedup.sql` — adds the
  generated `contacts.phone_normalized` column, **merges existing
  duplicate contacts into the oldest** (re-pointing conversations,
  deals, notes, tags, custom values, and broadcast recipients — no
  data loss), then adds a `UNIQUE (account_id, phone_normalized)`
  index. Idempotent. **Apply before deploying** — CSV import reads
  `phone_normalized`, and the index is what enforces de-duplication
  for every write path. The one-shot merge runs inside the migration.

## [0.2.2] — 2026-05-29

Flow nodes can now send media. Closes the most-requested gap from user
feedback after the v0.2.0 Flows launch — flows were text-only and
couldn't deliver an invoice, receipt, product photo, or short demo
video mid-conversation.

### Added

- **`send_media` flow node.** Send an image (PNG / JPEG / WebP), video
  (MP4 / 3GP), or document (PDF, Word, Excel, PowerPoint, TXT) to the
  customer from any point in a flow. Pick a file in the builder, it
  uploads to the new `flow-media` Supabase Storage bucket, and Meta
  fetches the public URL at send time. Optional caption (1024 char cap,
  supports `{{vars.X}}` interpolation); documents also take an optional
  filename shown in the recipient's chat. Auto-advances after send —
  same suspend semantics as `send_message`.
  ([#156](https://github.com/ArnasDon/wacrm/pull/156))

### Migration required

Apply against your Supabase project before deploying this version:

- `supabase/migrations/016_flow_media.sql` — does two things:
  1. Adds `'send_media'` to the `flow_nodes.node_type` CHECK
     constraint. Without this the `send_media` node fails to save with
     a constraint violation.
  2. Creates the public `flow-media` Supabase Storage bucket (16 MB
     file-size cap, image / video / document MIME allowlist) plus
     per-user RLS policies (path prefix = `auth.uid()`). Without this
     the builder's file picker fails on upload. Same shape as the
     `avatars` bucket from migration 008 — the bucket is **public** so
     Meta can fetch the URL without credentials.

The migration is idempotent and safe to re-run.

## [0.2.1] — 2026-05-26

Bug-fix release. Plugs a silent inbound-message drop that triggered
when two users on the same instance saved the same WhatsApp
`phone_number_id`.

### Fixed

- **Inbound WhatsApp messages no longer silently disappear** when two
  users have claimed the same `phone_number_id`. Previously the
  webhook used `.single()` to look up the owning config, which errors
  `PGRST116` for both 0 rows *and* ≥2 rows — the second user's save
  put the DB into the ≥2-row state and every inbound message was
  dropped while the log misleadingly reported *"No config found for
  phone_number_id"*. Three layers of fix: `POST /api/whatsapp/config`
  now returns **409** when another user has already claimed the
  number, the webhook lookup distinguishes 0 rows from ≥2 rows and
  logs the conflicting `user_id`s, and a new DB constraint
  (`UNIQUE(phone_number_id)`) prevents the bad state at the storage
  layer. Reported in
  [#136](https://github.com/ArnasDon/wacrm/issues/136), fixed in
  [#143](https://github.com/ArnasDon/wacrm/pull/143).

### Migration required

Apply against your Supabase project before deploying this version:

- `supabase/migrations/013_whatsapp_config_phone_number_id_unique.sql`
  — adds `UNIQUE(phone_number_id)` to `whatsapp_config`. **Fails
  loudly with a copy-pasteable resolution hint** if duplicate rows
  already exist; auto-deduping would destroy encrypted tokens, so
  the operator picks which row keeps the number. To check first:

  ```sql
  SELECT phone_number_id, array_agg(user_id) AS owners, count(*) AS n
  FROM whatsapp_config
  GROUP BY phone_number_id
  HAVING count(*) > 1;
  ```

  If that returns rows, `DELETE` the duplicate row(s) you want to
  drop, then re-run the migration.

### Note on multi-user setups

wacrm is intentionally **single-tenant per WhatsApp number**. RLS on
`conversations`/`messages` is `auth.uid() = user_id`, so a second
user physically cannot read messages routed to a different owner —
two users sharing one number was never supported. If you need
multiple humans handling the same inbox, run them under one shared
account.

## [0.2.0] — 2026-05-22

The **Flows** release. Adds a no-code, branching, button-driven WhatsApp
conversation engine that runs alongside Automations. Also ships a
5-theme color picker in Settings and opens Flows to all users.

### Added

#### Flows — branching chatbot conversations

- **Module + schema.** New `flows`, `flow_nodes`, `flow_runs`,
  `flow_run_events` tables with partial unique indexes that enforce
  one active run per contact. Widened `messages.content_type` CHECK
  to accept `'interactive'`; added `interactive_reply_id` column so
  the inbox can render button/list taps.
  ([#112](https://github.com/ArnasDon/wacrm/pull/112))
- **Runner engine.** `dispatchInboundToFlows` parses every inbound
  webhook, decides whether the message is a reply on an active run
  or a fresh trigger, advances the state machine, and reports back
  to the webhook so consumed messages don't also fire automations.
  Idempotent on Meta's `message_id`.
  ([#114](https://github.com/ArnasDon/wacrm/pull/114))
- **No-code builder UI** at `/flows`. Linear-list editor with
  per-node config forms, live validator, draft/active/archived
  status, and a 5-route REST API (`GET/POST /api/flows`,
  `GET/PUT/DELETE /api/flows/[id]`, `POST /api/flows/[id]/activate`,
  `GET /api/flows/[id]/runs`, `GET /api/flows/templates`).
  ([#115](https://github.com/ArnasDon/wacrm/pull/115))
- **Templates + v1.5 node types.** Three starter templates
  (Welcome menu, FAQ bot, Lead capture) cloneable from the New-flow
  dialog. Three new node types: `collect_input` (capture customer
  text into a variable), `condition` (branch on var / tag / contact
  field), `set_tag` (add or remove a tag). `{{vars.X}}` interpolation
  in send_message + collect_input prompts. Per-flow run-history
  viewer at `/flows/[id]/runs`.
  ([#117](https://github.com/ArnasDon/wacrm/pull/117))
- **Stale-run sweep cron** at `GET /api/flows/cron` — marks runs
  past their configured timeout (default 24h) as `timed_out` so
  abandoned conversations free up the contact for new triggers.
  Reuses `AUTOMATION_CRON_SECRET`.
  ([#114](https://github.com/ArnasDon/wacrm/pull/114))

#### Color themes

- **5 color themes** (Violet default, Emerald, Cobalt, Amber, Rose)
  selectable from a new **Appearance** tab in Settings. CSS variables
  scoped under `html[data-theme="..."]`, applied at runtime via
  `dataset.theme`, persisted to `localStorage`. Inline boot script in
  `layout.tsx` replays the choice before first paint so there's no
  flash of the default.
  ([#132](https://github.com/ArnasDon/wacrm/pull/132))
- **Theme tokenization sweep** — every previously hard-coded
  `violet-*` Tailwind class replaced with `primary` tokens across
  ~49 files. Picking a non-violet theme now themes the whole app,
  not just the chrome.
  ([#133](https://github.com/ArnasDon/wacrm/pull/133))

### Changed

#### Flows — soft-GA

- **Flows is now available to every authenticated user.** The
  per-account beta gate is gone; the sidebar entry + page header
  carry a small "Beta" chip as the only remaining signal.
  ([#134](https://github.com/ArnasDon/wacrm/pull/134))
- **Editor UX**:
  - Internal `node_key` + per-button/row `reply_id` identifiers
    hidden behind a per-node "Show advanced" disclosure.
    ([#118](https://github.com/ArnasDon/wacrm/pull/118))
  - `send_list` nodes can have multiple sections.
    ([#119](https://github.com/ArnasDon/wacrm/pull/119))
  - Collapsed node cards show a 1-line content preview per node
    type (text excerpt, button titles, condition summary, etc.).
    ([#120](https://github.com/ArnasDon/wacrm/pull/120))
  - Validation issues are clickable: jump to + flash the offending
    node.
    ([#121](https://github.com/ArnasDon/wacrm/pull/121))
  - Unsaved-changes "● Edited" indicator + `beforeunload` reload
    guard.
    ([#122](https://github.com/ArnasDon/wacrm/pull/122))
  - New-flow dialog actually widens to fit the 3 template cards
    (was capped at 384px by a baked-in `sm:max-w-sm` from shadcn).
    ([#129](https://github.com/ArnasDon/wacrm/pull/129),
    [#131](https://github.com/ArnasDon/wacrm/pull/131))
  - Validation panel pinned to the viewport bottom so
    activate-readiness follows the user as they scroll through nodes.
    ([#130](https://github.com/ArnasDon/wacrm/pull/130))

#### Engine reliability

- **Atomic `execution_count` increment** via SECURITY DEFINER RPC —
  prevents lost counts when two webhooks start runs concurrently.
  Mirrors the automations engine pattern.
  ([#124](https://github.com/ArnasDon/wacrm/pull/124))
- **Preload all flow_nodes once per dispatch** — one SELECT per
  inbound instead of one per advance-loop iteration. A 5-node
  auto-advance chain now costs 1 round trip, not 5.
  ([#125](https://github.com/ArnasDon/wacrm/pull/125))
- **Wasted re-read dropped** after reprompt reset; `loadActiveRun`
  switched to defensive `.limit(1)` so a migration glitch producing
  duplicates can't crash dispatch.
  ([#126](https://github.com/ArnasDon/wacrm/pull/126))

### Security

- **PII redacted from `reply_received` event payload** — customer
  text is no longer persisted to `flow_run_events.payload`; only
  the length is. A `collect_input` prompt asking "what's your card
  number?" used to leave the PAN sitting in the events table.
  ([#123](https://github.com/ArnasDon/wacrm/pull/123))
- **Constant-time cron-secret compare** on `/api/flows/cron`
  (`crypto.timingSafeEqual`) to close a theoretical
  timing-side-channel on the `x-cron-secret` header check.
  ([#127](https://github.com/ArnasDon/wacrm/pull/127))

### Fixed

- **`/flows` no longer spuriously redirects to `/dashboard`** when
  navigating in. Root cause: `useAuth` flipped `loading: false`
  before the profile fetch resolved. `use-auth` now exposes a
  separate `profileLoading` boolean.
  ([#128](https://github.com/ArnasDon/wacrm/pull/128))

### Migration required

Apply, in order, against your Supabase project:

1. `supabase/migrations/010_flows.sql` — Flows core tables, indexes,
   RLS policies, and the `messages` schema widening.
2. `supabase/migrations/011_profile_beta_features.sql` — adds the
   `profiles.beta_features` column. Surviving for future betas;
   Flows no longer reads it.
3. `supabase/migrations/012_flows_increment_counter.sql` — atomic
   counter RPC. Without this the engine still runs but
   `flows.execution_count` is racy.

Each migration is idempotent — safe to re-run if you're not sure
whether you applied a previous one.

### Removed

- **`src/lib/flows/feature-flag.ts`** + its tests. Flows is open to
  all users; the `profiles.beta_features` column itself survives
  for future beta gates.
  ([#134](https://github.com/ArnasDon/wacrm/pull/134))

---

## [0.1.1] — 2026-05-19

### Added

- Chat actions in the inbox: emoji reactions, reply-with-quote, and
  copy-text on individual messages. Hover on desktop, long-press on
  touch. Outbound reactions and replies forward to WhatsApp via the
  Cloud API; inbound reactions and swipe-replies from customers
  arrive through the webhook and appear in real time.

### Migration required

- Apply `supabase/migrations/009_message_actions.sql` to your
  Supabase project. It adds `messages.reply_to_message_id` and the
  new `message_reactions` table (with RLS and realtime). The
  migration is idempotent — safe to re-run.

### Changed

- The webhook no longer stores inbound customer reactions as fake
  text messages. They are written to `message_reactions` instead,
  so any custom queries that counted reactions as messages will
  need updating.

---

## [0.1.0]

Initial template release. Core CRM: inbox, contacts, pipelines,
broadcasts, automations (with a Wait-step cron drain), WhatsApp
Cloud API integration, Supabase auth + RLS.
