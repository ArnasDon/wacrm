import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..', '..');
const migrationPath = resolve(
  root,
  'supabase/migrations/037_ai_inbox_agent.sql'
);
const typesPath = resolve(root, 'src/types/index.ts');

describe('AI inbox agent schema contract', () => {
  it('defines the three AI agent tables, tenancy policies, and updated_at triggers', () => {
    expect(existsSync(migrationPath)).toBe(true);

    const migration = readFileSync(migrationPath, 'utf8');

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS ai_agents');
    expect(migration).toContain(
      'user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL'
    );
    expect(migration).toContain(
      'CREATE TABLE IF NOT EXISTS ai_conversation_states'
    );
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS ai_agent_runs');
    expect(migration).toContain(
      "CHECK (status IN ('active', 'paused', 'handoff', 'disabled'))"
    );
    expect(migration).toContain(
      "CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'skipped'))"
    );
    expect(migration).toContain(
      'CREATE POLICY ai_agents_select ON ai_agents FOR SELECT USING (is_account_member(account_id));'
    );
    expect(migration).toContain(
      "CREATE POLICY ai_agents_modify ON ai_agents FOR ALL USING (is_account_member(account_id, 'admin')) WITH CHECK (is_account_member(account_id, 'admin'));"
    );
    expect(migration).toContain(
      "CREATE POLICY ai_conversation_states_modify ON ai_conversation_states FOR ALL USING (is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));"
    );
    expect(migration).toContain(
      'CREATE POLICY ai_agent_runs_select ON ai_agent_runs FOR SELECT USING (is_account_member(account_id));'
    );
    expect(migration).toContain(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON ai_agents'
    );
    expect(migration).toContain(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON ai_conversation_states'
    );
  });

  it('declares the public AI inbox agent types', () => {
    const types = readFileSync(typesPath, 'utf8');

    expect(types).toContain('export interface AiAgent');
    expect(types).toContain('export interface AiConversationState');
    expect(types).toContain('export interface AiAgentRun');
    expect(types).toContain(
      "export type AiConversationStateStatus = 'active' | 'paused' | 'handoff' | 'disabled';"
    );
    expect(types).toContain(
      "export type AiAgentRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped';"
    );
  });
});
