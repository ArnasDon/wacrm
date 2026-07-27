import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/056_flow_entry_triggers.sql",
);

function sql(): string {
  return readFileSync(migrationPath, "utf8");
}

describe("migration 056 flow entry triggers", () => {
  it("creates durable trigger ingress tables and links runs to invocations", () => {
    const text = sql();

    expect(text).toMatch(/CREATE TABLE IF NOT EXISTS public\.flow_webhook_endpoints/i);
    expect(text).toMatch(/CREATE TABLE IF NOT EXISTS public\.flow_trigger_schedules/i);
    expect(text).toMatch(/CREATE TABLE IF NOT EXISTS public\.flow_trigger_invocations/i);
    expect(text).toMatch(/ALTER TABLE public\.flow_runs[\s\S]+ADD COLUMN IF NOT EXISTS trigger_invocation_id UUID/i);
    expect(text).toMatch(/CREATE UNIQUE INDEX[\s\S]+?\(trigger_invocation_id\)/i);
    expect(text).toMatch(/idempotency_key TEXT NOT NULL/i);
    expect(text).toMatch(/body_hash TEXT/i);
    expect(text).toMatch(/flow_version_id UUID NOT NULL[\s\S]+REFERENCES public\.flow_versions\(id\)/i);
  });

  it("hardens RLS, grants, and SECURITY DEFINER RPCs", () => {
    const text = sql();

    for (const table of [
      "flow_webhook_endpoints",
      "flow_trigger_schedules",
      "flow_trigger_invocations",
    ]) {
      expect(text).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
      expect(text).toMatch(
        new RegExp(`REVOKE ALL ON TABLE public\\.${table} FROM PUBLIC, anon, authenticated`, "i"),
      );
      expect(text).toMatch(
        new RegExp(`GRANT ALL ON TABLE public\\.${table} TO service_role`, "i"),
      );
    }

    for (const fn of [
      "accept_flow_trigger_invocation",
      "claim_due_flow_trigger_schedules",
      "mark_flow_trigger_schedule_fired",
      "claim_flow_trigger_invocations",
      "complete_flow_trigger_invocation",
    ]) {
      expect(text).toMatch(
        new RegExp(`FUNCTION public\\.${fn}[\\s\\S]+?SECURITY DEFINER[\\s\\S]+?SET search_path = pg_catalog, public, pg_temp`, "i"),
      );
      expect(text).toMatch(
        new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}[\\s\\S]+?FROM PUBLIC, anon, authenticated`, "i"),
      );
      expect(text).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}[\\s\\S]+?TO service_role`, "i"),
      );
    }
  });

  it("uses concurrent-safe schedule and invocation claims", () => {
    const text = sql();

    expect(text).toContain("FOR UPDATE SKIP LOCKED");
    expect(text).toMatch(/claim_token UUID/i);
    expect(text).toMatch(/lease_expires_at TIMESTAMPTZ/i);
    expect(text).toMatch(/UNIQUE \(schedule_id, scheduled_for\)/i);
    expect(text).toMatch(/misfire_policy TEXT NOT NULL DEFAULT 'skip'/i);
  });
});
