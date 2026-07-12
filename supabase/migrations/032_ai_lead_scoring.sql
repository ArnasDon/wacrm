-- ============================================================
-- MIGRATION 032
-- AI LEAD SCORING ENGINE
-- ============================================================

create table if not exists ai_lead_scores (

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

    score integer not null default 0
        check (
            score >= 0
            and score <= 100
        ),

    grade text not null default 'COLD'
        check (
            grade in (
                'COLD',
                'WARM',
                'HOT',
                'QUALIFIED'
            )
        ),

    reason text,

    last_intent text,

    booking_interest boolean not null default false,

    pricing_interest boolean not null default false,

    followup_needed boolean not null default false,

    human_handoff boolean not null default false,

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now(),

    unique (
        account_id,
        contact_id
    )

);

------------------------------------------------------------
-- INDEXES
------------------------------------------------------------

create index if not exists idx_ai_lead_scores_account
on ai_lead_scores (
    account_id
);

create index if not exists idx_ai_lead_scores_contact
on ai_lead_scores (
    contact_id
);

create index if not exists idx_ai_lead_scores_score
on ai_lead_scores (
    score
);

create index if not exists idx_ai_lead_scores_grade
on ai_lead_scores (
    grade
);

create index if not exists idx_ai_lead_scores_conversation
on ai_lead_scores (
    conversation_id
);