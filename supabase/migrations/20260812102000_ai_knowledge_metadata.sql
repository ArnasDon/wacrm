-- Lightweight metadata for a knowledge document: a free-text type label
-- (business-defined, not a fixed taxonomy — mirrors how skills.name and
-- agent_tools.instructions are already free text elsewhere in this
-- schema) and a status. `status` defaults every existing row to
-- 'active' (no behaviour change). Deliberately UI-facing metadata only
-- for now: retrieveKnowledge/match_ai_knowledge_semantic/_fts are NOT
-- changed by this migration, so an 'archived' document still surfaces
-- in retrieval — excluding it would mean editing the retrieval RPCs,
-- a Runtime change out of scope for this pass. Track status in the UI
-- (Agentes -> Conhecimento) as "arquivado, mas ainda pesquisável" until
-- that follow-up lands.

alter table wacrm.ai_knowledge_documents
  add column if not exists doc_type text check (char_length(doc_type) <= 60),
  add column if not exists status text not null default 'active'
    check (status in ('active', 'archived'));
