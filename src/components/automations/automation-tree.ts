import type { AutomationStepType } from "@/types"

export interface BuilderStep {
  /** Stable client id. The API assigns database UUIDs when saving. */
  cid: string
  step_type: AutomationStepType
  step_config: Record<string, unknown>
  branches?: { yes: BuilderStep[]; no: BuilderStep[] }
  /** Optional visual-canvas position — backward-compatible; legacy flows render with defaults. */
  position?: { x: number; y: number }
}

export type BranchTarget =
  { kind: "root" } | { kind: "branch"; parentCid: string; branch: "yes" | "no" }

export interface TreeMutation {
  steps: BuilderStep[]
  changed: boolean
}

export function findStepByCid(
  steps: BuilderStep[],
  cid: string
): BuilderStep | null {
  for (const step of steps) {
    if (step.cid === cid) return step
    if (!step.branches) continue
    const nested =
      findStepByCid(step.branches.yes, cid) ??
      findStepByCid(step.branches.no, cid)
    if (nested) return nested
  }
  return null
}

export interface StepContext {
  step: BuilderStep
  index: number
  total: number
}

export function findStepContextByCid(
  steps: BuilderStep[],
  cid: string
): StepContext | null {
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index]
    if (step.cid === cid) return { step, index, total: steps.length }
    if (!step.branches) continue
    const nested =
      findStepContextByCid(step.branches.yes, cid) ??
      findStepContextByCid(step.branches.no, cid)
    if (nested) return nested
  }
  return null
}

export function updateStepByCid(
  steps: BuilderStep[],
  cid: string,
  updater: (step: BuilderStep) => BuilderStep
): TreeMutation {
  let changed = false
  const next = steps.map((step) => {
    if (step.cid === cid) {
      changed = true
      return updater(step)
    }
    if (!step.branches) return step

    const yes = updateStepByCid(step.branches.yes, cid, updater)
    if (yes.changed) {
      changed = true
      return { ...step, branches: { ...step.branches, yes: yes.steps } }
    }
    const no = updateStepByCid(step.branches.no, cid, updater)
    if (!no.changed) return step
    changed = true
    return { ...step, branches: { ...step.branches, no: no.steps } }
  })
  return { steps: changed ? next : steps, changed }
}

export function insertStep(
  steps: BuilderStep[],
  target: BranchTarget,
  index: number,
  node: BuilderStep
): TreeMutation {
  if (target.kind === "root") {
    const next = [...steps]
    next.splice(Math.max(0, Math.min(index, next.length)), 0, node)
    return { steps: next, changed: true }
  }

  const parent = findStepByCid(steps, target.parentCid)
  if (!parent?.branches) return { steps, changed: false }

  return updateStepByCid(steps, target.parentCid, (parent) => {
    if (!parent.branches) return parent
    const bucket = [...parent.branches[target.branch]]
    bucket.splice(Math.max(0, Math.min(index, bucket.length)), 0, node)
    return {
      ...parent,
      branches: { ...parent.branches, [target.branch]: bucket },
    }
  })
}

export function removeStepByCid(
  steps: BuilderStep[],
  cid: string
): TreeMutation {
  const rootIndex = steps.findIndex((step) => step.cid === cid)
  if (rootIndex >= 0) {
    return {
      steps: steps.filter((_, index) => index !== rootIndex),
      changed: true,
    }
  }

  for (let index = 0; index < steps.length; index++) {
    const step = steps[index]
    if (!step.branches) continue
    const yes = removeStepByCid(step.branches.yes, cid)
    if (yes.changed) {
      const next = [...steps]
      next[index] = {
        ...step,
        branches: { ...step.branches, yes: yes.steps },
      }
      return { steps: next, changed: true }
    }
    const no = removeStepByCid(step.branches.no, cid)
    if (no.changed) {
      const next = [...steps]
      next[index] = {
        ...step,
        branches: { ...step.branches, no: no.steps },
      }
      return { steps: next, changed: true }
    }
  }
  return { steps, changed: false }
}

export function moveStepByCid(
  steps: BuilderStep[],
  cid: string,
  direction: -1 | 1
): TreeMutation {
  const index = steps.findIndex((step) => step.cid === cid)
  if (index >= 0) {
    const destination = index + direction
    if (destination < 0 || destination >= steps.length) {
      return { steps, changed: false }
    }
    const next = [...steps]
    ;[next[index], next[destination]] = [next[destination], next[index]]
    return { steps: next, changed: true }
  }

  for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
    const step = steps[stepIndex]
    if (!step.branches) continue
    const yes = moveStepByCid(step.branches.yes, cid, direction)
    if (yes.changed) {
      const next = [...steps]
      next[stepIndex] = {
        ...step,
        branches: { ...step.branches, yes: yes.steps },
      }
      return { steps: next, changed: true }
    }
    const no = moveStepByCid(step.branches.no, cid, direction)
    if (no.changed) {
      const next = [...steps]
      next[stepIndex] = {
        ...step,
        branches: { ...step.branches, no: no.steps },
      }
      return { steps: next, changed: true }
    }
  }
  return { steps, changed: false }
}

