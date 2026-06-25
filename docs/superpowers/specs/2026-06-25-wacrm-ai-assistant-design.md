# AI Assistant for WhatsApp — Design Spec

- **Date:** 2026-06-25
- **Status:** Approved design — ready for implementation plan
- **Author:** brainstormed with the maintainer
- **Feature branch (planned):** `feat/ai-assistant`
- **Migration:** `027_ai_assistant.sql`

---

## 1. Goal

Add an AI assistant that answers inbound WhatsApp messages, **grounded
only in a per-account knowledge base** ("LLM wiki"). When the model is
confident the knowledge base covers the question, it **replies
autonomously**. When it is unsure, it **escalates to a human** and goes
silent on that conversation. Admins manage the knowledge base and edit
the assistant's prompt from Settings.

This is a customer-facing, autonomous-send feature on the official
WhatsApp Business API — so the bias everywhere is **fail safe to a
human**: any doubt, any error, any cap hit → escalate, never guess and
never go silent.

## 2. Locked decisions (from brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Audience / channel | Customer-facing on WhatsApp | Highest value; builds on existing webhook + inbox |
| Engagement model | AI is first responder; autonomous send when confident; clean hand-off + escalate when unsure; goes silent once a human takes over; agent can hand back | Matches "responds immediately; if unsure add a human" |
| Knowledge approach | **LLM wiki (long-context + prompt caching)**, not vector/RAG | One provider, no pgvector/embeddings/chunking, ships faster; fits a typical company KB. RAG deferred with an upgrade path |
| Confidence detection | **LLM self-reported grounding + deterministic guardrails** (both must pass to auto-send) | The retrieval half of the original "hybrid" is N/A since we send the whole KB; guardrails cover the deterministic half |
| Provider | **Anthropic only** (Claude) | One key; LLM-wiki needs no embeddings provider |
| Where logic lives | Dedicated `src/lib/ai/` module wired into the existing WhatsApp webhook | Lowest latency, self-contained, testable; designed so it could later be a Flows node |
| Default model | `claude-sonnet-4-6` (configurable; Haiku 4.5 for cheaper/faster) | Good support-reply quality/cost balance |
| Cost guard | Per-account **daily reply cap** (default 500/day, editable) | Prevents runaway spend; cap hit → escalate |

## 3. Scope

**In v1**
- DB migration: AI config table, knowledge base table, conversation AI
  columns, AI reply audit log.
- `src/lib/ai/` module: prompt assembly, decision core, Anthropic
  client wrapper, escalation logic — pure/mockable where possible.
- Webhook integration: AI auto-reply dispatched from `processMessage`,
  gated on `!flowConsumed` and `ai_handling`.
- Settings → "AI Assistant" tab: enable toggle, prompt editor, handoff
  message, escalation keywords, business name + logo, **knowledge base
  manager** (CRUD + `.txt`/`.md`/PDF upload → text), KB size meter.
- Inbox hand-off UX: "Needs human" badge, AI message tag (`sender_type
  = 'bot'`), Take over / Hand back to AI controls.
- API routes for AI config + knowledge base CRUD (account-scoped,
  admin+).
- Unit tests for the decision core and prompt assembly.

**Deferred (not in v1; upgrade paths designed in)**
- Vector/RAG retrieval (turn on when a KB exceeds the context budget).
- Usage/cost analytics dashboard (data is logged in v1 via
  `ai_reply_log`; the UI comes later).
- Customer-facing logo surface / web chat widget (logo stored in v1,
  used only as persona context).
- Multi-language tuning, voice-note transcription, image understanding.

## 4. Data model — `supabase/migrations/027_ai_assistant.sql`

Follows existing conventions: `account_id` tenancy column, RLS enabled,
`is_account_member(account_id, min_role)` for policies (mirror
migrations 017–026). Service-role writes from the webhook bypass RLS as
the other engines already do.

### 4.1 `ai_assistant_config` — one row per account
| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `account_id` | uuid unique not null | FK → accounts, `ON DELETE CASCADE` |
| `enabled` | boolean not null default false | Master switch; off by default (opt-in) |
| `system_prompt` | text not null | Editable prompt; seeded with a strong default (see §7.2) |
| `handoff_message` | text | Sent to the customer on escalation; nullable = send nothing |
| `escalation_keywords` | text[] not null default `'{}'` | Seeded: refund, cancel, complaint, lawyer, legal, human, agent, manager |
| `business_name` | text | Persona context |
| `logo_url` | text | Stored via existing storage bucket; persona context only in v1 |
| `model` | text not null default `'claude-sonnet-4-6'` | Configurable |
| `daily_reply_cap` | integer not null default 500 | Cap hit → escalate |
| `created_at` / `updated_at` | timestamptz default now() | |

