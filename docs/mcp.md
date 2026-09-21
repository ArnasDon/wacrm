# MCP server

wacrm ships a [Model Context Protocol](https://modelcontextprotocol.io)
server so you can drive your CRM from AI assistants — Claude Desktop,
Claude Code, Cursor, and any other MCP client — in natural language:

> "How many conversations are still open today?"
> "Show the last five messages with +1 415 555 0123."
> "Send the `order_update` template to that contact."

It lives in [`mcp-server/`](../mcp-server) and is published to npm as
[`wacrm-mcp`](https://www.npmjs.com/package/wacrm-mcp). Under the hood
it's a thin wrapper over the [public API](./public-api.md), so every
request is authenticated and scoped by your instance exactly like any
other API call.

## Quick start

1. Create an API key in the dashboard: **Settings → API keys**. Grant
   only the scopes your assistant needs (a read-only assistant only
   needs the `*:read` scopes).
2. Add the server to your MCP client config:

   ```jsonc
   {
     "mcpServers": {
       "wacrm": {
         "command": "npx",
         "args": ["-y", "wacrm-mcp"],
         "env": {
           "WACRM_BASE_URL": "https://crm.example.com",
           "WACRM_API_KEY": "wacrm_live_xxxxxxxxxxxxxxxxxxxxxxxx"
         }
       }
     }
   }
   ```

That's **read-only** — the safe default. To let the assistant change
data or send messages, add `"WACRM_ENABLE_WRITES": "true"` (and
`"WACRM_ENABLE_BROADCASTS": "true"` for mass sends) to `env`.

## What it exposes

- **Reads (always on):** `whoami`, `list_channels`, contacts (list/get),
  conversations (list/get), messages (list), broadcast status.
- **Writes (opt-in):** send a message, create/update a contact.
- **Broadcasts (opt-in):** launch a template broadcast — requires an
  explicit `confirm` and is marked destructive.

### Several WhatsApp numbers

An account can have more than one number. `list_channels` shows them, and
`send_message` / `send_broadcast` take an optional `channel_id` to pick
which one to send **from**. It needs the `channels:read` scope. For
`send_broadcast`, omitting it picks a usable official number for you (a
connected one first — the account default, then the oldest), and the
response says which; an id that is not a usable official number of the
account is refused (`meta_channel_required`) and nothing is sent.

Two things worth knowing before choosing:

- **Omitting `channel_id` is not neutral.** The message goes out on the
  number the conversation is already on, and that follows the customer —
  if they last wrote to a different number of yours, the reply leaves
  from that one. When the number matters (an official notice, a formal
  confirmation), pass `channel_id` explicitly.
- **`kind` limits what the number can do.** `meta` is an official Cloud
  API number and is the only kind that accepts templates and
  button/list messages. `evolution` is a QR-code number: plain text
  only. Broadcasts are template-only, so they always need a `meta`
  number.

## Safety

Because sending WhatsApp messages is a real side effect, the server is
**read-only until you opt in**, layered on top of the API key's own
scopes. Give an assistant a read-only key and read-only config and it
physically cannot send anything. See the
[server README](../mcp-server/README.md) for the full tool list and
safety model.
