// ------------------------------------------------------------
// Automation builder step tree: addressing + immutable mutation.
//
// The builder edits a tree, not a list: root steps run in order, and a
// `condition` step nests its children under `branches.yes` /
// `branches.no`. Every mutation is addressed by a StepPath — one
// element per level, each naming the bucket it descends into and the
// index within that bucket.
//
// The addressing rule is: a step's path is its parent's path plus its
// own marker. `childPath` is the only place that rule is written down;
// build paths with it rather than by hand. Getting it wrong doesn't
// throw — the walkers below simply find nothing and return the tree
// unchanged, so the UI silently drops the edit. That is how issue #474
// hid: every keystroke in a step nested under a condition was a no-op.
//
// Lives here rather than in the component so the rules are unit-
// testable in the node test environment (there is no jsdom / DOM
// testing setup in this repo).
// ------------------------------------------------------------

/**
 * Structural minimum the walkers need. Generic in the concrete node
 * type so callers keep their own richer step type end-to-end —
 * `BuilderStep` in the builder satisfies `TreeStep<BuilderStep>`.
 */
export interface TreeStep<T> {
  cid: string
  branches?: { yes: T[]; no: T[] }
}

/** Which bucket new children go into, for insertion. */
export type ParentScope =
  | { kind: "root" }
  | { kind: "branch"; parentCid: string; branch: "yes" | "no" }

/**
 * One level of addressing: which bucket, and the index within it. The
 * first marker of a path is always `root`; every later one names the
 * branch of the step the previous marker resolved to.
 */
export type StepMarker =
  | { kind: "root"; index: number }
  | { kind: "branch"; branch: "yes" | "no"; index: number }

export type StepPath = StepMarker[]

/**
 * Path of the step at `index` within `scope`, where `basePath` is the
 * path of the step that OWNS that scope (`[]` for the root list, the
 * condition's own path for a branch).
 *
 * Callers used to append a branch marker when descending into a
 * condition and then append a second one per child, on the assumption
 * that the first one's index would be "replaced during the walk".
 * Nothing replaced it: the walkers consumed both markers, so an edit
 * addressed the first child of the branch and then looked for the real
 * target inside *that* child's branches — which a `send_buttons` step
 * doesn't have, so the update was dropped (issue #474).
 */
export function childPath(
  basePath: StepPath,
  scope: ParentScope,
  index: number,
): StepPath {
  return [
    ...basePath,
    scope.kind === "root"
      ? { kind: "root", index }
      : { kind: "branch", branch: scope.branch, index },
  ]
}

/**
 * Insert `node` at `index` within `scope`. Searches the whole tree for
 * the scope's owning condition, not just the root list — a condition
 * nested inside another condition's branch is a normal thing to build,
 * and only matching at the top level meant the Add button under it did
 * nothing at all.
 */
export function insertAt<T extends TreeStep<T>>(
  steps: T[],
  scope: ParentScope,
  index: number,
  node: T,
): T[] {
  if (scope.kind === "root") {
    const copy = [...steps]
    copy.splice(index, 0, node)
    return copy
  }
  return steps.map((step) => {
    if (!step.branches) return step
    if (step.cid === scope.parentCid) {
      const bucket = [...step.branches[scope.branch]]
      bucket.splice(index, 0, node)
      return {
        ...step,
        branches: { ...step.branches, [scope.branch]: bucket },
      }
    }
    // Not this condition — keep looking inside both of its branches.
    return {
      ...step,
      branches: {
        yes: insertAt(step.branches.yes, scope, index, node),
        no: insertAt(step.branches.no, scope, index, node),
      },
    }
  })
}

/** Replace the step at `path` with `updater`'s result. */
export function mapAtPath<T extends TreeStep<T>>(
  steps: T[],
  path: StepPath,
  updater: (step: T) => T,
): T[] {
  return atPath(steps, path, (bucket, index) =>
    bucket.map((step, i) => (i === index ? updater(step) : step)),
  )
}

/** Drop the step at `path`. */
export function removeAt<T extends TreeStep<T>>(
  steps: T[],
  path: StepPath,
): T[] {
  return atPath(steps, path, (bucket, index) =>
    bucket.filter((_, i) => i !== index),
  )
}

/** Swap the step at `path` with its neighbour in `direction`. */
export function moveAt<T extends TreeStep<T>>(
  steps: T[],
  path: StepPath,
  direction: -1 | 1,
): T[] {
  return atPath(steps, path, (bucket, index) => {
    const target = index + direction
    if (target < 0 || target >= bucket.length) return bucket
    const copy = [...bucket]
    ;[copy[index], copy[target]] = [copy[target], copy[index]]
    return copy
  })
}

/**
 * Walk to the bucket the last marker of `path` addresses and hand it,
 * plus the target index, to `edit`. One traversal shared by every
 * mutation above so they cannot drift apart on how a path resolves.
 *
 * A path that doesn't resolve (stale index, unknown branch, a marker
 * pointing into a step with no branches) returns the tree untouched.
 */
function atPath<T extends TreeStep<T>>(
  steps: T[],
  path: StepPath,
  edit: (bucket: T[], index: number) => T[],
): T[] {
  if (path.length === 0) return steps
  const [head, ...rest] = path

  // Last marker: `steps` is the bucket that holds the target.
  if (rest.length === 0) return edit(steps, head.index)

  // Otherwise descend through the step this marker names, into the
  // branch the NEXT marker names.
  const next = rest[0]
  if (next.kind !== "branch") return steps
  return steps.map((step, i) => {
    if (i !== head.index || !step.branches) return step
    return {
      ...step,
      branches: {
        ...step.branches,
        [next.branch]: atPath(step.branches[next.branch], rest, edit),
      },
    }
  })
}
