# WhatsApp AI Agent — Design Spec

## Context

A prior iteration of this product had a BYOK AI reply-assistant (`src/lib/ai/`,
`/agents` dashboard section, knowledge base, auto-reply, playground, usage
dashboard). That feature was removed in its entirety (see
`supabase/migrations/037_drop_ai.sql`, CHANGELOG 0.9.0) ahead of this
redesign — nothing in this spec restores it verbatim. Two implementation
plans (pipeline-stage AI classifier, natural-language automation builder)
were drafted against the old infra and have been discarded; this spec
supersedes both.

Researched for reusable *architectural* patterns (not code — different
stacks): Chatwoot's Captain AI agent (per-account JSON-configured
"Assistant", tool-descriptor pattern, handoff modeled as a conversation
state transition, a separate "Copilot" persona for internal users) and
OpenHands' agent core (typed Action → Executor → Observation loop with a
guardrail layer that validates an action *before* it executes).

## Goal

One AI agent capability, exposed on two surfaces:

1. **WhatsApp-facing agent** — replies to customers (capped, with clean
   handoff to a human), classifies conversation intent, and moves the
   linked deal's pipeline stage.
2. **In-dashboard automation copilot** — a chat panel next to the existing
   automation builder that turns a plain-language description into a real,
   editable automation draft.

## Architecture: single structured decision per event

Rejected a full multi-turn tool-calling agent loop (OpenHands-style) as
overkill for this use case — reply/classify/move-stage doesn't need
iterative reasoning, and a runaway loop directly costs the account money
under a BYOK model. Rejected fully bespoke pipelines per capability (closest
to the deleted plans) as too narrow to extend later.

Instead: **one JSON-schema LLM call per trigger** (an inbound WhatsApp
message, or one copilot turn), returning a single decision object that
declares everything it wants to happen. A deterministic executor then
applies each declared effect — validating every id the model returns
against the account's real data first, exactly like the "never trust the
model's id" sanitizer already validated in the (now-discarded) automation
plan, and matching OpenHands' validate-before-execute guardrail.

Both surfaces share one foundation: a provider-agnostic
`generateJson<T>()` helper (`src/lib/ai/generate-json.ts`) layered on
hand-rolled OpenAI/Anthropic `fetch()` adapters — no new AI SDK dependency,
matching this codebase's existing convention (confirmed: no `openai`/
`@anthropic-ai/sdk`/`ai` package in `package.json`).

## Data model

### `ai_configs` (one row per account)

| column | type | notes |
|---|---|---|
| `account_id` | uuid PK/FK | |
| `provider` | text | `'openai' \| 'anthropic'` |
| `model` | text | |
| `api_key_encrypted` | text | AES-256-GCM via the existing generic cipher in `src/lib/whatsapp/encryption.ts` (reused, not WhatsApp-specific despite its current path — evaluate renaming to `src/lib/crypto/secret-box.ts` during implementation since a second feature now depends on it) |
| `agent_enabled` | boolean | master switch — WhatsApp reply/classify/move |
| `auto_reply_max_per_conversation` | int | default 3, mirrors the deleted feature's cap |
| `handoff_agent_id` | uuid FK profiles, nullable | who conversations get assigned to on handoff |
| `pipeline_move_enabled` | boolean | separate switch — a team may want replies without letting AI touch deal stages |
| `created_at`, `updated_at` | timestamptz | |

### `conversations` (add back 3 columns dropped by migration 037)

`ai_autoreply_disabled boolean default false`, `ai_reply_count int default 0`,
`ai_handoff_summary text` — same shape as before; this time driven by the
executor in step 4 below, not a separate `auto-reply.ts` module.

### `messages`

`ai_generated boolean default false` (dropped by migration 037, re-added) —
flags agent-sent messages in the inbox UI.

### `ai_pipeline_moves` (new — audit trail for AI-driven stage moves)

`id, account_id, deal_id, conversation_id, from_stage_id, to_stage_id,
reason, created_at`. Admin+ read via RLS (`is_account_member(account_id,
'admin')`), no INSERT policy for `authenticated` — writes come from the
service-role webhook path only. This is the "revert" mechanism: a human
can see why a move happened and drag the card back if wrong.

## WhatsApp agent flow

Attaches to `processMessage()` in `src/app/api/whatsapp/webhook/route.ts`,
immediately after the existing flow-runner + automation-trigger dispatch
block (~line 766), as a new fire-and-forget call —
`dispatchInboundToAgent()` — so a slow/failing agent call never blocks the
webhook's 200 OK to Meta, matching the existing automation dispatch's
contract.

1. **Gate**: `ai_configs.agent_enabled` must be true and
   `conversations.ai_autoreply_disabled` false; otherwise no-op.
