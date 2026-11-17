import { describe, expect, it } from "vitest";
import {
  buildStageUpdateRows,
  reconcileStages,
  sortByPosition,
} from "./stage-sync";

const stage = (id: string, position: number, name = id) => ({
  id,
  pipeline_id: "p1",
  name,
  color: "#000",
  position,
});

describe("sortByPosition", () => {
  it("orders by position without mutating the input", () => {
    const input = [stage("b", 1), stage("a", 0)];
    expect(sortByPosition(input).map((s) => s.id)).toEqual(["a", "b"]);
    expect(input.map((s) => s.id)).toEqual(["b", "a"]);
  });
});

describe("reconcileStages", () => {
  it("keeps unsaved local edits and local order for stages that still exist", () => {
    const local = [stage("b", 1, "Renamed B"), stage("a", 0)];
    const incoming = [stage("a", 0), stage("b", 1)];
    const result = reconcileStages(local, incoming);
    expect(result.map((s) => s.id)).toEqual(["b", "a"]);
    expect(result[0].name).toBe("Renamed B");
  });

  it("drops stages that were deleted on the server", () => {
    const local = [stage("a", 0), stage("b", 1)];
    expect(reconcileStages(local, [stage("a", 0)]).map((s) => s.id)).toEqual([
      "a",
    ]);
  });

  it("appends newly created stages in position order", () => {
    const local = [stage("a", 0)];
    const incoming = [stage("d", 3), stage("a", 0), stage("c", 2)];
    expect(reconcileStages(local, incoming).map((s) => s.id)).toEqual([
      "a",
      "c",
      "d",
    ]);
  });
});

describe("buildStageUpdateRows", () => {
  it("never includes a stage that no longer exists", () => {
    const rows = buildStageUpdateRows(
      [stage("a", 0), stage("gone", 1), stage("b", 2)],
      new Set(["a", "b"]),
    );
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("renumbers positions from the local order", () => {
    const rows = buildStageUpdateRows(
      [stage("b", 5), stage("a", 9)],
      new Set(["a", "b"]),
    );
    expect(rows.map((r) => [r.id, r.position])).toEqual([
      ["b", 0],
      ["a", 1],
    ]);
  });
});
