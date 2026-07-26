import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/049_flow_runtime_primitives.sql"),
  "utf8",
);

describe("migration 049 durable waits", () => {
  it("adds a waiting run state and blocks competing active or waiting runs", () => {
    expect(sql).toContain("'waiting'");
    expect(sql).toMatch(
      /WHERE\s+status\s+IN\s*\(\s*'active'\s*,\s*'waiting'\s*,\s*'resuming'\s*,\s*'needs_recovery'\s*\)/i,
    );
  });

  it("uses service-role-only, search-path-safe atomic wait RPCs", () => {
    for (const name of [
      "schedule_flow_wait",
      "claim_due_flow_waits",
      "prepare_flow_wait_resume",
      "complete_flow_wait_continuation",
      "ack_flow_wait_resume",
      "advance_flow_run_cursor",
      "reserve_flow_node_effect",
      "mark_flow_node_effect_committed",
      "mark_flow_node_effect_ambiguous",
      "complete_flow_node_effect",
      "reconcile_flow_node_effect_recovery",
      "mark_flow_run_cursor_recovery",
      "commit_flow_reply_transition",
      "finalize_flow_reprompt_effect",
      "finalize_flow_fallback_decision",
    ]) {
      expect(sql).toContain(`FUNCTION ${name}`);
      expect(sql).toMatch(
        new RegExp(
          `FUNCTION\\s+${name}[\\s\\S]+?SECURITY DEFINER[\\s\\S]+?SET search_path = public`,
          "i",
        ),
      );
      expect(sql).toMatch(
        new RegExp(`REVOKE ALL ON FUNCTION ${name}[\\s\\S]+?FROM PUBLIC`, "i"),
      );
      expect(sql).toMatch(
        new RegExp(
          `GRANT EXECUTE ON FUNCTION ${name}[\\s\\S]+?TO service_role`,
          "i",
        ),
      );
    }
  });

  it("pins waits to immutable versions and uses idempotent claims", () => {
    expect(sql).toContain("flow_version_id");
    expect(sql).toContain("claim_token");
    expect(sql).toMatch(/FOR UPDATE(?:\s+OF\s+wait)?\s+SKIP LOCKED/i);
    expect(sql).toMatch(
      /wait\.status\s*=\s*'claimed'[\s\S]+?wait\.claimed_at\s*<\s*p_now\s*-\s*INTERVAL\s*'5 minutes'/i,
    );
    expect(sql).toContain("UNIQUE (flow_run_id)");
    expect(sql).toMatch(
      /IF\s+v_run\.status\s*=\s*'waiting'[\s\S]+?wait\.status\s+IN\s*\(\s*'pending'\s*,\s*'claimed'\s*\)[\s\S]+?IF FOUND THEN[\s\S]+?RETURN;/i,
    );
  });

  it("keeps a continuation reclaimable until advancement is acknowledged", () => {
    expect(sql).toContain("'resuming'");
    expect(sql).toContain("current_visit_id");
    expect(sql).toContain("continuation_id");
    expect(sql).toContain("continuation_phase");
    expect(sql).toContain("continuation_step");
    expect(sql).toContain("resume_id");
    expect(sql).toMatch(
      /FUNCTION\s+prepare_flow_wait_resume[\s\S]+?SET\s+status\s*=\s*'resuming'[\s\S]+?current_node_key\s*=\s*v_wait\.next_node_key[\s\S]+?current_visit_id\s*=\s*v_wait\.resume_id/i,
    );
    expect(sql).toMatch(
      /FUNCTION\s+complete_flow_wait_continuation[\s\S]+?continuation_phase\s*=\s*'completed'/i,
    );
    expect(sql).toMatch(
      /FUNCTION\s+ack_flow_wait_resume[\s\S]+?continuation_phase\s*<>\s*'completed'[\s\S]+?status\s*=\s*'resumed'/i,
    );
    expect(sql).toMatch(
      /FUNCTION\s+ack_flow_wait_resume[\s\S]+?v_wait\.status\s*=\s*'resumed'[\s\S]+?v_wait\.claim_token\s*=\s*p_claim_token[\s\S]+?RETURN TRUE/i,
    );
    expect(sql).not.toMatch(/FUNCTION\s+resume_flow_wait\s*\(/i);
  });

  it("uses a stable per-visit effect ledger with fail-safe ambiguity", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS flow_node_effects");
    expect(sql).toContain(
      "UNIQUE (flow_run_id, visit_id, node_key, effect_kind)",
    );
    expect(sql).toContain("'ambiguous'");
    expect(sql).toContain("invocation_token");
    expect(sql).toMatch(
      /FUNCTION\s+reserve_flow_node_effect[\s\S]+?current_visit_id\s*=\s*p_visit_id[\s\S]+?effect\.invocation_token\s*=\s*p_invocation_token/i,
    );
    expect(sql).toMatch(
      /FUNCTION\s+mark_flow_node_effect_committed[\s\S]+?status\s*=\s*'remote_committed'[\s\S]+?result\s*=\s*p_result/i,
    );
    expect(sql).toMatch(
      /FUNCTION\s+mark_flow_node_effect_ambiguous[\s\S]+?status\s*=\s*'ambiguous'/i,
    );
    expect(sql).toMatch(
      /FUNCTION\s+complete_flow_node_effect[\s\S]+?status\s*=\s*'completed'/i,
    );
    expect(sql).toMatch(
      /FUNCTION\s+reconcile_flow_node_effect_recovery[\s\S]+?FOR UPDATE[\s\S]+?v_effect\.status\s*=\s*'remote_committed'[\s\S]+?status\s*=\s*'needs_recovery'/i,
    );
    expect(sql).toContain(
      "GRANT ALL ON TABLE flow_node_effects TO service_role",
    );
  });

  it("commits replies and reprompt completion at their state boundaries", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS flow_reply_transitions");
    expect(sql).toContain("next_visit_id UUID NOT NULL");
    expect(sql).toContain("transition_kind TEXT NOT NULL");
    expect(sql).toContain("recovery_state TEXT NOT NULL");
    expect(sql).toContain("UNIQUE (account_id, contact_id, meta_message_id)");
    expect(sql).toMatch(
      /FUNCTION\s+commit_flow_reply_transition[\s\S]+?FOR UPDATE[\s\S]+?INSERT INTO flow_reply_transitions/i,
    );
    expect(sql).toMatch(
      /FUNCTION\s+commit_flow_reply_transition[\s\S]+?reprompt_count\s*=\s*0[\s\S]+?current_node_key\s*=\s*p_next_node_key/i,
    );
    expect(sql).toMatch(
      /FUNCTION\s+finalize_flow_reprompt_effect[\s\S]+?FOR UPDATE[\s\S]+?reprompt_count\s*=\s*p_reprompt_count[\s\S]+?UPDATE flow_node_effects[\s\S]+?status\s*=\s*'completed'/i,
    );
    expect(sql).toMatch(
      /FUNCTION\s+finalize_flow_fallback_decision[\s\S]+?FOR UPDATE[\s\S]+?INSERT INTO flow_reply_transitions[\s\S]+?reprompt_count\s*=\s*p_reprompt_count[\s\S]+?status\s*=\s*'handed_off'/i,
    );
  });

  it("exposes reply receipts read-only to account members", () => {
    expect(sql).toContain(
      "ALTER TABLE flow_reply_transitions ENABLE ROW LEVEL SECURITY",
    );
    expect(sql).toContain(
      "USING (is_account_member(account_id, 'viewer'))",
    );
    expect(sql).toContain(
      "REVOKE ALL ON TABLE flow_reply_transitions FROM PUBLIC, anon",
    );
    expect(sql).toContain(
      "REVOKE INSERT, UPDATE, DELETE ON TABLE flow_reply_transitions FROM authenticated",
    );
    expect(sql).toContain(
      "GRANT SELECT ON TABLE flow_reply_transitions TO authenticated",
    );
    expect(sql).toContain(
      "GRANT ALL ON TABLE flow_reply_transitions TO service_role",
    );
  });

  it("keeps remote-committed runs publicly recoverable", () => {
    expect(sql).toContain("'needs_recovery'");
    expect(sql).toMatch(
      /WHERE\s+status\s+IN\s*\(\s*'active'\s*,\s*'waiting'\s*,\s*'resuming'\s*,\s*'needs_recovery'\s*\)/i,
    );
    expect(sql).toMatch(
      /FUNCTION\s+reconcile_flow_node_effect_recovery[\s\S]+?v_effect\.status\s*=\s*'reserved'[\s\S]+?status\s*=\s*'remote_committed'/i,
    );
    expect(sql).toMatch(
      /p_intended_next_node_key[\s\S]+?p_intended_next_visit_id[\s\S]+?'already_committed'/i,
    );
  });

  it("preserves and clears wait continuation identity independently of status", () => {
    expect(sql).toMatch(
      /FUNCTION\s+advance_flow_run_cursor[\s\S]+?WHEN continuation_id IS NOT NULL THEN 'resuming'/i,
    );
    expect(sql).toMatch(
      /FUNCTION\s+advance_flow_run_cursor[\s\S]+?current_visit_id\s*=\s*p_next_visit_id/i,
    );
    expect(sql).toMatch(
      /current_node_key IS NOT DISTINCT FROM p_next_node_key[\s\S]+?current_visit_id IS NOT DISTINCT FROM p_next_visit_id/i,
    );
    expect(sql).toMatch(
      /FUNCTION\s+ack_flow_wait_resume[\s\S]+?continuation_id = v_wait\.resume_id[\s\S]+?continuation_phase = 'completed'/i,
    );
  });
});