2. **Context load**: last N text messages of the conversation (existing
   `AI_CONTEXT_MESSAGE_LIMIT`-style default), the linked deal's current
   pipeline/stage if any, and the account's real tags/pipelines/stages
   (server-side resource loader, RLS-scoped — same shape as the discarded
   plan's `loadAutomationResources()`).
3. **One `generateJson` call** returns:
   ```ts
   interface AgentDecision {
     reply_text: string | null
     add_tags: string[]       // tag ids
     remove_tags: string[]    // tag ids
     move_to_stage_id: string | null
     handoff: boolean
     handoff_reason: string | null
   }
   ```
4. **Sanitize**: every tag id / stage id checked against the resources
   loaded in step 2; unrecognized ids are dropped, never applied.
5. **Execute deterministically**:
   - `reply_text` → send via the automation engine's existing
     `engineSendText`, insert with `messages.ai_generated = true`, and
     increment `conversations.ai_reply_count`. If incrementing would
     exceed `auto_reply_max_per_conversation`, skip the send and force
     `handoff = true` instead.
   - `add_tags`/`remove_tags` → existing tag-write helpers
     (`src/lib/contacts/tag-write.ts`), which already guard the
     `tag_added` automation chain-depth the same way this reuses.
   - `move_to_stage_id` → `moveDealStage()` (new helper,
     `src/lib/pipelines/stage-move.ts`; resolves the deal via
     `conversations.id`, tenant-checks target stage belongs to the deal's
     pipeline, applies immediately per product decision, logs to
     `ai_pipeline_moves`, fires a `deal.stage_changed` webhook event and
     the `deal_stage_changed` automation trigger — guarded by the same
     `MAX_STAGE_CHAIN_DEPTH` pattern `tag-chain.ts` already uses for
     `add_tag` → `tag_added`, since a `move_deal_stage` automation step
     could itself live inside a `deal_stage_changed`-triggered automation).
   - `handoff` → set `conversations.ai_autoreply_disabled = true`,
     `ai_handoff_summary = handoff_reason`, assign to
     `ai_configs.handoff_agent_id` if set. Modeled as a state transition,
     not a special runtime branch — any part of the UI that already reacts
     to conversation assignment picks this up for free.

## Automation copilot

Chat panel next to the existing builder
(`src/app/(dashboard)/automations/page.tsx`) — not a persistent CRM-wide
assistant, per product decision (narrower scope, reuses the existing
deterministic engine/validation as-is).

- Client keeps the running chat history in component state.
- Each user turn → one `generateJson` call with the full history + the
  account's real tags/pipelines/stages as context, constrained to the
  existing `AutomationStepType` / `AutomationTriggerType` unions
  (`src/types/index.ts`) — model may either ask a clarifying question
  (plain-text turn, shown in the chat) or emit a draft automation.
- Draft sanitized with the same "unknown id → blank, never trusted"
  rule as the WhatsApp path.
- Confirmed draft is created via the **existing, unmodified**
  `POST /api/automations` route with `is_active: false`, then the user is
  routed into the **existing, unmodified** builder to review/edit/activate.
  No new persistence path, no new step/trigger/runtime behavior — an
  AI-drafted automation is byte-for-byte the same kind of row as a
  hand-built one.

## Guardrails (shared by both surfaces)

- **Never trust a model-returned id.** Every tag/pipeline/stage id is
  checked against real account data before reaching a write; a mismatch is
  dropped, never passed through.
- **Rate limits**: reuse the `RATE_LIMITS` bucket pattern
  (`src/lib/rate-limit.ts`) — two new buckets, following the file's
  existing style (see `send`/`adminAction` for the pattern): one for
  inbound-message decisions (volume-driven, keyed per account) and one
  for copilot turns (click-driven, keyed per user, ~20/min — a
  human-paced "click generate" action). Neither bucket exists yet; both
  were removed along with the rest of `src/lib/ai/`.
- **Chain-depth guard** on `deal_stage_changed` → automation →
  `move_deal_stage`, mirroring the existing `tag_added` guard
  (`src/lib/contacts/tag-chain.ts`) so an automation can't recurse forever.
- **Audit trail**: `ai_pipeline_moves` for every AI stage move,
  `messages.ai_generated` for every AI-sent reply — both human-inspectable,
  neither silently reversible-by-default (a human drags the card back or
  edits the message if the AI got it wrong).
- **Per-capability toggles**: `agent_enabled` and `pipeline_move_enabled`
  are separate switches — a team can run the reply bot without letting AI
  touch deal stages.

## Settings surface

New `agent` tab in the existing `?tab=` settings pattern
(`src/components/settings/settings-sections.ts` +
`src/app/(dashboard)/settings/page.tsx`) — provider, model, API key,
`agent_enabled`, `pipeline_move_enabled`, `auto_reply_max_per_conversation`,
`handoff_agent_id`. No standalone `/agents` dashboard route this time —
the old feature's playground and usage dashboard are explicitly out of
scope for this iteration.

## Explicitly out of scope

- A full multi-turn tool-calling agent loop (rejected — see Architecture).
- Restoring the AI knowledge base / RAG grounding from the deleted feature.
- A persistent, CRM-wide chat assistant (copilot is scoped to the
  Automations page only).
- Generating **Flows** (`src/lib/flows/`) via natural language — a
  reasonable follow-up, but Flows are a full graph-with-canvas-layout
  system, not the flat trigger→steps shape Automations uses; it would need
  its own sanitizer against `src/lib/flows/types.ts`'s node union.
- Manual drag-and-drop pipeline moves firing `deal_stage_changed` — stays
  a direct client-side write, unchanged by this spec.
- Usage/cost dashboards for the AI calls (the deleted feature's
  `ai_usage_log` is not restored in this pass).

## Testing strategy

Unit-test the sanitizer exhaustively (hallucinated ids, out-of-union step
types, malformed JSON) for both the agent-decision path and the
copilot-draft path — this is where nearly all of the risk lives, same
lesson already validated in the discarded plan's test suite. Route-level
tests for auth/rate-limit/gating. `moveDealStage()` gets its own unit
suite (tenant mismatch, same-stage no-op, cross-pipeline stage rejected).
Manual end-to-end pass with a real provider key before shipping, per
`superpowers:verification-before-completion`.
