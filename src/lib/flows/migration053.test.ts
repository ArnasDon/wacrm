import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/053_flow_approvals.sql"),
  "utf8",
);
const memberRpcsSql = readFileSync(
  join(process.cwd(), "supabase/migrations/018_account_member_rpcs.sql"),
  "utf8",
);
const invitationRpcsSql = readFileSync(
  join(process.cwd(), "supabase/migrations/019_invitation_rpcs.sql"),
  "utf8",
);

describe("migration 053 durable flow approvals", () => {
  it("stores account/version/run/visit-bound requests with bounded payloads and retention", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS flow_approval_requests");
    for (const column of [
      "account_id",
      "flow_id",
      "flow_version_id",
      "flow_run_id",
      "node_key",
      "visit_id",
      "attempt",
      "assignee_user_id",
      "expires_at",
      "revision",
    ]) {
      expect(sql).toMatch(new RegExp(`\\b${column}\\b`, "i"));
    }
    expect(sql).toContain("octet_length");
    expect(sql).toContain("retention_expires_at");
    expect(sql).toMatch(/UNIQUE\s*\(\s*flow_run_id,\s*visit_id,\s*node_key,\s*attempt\s*\)/i);
  });

  it("keeps raw rows immutable and account-scoped", () => {
    expect(sql).toContain("ALTER TABLE flow_approval_requests ENABLE ROW LEVEL SECURITY");
    expect(sql).toMatch(
      /auth\.uid\(\)\s*=\s*assignee_user_id[\s\S]+?is_account_member\s*\(\s*account_id,\s*'agent'\s*\)/i,
    );
    expect(sql).toMatch(/is_account_member\s*\(\s*account_id,\s*'admin'\s*\)/i);
    expect(sql).toMatch(
      /REVOKE\s+(?:ALL|INSERT,\s*UPDATE,\s*DELETE)[\s\S]+?flow_approval_requests[\s\S]+?FROM authenticated/i,
    );
    expect(sql).not.toMatch(/GRANT\s+(?:INSERT|UPDATE|DELETE)[\s\S]+?flow_approval_requests[\s\S]+?TO authenticated/i);
  });

  it("provides hardened schedule, CAS decision, SKIP LOCKED claim, ack, and purge RPCs", () => {
    for (const name of [
      "schedule_flow_approval",
      "decide_flow_approval",
      "claim_flow_approval_resolutions",
      "complete_flow_approval_resolution",
      "purge_expired_flow_approvals",
    ]) {
      const definition = sql.match(
        new RegExp(
          `CREATE OR REPLACE FUNCTION ${name}[\\s\\S]+?\\$\\$;`,
          "i",
        ),
      )?.[0];
      expect(definition, name).toBeTruthy();
      expect(definition).toContain(
        "SET search_path = pg_catalog, public, pg_temp",
      );
    }
    expect(sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(sql).toContain("approval_revision_conflict");
    expect(sql).toContain("p_expected_revision");
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION decide_flow_approval[\s\S]+?TO authenticated/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION schedule_flow_approval[\s\S]+?TO service_role/i);
    const decision = sql.match(
      /CREATE OR REPLACE FUNCTION decide_flow_approval[\s\S]+?\$\$;/i,
    )?.[0];
    expect(decision).toContain("RETURNS JSONB");
    expect(decision).not.toContain("'resolution_token'");
    expect(decision).not.toContain("'resume_id'");
  });

  it("locks the request then the actor membership row before authorizing", () => {
    const decision = sql.match(
      /CREATE OR REPLACE FUNCTION decide_flow_approval[\s\S]+?\$\$;/i,
    )?.[0];
    expect(decision).toBeTruthy();
    expect(decision).toMatch(
      /SELECT \* INTO v_request[\s\S]+?flow_approval_requests[\s\S]+?FOR UPDATE;[\s\S]+?SELECT \* INTO v_actor_profile[\s\S]+?profiles[\s\S]+?user_id\s*=\s*v_actor[\s\S]+?FOR SHARE;/i,
    );
    expect(decision).toMatch(
      /v_actor_profile\.account_id\s+IS DISTINCT FROM\s+v_request\.account_id[\s\S]+?v_actor\s*=\s*v_request\.assignee_user_id[\s\S]+?v_actor_profile\.account_role\s+IN\s*\(\s*'owner',\s*'admin',\s*'agent'\s*\)[\s\S]+?v_actor_profile\.account_role\s+IN\s*\(\s*'owner',\s*'admin'\s*\)/i,
    );
    expect(decision).toContain(
      "Lock order: approval request first, then the actor profile.",
    );
  });

  it("serializes approval authorization with every membership removal, demotion, and transfer write", () => {
    const setRole = memberRpcsSql.match(
      /CREATE OR REPLACE FUNCTION public\.set_member_role[\s\S]+?\$\$;/i,
    )?.[0];
    const removeMember = memberRpcsSql.match(
      /CREATE OR REPLACE FUNCTION public\.remove_account_member[\s\S]+?\$\$;/i,
    )?.[0];
    const transferOwner = memberRpcsSql.match(
      /CREATE OR REPLACE FUNCTION public\.transfer_account_ownership[\s\S]+?\$\$;/i,
    )?.[0];
    const redeemInvitation = invitationRpcsSql.match(
      /CREATE OR REPLACE FUNCTION public\.redeem_invitation[\s\S]+?\$\$;/i,
    )?.[0];

    expect(setRole).toMatch(
      /UPDATE profiles[\s\S]+?SET account_role\s*=\s*p_new_role[\s\S]+?WHERE user_id\s*=\s*p_user_id/i,
    );
    expect(removeMember).toMatch(
      /UPDATE profiles[\s\S]+?SET account_id\s*=\s*v_new_account_id[\s\S]+?account_role\s*=\s*'owner'[\s\S]+?WHERE user_id\s*=\s*p_user_id/i,
    );
    expect(transferOwner).toMatch(
      /UPDATE profiles SET account_role\s*=\s*'admin'[\s\S]+?WHERE user_id\s*=\s*auth\.uid\(\)/i,
    );
    expect(redeemInvitation).toMatch(
      /UPDATE profiles[\s\S]+?SET account_id\s*=\s*v_inv\.account_id[\s\S]+?account_role\s*=\s*v_inv\.role[\s\S]+?WHERE user_id\s*=\s*v_caller_id/i,
    );
  });

  it("allows an exact authorized replay after expiry but blocks a first decision at the deadline", () => {
    const decision = sql.match(
      /CREATE OR REPLACE FUNCTION decide_flow_approval[\s\S]+?\$\$;/i,
    )?.[0] ?? "";
    const replayAt = decision.indexOf("IF v_request.decision = p_decision");
    const expiryAt = decision.indexOf(
      "v_request.expires_at <= clock_timestamp()",
    );
    const mutationAt = decision.indexOf(
      "UPDATE public.flow_approval_requests",
    );

    expect(replayAt).toBeGreaterThan(-1);
    expect(expiryAt).toBeGreaterThan(replayAt);
    expect(mutationAt).toBeGreaterThan(expiryAt);
    expect(decision).toMatch(
      /IF v_request\.decision\s*=\s*p_decision[\s\S]+?p_expected_revision\s*=\s*v_request\.revision\s*-\s*1[\s\S]+?v_request\.decision_note\s+IS NOT DISTINCT FROM\s+NULLIF\(BTRIM\(p_note\),\s*''\)[\s\S]+?RETURN jsonb_build_object/i,
    );
    expect(decision).toMatch(
      /v_request\.expires_at\s*<=\s*clock_timestamp\(\)[\s\S]+?approval_expired/i,
    );
  });

  it("hardens notification reads and read receipts against removed or transferred users", () => {
    expect(sql).toMatch(
      /DROP POLICY IF EXISTS notifications_select[\s\S]+?CREATE POLICY notifications_select[\s\S]+?auth\.uid\(\)\s*=\s*user_id[\s\S]+?is_account_member\s*\(\s*account_id,\s*'viewer'\s*\)/i,
    );
    expect(sql).toMatch(
      /DROP POLICY IF EXISTS notifications_update[\s\S]+?CREATE POLICY notifications_update[\s\S]+?USING\s*\([\s\S]+?auth\.uid\(\)\s*=\s*user_id[\s\S]+?is_account_member\s*\(\s*account_id,\s*'viewer'\s*\)[\s\S]+?WITH CHECK\s*\([\s\S]+?auth\.uid\(\)\s*=\s*user_id[\s\S]+?is_account_member\s*\(\s*account_id,\s*'viewer'\s*\)/i,
    );
  });

  it("returns durable evidence when a reclaimed resolution already opened a second approval", () => {
    const claim = sql.match(
      /CREATE OR REPLACE FUNCTION claim_flow_approval_resolutions[\s\S]+?\$\$;/i,
    )?.[0];
    expect(claim).toContain("chained_approval_ready BOOLEAN");
    expect(claim).toMatch(
      /chained_approval_ready\s*:=\s*[\s\S]+?v_run\.status\s*=\s*'paused_by_agent'[\s\S]+?EXISTS\s*\([\s\S]+?flow_approval_requests[\s\S]+?id\s*<>\s*v_request\.id[\s\S]+?visit_id\s*=\s*v_run\.current_visit_id/i,
    );
  });

  it("adds approval notifications without exposing contact channels", () => {
    expect(sql).toContain("'flow_approval'");
    expect(sql).toContain("approval_request_id");
    expect(sql).not.toMatch(/\b(?:email|phone|telephone)\b/i);
  });

  it("appends bounded run audit events for human decisions and timeouts", () => {
    expect(sql).toContain("'approval_decision'");
    expect(sql).toContain("'approval_timeout'");
    expect(sql).not.toMatch(/flow_run_events[\s\S]{0,500}decision_note/i);
  });
});
