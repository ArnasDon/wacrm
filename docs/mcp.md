# MCP server

wacrm ships a [Model Context Protocol](https://modelcontextprotocol.io)
server so you can drive your CRM from AI assistants — Claude Desktop,
Claude Code, Cursor, and any other MCP client — in natural language:

> "How many conversations are still open today?"
> "Show the last five messages with +1 415 555 0123."
> "Send the `order_update` template to that contact."

It's published to npm as [`wacrm-mcp`](https://www.npmjs.com/package/wacrm-mcp)
and its source is a standalone package (not part of this app's tree —
a second `package.json` here breaks some one-click importers, so it's
developed as a sibling project). Under the hood it's a thin wrapper
over the [public API](./public-api.md), so every request is
authenticated and scoped by your instance exactly like any other API
call.

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

- **Reads (always on):** `whoami`, contacts (list/get), conversations
  (list/get), messages (list), broadcast status, and campaigns
  (list/get, list recipients, a lead's campaign history).
- **Writes (opt-in):** send a message, create/update a contact,
  create a campaign, add campaign recipients — creating or staging a
  campaign never sends anything by itself.
- **Broadcasts (opt-in):** launch a template broadcast, or dispatch an
  existing campaign's recipients — both require an explicit `confirm`
  and are marked destructive.

A campaign is a broadcast with a `description` and richer audience
planning (segments, pipeline stage, individual leads, multiple
custom-field filters) — see the [Campaigns](./public-api.md#campaigns)
section of the public API docs. "Which leads are investors?" only ever
reaches a read tool; only the dedicated send tool can trigger a real
WhatsApp send.

## Safety

Because sending WhatsApp messages is a real side effect, the server is
**read-only until you opt in**, layered on top of the API key's own
scopes. Give an assistant a read-only key and read-only config and it
physically cannot send anything. Campaign creation sits under the
write guard, not the broadcast one — you can let an assistant build
and stage campaigns without ever letting it press send. See the
server's README (in its own repository/package) for the full tool
list and safety model.
