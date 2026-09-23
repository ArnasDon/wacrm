# wacrm MCP server

A [Model Context Protocol](https://modelcontextprotocol.io) server for
**[wacrm](https://github.com/ArnasDon/wacrm)** — the self-hostable
WhatsApp CRM. It lets MCP clients (Claude Desktop, Claude Code, Cursor,
and others) drive your CRM in natural language:

> "How many conversations are still open?"
> "Find the contact for +1 415 555 0123 and show the last few messages."
> "Draft and send an order-update template to Jane."

It's a thin wrapper over wacrm's public [`/api/v1`](../docs/public-api.md)
REST API. All auth, scoping, and rate limiting are enforced by your
wacrm instance — this server just exposes the API as MCP tools.

## Prerequisites

1. A running wacrm instance (your own self-hosted deploy).
2. An API key: in the dashboard go to **Settings → API keys → New API
   key** and grant only the scopes you need. The key is shown once.

## Install & configure

The server reads two required environment variables and two optional
write guards:

| Variable                  | Required | Purpose                                                        |
| ------------------------- | -------- | -------------------------------------------------------------- |
| `WACRM_BASE_URL`          | yes      | Your instance URL, e.g. `https://crm.example.com`              |
| `WACRM_API_KEY`           | yes      | An API key from the dashboard                                  |
| `WACRM_ENABLE_WRITES`     | no       | `true` to expose contact writes + message sending              |
| `WACRM_ENABLE_BROADCASTS` | no       | `true` to expose mass broadcasts (needs `WACRM_ENABLE_WRITES`) |

### Claude Desktop / Claude Code / Cursor

Add to your MCP client config (e.g. `claude_desktop_config.json`, or
`.mcp.json` for Claude Code):

```jsonc
{
  "mcpServers": {
    "wacrm": {
      "command": "npx",
      "args": ["-y", "wacrm-mcp"],
      "env": {
        "WACRM_BASE_URL": "https://crm.example.com",
        "WACRM_API_KEY": "wacrm_live_xxxxxxxxxxxxxxxxxxxxxxxx",
      },
    },
  },
}
```

That configuration is **read-only** — the safe default. To let the
assistant change data or send messages, add the write guards:

```jsonc
"env": {
  "WACRM_BASE_URL": "https://crm.example.com",
  "WACRM_API_KEY": "wacrm_live_xxxxxxxxxxxxxxxxxxxxxxxx",
  "WACRM_ENABLE_WRITES": "true",
  "WACRM_ENABLE_BROADCASTS": "true"
}
```

## Tools

Read tools are always available. Write and broadcast tools appear only
when their guard is set.

| Tool                 | Group     | Scope needed         | What it does                                     |
| -------------------- | --------- | -------------------- | ------------------------------------------------ |
| `whoami`             | read      | _(any valid key)_    | Show the account + scopes the key carries        |
| `list_contacts`      | read      | `contacts:read`      | List/search contacts (paginated)                 |
| `get_contact`        | read      | `contacts:read`      | Read one contact                                 |
| `list_conversations` | read      | `conversations:read` | List conversations, filter by status/contact     |
| `get_conversation`   | read      | `conversations:read` | Read one conversation                            |
| `list_messages`      | read      | `messages:read`      | List a conversation's messages                   |
| `get_broadcast`      | read      | `broadcasts:send`    | Poll a broadcast's delivery status               |
| `send_message`       | write     | `messages:send`      | Send a WhatsApp message (text/template/media)    |
| `create_contact`     | write     | `contacts:write`     | Create (find-or-create) a contact                |
| `update_contact`     | write     | `contacts:write`     | Update a contact / replace its tags              |
| `send_broadcast`     | broadcast | `broadcasts:send`    | Launch a template broadcast (requires `confirm`) |

## Safety model

Sending WhatsApp messages through an LLM is a real-world side effect, so
the server layers three guards:

1. **Read-only by default.** Write and broadcast tools are not even
   registered — the model can't see them — unless you opt in via
   `WACRM_ENABLE_WRITES` / `WACRM_ENABLE_BROADCASTS`.
2. **API-key scopes.** Whatever the guards allow, your wacrm instance
   still enforces the key's scopes. A call without the right scope
   returns a clean `forbidden` error. Issue a read-only key for a
   read-only assistant.
3. **Explicit broadcast confirmation.** `send_broadcast` refuses to run
   unless called with `confirm: true`, and is marked `destructive` so
   compliant clients prompt the user first.

## Development

```bash
npm install
npm run build      # compile to dist/
npm run typecheck
npm start          # run the compiled server (needs the env vars)
```

Logs go to **stderr** — stdout is reserved for the MCP protocol.

## License

MIT — same as wacrm.