interface ApiStep {
  step_type: string
  step_config: Record<string, unknown>
  branches?: { yes?: ApiStep[]; no?: ApiStep[] }
}

export function toApiSteps(steps: BuilderStep[]): ApiStep[] {
  return steps.map((step) => ({
    step_type: step.step_type,
    step_config: step.position
      ? { ...step.step_config, __canvas: step.position }
      : step.step_config,
    branches: step.branches
      ? {
          yes: toApiSteps(step.branches.yes),
          no: toApiSteps(step.branches.no),
        }
      : undefined,
  }))
}

export interface ServerStepNode {
  id: string
  step_type: string
  step_config: Record<string, unknown>
  branches: { yes: ServerStepNode[]; no: ServerStepNode[] }
}

export function fromServerSteps(
  nodes: ServerStepNode[],
  createCid: () => string
): BuilderStep[] {
  return nodes.map((node) => {
    const config = node.step_config ?? {}
    const storedPosition = config.__canvas
    const position = isCanvasPosition(storedPosition)
      ? storedPosition
      : undefined
    const { __canvas: _canvas, ...stepConfig } = config
    return {
      cid: createCid(),
      step_type: node.step_type as AutomationStepType,
      step_config: stepConfig,
      position,
      branches:
        node.step_type === "condition"
          ? {
              yes: fromServerSteps(node.branches?.yes ?? [], createCid),
              no: fromServerSteps(node.branches?.no ?? [], createCid),
            }
          : undefined,
    }
  })
}

function isCanvasPosition(value: unknown): value is CanvasPosition {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as CanvasPosition).x === "number" &&
    typeof (value as CanvasPosition).y === "number"
  )
}

// ------------------------------------------------------------
// Visual-canvas helpers — backward-compatible default positioning
// ------------------------------------------------------------

export interface CanvasPosition {
  x: number
  y: number
}

/** Assign sensible default positions to legacy steps that have no saved position. Keeps root-level nodes vertically stacked with a 250px gap and branches offset to the right. */
export function defaultPositionsForSteps(
  steps: BuilderStep[],
  startX: number = 50,
  startY: number = 50,
  yStep: number = 150,
  xBranchOffset: number = 300
): Map<string, CanvasPosition> {
  const positions = new Map<string, CanvasPosition>()
  function visit(list: BuilderStep[], x: number, y: number, depth: number) {
    list.forEach((step, idx) => {
      positions.set(step.cid, { x, y: y + idx * yStep })
      if (step.branches) {
        const yesY = y + idx * yStep + 40
        visit(step.branches.yes, x + xBranchOffset, yesY, depth + 1)
        visit(step.branches.no, x + xBranchOffset, yesY + 120, depth + 1)
      }
    })
  }
  visit(steps, startX, startY, 0)
  return positions
}

/** Derive connection references from step_config for canvas edge rendering (backward-compatible with existing step_config shapes). */
export function connectionRefsFromStep(
  step: BuilderStep
): Record<string, string | null> {
  const cfg = step.step_config ?? {}
  const refs: Record<string, string | null> = {}
  switch (step.step_type) {
    case "send_message":
    case "send_buttons":
    case "send_list":
    case "send_template":
    case "add_tag":
    case "remove_tag":
    case "assign_conversation":
    case "update_contact_field":
    case "create_deal":
    case "wait":
    case "send_webhook":
    case "close_conversation":
      refs.next = (cfg.next_node_key as string) ?? null
      break
    case "condition":
      refs.true = (cfg.true_next as string) ?? null
      refs.false = (cfg.false_next as string) ?? null
      break
    default:
      refs.next = (cfg.next_node_key as string) ?? null
      break
  }
  return refs
}

export interface CanvasConnection {
  source: string
  target: string
  sourceHandle: "next" | "yes" | "no"
}

/** Every visual line is derived from the execution tree, never a separate
 * display-only graph. This keeps the canvas truthful to engine behavior. */
export function executionConnections(steps: BuilderStep[]): CanvasConnection[] {
  const edges: CanvasConnection[] = []
  function visit(list: BuilderStep[]) {
    list.forEach((step, index) => {
      const next = list[index + 1]
      if (step.branches) {
        const yes = step.branches.yes[0]
        const no = step.branches.no[0]
        if (yes)
          edges.push({
            source: step.cid,
            target: yes.cid,
            sourceHandle: "yes",
          })
        if (no)
          edges.push({ source: step.cid, target: no.cid, sourceHandle: "no" })
        visit(step.branches.yes)
        visit(step.branches.no)
      }
      if (next)
        edges.push({
          source: step.cid,
          target: next.cid,
          sourceHandle: "next",
        })
    })
  }
  visit(steps)
  return edges
}
