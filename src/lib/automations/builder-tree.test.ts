import { describe, it, expect } from "vitest"

import {
  childPath,
  insertAt,
  mapAtPath,
  moveAt,
  removeAt,
  type ParentScope,
  type StepPath,
} from "./builder-tree"

// Minimal stand-in for BuilderStep: a cid, some config to mutate, and
// the optional branches a condition carries.
interface Step {
  cid: string
  text?: string
  branches?: { yes: Step[]; no: Step[] }
}

const step = (cid: string, text = ""): Step => ({ cid, text })
const condition = (cid: string, yes: Step[] = [], no: Step[] = []): Step => ({
  cid,
  branches: { yes, no },
})

/** Path the builder renders for a root-level step. */
const rootPath = (index: number): StepPath => childPath([], { kind: "root" }, index)

/** Path the builder renders for a step inside `cid`'s branch. */
const branchPath = (
  conditionPath: StepPath,
  cid: string,
  branch: "yes" | "no",
  index: number,
): StepPath => childPath(conditionPath, { kind: "branch", parentCid: cid, branch }, index)

const setText = (text: string) => (s: Step): Step => ({ ...s, text })

describe("childPath", () => {
  it("addresses a root step by its index", () => {
    expect(rootPath(2)).toEqual([{ kind: "root", index: 2 }])
  })

  it("appends exactly one marker per level of nesting", () => {
    const c1 = rootPath(0)
    const inner = branchPath(c1, "c1", "yes", 1)
    expect(inner).toEqual([
      { kind: "root", index: 0 },
      { kind: "branch", branch: "yes", index: 1 },
    ])
    // Two levels deep: still one marker each, never a duplicate.
    expect(branchPath(inner, "c2", "no", 0)).toHaveLength(3)
  })
})

describe("editing a step nested under a condition (#474)", () => {
  // condition c1 → yes: [a, b], no: [n]
  const tree = (): Step[] => [
    condition("c1", [step("a"), step("b")], [step("n")]),
    step("tail"),
  ]
  const c1 = rootPath(0)

  it("updates the addressed step, not the first one in the bucket", () => {
    const next = mapAtPath(tree(), branchPath(c1, "c1", "yes", 1), setText("typed"))

    expect(next[0].branches!.yes.map((s) => s.text)).toEqual(["", "typed"])
    // Nothing else moved or changed.
    expect(next[0].branches!.no.map((s) => s.cid)).toEqual(["n"])
    expect(next[1].cid).toBe("tail")
  })

  it("updates a step in the NO branch", () => {
    const next = mapAtPath(tree(), branchPath(c1, "c1", "no", 0), setText("typed"))

    expect(next[0].branches!.no[0].text).toBe("typed")
    expect(next[0].branches!.yes.every((s) => s.text === "")).toBe(true)
  })

  it("keeps a nested step's own shape intact — no stray branches key", () => {
    const next = mapAtPath(tree(), branchPath(c1, "c1", "yes", 0), setText("typed"))

    expect(next[0].branches!.yes[0]).toEqual({ cid: "a", text: "typed" })
  })

  it("deletes the addressed nested step", () => {
    const next = removeAt(tree(), branchPath(c1, "c1", "yes", 0))

    expect(next[0].branches!.yes.map((s) => s.cid)).toEqual(["b"])
  })

  it("reorders within a branch", () => {
    const next = moveAt(tree(), branchPath(c1, "c1", "yes", 1), -1)

    expect(next[0].branches!.yes.map((s) => s.cid)).toEqual(["b", "a"])
  })

  it("leaves the tree alone when a move would run off the end", () => {
    const next = moveAt(tree(), branchPath(c1, "c1", "yes", 1), 1)

    expect(next[0].branches!.yes.map((s) => s.cid)).toEqual(["a", "b"])
  })
})

describe("conditions nested inside conditions", () => {
  // c1 → yes: [ c2 → yes: [deep] ]
  const tree = (): Step[] => [condition("c1", [condition("c2", [step("deep")])])]
  const c1 = rootPath(0)
  const c2 = branchPath(c1, "c1", "yes", 0)

  it("edits a step two levels down", () => {
    const next = mapAtPath(tree(), branchPath(c2, "c2", "yes", 0), setText("typed"))

    expect(next[0].branches!.yes[0].branches!.yes[0].text).toBe("typed")
  })

  it("reorders two levels down", () => {
    const deep = (): Step[] => [
      condition("c1", [condition("c2", [step("x"), step("y")])]),
    ]
    const next = moveAt(deep(), branchPath(c2, "c2", "yes", 1), -1)

    expect(
      next[0].branches!.yes[0].branches!.yes.map((s) => s.cid),
    ).toEqual(["y", "x"])
  })

  it("adds into a nested condition's branch", () => {
    const scope: ParentScope = { kind: "branch", parentCid: "c2", branch: "no" }
    const next = insertAt(tree(), scope, 0, step("fresh"))

    expect(next[0].branches!.yes[0].branches!.no.map((s) => s.cid)).toEqual([
      "fresh",
    ])
    // The outer condition's own buckets are untouched.
    expect(next[0].branches!.no).toEqual([])
  })
})

describe("insertAt", () => {
  it("splices into the root list at the given index", () => {
    const next = insertAt([step("a"), step("b")], { kind: "root" }, 1, step("mid"))

    expect(next.map((s) => s.cid)).toEqual(["a", "mid", "b"])
  })

  it("splices into a top-level condition's branch", () => {
    const next = insertAt(
      [condition("c1", [step("a")])],
      { kind: "branch", parentCid: "c1", branch: "yes" },
      1,
      step("after"),
    )

    expect(next[0].branches!.yes.map((s) => s.cid)).toEqual(["a", "after"])
  })

  it("is a no-op when the scope's condition is gone", () => {
    const before = [condition("c1", [step("a")])]
    const next = insertAt(
      before,
      { kind: "branch", parentCid: "missing", branch: "yes" },
      0,
      step("fresh"),
    )

    expect(next).toEqual(before)
  })
})

describe("unresolvable paths", () => {
  const tree = (): Step[] => [condition("c1", [step("a")]), step("tail")]

  it("an empty path changes nothing", () => {
    expect(mapAtPath(tree(), [], setText("x"))).toEqual(tree())
  })

  it("descending into a step that has no branches changes nothing", () => {
    // Marker chain says "root index 1, then its yes branch" — but
    // `tail` is a plain step.
    const path: StepPath = [
      { kind: "root", index: 1 },
      { kind: "branch", branch: "yes", index: 0 },
    ]
    expect(mapAtPath(tree(), path, setText("x"))).toEqual(tree())
  })

  it("a stale index changes nothing", () => {
    expect(removeAt(tree(), rootPath(9))).toEqual(tree())
  })
})
