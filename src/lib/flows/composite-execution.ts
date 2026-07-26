import {
  advanceEachState,
  advanceLoopState,
  mapSubFlowInputs,
  type EachState,
  type LoopState,
  type SubFlowVariableMapping,
} from "./composite-runtime";

interface RpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
}

interface CompositeRun {
  id: string;
  flow_id: string;
  flow_version_id: string;
  active_flow_id?: string | null;
  active_flow_version_id?: string | null;
  current_node_key: string | null;
  current_visit_id?: string | null;
  vars: Record<string, unknown>;
}

export interface SubFlowFailurePolicy {
  on_error: "fail_run" | "fail_branch" | "default_value";
  error_next_node_key?: string;
  default_value?: {
    key: string;
    type: string;
    value: unknown;
  };
}

interface LoopStateRow {
  id: string;
  items: unknown[] | null;
  next_iteration: number;
  max_iterations: number;
  state_version: number;
}

async function durableRpcRow<T>(
  db: RpcClient,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  let lastError: { message?: string } | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await db.rpc(name, args);
    const row = Array.isArray(data) ? data[0] : data;
    if (!error && row) return row as T;
    lastError = error;
  }
  throw new Error(
    lastError?.message ?? `${name} lost its durable state race`,
  );
}

function activeVersion(run: CompositeRun): string {
  return run.active_flow_version_id ?? run.flow_version_id;
}

async function beginState(
  db: RpcClient,
  run: CompositeRun,
  kind: "each" | "loop",
  items: unknown[] | null,
  maxIterations: number,
): Promise<LoopStateRow> {
  if (!run.current_node_key || !run.current_visit_id) {
    throw new Error("Composite node is missing its durable visit identity.");
  }
  return durableRpcRow<LoopStateRow>(db, "begin_flow_loop_iteration", {
    p_run_id: run.id,
    p_flow_version_id: activeVersion(run),
    p_node_key: run.current_node_key,
    p_expected_visit_id: run.current_visit_id,
    p_loop_kind: kind,
    p_items: items,
    p_max_iterations: maxIterations,
  });
}

async function commitState(
  db: RpcClient,
  run: CompositeRun,
  state: LoopStateRow,
  transition: {
    nextIteration: number;
    completed: boolean;
    nextNodeKey: string;
    nextVars: Record<string, unknown>;
  },
): Promise<CompositeRun> {
  return durableRpcRow<CompositeRun>(db, "advance_flow_loop_iteration", {
    p_run_id: run.id,
    p_flow_version_id: activeVersion(run),
    p_node_key: run.current_node_key,
    p_expected_visit_id: run.current_visit_id,
    p_state_id: state.id,
    p_expected_state_version: state.state_version,
    p_next_iteration: transition.nextIteration,
    p_completed: transition.completed,
    p_next_node_key: transition.nextNodeKey,
    p_next_visit_id: crypto.randomUUID(),
    p_next_vars: transition.nextVars,
  });
}

export interface EachConfig {
  array_variable: string;
  item_variable: string;
  index_variable?: string;
  max_iterations: number;
  body_next: string;
  done_next: string;
}

export async function executeEachIteration(
  db: RpcClient,
  run: CompositeRun,
  config: EachConfig,
): Promise<{
  branch: "body" | "done";
  nextNodeKey: string;
  run: CompositeRun;
}> {
  const input = run.vars[config.array_variable];
  if (!Array.isArray(input)) {
    throw new Error(`Variable "${config.array_variable}" is not an array.`);
  }
  const state = await beginState(
    db,
    run,
    "each",
    input,
    config.max_iterations,
  );
  const step = advanceEachState({
    kind: "each",
    items: state.items ?? [],
    nextIndex: state.next_iteration,
    maxIterations: state.max_iterations,
  } satisfies EachState);
  const branch = step.branch;
  const nextNodeKey =
    branch === "body" ? config.body_next : config.done_next;
  const nextVars = { ...run.vars };
  if (branch === "body") {
    nextVars[config.item_variable] = step.item;
    if (config.index_variable) nextVars[config.index_variable] = step.index;
  }
  const committed = await commitState(db, run, state, {
    nextIteration: step.state.nextIndex,
    completed: branch === "done",
    nextNodeKey,
    nextVars,
  });
  Object.assign(run, committed);
  return { branch, nextNodeKey, run: committed };
}

