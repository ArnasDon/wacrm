alter table ai_lead_scores
add column if not exists ai_score integer;

alter table ai_lead_scores
add column if not exists ai_grade text;

alter table ai_lead_scores
add column if not exists ai_reason text;

alter table ai_lead_scores
add column if not exists ai_confidence integer;

alter table ai_lead_scores
add column if not exists manual_score integer;

alter table ai_lead_scores
add column if not exists manual_grade text;

alter table ai_lead_scores
add column if not exists manual_reason text;

alter table ai_lead_scores
add column if not exists manual_updated_by uuid
references profiles(id)
on delete set null;

alter table ai_lead_scores
add column if not exists manual_updated_at timestamptz;

alter table ai_lead_scores
add column if not exists effective_score integer;

alter table ai_lead_scores
add column if not exists effective_grade text;

alter table ai_lead_scores
add column if not exists scoring_mode text
default 'AI'
check (
    scoring_mode in (
        'AI',
        'MANUAL',
        'HYBRID'
    )
);

alter table ai_lead_scores
add column if not exists locked boolean
default false;

alter table ai_lead_scores
add column if not exists pipeline_stage text;

alter table ai_lead_scores
add column if not exists next_action text;

alter table ai_lead_scores
add column if not exists updated_by_ai boolean
default true;

-- ============================================================
-- AI LEAD SCORE HISTORY
-- ============================================================

create table if not exists ai_lead_score_history (

    id uuid primary key default gen_random_uuid(),

    account_id uuid not null
        references accounts(id)
        on delete cascade,

    contact_id uuid not null
        references contacts(id)
        on delete cascade,

    conversation_id uuid
        references conversations(id)
        on delete set null,

    old_score integer,

    new_score integer,

    old_grade text,

    new_grade text,

    changed_by uuid
        references profiles(id)
        on delete set null,

    change_source text not null
        check (
            change_source in (
                'AI',
                'MANUAL',
                'SYSTEM'
            )
        ),

    reason text,

    created_at timestamptz not null default now()

);

------------------------------------------------------------
-- INDEXES
------------------------------------------------------------

create index if not exists idx_ai_lead_history_account
on ai_lead_score_history(account_id);

create index if not exists idx_ai_lead_history_contact
on ai_lead_score_history(contact_id);

create index if not exists idx_ai_lead_history_conversation
on ai_lead_score_history(conversation_id);

create index if not exists idx_ai_lead_history_created
on ai_lead_score_history(created_at);