-- ============================================================
-- MIGRATION 030
-- AI MEMORY FOUNDATION
-- ============================================================

create table if not exists ai_memory_hot (

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

    summary text not null,

    summary_hash varchar(64) not null,

    memory_version integer not null default 1,

    last_updated_by text,

    archived boolean not null default false,

    last_message_at timestamptz not null,

    expires_at timestamptz not null,

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now(),

    accessed_at timestamptz,

    unique (
        account_id,
        contact_id
    )

);

------------------------------------------------------------
-- INDEXES
------------------------------------------------------------

create index if not exists idx_ai_memory_account_contact
on ai_memory_hot (
    account_id,
    contact_id
);

create index if not exists idx_ai_memory_expiry
on ai_memory_hot (
    expires_at
);

create index if not exists idx_ai_memory_last_message
on ai_memory_hot (
    last_message_at
);

------------------------------------------------------------
-- CUSTOMER PREFERENCES
------------------------------------------------------------

create table if not exists ai_memory_preferences (

    id uuid primary key default gen_random_uuid(),

    account_id uuid not null
        references accounts(id)
        on delete cascade,

    contact_id uuid not null
        references contacts(id)
        on delete cascade,

    language text,

    preferred_service text,

    preferred_therapist text,

    preferred_visit_time text,

    notes text,

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now(),

    accessed_at timestamptz,

    unique (
        account_id,
        contact_id
    )

);

------------------------------------------------------------
-- INDEXES
------------------------------------------------------------

create index if not exists idx_ai_preferences_account_contact
on ai_memory_preferences (
    account_id,
    contact_id
);