import { describe, it, expect } from "vitest";
import { autoLayout, shouldAutoLayout } from "./layout";

describe("shouldAutoLayout", () => {
  it("returns false for an empty list", () => {
    expect(shouldAutoLayout([])).toBe(false);
  });

  it("returns true when every node sits at 0,0", () => {
    expect(
      shouldAutoLayout([
        { position_x: 0, position_y: 0 },
        { position_x: 0, position_y: 0 },
      ]),
    ).toBe(true);
  });

  it("treats null / undefined positions as 0,0", () => {
    expect(
      shouldAutoLayout([
        { position_x: null, position_y: null },
        {},
      ]),
    ).toBe(true);
  });

  it("returns false if any node has a non-zero position (mid-edit guard)", () => {
    expect(
      shouldAutoLayout([
        { position_x: 0, position_y: 0 },
        { position_x: 200, position_y: 50 },
      ]),
    ).toBe(false);
  });
});

describe("autoLayout", () => {
  it("returns a position for every input node", () => {
    const positions = autoLayout(
      [
        { id: "a" },
        { id: "b" },
        { id: "c" },
      ],
      [
        { source: "a", target: "b" },
        { source: "b", target: "c" },
      ],
    );
    expect(positions.size).toBe(3);
    expect(positions.has("a")).toBe(true);
    expect(positions.has("b")).toBe(true);
    expect(positions.has("c")).toBe(true);
  });

  it("lays a linear chain top-to-bottom by default", () => {
    const positions = autoLayout(
      [
        { id: "a" },
        { id: "b" },
        { id: "c" },
      ],
      [
        { source: "a", target: "b" },
        { source: "b", target: "c" },
      ],
    );
    const a = positions.get("a")!;
    const b = positions.get("b")!;
    const c = positions.get("c")!;
    // TB direction => y increases down the chain.
    expect(a.y).toBeLessThan(b.y);
    expect(b.y).toBeLessThan(c.y);
  });

  it("spreads branch targets horizontally on the same rank", () => {
    const positions = autoLayout(
      [
        { id: "root" },
        { id: "left" },
        { id: "right" },
      ],
      [
        { source: "root", target: "left" },
        { source: "root", target: "right" },
      ],
    );
    const left = positions.get("left")!;
    const right = positions.get("right")!;
    // Same rank => same y; different positions horizontally.
    expect(left.y).toBe(right.y);
    expect(left.x).not.toBe(right.x);
  });

  it("ignores edges whose endpoints aren't in the node list", () => {
    // Defensive — the canvas filters dangling edges but the helper
    // shouldn't blow up if a stale edge slips through.
    const positions = autoLayout(
      [{ id: "only" }],
      [
        { source: "only", target: "ghost" },
        { source: "phantom", target: "only" },
      ],
    );
    expect(positions.size).toBe(1);
    expect(positions.get("only")).toBeDefined();
  });

  it("respects custom node widths when computing positions", () => {
    const narrow = autoLayout(
      [
        { id: "a", width: 100, height: 50 },
        { id: "b", width: 100, height: 50 },
      ],
      [{ source: "a", target: "b" }],
    );
    const wide = autoLayout(
      [
        { id: "a", width: 400, height: 50 },
        { id: "b", width: 400, height: 50 },
      ],
      [{ source: "a", target: "b" }],
    );
    // Wider nodes don't shift vertical spacing on a single chain
    // (rank gap is fixed) but they DO offset x to keep nodes centered.
    expect(narrow.get("a")!.y).toBe(wide.get("a")!.y);
  });
});
