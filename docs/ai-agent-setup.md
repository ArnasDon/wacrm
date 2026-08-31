# Setting up the AI agent

How to write Setup → **Business context**, **Knowledge base**, and **Tools**
so the agent answers accurately and cheaply. This is a content guide, not a
feature list — see the Agents page itself for what each toggle does.

## The three-tier mental model

The agent's prompt is built from three places that behave very differently.
Putting the right content in the right tier is most of what makes an agent
good:

| Tier | Included | Best for |
|---|---|---|
| **Business context** | Every single reply, always | Identity, tone, hard rules — small and foundational |
| **Knowledge base** | Only the top-k excerpts relevant to *this* question | Policies, FAQs, product info — detailed and larger |
| **Tools** | Called live, on demand | Anything that changes — stock, prices, order status, bookings |

Business context is part of the prompt's stable, cached block — it's real
token cost on **every** reply, forever, whether or not it was relevant to
this particular message. Knowledge base is retrieved per-question (see
Setup → "Excerpts per question"), so it scales to a much larger corpus
without inflating every reply's cost. Tools are the only correct place for
anything that can be wrong five minutes after you write it down.

## Business context & instructions

**Yes — write it.** This is the single highest-leverage field for reply
quality. It's plain free text, appended after a fixed scaffold (persona,
tone guidelines, "never invent facts," the handoff instruction). Two to
four short paragraphs is typical; there's a live character/token counter
under the box, and an "Insert example" menu with starter snippets.

Describe:
- **Who you are.** Business name, what you sell/do, in one line.
- **Tone.** "Warm and brief," "formal," "match the customer's language" —
  concrete adjectives, not "be helpful."
- **Scope boundaries.** What it should and should not discuss. "Only
  answer questions about our bikes and rentals; for anything about
  payments or account changes, say a human will follow up."
- **The handful of facts that matter on almost every conversation** —
  hours, the one policy customers ask about constantly. If it's something
  a large fraction of conversations touch, it earns a spot here even
  though it costs tokens every time.

Don't put here:
- **Detailed policies, FAQs, or procedures.** That's the knowledge base —
  it's retrieved only when relevant, so it doesn't cost tokens on
  unrelated replies. If the box is growing past a few short paragraphs,
  that content probably belongs in the KB instead.
- **Anything that changes.** Prices, stock, "today's" anything. Stale
  facts baked into a permanently-cached prompt are exactly what causes
  confident wrong answers.
- **Secrets, credentials, or customer PII.** Tool credentials have their
  own encrypted field for a reason — never paste one into free text here.

## Tools — do you need to describe them here too?

**No, not by default.** A tool's own `description` field is sent to the
model automatically on every call via the provider's native tool-calling
API — the model already knows a tool exists and when to reach for it
without anything in Business Context. Repeating a tool's description here
is redundant and just spends tokens twice.

The one thing worth a single line in Business Context: a general nudge if
the agent should be proactive about using its tools at all — e.g. *"You can
check live stock and order status — use that rather than guessing."*
That's a nudge toward confidence, not a duplicate spec. What actually
governs whether a tool gets used correctly is its own **description** field
in the Tools tab — see the guidance already in that dialog: state what it
does, when to call it, what *not* to use it for (if a similar tool exists),
and the response shape, since neither provider API has a separate field for
that. That description is live prompt weight on every message whether or
not the tool ends up called, so keep it to one or two sentences.

## Knowledge base

**Format:** plain text per document (Setup → Knowledge base → Add doc, a
title + a content box). Each document is split into retrieval chunks on
**blank-line-separated paragraphs**, greedily packed up to ~1200 characters
— so:

- **Put one topic, or one Q&A pair, per paragraph**, separated by a blank
  line. A paragraph is the smallest unit retrieval can return — cramming
  three unrelated facts into one paragraph means a question about fact #1
  drags #2 and #3 along as noise (more tokens, more chance of an
  off-target answer). Splitting one fact across a blank line, conversely,
  means a match might return only half the fact.
- A natural shape that works well: `**Q: Do you offer refunds?**\nA: ...`
  — one such block per paragraph, one document per topic area (Shipping,
  Returns, Product specs, ...) or all in one doc if it's short. Either
  works the same way; organize however's easiest to maintain.
- Reasonable length per paragraph: a short paragraph, not a page. If a
  single answer genuinely needs more than ~1200 characters it gets
  hard-split at that length regardless of sentence boundaries, which reads
  worse to the model — better to tighten it.

**Yes — retrieved excerpts go directly into the system prompt**, not
anywhere else. Setup → "Excerpts per question" controls how many chunks get
pulled in per question (3–10); "Relevance strictness" (Off/Normal/Strict)
drops weak matches before they're ever included — worth turning on if you
notice the agent citing the knowledge base for something it doesn't really
cover. With an embeddings key set, retrieval is semantic (meaning-based);
without one, it falls back to keyword search. Either way only the
top-matching excerpts for *this* question are included — never the whole
KB, and never for a question that doesn't need it.

What to add: policies, FAQs, how-to/troubleshooting steps, product specs,
anything a support agent would look up rather than recite from memory.

What not to add: anything live (see Tools above), anything already covered
concisely enough to just live in Business Context, secrets, or customer
data.

## Writing tips for “does it answer properly”

- **Be concrete, not vague.** "Be helpful and professional" changes
  nothing the model wasn't already going to do. "Keep replies under 3
  sentences; never quote a price without checking the tool first" changes
  behavior.
- **State escalation boundaries explicitly**, and separately tune *how
  readily* it escalates via Setup → Handoff sensitivity
  (Conservative/Balanced/Assertive) — that setting controls the threshold,
  your Business context text controls *what counts* as out-of-scope.
- **Test in the Playground before enabling auto-reply.** It runs the exact
  same path (knowledge base, tools, handoff) against a fake customer, with
  nothing sent to WhatsApp.
- If replies feel inconsistent turn to turn, try Setup → Response
  consistency ("Consistent") rather than rewriting the prompt — that's a
  model-sampling knob, not a content problem.
