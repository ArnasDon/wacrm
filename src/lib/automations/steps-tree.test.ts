import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  existingIds: [] as string[],
  calls: [] as { type: string; payload?: unknown; filters: [string, string, unknown][] }[],
}));

vi.mock("./admin-client", () => {
  function builder() {
    const op = { type: "select", payload: undefined as unknown, filters: [] as [string, string, unknown][] };
    const b: Record<string, unknown> = {
      select: () => b,
      insert: (p: unknown) => ((op.type = "insert"), (op.payload = p), b),
      upsert: (p: unknown) => ((op.type = "upsert"), (op.payload = p), b),
      delete: () => ((op.type = "delete"), b),
      eq: (k: string, v: unknown) => (op.filters.push(["eq", k, v]), b),
      in: (k: string, v: unknown) => (op.filters.push(["in", k, v]), b),
      then: (onF: (v: unknown) => unknown) => {
        h.calls.push(op);
        const data = op.type === "select" ? h.existingIds.map((id) => ({ id })) : null;
        return Promise.resolve({ data, error: null }).then(onF);
      },
    };
    return b;
  }
  return { supabaseAdmin: () => ({ from: () => builder() }) };
});

import { flattenSteps, replaceSteps } from "./steps-tree";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const FRESH = "44444444-4444-4444-8444-444444444444";

beforeEach(() => {
  h.existingIds = [];
  h.calls = [];
});

const writes = () => h.calls.filter((c) => c.type !== "select");
const rowsOf = (type: string) =>
  (writes().find((c) => c.type === type)?.payload ?? []) as { id: string; parent_step_id: string | null; position: number }[];

describe("replaceSteps", () => {
  it("keeps the ids of steps that survive a save", async () => {
    h.existingIds = [A, B, C];

    const err = await replaceSteps("auto1", [
      { id: A, step_type: "send_message", step_config: { text: "hi" } },
      {
        id: B,
        step_type: "condition",
        step_config: {},
        branches: { yes: [{ id: FRESH, step_type: "wait", step_config: {} }], no: [] },
      },
    ]);

    expect(err).toBeNull();
    expect(writes().map((c) => c.type)).toEqual(["insert", "upsert", "delete"]);
    expect(rowsOf("insert").map((r) => r.id)).toEqual([FRESH]);
    expect(rowsOf("insert")[0].parent_step_id).toBe(B);
    expect(rowsOf("upsert").map((r) => r.id)).toEqual([A, B]);
    const del = writes().find((c) => c.type === "delete")!;
    expect(del.filters).toContainEqual(["eq", "automation_id", "auto1"]);
    expect(del.filters).toContainEqual(["in", "id", [C]]);
  });

  it("skips the delete when nothing was removed", async () => {
    h.existingIds = [A];

    await replaceSteps("auto1", [{ id: A, step_type: "send_message", step_config: {} }]);

    expect(writes().map((c) => c.type)).toEqual(["upsert"]);
  });

  it("deletes every step when the builder sends none", async () => {
    h.existingIds = [A, B];

    await replaceSteps("auto1", []);

    expect(writes().map((c) => c.type)).toEqual(["delete"]);
  });
});

describe("flattenSteps", () => {
  it("replaces malformed and duplicate ids with fresh ones", () => {
    const rows = flattenSteps("auto1", [
      { id: A, step_type: "send_message", step_config: {} },
      { id: A, step_type: "send_message", step_config: {} },
      { id: "not-a-uuid", step_type: "send_message", step_config: {} },
    ]);

    expect(rows[0].id).toBe(A);
    expect(rows[1].id).not.toBe(A);
    expect(rows[2].id).not.toBe("not-a-uuid");
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2]);
  });
});