**RLS:** select/insert/update for `is_account_member(account_id,
'admin')`. (Read could be widened to any member if the UI needs it;
keep admin-only in v1.)

### 4.2 `knowledge_base_entries` — many per account (the "wiki pages")
| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `account_id` | uuid not null | FK → accounts, cascade |
| `title` | text not null | |
| `content` | text not null | Markdown/plain text; what gets fed to the model |
| `source_type` | text not null default `'manual'` | CHECK in (`manual`, `file`) |
| `source_filename` | text | Original filename when `source_type='file'` |
| `enabled` | boolean not null default true | Disabled entries are excluded from the prompt |
| `token_estimate` | integer | Cached ~token count for the size meter (chars/4 heuristic) |
| `created_by_user_id` | uuid | Audit |
| `created_at` / `updated_at` | timestamptz default now() | |

**RLS:** all ops for `is_account_member(account_id, 'admin')`.

### 4.3 `conversations` — add AI hand-off columns (ALTER)
| Column | Type | Notes |
|---|---|---|
| `ai_handling` | boolean not null default true | Is the AI still driving this conversation? Set false when escalated or when a human replies |
| `ai_escalated_at` | timestamptz | Set on escalation |
| `ai_escalation_reason` | text | `low_confidence` / `keyword` / `error` / `cap_reached` / `human_takeover` |

(No change to the `status` CHECK. On escalation we also set
`status='pending'`, which is already an allowed value and reads as
"needs attention" in the inbox.)

### 4.4 `ai_reply_log` — one row per AI decision (audit + future cost view)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `account_id` | uuid not null | cascade |
| `conversation_id` | uuid | |
| `message_id` | uuid | the inbound `messages.id` that triggered it |
| `decision` | text not null | CHECK in (`replied`, `escalated`, `skipped`, `error`) |
| `confident` | boolean | model's self-report (null when skipped pre-LLM) |
| `reason` | text | escalation reason / error summary |
| `model` | text | |
| `input_tokens` / `output_tokens` / `cache_read_tokens` | integer | from `usage` |
| `latency_ms` | integer | |
| `created_at` | timestamptz default now() | |

**RLS:** select for `is_account_member(account_id, 'admin')`; inserts
are service-role only.

## 5. Module structure — `src/lib/ai/`

| File | Responsibility | I/O |
|---|---|---|
| `admin-client.ts` | Lazy service-role Supabase client | mirrors `src/lib/flows/admin-client.ts` |
| `config.ts` | Load `ai_assistant_config` for an account | DB read |
| `knowledge-base.ts` | Load enabled KB entries; assemble the KB text block; estimate tokens | DB read + pure |
| `prompt.ts` | **Pure.** Build the system block (persona + KB, cache-marked) and the message array from conversation history + inbound | pure |
| `guardrails.ts` | **Pure.** Deterministic escalation rules (keyword match, explicit human request) | pure |
| `decide.ts` | **Pure.** Given the model's structured response + guardrail result + cap state → `{action: 'reply'|'escalate', text?, reason?}` | pure |
| `anthropic.ts` | Thin wrapper around `@anthropic-ai/sdk`: forces the `submit_answer` tool, returns `{answer, confident, reason, usage}`. Injectable for tests | network |
| `reply.ts` | Orchestrator: `maybeReplyToInbound(...)` — loads config/KB, runs guardrails, calls the model, applies `decide`, sends or escalates, writes `ai_reply_log`. Wraps everything in try/catch → escalate on error | composes the above |
| `send.ts` | Send an AI reply via the existing Meta send path and insert the outbound `messages` row with `sender_type='bot'` | network + DB |
| `escalate.ts` | Set `ai_handling=false`, `ai_escalated_at`, `ai_escalation_reason`, `status='pending'`; optionally send `handoff_message` | DB + network |

The pure modules (`prompt`, `guardrails`, `decide`) hold all the
logic worth testing; `anthropic`/`send`/DB are thin and mocked.

## 6. Runtime flow

Integration point: `src/app/api/whatsapp/webhook/route.ts` →
`processMessage()`, **after** the flow dispatch resolves `flowConsumed`
and after the inbound `messages` row is inserted. The webhook already
runs `processWebhook(...)` fire-and-forget before acking Meta 200, so
no change to the ack path is needed (no double-send risk). The AI call
is fire-and-forget with its own try/catch, exactly like the automation
dispatch.

