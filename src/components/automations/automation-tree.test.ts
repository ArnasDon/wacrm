import { describe, expect, it } from "vitest"

import {
  findStepByCid,
  findStepContextByCid,
  executionConnections,
  fromServerSteps,
  insertStep,
  moveStepByCid,
  removeStepByCid,
  updateStepByCid,
  type BuilderStep,
} from "./automation-tree"

function action(cid: string): BuilderStep {
  return { cid, step_type: "send_message", step_config: { text: cid } }
}

function nestedTree(): BuilderStep[] {
  return [
    {
      cid: "condition-1",
      step_type: "condition",
      step_config: { subject: "message_content" },
      branches: {
        yes: [
          {
            cid: "condition-2",
            step_type: "condition",
            step_config: { subject: "tag_presence" },
            branches: {
              yes: [action("deep-a"), action("deep-b")],
              no: [],
            },
          },
        ],
        no: [],
      },
    },
  ]
}

describe("automation tree mutations", () => {
  it("updates and locates a node at arbitrary depth", () => {
    const result = updateStepByCid(nestedTree(), "deep-b", (step) => ({
      ...step,
      step_config: { text: "updated" },
    }))

    expect(result.changed).toBe(true)
    expect(findStepByCid(result.steps, "deep-b")?.step_config.text).toBe(
      "updated"
    )
    expect(findStepContextByCid(result.steps, "deep-b")).toMatchObject({
      index: 1,
      total: 2,
    })
  })

  it("inserts into a deeply nested condition branch", () => {
    const result = insertStep(
      nestedTree(),
      { kind: "branch", parentCid: "condition-2", branch: "no" },
      0,
      action("deep-no")
    )

    expect(result.changed).toBe(true)
    expect(findStepByCid(result.steps, "condition-2")?.branches?.no).toEqual([
      action("deep-no"),
    ])
  })

  it("moves and removes nodes within deeply nested siblings", () => {
    const moved = moveStepByCid(nestedTree(), "deep-b", -1)
    expect(moved.changed).toBe(true)
    expect(
      findStepByCid(moved.steps, "condition-2")?.branches?.yes.map(
        (step) => step.cid
      )
    ).toEqual(["deep-b", "deep-a"])

    const removed = removeStepByCid(moved.steps, "deep-a")
    expect(removed.changed).toBe(true)
    expect(findStepByCid(removed.steps, "deep-a")).toBeNull()
  })

  it("does not mutate the tree when a target does not exist", () => {
    const original = nestedTree()
    const result = insertStep(
      original,
      { kind: "branch", parentCid: "missing", branch: "yes" },
      0,
      action("new")
    )

    expect(result).toEqual({ steps: original, changed: false })
    expect(result.steps).toBe(original)
  })

  it("rejects inserting a branch below a non-condition node", () => {
    const original = nestedTree()
    const result = insertStep(
      original,
      { kind: "branch", parentCid: "deep-a", branch: "yes" },
      0,
      action("invalid-child")
    )

    expect(result.changed).toBe(false)
    expect(result.steps).toBe(original)
  })

  it("keeps large, deeply nested automations editable", () => {
    let tree = nestedTree()
    for (let index = 0; index < 50; index++) {
      tree = insertStep(
        tree,
        { kind: "branch", parentCid: "condition-2", branch: "no" },
        index,
        action(`bulk-${index}`)
      ).steps
    }

    const updated = updateStepByCid(tree, "bulk-49", (step) => ({
      ...step,
      step_config: { text: "still editable" },
    }))
    const removed = removeStepByCid(updated.steps, "bulk-25")

    expect(updated.changed).toBe(true)
    expect(findStepByCid(updated.steps, "bulk-49")?.step_config.text).toBe(
      "still editable"
    )
    expect(removed.changed).toBe(true)
    expect(findStepByCid(removed.steps, "bulk-25")).toBeNull()
  })

  it("derives canvas edges from the executable step and branch order", () => {
    const edges = executionConnections(nestedTree())

    expect(edges).toEqual([
      { source: "condition-1", target: "condition-2", sourceHandle: "yes" },
      { source: "condition-2", target: "deep-a", sourceHandle: "yes" },
      { source: "deep-a", target: "deep-b", sourceHandle: "next" },
    ])
  })

  it("round-trips visual positions in configuration without changing legacy steps", () => {
    const [step] = fromServerSteps(
      [
        {
          id: "server-id",
          step_type: "send_message",
          step_config: { text: "hello", __canvas: { x: 120, y: 240 } },
          branches: { yes: [], no: [] },
        },
      ],
      () => "client-id"
    )

    expect(step).toMatchObject({
      cid: "client-id",
      position: { x: 120, y: 240 },
      step_config: { text: "hello" },
    })
  })
})
