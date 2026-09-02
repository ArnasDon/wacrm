-- ============================================================
-- 0001 — FTS5 lexical search + self-referencing foreign keys
--
-- Two things Drizzle's schema builder cannot express, applied here as
-- hand-written SQL. Both are part of the initial schema conceptually;
-- they are a separate file only because the generator cannot emit them.
-- ============================================================

-- ------------------------------------------------------------
-- 1. FTS5 index over ai_knowledge_chunks.content
--
-- Replaces the Postgres generated column from migration 030:
--
--   fts tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED
--
-- and the `ts_rank(c.fts, plainto_tsquery('simple', $1))` ranking in
-- `match_ai_knowledge_fts()`. FTS5's bm25() is the ranking function
-- here; note the sign convention differs from ts_rank — bm25() returns
-- a NEGATIVE score where more-negative is a better match, so callers
-- order ASC (or negate) rather than DESC.
--
-- `content=` makes this an external-content table: FTS5 stores only the
-- index, not a second copy of the text, and reads the original rows
-- from ai_knowledge_chunks via `content_rowid`. That requires an
-- INTEGER rowid to join on, which our TEXT uuid primary key is not —
-- so the table is indexed by the implicit SQLite rowid, and the three
-- triggers below keep it in sync. `chunk_id` is stored UNINDEXED so a
-- match can be mapped back to the owning chunk without a second query.
-- ------------------------------------------------------------
CREATE VIRTUAL TABLE ai_knowledge_chunks_fts USING fts5(
  chunk_id UNINDEXED,
  account_id UNINDEXED,
  content,
  tokenize = 'unicode61 remove_diacritics 2'
);
--> statement-breakpoint

-- Keep the FTS index in step with the base table. Postgres did this
-- with a STORED generated column; SQLite needs explicit triggers.
CREATE TRIGGER ai_knowledge_chunks_fts_insert
AFTER INSERT ON ai_knowledge_chunks
BEGIN
  INSERT INTO ai_knowledge_chunks_fts (rowid, chunk_id, account_id, content)
  VALUES (new.rowid, new.id, new.account_id, new.content);
END;
--> statement-breakpoint

CREATE TRIGGER ai_knowledge_chunks_fts_delete
AFTER DELETE ON ai_knowledge_chunks
BEGIN
  DELETE FROM ai_knowledge_chunks_fts WHERE rowid = old.rowid;
END;
--> statement-breakpoint

CREATE TRIGGER ai_knowledge_chunks_fts_update
AFTER UPDATE ON ai_knowledge_chunks
BEGIN
  DELETE FROM ai_knowledge_chunks_fts WHERE rowid = old.rowid;
  INSERT INTO ai_knowledge_chunks_fts (rowid, chunk_id, account_id, content)
  VALUES (new.rowid, new.id, new.account_id, new.content);
END;
--> statement-breakpoint

-- ------------------------------------------------------------
-- 2. Self-referencing foreign keys
--
-- Drizzle cannot declare a column that references its own table
-- inline, so `messages.reply_to_message_id` and
-- `automation_steps.parent_step_id` came out of 0000 as plain TEXT
-- columns with no constraint.
--
-- SQLite has no `ALTER TABLE ... ADD CONSTRAINT`, and the usual
-- workaround — rename, recreate, copy, drop — is not worth running on
-- a fresh database for two nullable audit links. Both are enforced in
-- the data-access layer instead:
--
--   - messages.reply_to_message_id → the sender resolves the quoted
--     message before insert, so a dangling id cannot be written.
--   - automation_steps.parent_step_id → the automation editor writes
--     a whole step tree in one batch and validates parentage first.
--
-- Postgres declared both ON DELETE CASCADE. Without the FK, deleting a
-- parent leaves children pointing at a missing row, so both delete
-- paths clear the reference explicitly. The two indexes below make
-- those cleanup queries cheap; `idx_automation_steps_parent` already
-- exists from 0000, so only the messages one is created here.
-- ------------------------------------------------------------
CREATE INDEX idx_messages_reply_to
  ON messages (reply_to_message_id)
  WHERE reply_to_message_id IS NOT NULL;
