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
| `webhooks:manage`    | Register and manage outbound webhooks. ⚠️ The subscribed events carry message text and full contact and deal data (tags and custom fields included) — with no `contacts:read`, `deals:read` or `messages:read` needed |
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
| 400    | `unknown_tag_ids` | A tag id (UUID) that is not a tag of this account — see [tags](#post-apiv1contactsidtags) |
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
> created automatically in the default pipeline/stage of the number the
> message **went out on** (`source: 'channel'`) — the same rule as sends
> from the CRM composer. Only if that number has a default pipeline set
> (*Settings → Connections*); without one, no deal is created. At most one
> deal per contact is ever created this way; contacts that already have a
> deal are left untouched. This is intentional (PR #79); if your
> integration must not open deals, don't send through this endpoint for
> those contacts.

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
or phone) and `?tag=<tagId>`. The `tag` filter takes only a tag **id**
(from `GET /api/v1/tags`) — unlike the write endpoints below, a tag name
there is a `400 bad_request`.

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
`name`, `email`, `company`, and `tags` (an array of tag names or tag ids
from `GET /api/v1/tags`; new names are created) are optional. **Find-or-create
by phone:** an existing match returns `200` with the existing contact; a
new contact returns `201`. The response body is the serialized contact
(same shape as the list rows above).

> ⚠️ **When the contact already exists, `tags` REPLACES its whole tag set**
> (while `name`, `email` and `company` are ignored for it). Sending
> `tags: ["Typebot"]` for a known phone removes every other tag that
> contact had, and `tags: []` removes them all. To add a tag without touching the others, use
> [`POST /api/v1/contacts/{id}/tags`](#post-apiv1contactsidtags).

Tags follow the same rules as in the additive endpoint below: text in the
canonical UUID form is read as a tag id, an id that is not a tag of this
account is a `400 unknown_tag_ids` (checked **before** the contact is
created), and an id never creates a tag. `tags` must be an array of
non-empty strings: a non-string or empty item, or a `tags` that is not an
array, is a `400 bad_request` — never silently dropped. `tags: null` means
"leave the tags alone", the same as leaving the field out.

### `GET` / `PATCH /api/v1/contacts/{id}`

Read or update one contact. Scopes: `contacts:read` / `contacts:write`.
`PATCH` updates only the fields you send (`name`, `email`, `company`);
pass `tags` (an array of tag names or tag ids from `GET /api/v1/tags`) to
**replace** the contact's tags — with the same rules as `POST /contacts`
above: an unknown tag id is a `400 unknown_tag_ids` and nothing is
written, a non-string or empty item — or a `tags` that is neither an
array nor `null` — is a `400 bad_request`, and `tags: null` leaves the tags
alone. To clear every tag, send `tags: []`. A
contact in another account returns `404`; a contact id in the path that is
not a UUID returns `400 bad_request` (here and on `/custom-fields` and
`/tags` below).

> ⚠️ `tags` here replaces the whole set — sending `["Lead"]` removes
> every other tag the contact had. To add or drop individual tags, use
> `POST /api/v1/contacts/{id}/tags` below.

### `POST /api/v1/contacts/{id}/tags`

Add and remove tags **by name or by id, without touching the others**.
Scope: `contacts:write`. This is what an external flow (Typebot, n8n) should
call to label a lead — the `tags` array on `PATCH` would wipe the rest
of the contact's labels and still answer `200`.

```jsonc
{
  "add": ["Typebot", "Lead novo"],   // optional — names or ids
  "remove": ["Desqualificado"],      // optional — names or ids
  "create_missing": true             // optional, default true
}
```

- **Name or id.** Text in the canonical UUID form (with hyphens — the `id`
  that `GET /api/v1/tags` returns) is **always** read as a tag id; any other
  text is a name. There is no "try as a name, then as an id": the same body
  must not change meaning when someone creates or deletes a tag.
- An id that is not a tag of this account — in `add` **or** in `remove` —
  returns `400` with `{"error":{"code":"unknown_tag_ids", ...}}` (the
  message lists the ids), checked **before any write**: the contact is left
  untouched.
- An id **never creates a tag**, not even with `create_missing`.
- Names are matched **case- and accent-insensitively**, and trimmed: `"vip"`
  finds an existing `"VIP"`, and `"bancario"` finds an existing `"Bancário"`.
  Two names that differ only by accent or case are the **same tag** — the
  database enforces this with a unique index, so a second one cannot be
  created.
- The same tag asked for twice in one list — by name and by id, or in two
  spellings — counts once.
- `create_missing` (default `true`) creates tags in `add` that don't
  exist yet. It never applies to `remove` — an unknown name there is
  reported, not created.
- The **same tag in both `add` and `remove` is rejected** (`400`), whether
  it is spelled the same, differs by accent or case, or is sent by name on
  one side and by id on the other: either order would be a convention
  invisible to the caller.
- Every item must be a non-empty string (anything else is a `400`). At
  least one of `add` / `remove` must be non-empty; at most 50 items per
  request.

Response is the contact plus a summary of what actually changed —
enough to debug "I tagged the lead and nothing happened" without a
second call. `adicionadas`, `removidas` and `inalteradas` carry the
**stored** tag name (the same `name` as in `GET /api/v1/tags`) — whether
you sent a name in another spelling or an id; only `desconhecidas` echoes
what you sent, since there is no stored name for what does not exist.
⚠️ Until 23/09/2026 all four echoed the spelling you sent.

```jsonc
{
  "data": {
    "contact": { "id": "…", "tags": [ /* … */ ] },
    "adicionadas":  ["Typebot"],       // now applied (stored name)
    "removidas":    ["Desqualificado"],// now gone (stored name)
    "inalteradas":  ["Lead novo"],     // already in the requested state (stored name)
    "desconhecidas": []                // no such tag name in this account (as sent)
  }
}
```

Applying a tag **fires `tag_added` automations** (once per tag actually
added — a duplicate is a no-op and triggers nothing), and both adding
and removing are recorded in the contact's activity trail.

### `GET /api/v1/tags`

List the account's tags (`id`, `name`, `color`), ordered by name. Scope:
`contacts:read`. Not paginated. Use it to discover the names and ids
accepted by `POST /api/v1/contacts`, `PATCH /api/v1/contacts/{id}` and
`POST /api/v1/contacts/{id}/tags` (and the id the `?tag=` filter of
`GET /api/v1/contacts` takes).

### `GET` / `PATCH /api/v1/contacts/{id}/custom-fields`

Read or write the contact's **custom field values**, addressed by the
stable `field_key` (shown in the field manager next to each field —
e.g. `utm_source`, `ctwa_clid`, `data_da_proposta`). Scopes:
`custom_fields:read` / `custom_fields:write`. This is the endpoint an
external orchestrator (n8n etc.) uses to store ad-tracking data on the
lead and read it back later.

`GET` returns the whole account catalogue with this contact's values —
so a `GET` for **any** contact is also how to list the account's custom
fields and their keys (there is no catalogue endpoint without a contact
id yet):

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
        "channel_id": "<uuid of an official Meta number>",
        "recipients": [
          { "to": "+14155550123", "params": ["Jane"] },
          { "to": "+14155550124" }
        ]
      }'
```

`channel_id` is optional — see
[Choosing which number to send from](#choosing-which-number-to-send-from).
`params` is one list per recipient, in the order of the template's
`{{1}}`, `{{2}}`… variables; recipients may carry lists of different
lengths.

**Migration required:** apply
`supabase/migrations/1030_cb_funcao_de_disparo_executavel.sql`. Before it,
every call to this endpoint failed with `500 Failed to create broadcast`
(the database function behind it could not execute), and per-recipient
`params` could not be stored as lists.

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
    "rejected": 0,
    "channel_id": "…"
  }
}
```

`channel_id` is the official number the campaign **actually** went out
on — record it for auditing, especially when you omitted it in the
request. `GET /api/v1/broadcasts/{id}` returns it too. It is `null` only
on an installation that still uses the legacy single-number setup (no
entry under Settings → Connections), where there is no channel id to
report.

### `GET /api/v1/broadcasts/{id}`

Broadcast status + counts. Scope: `broadcasts:send`. `status` moves
`sending` → `sent`; `delivered_count` / `read_count` keep climbing as
Meta delivery webhooks arrive. `404` for another account's broadcast.

### `GET /api/v1/channels`

List the account's WhatsApp numbers. Scope: `channels:read`.

An account can have several numbers — official Meta (Cloud API) ones and
unofficial QR-code ones. Every id returned here is a valid `channel_id`
for `POST /api/v1/messages`. `POST /api/v1/broadcasts` only accepts the
ones whose `kind` is `meta` (broadcasts are template-only).

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
official Meta number (broadcasts are template-only).

- **Omitted or `null`** — the campaign goes out on a usable Meta number
  chosen for you: a **connected** one is preferred (the account default
  first, then the oldest); if none is connected, the default / oldest
  one that has credentials. If the account has none, the call returns
  `meta_channel_required`. The `202` tells you which one was picked.
- **Set** — a `channel_id` that is not a usable Meta number **of this
  account** returns `meta_channel_required` (400), and any other
  non-null value that is not a non-empty string (a number, a list, an
  object, `""`) returns `bad_request` (400). Either way it never falls
  back to another number, and nothing is created or sent.

If your integration tool fills the field from a variable, note that an
empty variable usually arrives as `""` (refused) but may arrive as
`null` (treated as omitted) — check the `channel_id` in the `202`.

`meta_channel_required` (400) means the number really is missing or not
usable — fix the request or the connection before retrying. If the CRM
**could not read** the connections (a database hiccup), the call returns
`500 internal` instead, nothing is created or sent, and it is safe to
retry the same request.

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

**Stages with an outcome.** A stage can be marked *won* or *lost*: moving a
deal into it sets `status` to `won` / `lost`, overriding any `status` sent
in the same request. A **lost** deal moved into a stage **without** an
outcome is reopened (`status: open`) — also when the same request sends
`status: "lost"` for a deal that is already lost. To keep a deal lost while
moving it, move it to a stage marked *lost*. A won deal stays won when it
moves to a stage without an outcome. The response shows the final status.

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
`supabase/migrations/0028_webhook_endpoints.sql`.

### Events

| Event                    | Fires when                                                     |
| ------------------------ | -------------------------------------------------------------- |
| `message.received`       | An inbound message arrives from a contact                      |
| `message.status_updated` | A message you sent changed delivery status                     |
| `conversation.created`   | A new conversation is opened for a contact                     |
| `deal.created`           | A deal (pipeline card) is created, in any stage                |
| `deal.stage_changed`     | A deal moves to another stage — or to another pipeline         |
| `deal.status_changed`    | A deal is marked won or lost, or reopened                      |

Every event carries `channel_id` in `data` — which of your numbers the
event happened on. Without it, several numbers look like one
indistinguishable stream, and a rule like "only open a ticket for what
comes in on Comercial" is unbuildable. List the numbers with
`GET /api/v1/channels`. On the three `deal.*` events it is the number of
the contact's conversation **when the card moved** — not `deal.channel_id`,
which is the number the lead **arrived** through.

⚠️ `channel_id` can be `null`, and not only on events recorded before
multi-channel. On `deal.*` it is `null` whenever, at the moment of the
move, the contact had no conversation tied to a number: a lead created by
an incoming webhook (a form, Typebot) or by a Calendly booking before
writing to you, a contact created through this API, a card with no contact
(a group card, or a deleted contact). A flow that filters by number must
decide what to do with those — dropping them silently drops exactly the
new leads.

The `deal.*` events fire for **every** way a card moves: dragging on the
board, the deal form, the list view, the conversation side panel,
automations and this API. They do **not** fire for bulk data migrations
(which load history with the database triggers switched off), and deleting
a deal emits nothing. One drag can emit **two** events: moving an existing
card into a stage marked "won"/"lost" changes the stage *and* the status.
⚠️ A card **created** directly in such a stage is born with that status and
emits **only** `deal.created` — there is no `deal.status_changed` for it.
If you listen for "won", also check `deal.status` on `deal.created`.

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

Every delivery is a POST with this envelope, and `data` varies by `event`
(the exact shapes live in `src/lib/webhooks/dados-dos-eventos.ts`, which
the dispatch code is typed against):

```json
{
  "id": "8f3c…",
  "event": "message.received",
  "occurred_at": "2026-07-01T12:00:00.000Z",
  "account_id": "…",
  "data": { /* per-event, see below */ }
}
```

- `id` — on the three `deal.*` events it is the id of the underlying fact
  (the same value as `data.event_id`), so it is stable and safe to dedupe
  on. On the message/conversation events it is a fresh uuid per dispatch.
- `occurred_at` — on `deal.*` it is when the card changed (the database
  clock), even if the delivery goes out later; on the other events it is
  the dispatch time.
- `test: true` — present only on deliveries sent by the **"Send test"**
  button of *Settings → Webhooks → Outgoing*. Their `data` is fictitious sample
  data; filter them out in production flows. The test goes to the
  endpoint's registered URL, like a real delivery (see **Testing** below).

`data` by event:

```jsonc
// message.received — WhatsApp (Meta or Evolution)
{ "conversation_id": "…", "contact_id": "…", "whatsapp_message_id": "wamid.…", "content_type": "text", "text": "Hi 👋", "channel_id": "…" }
// message.received — Instagram Direct: `instagram_message_id` instead of `whatsapp_message_id`
{ "conversation_id": "…", "contact_id": "…", "instagram_message_id": "…", "content_type": "text", "text": "Hi 👋", "channel_id": "…" }
// conversation.created
{ "conversation_id": "…", "contact_id": "…", "channel_id": "…" }
// message.status_updated
{ "whatsapp_message_id": "wamid.…", "conversation_id": "…", "status": "delivered", "channel_id": "…" }
```

The three `deal.*` events share one shape:

```jsonc
{
  "event_id": "…",                 // same as the envelope `id`
  "occurred_at": "2026-09-23T14:05:00.000Z",
  "source": "user",                // user | channel | automation | system (see below)
  "deal_id": "…",
  "deal": { /* GET /api/v1/deals/{id} shape — the deal AS OF DELIVERY, null if deleted */ },
  "assignee": { "user_id": "…", "name": "Ana" },   // or null
  "pipeline": { "id": "…", "name": "Comercial" },  // where the card went IN THIS EVENT
  "stage": { "id": "…", "name": "Reunião Agendada", "position": 3 },
  "contact": {                     // GET /api/v1/contacts/{id} shape, or null (group card / deleted contact)
    "id": "…", "name": "…", "phone": "…", "email": "…", "tags": [{ "id": "…", "name": "Typebot", "color": "#3b82f6" }],
    "custom_fields": { "tamanho_da_divida": "150000", "utm_source": null },
    "…": "…"
  },
  "channel_id": "…",
  // deal.stage_changed only — where it came from (a different pipeline = it changed pipelines):
  "from_pipeline": { "id": "…", "name": "…" }, "from_stage": { "id": "…", "name": "Lead", "position": 2 },
  // deal.status_changed only:
  "from_status": "open", "status": "won"
}
```

Read `stage`, not `deal.stage_id`, to know where the card went: `deal` is
read at delivery time, so a card moved twice in a few seconds produces two
events whose `deal` already shows the final stage. `source` tells who caused
the change:

- `user` — someone in the CRM screens (board, deal form, list view,
  conversation side panel);
- `channel` — the connection's pipeline routing opened the card. That
  happens on the contact's **first message** *or* on the team's **first
  send** to them — from the CRM screens, from the paired phone, or through
  `POST /api/v1/messages` — so `channel` does not mean "inbound lead";
- `automation` — an automation's "Create Deal" step;
- `system` — direct deal writes through this API (`POST`/`PATCH
  /api/v1/deals`) **and** an automation's "Move deal to stage" / "Mark won
  or lost" steps. The database does not tell those two apart.

⚠️ If your flow reacts to `deal.stage_changed` by moving the card through
this API, that move emits another event (`source: "system"`): make sure the
flow cannot loop. Filtering out `system` also drops the moves made by
automations' "Move deal to stage" step.

Headers: `X-Wacrm-Event`, `X-Wacrm-Webhook-Id`, and `X-Wacrm-Signature`.

### Verifying the signature

`X-Wacrm-Signature: t=<unix_seconds>,v1=<hex>` where `v1 =
HMAC-SHA256(secret, "${t}.${rawBody}")`. Recompute it over the **raw
request body** and compare in constant time; reject if `t` is more than
a few minutes old (replay protection).

The secret is the **whole** value you received, `whsec_` prefix included.

```js
const [, t, v1] = header.match(/t=(\d+),v1=([0-9a-f]+)/);
const expected = crypto.createHmac('sha256', secret)
  .update(`${t}.${rawBody}`).digest('hex');
// timingSafeEqual throws on different lengths — compare lengths first.
const ok = expected.length === v1.length &&
  crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
```

### Delivery semantics

Delivery is **best-effort**: a **single attempt** per event with a
5-second timeout, and **redirects are not followed** (a 3xx counts as a
failure). Nothing is retried, so a delivery is never duplicated by the CRM
itself — but the *source* can repeat a fact: providers re-send and
re-order status callbacks, so the same `message.status_updated` may arrive
more than once (with a new `id`) or out of order. Deliveries run in
parallel, so **don't assume ordering** — on `deal.*`, order by
`occurred_at` and dedupe on `id`. `message.status_updated` covers messages
the CRM stores (inbox + API sends), not broadcast-only sends. Each
consecutive failure increments `failure_count`; after 15 consecutive
failures the endpoint is auto-disabled (`is_active: false`) — re-enable it
with `PATCH` (which resets the counter) or on the settings screen. ⚠️ The
counter belongs to the **endpoint**, not to the event: when the `deal.*`
queue has been held back (the scheduler down, for instance) its backlog is
delivered at once, and if your receiver is down at that moment the backlog
alone can reach the 15 failures and switch the endpoint off — for every
event it subscribes to, `message.*` included. Durable
retry-with-backoff (a delivery queue) is a future enhancement; today, treat
missed deliveries as possible and reconcile with the read endpoints when it
matters.

**Testing.** *Settings → Webhooks → Outgoing* has a **"Send test"** button per
endpoint: it signs and POSTs a sample of the event you pick (with
`"test": true`) to the endpoint's **registered URL** and shows the HTTP
status your endpoint answered. It works for events the endpoint does not
subscribe to and on a switched-off endpoint, and it does not touch the
failure counter.

It does **not** feed n8n's "Listen for test event": that only captures the
**Test URL** (`/webhook-test/…`), while the URL you register is the
**Production URL**. With the Production URL and the workflow published,
the test shows up in the workflow's **Executions**. To see it in Listen,
register a second, temporary endpoint with the Test URL, click Listen, and
press "Send test" on that endpoint within the 120 seconds — then delete
it: outside the listening window the Test URL answers `404` to real
deliveries, and the endpoint ends up switched off.

**Target restrictions (SSRF).** The `url` must be `https://` and must
resolve to a public address — requests to `localhost`, private/RFC1918
ranges, link-local (incl. cloud metadata `169.254.169.254`), and similar
internal targets are refused at delivery time.

## Roadmap

The public API now covers messaging, contacts, conversations,
broadcasts, outbound webhooks — the full scope of
[#245](https://github.com/ArnasDon/wacrm/issues/245) — plus this
fork's additions: tasks, scheduled messages, deals/pipelines, calendar
meetings, internal notes, and deal webhook events. Future ideas
(templates, flows, a delivery queue for webhooks, task webhook events, a
members endpoint and a custom-field catalog endpoint that doesn't need a
contact id) are not yet scheduled. Meanwhile, *Settings → API → IDs* lists
every id and key the API asks for.