```
inbound message stored
        │
        ├─ flowConsumed?  ── yes ─▶ skip AI (customer is in a bot menu/flow)
        │                   no
        ▼
maybeReplyToInbound({ accountId, conversationId, contactId, messageId, inboundText })
        │
   load ai_assistant_config
        ├─ !enabled                         ─▶ skip
   load conversation
        ├─ ai_handling === false            ─▶ skip (human owns it)
   guardrails(inboundText, keywords)
        ├─ keyword / "talk to a human"      ─▶ escalate (reason=keyword), no LLM call
   daily cap check (count today's `replied` in ai_reply_log)
        ├─ cap reached                      ─▶ escalate (reason=cap_reached)
        ▼
   build prompt (persona + cached KB block + recent history + inbound)
   call Claude, force submit_answer tool → { answer, confident, reason, usage }
        ▼
   decide(modelResult)
        ├─ confident && answer  ─▶ send (sender_type='bot') + log replied
        └─ else                 ─▶ escalate (reason=low_confidence) + log escalated
        ▼
   any throw anywhere          ─▶ escalate (reason=error) + log error
```

**Human-takeover detection:** when an agent sends a manual reply
(`POST /api/whatsapp/send`), set `ai_handling=false` on that
conversation in the same handler. This guarantees the AI stays silent
the instant a human engages, even mid-stream.

## 7. Prompt & decision contract

### 7.1 Structured output
Call Claude with a single forced tool `submit_answer`
(`tool_choice: { type: 'tool', name: 'submit_answer' }`) whose
`input_schema` is:
```json
{
  "answer": "string — the reply to send the customer, empty if not confident",
  "confident": "boolean — true ONLY if the knowledge base fully answers the question",
  "reason": "string — short rationale, for the audit log"
}
```
This makes the decision reliably parseable (no JSON-in-text scraping).

### 7.2 System block (cache-marked)
`system` is an array; the **KB block carries
`cache_control: { type: 'ephemeral' }`** so it bills at ~10% on cache
hits (5-min TTL). Order: stable persona/instructions first, then the
assembled KB (most cacheable last-stable content).

Seeded default `system_prompt` (editable):
> You are the customer-support assistant for {business_name}. Answer
> ONLY using the information in the KNOWLEDGE BASE below. If the
> knowledge base does not clearly and fully answer the customer's
> question, you MUST set `confident` to false and leave `answer` empty —
> do not guess, do not use outside knowledge, do not make promises about
> pricing, refunds, delivery dates, or policies that aren't written
> here. Be concise, friendly, and match the customer's language.

The assembled KB block is the concatenation of enabled
`knowledge_base_entries` (`## {title}\n{content}`), wrapped in clear
delimiters.

### 7.3 Conversation history
Include the last N inbound/outbound messages (default N=10) for context,
oldest→newest, mapped to `user`/`assistant` roles. History is NOT
cached (it changes every turn); only the KB block is.

### 7.4 Account isolation (critical)
`prompt.ts` receives KB entries already filtered by `account_id`. A unit
test asserts that entries from another account never appear in the
assembled block. No global/shared KB in v1.

## 8. Escalation & inbox UX

- **Conversation list:** conversations with `ai_escalated_at` set (and
  `status='pending'`) show a **"🙋 Needs human"** badge. Surfaces live
  via the existing Supabase realtime subscription.
- **Thread:** messages with `sender_type='bot'` render with a small
  **"AI"** tag so agents see what the bot said.
- **Controls:** a per-conversation **"Take over"** (sets
  `ai_handling=false`) and **"Hand back to AI"** (sets
  `ai_handling=true`, clears escalation fields) toggle. Sending a manual
  reply implicitly takes over.
- No new conversation status value introduced; reuse `pending`.

## 9. Settings → "AI Assistant" tab

Plugs into the existing settings rail (`settings-sections.ts` +
`settings-rail.tsx`). Gated by `canEditSettings(role)` (admin+), mirror
`whatsapp-config.tsx` / `template-manager.tsx` patterns.

Sections:
1. **Status & enable** — master toggle; shows whether `ANTHROPIC_API_KEY`
   is configured (server-reported boolean, never the key).
2. **Prompt** — textarea for `system_prompt` (seeded default), handoff
   message, escalation-keyword chips.
3. **Persona** — business name, logo upload (existing storage helper).
4. **Knowledge base manager** — list entries (title, size, enabled
   toggle), add/edit (title + markdown content), delete, and **file
   upload** (`.txt`/`.md` read directly; PDF → text extraction). A
   **size meter** shows total estimated tokens vs. a soft budget
   (e.g. 150k) with a warning band — the signal to enable RAG later.
5. **Model** — dropdown (Sonnet 4.6 / Haiku 4.5), daily reply cap input.

## 10. API routes (account-scoped, admin+ via `requireRole`)

| Route | Methods | Purpose |
|---|---|---|
| `src/app/api/ai/config/route.ts` | GET, PUT | Read/update `ai_assistant_config` |
| `src/app/api/ai/knowledge/route.ts` | GET, POST | List / create KB entries |
| `src/app/api/ai/knowledge/[id]/route.ts` | PATCH, DELETE | Edit / delete a KB entry |
| `src/app/api/ai/knowledge/upload/route.ts` | POST | Accept a file, extract text, create an entry |

