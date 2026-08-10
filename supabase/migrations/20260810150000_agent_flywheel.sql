-- Agent flywheel: turns every moment the AI had to hand off to a human
-- into a reviewable, opt-in improvement instead of a repeated mistake.
--
-- 1. conversations.ai_handoff_at — precise timestamp for the most recent
--    handoff, set alongside the existing ai_handoff_summary. Needed so the
--    detector can scan "handoffs since X" without conflating it with
--    unrelated conversation activity (updated_at changes for many reasons).
--
-- 2. wacrm.agent_suggestions — a review queue. The detector (cron +
--    on-demand) drafts a candidate here from real handoff evidence; nothing
--    is ever applied automatically. Applying a 'lesson' does not touch the
--    account's own system_prompt text — it is folded in at generation time
--    (see src/lib/ai/flywheel.ts), so it stays reversible from a dismiss/
--    unapply and never overwrites what the owner wrote by hand.

alter table wacrm.conversations
  add column if not exists ai_handoff_at timestamptz;

create index if not exists conversations_ai_handoff_at_idx
  on wacrm.conversations (ai_handoff_at)
  where ai_handoff_at is not null;

create table if not exists wacrm.agent_suggestions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references wacrm.accounts(id) on delete cascade,
  kind text not null check (kind in ('lesson')),
  status text not null default 'pending' check (status in ('pending', 'applied', 'dismissed')),
  -- Dedupe key so a re-run of the detector never drafts the same
  -- suggestion twice, and a dismissed one never quietly comes back.
  fingerprint text not null,
  title text not null,
  content text not null,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  dismissed_at timestamptz,
  constraint agent_suggestions_account_kind_fingerprint unique (account_id, kind, fingerprint)
);

create index if not exists agent_suggestions_account_status_idx
  on wacrm.agent_suggestions (account_id, status, created_at desc);

alter table wacrm.agent_suggestions enable row level security;

revoke all on table wacrm.agent_suggestions from public, anon;
grant select, update on table wacrm.agent_suggestions to authenticated;
grant all on table wacrm.agent_suggestions to service_role;

drop policy if exists agent_suggestions_select on wacrm.agent_suggestions;
create policy agent_suggestions_select
on wacrm.agent_suggestions
for select
to authenticated
using (wacrm.is_account_member(account_id));

-- Only status/applied_at/dismissed_at ever change from the app; content is
-- system-drafted and immutable. Enforced in the API route, not by column
-- grants, to keep this policy simple.
drop policy if exists agent_suggestions_update on wacrm.agent_suggestions;
create policy agent_suggestions_update
on wacrm.agent_suggestions
for update
to authenticated
using (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum))
with check (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));
