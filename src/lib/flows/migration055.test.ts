import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/055_flow_code_import.sql"),
  "utf8",
);

describe("migration 055 flow code import", () => {
  it("exposes one hardened service-only atomic create/replace RPC", () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.import_flow_draft\s*\(/i,
    );
    expect(sql).toMatch(/SECURITY DEFINER/i);
    expect(sql).toMatch(/SET search_path = pg_catalog,\s*public/i);
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.import_flow_draft[\s\S]*FROM PUBLIC/i,
    );
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.import_flow_draft[\s\S]*FROM authenticated/i,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.import_flow_draft[\s\S]*TO service_role/i,
    );
  });

  it("validates actor/account, CAS, runtime nodes and never stores source documents or secrets", () => {
    expect(sql).toMatch(/profiles[\s\S]*p_actor_id[\s\S]*p_account_id/i);
    expect(sql).toContain("draft_revision_conflict");
    expect(sql).toMatch(/jsonb_array_elements\(p_nodes\)/i);
    expect(sql).toMatch(/v_runtime_node_types[\s\S]*node_type/i);
    expect(sql).toMatch(/FOR UPDATE/i);
    expect(sql).not.toMatch(/source_document|secret_bindings|raw_document/i);
  });

  it("deep-rejects portable markers, raw tokens and non-destination UUIDs", () => {
    expect(sql).toContain("p_allowed_resource_ids");
    expect(sql).toMatch(/\\\$\(secret\|resource\)/i);
    expect(sql).toMatch(/regexp_matches\(\s*p_nodes::TEXT/i);
    expect(sql).toContain("import_source_identifier_forbidden");
    expect(sql).toMatch(/bearer\[\[:space:\]\]/i);
  });

  it("preserves immutable published history while replacing only draft rows", () => {
    expect(sql).toMatch(/DELETE FROM public\.flow_nodes/i);
    expect(sql).toMatch(/INSERT INTO public\.flow_nodes/i);
    expect(sql).not.toMatch(/DELETE FROM public\.flow_versions/i);
    expect(sql).not.toMatch(/UPDATE public\.flow_versions/i);
    expect(sql).not.toMatch(/DELETE FROM public\.flow_runs/i);
  });
});
