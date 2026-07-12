-- ============================================================
-- AI PROMPT REGISTRY
-- ============================================================

create table if not exists ai_prompts (

    id uuid primary key default gen_random_uuid(),

    account_id uuid
        references accounts(id)
        on delete cascade,

    provider text not null
    check (
        provider in (
            'gemini',
            'openai',
            'claude',
            'deepseek',
            'grok'
        )
    ),

scope text not null default 'global'
    check (
        scope in (
            'global',
            'account',
            'intent'
        )
    ),

    intent text,

    name text not null,

    system_prompt text not null,

    version integer not null default 1,

    enabled boolean not null default true,

    created_at timestamptz default now(),

    updated_at timestamptz default now()
);

create index if not exists idx_ai_prompts_provider
on ai_prompts(provider);

create index if not exists idx_ai_prompts_account
on ai_prompts(account_id);

create index if not exists idx_ai_prompts_scope
on ai_prompts(scope);

create unique index if not exists idx_ai_prompts_unique
on ai_prompts (
    coalesce(
    account_id,
    CAST('00000000-0000-0000-0000-000000000000' AS uuid)
),
    provider,
    coalesce(intent,''),
    scope,
    version
);