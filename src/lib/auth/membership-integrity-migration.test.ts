import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "supabase", "migrations");

const migrations = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => ({ name, sql: readFileSync(join(migrationsDir, name), "utf8") }));

function latestFunctionBody(functionName: string): string {
  const header = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+(?:public\\.)?${functionName}\\s*\\(`,
    "i",
  );
  const latest = migrations.filter(({ sql }) => header.test(sql)).at(-1);
  if (!latest) throw new Error(`${functionName} is not defined in any migration`);
  const start = latest.sql.search(header);
  const bodyStart = latest.sql.indexOf("$$", start);
  const bodyEnd = latest.sql.indexOf("$$", bodyStart + 2);
  return latest.sql.slice(bodyStart + 2, bodyEnd);
}

function lastMigrationMatching(pattern: RegExp): string | undefined {
  return migrations.filter(({ sql }) => pattern.test(sql)).at(-1)?.name;
}

const membershipCheck =
  /select\s+1\s+from\s+profiles\s+where\s+user_id\s*=\s*new\.assigned_agent_id\s+and\s+account_id\s*=\s*new\.account_id/i;

describe("account membership integrity migrations", () => {
  it("leaves no client INSERT policy on profiles", () => {
    const created = lastMigrationMatching(/create\s+policy\s+profiles_insert\b/i);
    const dropped = lastMigrationMatching(/drop\s+policy\s+if\s+exists\s+profiles_insert\b/i);
    expect(dropped).toBeDefined();
    expect(created === undefined || created < dropped!).toBe(true);
  });

  it("guards profile inserts as well as updates", () => {
    const triggerName = /create\s+trigger\s+enforce_profile_privilege_columns\s+before\s+([a-z\s]+?)\s+on/gi;
    const last = migrations
      .flatMap(({ sql }) => [...sql.matchAll(triggerName)].map((match) => match[1]))
      .at(-1);
    expect(last?.toLowerCase().replace(/\s+/g, " ")).toBe("insert or update");
    expect(latestFunctionBody("enforce_profile_privilege_columns")).toMatch(/tg_op\s*=\s*'INSERT'/i);
  });

  it("unassigns a removed member's conversations", () => {
    expect(latestFunctionBody("remove_account_member")).toMatch(
      /update\s+conversations\s+set\s+assigned_agent_id\s*=\s*null\s+where\s+account_id\s*=\s*v_target_account_id\s+and\s+assigned_agent_id\s*=\s*p_user_id/i,
    );
  });

  it("only notifies assignees who belong to the conversation's account", () => {
    expect(latestFunctionBody("notify_conversation_assigned")).toMatch(membershipCheck);
  });

  it("drops assignees who are not members of the conversation's account", () => {
    expect(latestFunctionBody("enforce_conversation_assignee_membership")).toMatch(membershipCheck);
  });

  it("restricts media writes to agents and above", () => {
    for (const bucket of ["chat media", "flow media"]) {
      for (const verb of ["upload", "update", "delete"]) {
        const policy = `Members can ${verb} ${bucket}`;
        const latest = migrations
          .filter(({ sql }) => sql.includes(`CREATE POLICY "${policy}"`))
          .at(-1);
        expect(latest, policy).toBeDefined();
        const start = latest!.sql.indexOf(`CREATE POLICY "${policy}"`);
        const statement = latest!.sql.slice(start, latest!.sql.indexOf(";", start));
        expect(statement, policy).toContain("p.account_role IN ('owner', 'admin', 'agent')");
      }
    }
  });
});
