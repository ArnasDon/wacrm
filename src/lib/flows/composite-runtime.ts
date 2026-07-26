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

export interface SubFlowVariableDeclaration {
  key: string;
  type: "string" | "number" | "boolean" | "json" | "contact" | "message";
  required?: boolean;
  default?: unknown;
}

function isJsonValue(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
): boolean {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((entry) => isJsonValue(entry, seen))
    : Object.values(value).every((entry) => isJsonValue(entry, seen));
  seen.delete(value);
  return valid;
}

function matchesSubFlowVariableType(
  value: unknown,
  type: SubFlowVariableDeclaration["type"],
): boolean {
  if (type === "string") return typeof value === "string";
  if (type === "number") {
    return typeof value === "number" && Number.isFinite(value);
  }
  if (type === "boolean") return typeof value === "boolean";
  if (type === "json") return isJsonValue(value);
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    isJsonValue(value)
  );
}

/**
 * Builds a child invocation snapshot in deterministic precedence order:
 * declared defaults, authored mappings, then the bound `inputs` data port.
 */
export function mergeSubFlowInputs(
  parentVars: Readonly<Record<string, unknown>>,
  mappings: readonly SubFlowVariableMapping[],
  boundInputs: unknown,
  schema: readonly SubFlowVariableDeclaration[],
): Record<string, unknown> {
  if (
    boundInputs !== undefined &&
    (boundInputs === null ||
      typeof boundInputs !== "object" ||
      Array.isArray(boundInputs))
  ) {
    throw new Error("Sub-flow inputs binding must resolve to a JSON object.");
  }

  const declarations = new Map(schema.map((entry) => [entry.key, entry]));
  const result: Record<string, unknown> = {};
  const assign = (key: string, value: unknown): void => {
    const declaration = declarations.get(key);
    if (!declaration) {
      throw new Error(`Unknown child input variable "${key}".`);
    }
    if (!matchesSubFlowVariableType(value, declaration.type)) {
      throw new Error(
        `Child input variable "${key}" must be ${declaration.type}.`,
      );
    }
    result[key] = structuredClone(value);
  };

  for (const entry of schema) {
    if (entry.default !== undefined) assign(entry.key, entry.default);
  }
  for (const { parent_key, child_key } of mappings) {
    if (Object.hasOwn(parentVars, parent_key)) {
      assign(child_key, parentVars[parent_key]);
    }
  }
  for (const [key, value] of Object.entries(
    (boundInputs ?? {}) as Record<string, unknown>,
  )) {
    assign(key, value);
  }
  const missingRequired = schema.find(
    (entry) => entry.required && !Object.hasOwn(result, entry.key),
  );
  if (missingRequired) {
    throw new Error(
      `Required child input variable "${missingRequired.key}" is missing.`,
    );
  }
  return result;
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