export interface LoopConfig {
  max_iterations: number;
  body_next: string;
  done_next: string;
}

export async function executeLoopIteration(
  db: RpcClient,
  run: CompositeRun,
  config: LoopConfig,
  exitPredicate: boolean,
): Promise<{
  branch: "body" | "done";
  nextNodeKey: string;
  exhausted?: boolean;
  run: CompositeRun;
}> {
  const state = await beginState(
    db,
    run,
    "loop",
    null,
    config.max_iterations,
  );
  const step = advanceLoopState(
    {
      kind: "loop",
      nextIteration: state.next_iteration,
      maxIterations: state.max_iterations,
    } satisfies LoopState,
    exitPredicate,
  );
  const branch = step.branch;
  const nextNodeKey =
    branch === "body" ? config.body_next : config.done_next;
  const committed = await commitState(db, run, state, {
    nextIteration: step.state.nextIteration,
    completed: branch === "done",
    nextNodeKey,
    nextVars: run.vars,
  });
  Object.assign(run, committed);
  return {
    branch,
    nextNodeKey,
    ...("exhausted" in step && step.exhausted
      ? { exhausted: true }
      : {}),
    run: committed,
  };
}

export async function enterSubFlow(
  db: RpcClient,
  run: CompositeRun,
  args: {
    childFlowId: string;
    childVersionId: string;
    childEntryNodeKey: string;
    returnNodeKey: string;
    inputMapping: readonly SubFlowVariableMapping[];
    outputMapping: readonly SubFlowVariableMapping[];
    failurePolicy: SubFlowFailurePolicy;
  },
): Promise<CompositeRun> {
  if (!run.current_node_key || !run.current_visit_id) {
    throw new Error("Sub-flow node is missing its durable visit identity.");
  }
  const committed = await durableRpcRow<CompositeRun>(
    db,
    "push_flow_call_frame",
    {
    p_run_id: run.id,
    p_parent_flow_version_id: activeVersion(run),
    p_parent_node_key: run.current_node_key,
    p_expected_visit_id: run.current_visit_id,
    p_return_node_key: args.returnNodeKey,
    p_child_flow_id: args.childFlowId,
    p_child_flow_version_id: args.childVersionId,
    p_child_entry_node_key: args.childEntryNodeKey,
    p_child_vars: mapSubFlowInputs(run.vars, args.inputMapping),
    p_output_mapping: args.outputMapping,
    p_error_policy: args.failurePolicy,
    },
  );
  Object.assign(run, committed);
  return committed;
}

export async function failFromSubFlow(
  db: RpcClient,
  run: CompositeRun,
  failureReason: string,
): Promise<CompositeRun> {
  if (!run.current_visit_id) {
    throw new Error("Child flow is missing its durable failure visit.");
  }
  const committed = await durableRpcRow<CompositeRun>(
    db,
    "fail_flow_call_frame",
    {
      p_run_id: run.id,
      p_child_flow_version_id: activeVersion(run),
      p_expected_visit_id: run.current_visit_id,
      p_failure_reason: failureReason,
    },
  );
  Object.assign(run, committed);
  return committed;
}

export async function returnFromSubFlow(
  db: RpcClient,
  run: CompositeRun,
  childVars: Readonly<Record<string, unknown>>,
): Promise<CompositeRun> {
  if (!run.current_visit_id) {
    throw new Error("Child flow is missing its durable return visit.");
  }
  const committed = await durableRpcRow<CompositeRun>(
    db,
    "pop_flow_call_frame",
    {
    p_run_id: run.id,
    p_child_flow_version_id: activeVersion(run),
    p_expected_visit_id: run.current_visit_id,
    p_child_vars: childVars,
    },
  );
  Object.assign(run, committed);
  return committed;
}
