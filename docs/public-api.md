# Public API (`/api/v1`)

The public API lets you drive your wacrm instance from your own
scripts and automations — send messages, manage contacts, launch
broadcasts — without going through the dashboard UI.

> **Status:** stable. Authentication, scopes, rate limiting, the
> messages / contacts / conversations / broadcasts endpoints, and
> outbound event [webhooks](#webhooks) all ship now.

## Authentication

Every request authenticates with an **API key**, sent as a bearer
token:

```
Authorization: Bearer wacrm_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Keys are **account-scoped**: a key acts on exactly one account, the
one it was created in. There is no cross-account access.

### Creating a key

In the dashboard: **Settings → API keys → New API key**. Only
**admins and owners** can create keys.

1. Give the key a name (after the integration that will use it).
2. Grant the **scopes** it needs — nothing more (see below).
3. Copy the key. **The full key is shown exactly once.** wacrm
   stores only a SHA-256 hash, so it can never be shown again. If you
   lose it, revoke it and create a new one.

### Revoking a key

**Settings → API keys → Revoke.** Revocation is effective on the
key's next request. Revoked keys stay in the list as an audit trail.

## Scopes

A key can do only what its scopes allow — independent of who created
it. Grant the minimum.

| Scope                | Allows                                   |
| -------------------- | ---------------------------------------- |
| `messages:send`      | Send WhatsApp messages                   |
| `messages:read`      | Read messages and delivery status        |
| `contacts:read`      | List and read contacts                   |
| `contacts:write`     | Create and update contacts               |
| `conversations:read` | List and read conversations              |
| `channels:read`      | List the account's WhatsApp numbers      |
| `broadcasts:send`    | Launch broadcast campaigns               |
| `webhooks:manage`    | Register and manage outbound webhooks    |
| `tasks:read`         | List and read tasks                      |
| `tasks:write`        | Create tasks for team members            |
| `scheduled:read`     | List scheduled messages                  |
| `scheduled:write`    | Schedule text messages                   |
| `deals:read`         | List pipelines, stages and deals         |
| `deals:write`        | Create deals and move them between stages |
| `meetings:read`      | List calendar meetings                   |
| `meetings:write`     | Create calendar meetings                 |
| `notes:read`         | Read internal conversation notes         |
| `notes:write`        | Create internal conversation notes       |
| `custom_fields:read` | Read contact custom field values         |
| `custom_fields:write`| Write contact custom field values        |

A key with **no scopes** still authenticates and can call
`GET /api/v1/me` — useful for verifying a key works.

## Response envelope

Every response uses one of two shapes:

```jsonc
// success
{ "data": { /* ... */ } }

// failure
{ "error": { "code": "forbidden", "message": "This API key is missing the 'messages:send' scope" } }
```

Branch on `error.code` (stable); `error.message` is for humans and
may be reworded.

| Status | `code`         | Meaning                                          |
| ------ | -------------- | ------------------------------------------------ |
| 401    | `unauthorized` | Missing / malformed / unknown / revoked / expired key |
| 403    | `forbidden`    | Valid key, but missing the required scope        |
| 429    | `rate_limited` | Per-key rate limit exceeded                      |
| 400    | `bad_request`  | Malformed input                                  |
| 404    | `not_found`    | No such resource                                 |
| 500    | `internal`     | Server error                                     |

## Rate limits

Requests are limited **per key**: **120 requests per minute**. On a
`429`, these headers tell you when to retry:

- `Retry-After` — seconds until the window resets
- `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

> The limiter is in-memory and **per process**. A single-instance
> deploy (the common case for a self-hosted fork) is fine as-is. If
> you scale to multiple instances, swap the limiter for a shared
> store (Redis/Upstash) — see the note at the top of
> `src/lib/rate-limit.ts`. The limit is otherwise unenforced across
> instances.

## Endpoints

### `GET /api/v1/me`

Returns the account a key is bound to and the scopes it carries.
Requires only a valid key (no scope). Use it to verify a key works
and to discover its scopes.

```bash
curl https://your-crm.example.com/api/v1/me \
  -H "Authorization: Bearer wacrm_live_xxx"
```

```json
{
  "data": {
    "account": { "id": "…", "name": "Acme Inc" },
    "key": { "id": "…", "scopes": ["messages:send"] }
  }
}
```

### `POST /api/v1/messages`

Send a WhatsApp message to a phone number. Scope: `messages:send`. You
pass an **E.164 number**, not an internal id — the endpoint
finds-or-creates the contact + conversation, then sends.

> **Side effect — deals.** A successful send counts as the firm reaching
> out, so if the contact has **no deal yet** in any pipeline, one is
> created automatically in the channel's default pipeline/stage
> (`source: 'channel'`) — the same rule as sends from the CRM composer.
> At most one deal per contact is ever created this way; contacts that
> already have a deal are left untouched. This is intentional (PR #79);
> if your integration must not open deals, don't send through this
> endpoint for those contacts.

```bash
curl -X POST https://your-crm.example.com/api/v1/messages \
  -H "Authorization: Bearer wacrm_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{ "to": "+14155550123", "type": "text", "text": "Hi 👋" }'
```

`type` is `text` (default), `template`, or a media kind (`image` /
`video` / `document` / `audio`). Media needs `media_url` (and optional
`filename`); `text` doubles as the caption. `template` needs a
`template` object:

```jsonc
{
  "to": "+14155550123",
  "type": "template",
  "template": {
    "name": "order_update",
    "language": "en_US",
    "params": ["A123"]        // positional body vars, or a structured object
  },
  "reply_to_message_id": "<uuid>",  // optional; must be in the same conversation
  "channel_id": "<uuid>"            // optional; which number to send FROM
}
```

Response (201):

```json
{
  "data": {
    "message_id": "…",
    "whatsapp_message_id": "wamid.…",
    "conversation_id": "…",
    "contact_id": "…",
    "contact_created": true
  }
}
```

Domain error codes beyond the table above: `whatsapp_not_configured`
(400), `meta_error` (502 — the request reached Meta and it rejected the
send), `template_malformed` (500).

### `GET /api/v1/contacts`

List contacts, newest first. Scope: `contacts:read`. Paginated (see
[Pagination](#pagination)). Optional filters: `?search=` (matches name
or phone) and `?tag=<tagId>`.

```json
{
  "data": [
    {
      "id": "…", "phone": "+14155550123", "name": "Jane Doe",
      "email": null, "company": "Acme", "avatar_url": null,
      "tags": [{ "id": "…", "name": "vip", "color": "#3b82f6" }],
      "created_at": "…", "updated_at": "…"
    }
  ],
  "meta": { "next_cursor": "…" }
}
```

> **Instagram (since migration 989):** a contact that only exists on
> Instagram Direct has `phone: null` and carries `instagram_id` (the IGSID)
> and `instagram_username` instead. Both fields are present on every
> contact object (`null` for WhatsApp-only contacts). `POST /contacts`
> still requires `phone` — Instagram contacts are created by the Direct
> webhook, never by the API.

### `POST /api/v1/contacts`

Create a contact. Scope: `contacts:write`. `phone` (E.164) is required;
`name`, `email`, `company`, and `tags` (an array of tag names, created
if missing) are optional. **Find-or-create by phone:** an existing
match returns `200` with the existing contact; a new contact returns
`201`. The response body is the serialized contact (same shape as the
list rows above).

### `GET` / `PATCH /api/v1/contacts/{id}`

Read or update one contact. Scopes: `contacts:read` / `contacts:write`.
`PATCH` updates only the fields you send (`name`, `email`, `company`);
pass `tags` (an array of tag names) to **replace** the contact's tags. A
contact in another account returns `404`.

> ⚠️ `tags` here replaces the whole set — sending `["Lead"]` removes
> every other tag the contact had. To add or drop individual tags, use
> `POST /api/v1/contacts/{id}/tags` below.

### `POST /api/v1/contacts/{id}/tags`

Add and remove tags **by name, without touching the others**. Scope:
`contacts:write`. This is what an external flow (Typebot, n8n) should
call to label a lead — the `tags` array on `PATCH` would wipe the rest
of the contact's labels and still answer `200`.

```jsonc
{
  "add": ["Typebot", "Lead novo"],   // optional
  "remove": ["Desqualificado"],      // optional
  "create_missing": true             // optional, default true
}
```

- Names are matched **case- and accent-insensitively**, and trimmed: `"vip"`
  finds an existing `"VIP"`, and `"bancario"` finds an existing `"Bancário"`.
  Two names that differ only by accent or case are the **same tag** — the
  database enforces this with a unique index, so a second one cannot be
  created. The response echoes the spelling **you sent**, while the
  `contact.tags` array carries the stored spelling; when they differ, the
  stored one is the tag you got.
- `create_missing` (default `true`) creates tags in `add` that don't
  exist yet. It never applies to `remove` — an unknown name there is
  reported, not created.
- The **same name in both `add` and `remove` is rejected** (`400`):
  either order would be a convention invisible to the caller.
- At least one of `add` / `remove` must be non-empty; at most 50 names
  per request.

Response is the contact plus a summary of what actually changed —
enough to debug "I tagged the lead and nothing happened" without a
second call:

```jsonc
{
  "data": {
    "contact": { "id": "…", "tags": [ /* … */ ] },
    "adicionadas":  ["Typebot"],       // now applied
    "removidas":    ["Desqualificado"],// now gone
    "inalteradas":  ["Lead novo"],     // already in the requested state
    "desconhecidas": []                // no such tag in this account
  }
}
```

Applying a tag **fires `tag_added` automations** (once per tag actually
added — a duplicate is a no-op and triggers nothing), and both adding
and removing are recorded in the contact's activity trail.

### `GET /api/v1/tags`

List the account's tags (`id`, `name`, `color`), ordered by name. Scope:
`contacts:read`. Not paginated. Use it to discover the names accepted by
`POST /api/v1/contacts/{id}/tags`.

### `GET` / `PATCH /api/v1/contacts/{id}/custom-fields`

Read or write the contact's **custom field values**, addressed by the
stable `field_key` (shown in the field manager next to each field —
e.g. `utm_source`, `ctwa_clid`, `data_da_proposta`). Scopes:
`custom_fields:read` / `custom_fields:write`. This is the endpoint an
external orchestrator (n8n etc.) uses to store ad-tracking data on the
lead and read it back later.

`GET` returns the whole account catalogue with this contact's values:

```json
{
  "data": {
    "contact_id": "…",
    "fields": [
      { "key": "utm_source", "name": "utm_source", "type": "text",
        "category": "tracking", "value": "facebook" },
      { "key": "origem_da_divida", "name": "Origem da dívida",
        "type": "select", "category": "geral",
        "options": ["Apenas CPF", "CPF e CNPJ"], "value": null }
    ],
    "values": { "utm_source": "facebook", "origem_da_divida": null }
  }
}
```

> **The `email` field mirrors the contact's e-mail.** Every account has
> one custom field (usually keyed `email`) that is kept identical to the
> contact's `email`, in both directions, by the database. Writing it here
> changes the contact's `email`; `PATCH /api/v1/contacts/{id}` with a new
> `email` changes this field; clearing either clears both. It cannot be
> deleted from the dashboard.

(Every success response is wrapped in the `data` envelope, like the
rest of the v1 API.) `values` is the same payload as a flat map —
index it from an n8n expression as `data.values.utm_source`. `value` is always the raw stored text (`type` tells
you how the dashboard renders it; `datetime` values are ISO-8601 UTC).
An empty value is always `null` on the wire, no matter which writer
left it empty.

`PATCH` writes by key. `""`, `null` (or a whitespace-only string)
**clears** a value. Numbers and booleans are stringified. Values are
capped at **4000 characters**. `datetime` fields only accept an
ISO-8601 instant **with an explicit offset** (`2026-08-30T14:00:00-03:00`
or `…Z`) and are stored normalized to UTC — anything else is a `400`,
because a date without an offset silently shifts by the server/client
timezone gap and a non-ISO date would never fire the date reminder.
`select` and `number` values are stored as free text (the dashboard
tolerates values outside the option list). An **unknown key fails the
whole request** with `400` and the offending keys listed — a typo must
surface on the first call, not months later. Response = the post-write
`GET` payload (note this means a write-only key sees the catalogue and
current values in the response of its own writes).

```json
{ "values": { "utm_source": "facebook", "fbclid": "IwAR…", "utm_term": null } }
```

### `GET /api/v1/conversations`

List conversations, newest first. Scope: `conversations:read`.
Paginated. Optional filters: `?status=` (`open` / `pending` / `closed`)
and `?contact_id=`. Each conversation embeds its contact + tags.

### `GET /api/v1/conversations/{id}`

Read one conversation. Scope: `conversations:read`. `404` if it belongs
to another account.

### `GET /api/v1/conversations/{id}/messages`

List a conversation's messages, newest first. Scope: `messages:read`.
Paginated. Each message includes its `direction` (`inbound` /
`outbound`), `status` (delivery state), `whatsapp_message_id`, and
`content_*`. The conversation is verified to belong to your account
first (`404` otherwise).

### `POST /api/v1/broadcasts`

Launch a template broadcast to a list of recipients. Scope:
`broadcasts:send`. The broadcast + its recipient rows are persisted
immediately and the sends fan out in the background, so the call
returns fast — poll `GET /api/v1/broadcasts/{id}` for progress.

```bash
curl -X POST https://your-crm.example.com/api/v1/broadcasts \
  -H "Authorization: Bearer wacrm_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{
        "name": "July promo",
        "template_name": "promo_july",
        "template_language": "en_US",
        "recipients": [
          { "to": "+14155550123", "params": ["Jane"] },
          { "to": "+14155550124" }
        ]
      }'
```

Recipients are capped at **1000 per request** — split larger sends.
Invalid phone numbers are dropped and counted as `rejected`. Response
(202):

```json
{
  "data": {
    "broadcast_id": "…",
    "status": "sending",
    "total_recipients": 2,
    "accepted": 2,
    "rejected": 0
  }
}
```

### `GET /api/v1/broadcasts/{id}`

Broadcast status + counts. Scope: `broadcasts:send`. `status` moves
`sending` → `sent`; `delivered_count` / `read_count` keep climbing as
Meta delivery webhooks arrive. `404` for another account's broadcast.

### `GET /api/v1/channels`

List the account's WhatsApp numbers. Scope: `channels:read`.

An account can have several numbers — official Meta (Cloud API) ones and
unofficial QR-code ones. Every id returned here is a valid `channel_id`
for `POST /api/v1/messages` and `POST /api/v1/broadcasts`.

```jsonc
{
  "data": [
    {
      "id": "<uuid>",
      "label": "Comercial",
      "kind": "meta",          // "meta" = official Cloud API; "evolution" = QR code
      "display_phone": "+55 11 …",
      "is_default": true,
      "status": "connected",
      "connected_at": "2026-07-01T12:00:00Z"
    }
  ]
}
```

**`kind` decides what the number can do.** Only `meta` numbers accept
templates and interactive (button/list) messages. Sending a template
through an `evolution` number fails with `not_supported`.

### Choosing which number to send from

`POST /api/v1/messages` accepts an optional `channel_id`.

- **Omitted** — the message goes out on the number the conversation is
  already on, falling back to the account default. Note this "follows the
  customer": if they last wrote to a different number of yours, the reply
  goes out from that one.
- **Set** — the message goes out from that number *and* pins the
  conversation to it, so the customer's reply comes back to the same
  number they saw. An id that isn't a channel of your account returns
  `400 bad_request`.

The `201` response includes `channel_id` — the number the message
**actually** went out on, which is what you should record for auditing.

`POST /api/v1/broadcasts` also accepts `channel_id`, but it must be an
official Meta number (broadcasts are template-only). Omitted, it picks
the first usable Meta number (account default first). If the account has
none, the call returns `meta_channel_required`.

### `GET /api/v1/tasks`

List tasks, newest first. Scope: `tasks:read`. Paginated. Optional
filters: `?contact_id=`, `?responsavel_user_id=`, `?status=`
(`aberta` / `concluida`).

Each task carries `vence_em` (`YYYY-MM-DD`, a plain calendar date with
**no timezone** — don't feed it to `new Date()` as-is) and `vence_as`
(`HH:MM:SS`, or `null` for an all-day task), plus the frozen
`criador_nome` / `responsavel_nome` (they survive the member leaving
the account).

### `POST /api/v1/tasks`

Create a task about a contact, assigned to a team member. Scope:
`tasks:write`.

```jsonc
{
  "contact_id": "<uuid>",            // required — who the task is about
  "responsavel_user_id": "<uuid>",   // required — must be a member of the account
  "titulo": "Ligar sobre o contrato", // required, 1–200 chars
  "descricao": "…",                  // optional, ≤ 4000 chars
  "vence_em": "2026-09-01",          // required, YYYY-MM-DD
  "vence_as": "14:30",               // optional, HH:MM
  "importante": true                 // optional
}
```

The assignee is notified in-app (unless the task lands on the API's
own audit user). Replies and sub-tasks (`tarefa_pai_id`) are
dashboard-only. Response: `201` with the task.

### `GET /api/v1/tasks/{id}`

Read one task. Scope: `tasks:read`. `404` for another account's task.

### `GET /api/v1/scheduled-messages`

List scheduled messages, newest first. Scope: `scheduled:read`.
Paginated. Optional filters: `?conversation_id=`, `?status=`
(`pending` / `sending` / `sent` / `failed`).

Two fields matter when reading failures: `error` (human-readable
reason) and `entrega_incerta` — when `true`, the send failed *after*
WhatsApp may have accepted the message, so **never re-send from such a
row**; the customer could receive it twice.

### `POST /api/v1/scheduled-messages`

Schedule a **text** message into an existing conversation. Scope:
`scheduled:write`. Attachments and quoted replies are dashboard-only.

```jsonc
{
  "conversation_id": "<uuid>",              // required
  "body": "Bom dia! Passando para lembrar…", // required, ≤ 4000 chars
  "scheduled_for": "2026-09-01T09:00:00-03:00" // required, ISO-8601 WITH offset, future, ≤ 365 days ahead
}
```

`scheduled_for` **must carry a timezone offset** (`Z` or `±HH:MM`) —
without one, "14:00" would be read in the server's timezone and the
message would fire at the wrong hour with no error anywhere.

The sending channel is resolved **now** and frozen on the row (it does
not follow the conversation later). Domain error codes: `no_channel`
(409 — the account has no registered connection) and
`group_channel_unknown` (409 — a group whose number isn't known yet).
Response: `201` with the scheduled message.

> Scheduled rows are dispatched by the external scheduler hitting the
> cron endpoint — the API only enqueues.

### `GET /api/v1/scheduled-messages/{id}`

Read one scheduled message. Scope: `scheduled:read`. Read-only:
cancelling / "send now" stay dashboard-only.

### `GET /api/v1/pipelines`

List the account's pipelines with their stages (ordered by
`position`). Scope: `deals:read`. Not paginated. Every id returned
here is a valid `pipeline_id` / `stage_id` for the deal endpoints.

### `GET /api/v1/deals`

List deals, newest first. Scope: `deals:read`. Paginated. Optional
filters: `?pipeline_id=`, `?stage_id=`, `?contact_id=`, `?status=`
(`open` / `won` / `lost`).

### `POST /api/v1/deals`

Create a deal. Scope: `deals:write`. `contact_id`, `pipeline_id`,
`stage_id` and `title` are required (`value` is optional). `stage_id`
is **deliberately not optional**: the entry stage is a product
decision, not "the first column" — pick one from
`GET /api/v1/pipelines`. API-created deals get `source: "manual"`,
currency `BRL` (fixed — the per-account currency setting was removed;
this CRM operates in reais), and no `channel_id` (that column means
"which number the customer arrived through").

**One card per contact:** the product model is a single deal that
moves between pipelines. A contact that already has a deal (open or
closed, any pipeline) returns `409` with code
`contact_already_has_deal` — move the existing deal with
`PATCH /api/v1/deals/{id}` instead. Response: `201` with the deal.

### `GET` / `PATCH /api/v1/deals/{id}`

Read or update one deal. Scopes: `deals:read` / `deals:write`. `PATCH`
accepts `title`, `value`, `status`, and stage moves:

- `stage_id` alone moves the deal within its current pipeline (the
  stage must belong to it — `stage_not_found` otherwise);
- `pipeline_id` **plus** `stage_id` transfers it to another pipeline
  in one operation. `pipeline_id` without `stage_id` is rejected: the
  current stage belongs to the old pipeline.

Stage/pipeline/status changes are recorded in the account's activity
trail automatically.

### `GET /api/v1/meetings`

List calendar meetings, newest first. Scope: `meetings:read`.
Paginated. Optional filters: `?owner_user_id=`, `?contact_id=`,
`?status=` (`agendada` / `realizada` / `cancelada` / `falta`), and a
window on the start time via `?from=` / `?to=` — ISO-8601 instants
**with a timezone offset** (`Z` or `±HH:MM`), or the window shifts.

### `POST /api/v1/meetings`

Create a meeting. Scope: `meetings:write`.

```jsonc
{
  "titulo": "Reunião de alinhamento",          // required, ≤ 200 chars
  "starts_at": "2026-09-01T14:00:00-03:00",    // required — MUST carry a timezone offset
  "ends_at": "2026-09-01T15:00:00-03:00",      // required, after starts_at, ≤ 24h long
  "owner_user_id": "<uuid>",                   // optional — defaults to the API audit user
  "contact_id": "<uuid>",                      // optional — internal meetings have none
  "tipo": "outra",                             // optional: onboarding | atualizacao | outra
  "status": "agendada",                        // optional
  "descricao": "…", "local": "…"               // optional
}
```

Timestamps **must include the timezone offset** (`Z` or `±HH:MM`) —
without it "14:00" would silently shift by the server's UTC offset.
Overlapping meetings for the same owner return `409` with code
`overlap`. A malformed `owner_user_id` is a `400` (never a silent
fallback), and if the account has no resolvable default owner the
call returns `409` with code `no_default_owner` — pass
`owner_user_id` explicitly. Response: `201` with the meeting.

### `GET /api/v1/meetings/{id}`

Read one meeting. Scope: `meetings:read`.

### `GET /api/v1/notes`

List internal conversation notes, newest first. Scope: `notes:read`.
Paginated. Optional filters: `?conversation_id=`, `?contact_id=`.
Notes are internal to the team — they are never sent to the customer.

### `POST /api/v1/notes`

Create an internal note on a conversation. Scope: `notes:write`. Pass
`conversation_id`, **or** `contact_id` to note on that contact's
conversation (each contact has at most one). `texto` is required
(≤ 4000 chars). @-mentions are dashboard-only. A contact that never
exchanged a message has no conversation: `409` with code
`contact_without_conversation`. Response: `201` with the note.

## Pagination

Every list endpoint pages the same way. Request a page size with
`?limit=` (default 50, max 100) and read the next page with the opaque
`meta.next_cursor` from the previous response:

```
GET /api/v1/contacts?limit=50
→ { "data": [ … ], "meta": { "next_cursor": "eyJ…" } }

GET /api/v1/contacts?limit=50&cursor=eyJ…
→ { "data": [ … ], "meta": { "next_cursor": null } }   // last page
```

Cursors are keyset-based (stable under concurrent inserts). Pass the
cursor back verbatim — don't parse it. `next_cursor: null` means the
last page.

## Webhooks

Rather than polling, register an endpoint and wacrm will POST to it when
things happen in your account. **Migration required:** apply
`supabase/migrations/028_webhook_endpoints.sql`.

### Events

| Event                    | Fires when                                        |
| ------------------------ | ------------------------------------------------- |
| `message.received`       | An inbound message arrives from a contact         |
| `message.status_updated` | A message you sent changed delivery status        |
| `conversation.created`   | A new conversation is opened for a contact        |

All three carry `channel_id` in `data` — which of your numbers the event
happened on, or `null` for events recorded before multi-channel. Without
it, several numbers look like one indistinguishable stream, and a rule
like "only open a ticket for what comes in on Comercial" is unbuildable.
List the numbers with `GET /api/v1/channels`.

### Managing endpoints

All under scope `webhooks:manage`.

- `POST /api/v1/webhooks` — register `{ "url": "https://…", "events": ["message.received"] }`. `url` must be `https://`. **The response includes `secret` exactly once** — store it to verify signatures; wacrm keeps only an encrypted copy.
- `GET /api/v1/webhooks` — list your endpoints (never returns the secret).
- `GET /api/v1/webhooks/{id}` — read one.
- `PATCH /api/v1/webhooks/{id}` — update `url`, `events`, or `is_active` (re-enabling clears the failure counter).
- `DELETE /api/v1/webhooks/{id}` — remove one.

```bash
curl -X POST https://your-crm.example.com/api/v1/webhooks \
  -H "Authorization: Bearer wacrm_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{ "url": "https://example.com/hooks/wacrm", "events": ["message.received"] }'
# → 201 { "data": { "id": "…", "url": "…", "events": [...], "secret": "whsec_…" } }
```

### Delivery payload

Every delivery is a POST with this envelope; `id` is a unique per-
delivery uuid you can dedupe on, and `data` varies by `event`:

```json
{
  "id": "8f3c…",
  "event": "message.received",
  "occurred_at": "2026-07-01T12:00:00.000Z",
  "account_id": "…",
  "data": { /* per-event, see below */ }
}
```

`data` by event:

```jsonc
// message.received
{ "conversation_id": "…", "contact_id": "…", "whatsapp_message_id": "wamid.…", "content_type": "text", "text": "Hi 👋" }
// conversation.created
{ "conversation_id": "…", "contact_id": "…" }
// message.status_updated
{ "whatsapp_message_id": "wamid.…", "conversation_id": "…", "status": "delivered" }
```

Headers: `X-Wacrm-Event`, `X-Wacrm-Webhook-Id`, and `X-Wacrm-Signature`.

### Verifying the signature

`X-Wacrm-Signature: t=<unix_seconds>,v1=<hex>` where `v1 =
HMAC-SHA256(secret, "${t}.${rawBody}")`. Recompute it over the **raw
request body** and compare in constant time; reject if `t` is more than
a few minutes old (replay protection).

```js
const [, t, v1] = header.match(/t=(\d+),v1=([0-9a-f]+)/);
const expected = crypto.createHmac('sha256', secret)
  .update(`${t}.${rawBody}`).digest('hex');
const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
```

### Delivery semantics

Delivery is **best-effort**: a single attempt per event with a short
timeout, and **redirects are not followed**. `message.status_updated`
covers messages wacrm stores (inbox + API sends), not broadcast-only
sends, and — because providers re-send and re-order status callbacks —
the same status may arrive more than once or out of order; **dedupe on
`id` and don't assume ordering**. Each consecutive failure increments
`failure_count`; after enough consecutive failures the endpoint is
auto-disabled (`is_active: false`) — re-enable it with `PATCH` (which
resets the counter). Durable retry-with-backoff (a delivery queue) is a
future enhancement; today, treat missed deliveries as possible and
reconcile with the read endpoints when it matters.

**Target restrictions (SSRF).** The `url` must be `https://` and must
resolve to a public address — requests to `localhost`, private/RFC1918
ranges, link-local (incl. cloud metadata `169.254.169.254`), and similar
internal targets are refused at delivery time.

## Roadmap

The public API now covers messaging, contacts, conversations,
broadcasts, outbound webhooks — the full scope of
[#245](https://github.com/ArnasDon/wacrm/issues/245) — plus this
fork's additions: tasks, scheduled messages, deals/pipelines, calendar
meetings, and internal notes. Future ideas (templates, flows, a
delivery queue for webhooks, task/deal webhook events) are not yet
scheduled.