All use the user-session Supabase server client (RLS enforces tenancy)
plus an explicit role check. The conversation hand-off toggle reuses /
extends the existing conversation-update path used by the inbox.

## 11. Environment & config

Add to `.env.local.example` (and document in the CI dummy-env block):
```
# AI assistant (Anthropic). Leave blank to disable AI replies.
ANTHROPIC_API_KEY=
# Optional override of the default model.
AI_DEFAULT_MODEL=claude-sonnet-4-6
```
`anthropic.ts` reads `ANTHROPIC_API_KEY` lazily (like the Supabase admin
clients) so a missing key never crashes the build — it just means AI is
effectively off (treated as `enabled=false` / escalate).

## 12. Security & safety

- API key server-side only; never sent to the client; Settings shows
  only a configured/not-configured boolean.
- RLS on every new table; admin+ for config and KB; `ai_reply_log`
  inserts are service-role only, reads admin-only.
- **Strict per-account KB isolation** in prompt assembly (unit-tested).
- **Fail safe to human**: missing key, API error, timeout, cap reached,
  or low confidence all escalate; the customer is never left silent and
  the bot never guesses.
- No CSP change: all Anthropic calls are server-side (mirrors how Meta
  calls already work).
- The bot cannot perform destructive actions — it only sends a text
  reply or escalates. No tool access to the DB beyond logging.

## 13. Cost controls

- **Prompt caching** on the KB block (primary lever).
- **Daily reply cap** per account (escalate when exceeded).
- History window capped (default 10 messages).
- `ai_reply_log` records token usage per call for a future cost view.

## 14. Testing

Vitest, matching the `src/lib/**/*.test.ts` convention.

- `prompt.test.ts` — KB assembly, cache_control placement, account
  isolation, history mapping/order, history cap.
- `guardrails.test.ts` — keyword matching (case/word-boundary), explicit
  human-request detection, empty-KB behavior.
- `decide.test.ts` — confident+answer → reply; not-confident → escalate;
  empty answer despite confident → escalate; reason propagation.
- `reply.test.ts` — orchestration with a mocked `anthropic` + mocked DB:
  disabled→skip, human-owned→skip, keyword→escalate (no LLM call),
  cap→escalate, error→escalate, happy path→send+log.
- Anthropic SDK and Supabase admin client are injected/mocked; no
  network in tests.

CI (`.github/workflows/ci.yml`) gains a dummy `ANTHROPIC_API_KEY` in the
env block so `next build` and module-load are satisfied (mirrors the
existing `META_APP_SECRET` pattern).

## 15. Build orchestration (workflow + worktrees)

Implementation runs as a **Workflow** inside a dedicated **git
worktree** on branch `feat/ai-assistant`, so it never disturbs the main
checkout and lands as one reviewable branch.

Phased pipeline (dependency-ordered; later phases consume earlier
outputs):

1. **Schema** — write `027_ai_assistant.sql` + extend `src/types`.
2. **Lib core** (parallelizable once types exist) — the pure modules
   (`prompt`, `guardrails`, `decide`) **with their tests written first**,
   then `anthropic`, `config`, `knowledge-base`, `send`, `escalate`,
   `reply`.
3. **Webhook integration** — wire `maybeReplyToInbound` into
   `processMessage`; set `ai_handling=false` in the send route.
4. **API routes** — config + knowledge CRUD + upload.
5. **UI** — Settings "AI Assistant" tab + KB manager; inbox badge, AI
   tag, take-over/hand-back controls.
6. **Verify** — `npm run lint && npm run typecheck && npm test &&
   npm run build`; iterate to green.
7. **Review** — adversarial review pass (security + correctness) before
   opening a PR.

Agents that mutate overlapping files run sequentially; independent files
(e.g. the three pure libs, the API route files) fan out in parallel.
Every agent is told to **read the relevant `node_modules/next/dist/docs/`
guide before writing Next.js code** (per `AGENTS.md` — this is a modified
Next.js 16) and to follow existing patterns in the files referenced
above.

## 16. Future / upgrade path

- **RAG:** when the KB size meter trips the budget, add
  `knowledge_base_chunks` (pgvector) + an embedding step; `prompt.ts`
  swaps "whole KB" for "top-k retrieved chunks". Nothing else in the
  flow changes — `decide`, guardrails, escalation, logging are reused.
- **Flows node:** expose `maybeReplyToInbound` as an "AI Reply" node so
  it can be composed visually.
- **Cost dashboard:** read `ai_reply_log` into the existing dashboard.
