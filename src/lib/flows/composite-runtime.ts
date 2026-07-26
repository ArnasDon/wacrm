export const MAX_COMPOSITE_ITERATIONS = 100;
export const MAX_SUB_FLOW_DEPTH = 8;

export interface EachState {
  kind: "each";
  items: readonly unknown[];
  nextIndex: number;
  maxIterations: number;
}

export interface LoopState {
  kind: "loop";
  nextIteration: number;
  maxIterations: number;
}

export type CompositeStep<State> =
  | { branch: "done"; state: State; exhausted?: boolean }
  | {
      branch: "body";
      state: State;
      item?: unknown;
      index?: number;
      iteration?: number;
    };

function assertIterationLimit(value: number): void {
  if (
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_COMPOSITE_ITERATIONS
  ) {
    throw new Error(
      `Iteration limit must be between 1 and the hard cap ${MAX_COMPOSITE_ITERATIONS}.`,
    );
  }
}

export function createEachState(
  items: readonly unknown[],
  maxIterations: number,
): EachState {
  assertIterationLimit(maxIterations);
  if (items.length > maxIterations || items.length > MAX_COMPOSITE_ITERATIONS) {
    throw new Error("Each input exceeds the configured iteration cap.");
  }
  return {
    kind: "each",
    items: structuredClone(items),
    nextIndex: 0,
    maxIterations,
  };
}

export function advanceEachState(
  state: EachState,
): CompositeStep<EachState> {
  if (
    state.nextIndex >= state.items.length ||
    state.nextIndex >= state.maxIterations
  ) {
    const exhausted = state.nextIndex < state.items.length;
    return exhausted
      ? { branch: "done", state, exhausted: true }
      : { branch: "done", state };
  }
  const index = state.nextIndex;
  return {
    branch: "body",
    item: structuredClone(state.items[index]),
    index,
    state: { ...state, nextIndex: index + 1 },
  };
}

export function createLoopState(maxIterations: number): LoopState {
  assertIterationLimit(maxIterations);
  return { kind: "loop", nextIteration: 0, maxIterations };
}

export function advanceLoopState(
  state: LoopState,
  exitPredicate: boolean,
): CompositeStep<LoopState> {
  if (exitPredicate) return { branch: "done", state };
  if (state.nextIteration >= state.maxIterations) {
    return { branch: "done", state, exhausted: true };
  }
  const iteration = state.nextIteration;
  return {
    branch: "body",
    iteration,
    state: { ...state, nextIteration: iteration + 1 },
  };
}

export interface SubFlowVariableMapping {
  parent_key: string;
  child_key: string;
}

export function mapSubFlowInputs(
  parentVars: Readonly<Record<string, unknown>>,
  mappings: readonly SubFlowVariableMapping[],
): Record<string, unknown> {
  return Object.fromEntries(
    mappings.flatMap(({ parent_key, child_key }) =>
      Object.hasOwn(parentVars, parent_key)
        ? [[child_key, structuredClone(parentVars[parent_key])]]
        : [],
    ),
  );
}

export function mapSubFlowOutputs(
  childVars: Readonly<Record<string, unknown>>,
  parentVars: Readonly<Record<string, unknown>>,
  mappings: readonly SubFlowVariableMapping[],
): Record<string, unknown> {
  const result: Record<string, unknown> = structuredClone(parentVars);
  for (const { child_key, parent_key } of mappings) {
    if (Object.hasOwn(childVars, child_key)) {
      result[parent_key] = structuredClone(childVars[child_key]);
    }
  }
  return result;
}

export type SubFlowCallGraphResult =
  | { ok: true }
  | { ok: false; reason: "cycle" | "depth" };

export function validateSubFlowCallGraph(
  graph: ReadonlyMap<string, readonly string[]>,
  root: string,
): SubFlowCallGraphResult {
  const walk = (
    flowId: string,
    path: ReadonlySet<string>,
    depth: number,
  ): SubFlowCallGraphResult => {
    if (depth > MAX_SUB_FLOW_DEPTH) {
      return { ok: false, reason: "depth" } as const;
    }
    if (path.has(flowId)) {
      return { ok: false, reason: "cycle" } as const;
    }
    const nextPath = new Set(path);
    nextPath.add(flowId);
    for (const child of graph.get(flowId) ?? []) {
      const result: SubFlowCallGraphResult = walk(
        child,
        nextPath,
        depth + 1,
      );
      if (!result.ok) return result;
    }
    return { ok: true } as const;
  };
  return walk(root, new Set(), 1);
}
