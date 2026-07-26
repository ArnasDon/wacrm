import { getNodeDescriptor } from "./registry";
import type {
  NodeDescriptor,
  NodePortDescriptor,
} from "./registry/types";
import {
  coerceDeclaredValue,
  evaluateLoopExitPredicate,
  evaluateSwitch,
  type FlowVariableDeclaration,
  type FlowVariableType,
  type SwitchCase,
} from "./runtime-primitives";
import type { FlowVersionGraph, FlowVersionGraphNode } from "./versions";

const MAX_DEBUG_JSON_BYTES = 64 * 1024;
const MAX_DEBUG_DEPTH = 8;
const MAX_DEBUG_COLLECTION = 200;
const SECRET_KEY =
  /authorization|api[-_]?key|token|secret|password|cookie|credential/i;
const DEBUG_LEGACY_SIDE_EFFECT_NODES = new Set([
  "send_template",
  "send_webhook",
]);

export type DebugNodeOutputs = Record<string, Record<string, unknown>>;

export interface DebugNodeOutput {
  status: "completed" | "error";
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  variables: Record<string, unknown>;
  simulatedEffects: Array<{
    kind: string;
    payload: Record<string, unknown>;
  }>;
  metadata: {
    input_sources: Record<
      string,
      "override" | "session" | "source_run" | "config"
    >;
    runtime_hook?: string;
  };
  error?: { code: string; message: string };
}

export interface DebugManifest {
  variable_schema: FlowVariableDeclaration[];
  nodes: Array<{
    node_key: string;
    node_type: string;
    label: string;
    inputs: Array<{
      id: string;
      label: string;
      type: string;
      cardinality: "one" | "many";
      required?: boolean;
    }>;
    outputs: Array<{
      id: string;
      label: string;
      type: string;
      cardinality: "one" | "many";
      required?: boolean;
    }>;
  }>;
}

interface IsolatedAdapters {
  /** Test seam: production debug execution must never call this. */
  invokeRemote?: (...args: unknown[]) => unknown;
  /** Test seam: the debugger never walks the graph. */
  invokeUpstream?: (...args: unknown[]) => unknown;
}

export interface RunIsolatedDebugNodeInput {
  graph: FlowVersionGraph;
  nodeKey: string;
  variables: Record<string, unknown>;
  savedOutputs: DebugNodeOutputs;
  clonedOutputs: DebugNodeOutputs;
  overrides: Record<string, unknown>;
  adapters?: IsolatedAdapters;
}

function interpolate(
  template: string,
  vars: Readonly<Record<string, unknown>>,
): string {
  return template.replace(/\{\{vars\.([a-zA-Z0-9_]+)\}\}/g, (_match, key) => {
    const value = vars[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function assertJsonSerializable(value: unknown): void {
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new Error("debug_override_invalid:type");
  }
  if (
    encoded === undefined ||
    new TextEncoder().encode(encoded).byteLength > MAX_DEBUG_JSON_BYTES
  ) {
    throw new Error("debug_override_invalid:type");
  }
}

function validateSingleOverride(
  port: NodePortDescriptor,
  value: unknown,
): void {
  if (port.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error("debug_override_invalid:type");
    }
  } else if (port.type === "boolean") {
    if (typeof value !== "boolean") {
      throw new Error("debug_override_invalid:type");
    }
  } else if (port.type === "string") {
    if (typeof value !== "string") {
      throw new Error("debug_override_invalid:type");
    }
  } else if (port.type === "contact" || port.type === "message") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("debug_override_invalid:type");
    }
  }
  assertJsonSerializable(value);
}

function validateDebugOverrides(
  descriptor: NodeDescriptor,
  overrides: Record<string, unknown>,
): void {
  const ports = new Map(
    descriptor.inputs
      .filter((port) => port.type !== "control")
      .map((port) => [port.id, port]),
  );
  for (const [portId, value] of Object.entries(overrides)) {
    const port = ports.get(portId);
    if (!port) {
      throw new Error("debug_override_invalid:unknown_port");
    }
    if (port.cardinality === "many") {
      if (!Array.isArray(value)) {
        throw new Error("debug_override_invalid:cardinality");
      }
      value.forEach((entry) =>
        validateSingleOverride({ ...port, cardinality: "one" }, entry),
      );
    } else {
      validateSingleOverride(port, value);
    }
  }
}

function resolveInputs(
  node: FlowVersionGraphNode,
  descriptor: NodeDescriptor,
  variables: Readonly<Record<string, unknown>>,
  savedOutputs: DebugNodeOutputs,
  clonedOutputs: DebugNodeOutputs,
  overrides: Record<string, unknown>,
): {
  inputs: Record<string, unknown>;
  sources: Record<
    string,
    "override" | "session" | "source_run" | "config"
  >;
} {
  const bindings = asRecord(node.config._data_inputs);
  const inputs: Record<string, unknown> = {};
  const sources: Record<
    string,
    "override" | "session" | "source_run" | "config"
  > = {};

  for (const port of descriptor.inputs.filter(
    (candidate) => candidate.type !== "control",
  )) {
    const targetHandle = port.id;
    if (Object.hasOwn(overrides, targetHandle)) {
      inputs[targetHandle] = overrides[targetHandle];
      sources[targetHandle] = "override";
      continue;
    }
    const binding = asRecord(bindings[targetHandle]);
    const sourceNode =
      typeof binding.source_node_key === "string"
        ? binding.source_node_key
        : "";
    const sourceHandle =
      typeof binding.source_handle === "string" ? binding.source_handle : "";
    if (
      sourceNode &&
      sourceHandle &&
      Object.hasOwn(savedOutputs[sourceNode] ?? {}, sourceHandle)
    ) {
      inputs[targetHandle] = savedOutputs[sourceNode][sourceHandle];
      sources[targetHandle] = "session";
    } else if (
      sourceNode &&
      sourceHandle &&
      Object.hasOwn(clonedOutputs[sourceNode] ?? {}, sourceHandle)
    ) {
      inputs[targetHandle] = clonedOutputs[sourceNode][sourceHandle];
      sources[targetHandle] = "source_run";
    } else {
      const fallback = descriptor.resolveDebugInput?.(
        node.config,
        targetHandle,
        variables,
      );
      if (fallback !== undefined) {
        inputs[targetHandle] = fallback;
        sources[targetHandle] = "config";
      }
    }
  }
  return { inputs, sources };
}

export function assertDebugVariablesBounded(
  variables: Record<string, unknown>,
): void {
  if (
    new TextEncoder().encode(JSON.stringify(variables)).byteLength >
    MAX_DEBUG_JSON_BYTES
  ) {
    throw new Error("debug_variables_too_large");
  }
}

function sanitizeDebugResult(
  result: DebugNodeOutput,
): DebugNodeOutput {
  return {
    status: result.status,
    inputs: sanitizeDebugValue(result.inputs) as Record<string, unknown>,
    outputs: sanitizeDebugValue(result.outputs) as Record<string, unknown>,
    variables: sanitizeDebugValue(result.variables) as Record<string, unknown>,
    simulatedEffects: result.simulatedEffects.map((effect) => ({
      kind: effect.kind,
      payload: sanitizeDebugValue(effect.payload) as Record<string, unknown>,
    })),
    metadata: sanitizeDebugValue(result.metadata) as DebugNodeOutput["metadata"],
    ...(result.error
      ? {
          error: sanitizeDebugValue(result.error) as DebugNodeOutput["error"],
        }
      : {}),
  };
}

function simulated(
  kind: string,
  payload: Record<string, unknown>,
): DebugNodeOutput["simulatedEffects"] {
  return [{ kind, payload: sanitizeDebugValue(payload) as Record<string, unknown> }];
}

function plannedTransition(
  kind: string,
  config: Record<string, unknown>,
): Record<string, unknown> {
  return {
    preview: true,
    planned_transition: {
      kind,
      ...(typeof config.next_node_key === "string"
        ? { next_node_key: config.next_node_key }
        : {}),
    },
  };
}

/**
 * Executes one snapshot node with no database/provider adapters. The function
 * intentionally has no graph-walking primitive: unresolved bindings remain
 * unresolved until the caller supplies an override or persisted output.
 */
export async function runIsolatedDebugNode(
  input: RunIsolatedDebugNodeInput,
): Promise<DebugNodeOutput> {
  const node = input.graph.nodes.find(
    (candidate) => candidate.node_key === input.nodeKey,
  );
  if (!node) throw new Error("debug_node_not_found");
  const descriptor = getNodeDescriptor(node.node_type);
  if (
    !descriptor ||
    (!descriptor.supportsFlowRuntime &&
      !DEBUG_LEGACY_SIDE_EFFECT_NODES.has(node.node_type))
  ) {
    throw new Error("debug_node_not_supported");
  }
  const parsed = descriptor.flowConfigSchema.safeParse(node.config);
  if (!parsed.success) throw new Error("debug_node_config_invalid");
  validateDebugOverrides(descriptor, input.overrides);
  assertDebugVariablesBounded(input.variables);

  const { inputs, sources } = resolveInputs(
    node,
    descriptor,
    input.variables,
    input.savedOutputs,
    input.clonedOutputs,
    input.overrides,
  );
  const config = parsed.data;
  const variables = structuredClone(input.variables);
  let outputs: Record<string, unknown> = {};
  let effects: DebugNodeOutput["simulatedEffects"] = [];
  const hook = descriptor.runtimeHook;

  try {
    if (hook === "start") {
      outputs = { next_node_key: config.next_node_key };
    } else if (hook === "end") {
      outputs = { completed: true };
    } else if (hook === "condition") {
      const subject =
        config.subject === "var"
          ? variables[String(config.subject_key)]
          : undefined;
      const operator = config.operator;
      const present =
        subject !== undefined && subject !== null && subject !== "";
      const truthy =
        operator === "present"
          ? present
          : operator === "absent"
            ? !present
            : operator === "contains"
              ? typeof subject === "string" &&
                subject.includes(String(config.value ?? ""))
              : subject === config.value;
      outputs = {
        branch: truthy ? "true" : "false",
        next_node_key: truthy ? config.true_next : config.false_next,
      };
    } else if (hook === "switch") {
      const subject =
        inputs.subject ??
        (config.subject === "var"
          ? variables[String(config.subject_key)]
          : undefined);
      const next =
        evaluateSwitch(subject, config.cases as SwitchCase[]) ??
        String(config.default_next);
      outputs = { subject, next_node_key: next };
    } else if (hook === "variable_set") {
      for (const [index, rawAssignment] of (
        config.assignments as Array<Record<string, unknown>>
      ).entries()) {
        const raw =
          index === 0 &&
          Object.hasOwn(inputs, "value") &&
          sources.value !== "config"
            ? inputs.value
            : typeof rawAssignment.value === "string"
              ? interpolate(rawAssignment.value, variables)
              : rawAssignment.value;
        const coerced = coerceDeclaredValue(
          rawAssignment.type as FlowVariableType,
          raw,
        );
        if (!coerced.ok) throw new Error(coerced.reason);
        variables[String(rawAssignment.key)] = coerced.value;
      }
      outputs = { variables };
    } else if (hook === "each" || hook === "loop") {
      const isEach = hook === "each";
      const subject = isEach
        ? inputs.items
        : inputs.subject;
      const done = isEach
        ? !Array.isArray(subject) || subject.length === 0
        : evaluateLoopExitPredicate(
            subject,
            config.operator as SwitchCase["operator"],
            config.value,
          );
      outputs = {
        preview: true,
        planned_transition: {
          kind: hook,
          branch: done ? "done" : "body",
          next_node_key: done ? config.done_next : config.body_next,
          schedules_production: false,
        },
      };
    } else if (
      hook === "wait" ||
      hook === "approval"
    ) {
      outputs = plannedTransition(hook, config);
    } else if (hook === "sub_flow") {
      outputs = {
        ...plannedTransition(hook, config),
        inputs: inputs.inputs,
      };
    } else if (hook === "send_message" || hook === "collect_input") {
      const text = interpolate(
        String(
          hook === "collect_input" ? config.prompt_text ?? "" : config.text ?? "",
        ),
        variables,
      );
      outputs = {
        preview: text,
        ...(typeof config.next_node_key === "string"
          ? { next_node_key: config.next_node_key }
          : {}),
      };
      effects = simulated("whatsapp_text", { text });
    } else if (node.node_type === "send_template") {
      outputs = plannedTransition("send_template", config);
      effects = simulated("whatsapp_template", {
        template_name: config.template_name,
        language: config.language,
        variables: Object.fromEntries(
          Object.entries(asRecord(config.variables)).map(([key, value]) => [
            key,
            typeof value === "string" ? interpolate(value, variables) : value,
          ]),
        ),
      });
    } else if (node.node_type === "send_webhook") {
      outputs = plannedTransition("http_request", config);
      effects = simulated("http_request", {
        method: "POST",
        url: config.url,
        headers: Object.fromEntries(
          Object.entries(asRecord(config.headers)).map(([key, value]) => [
            key,
            typeof value === "string" ? interpolate(value, variables) : value,
          ]),
        ),
        body:
          typeof config.body_template === "string"
            ? interpolate(config.body_template, variables)
            : undefined,
      });
    } else if (
      hook === "send_media" ||
      hook === "send_buttons" ||
      hook === "send_list" ||
      hook === "send_template"
    ) {
      outputs = plannedTransition(hook, config);
      effects = simulated(`whatsapp_${hook.replace("send_", "")}`, config);
    } else if (hook === "http_request" || hook === "send_webhook") {
      outputs = plannedTransition("http_request", config);
      effects = simulated("http_request", {
        method: config.method,
        url: config.url,
        headers: config.headers,
        body: inputs.request,
      });
    } else if (hook === "ai_reply") {
      outputs = {
        preview: "[AI response would be generated]",
        next_node_key: config.next_node_key,
      };
      effects = simulated("ai_reply", {
        prompt: config.prompt,
        system_prompt: config.system_prompt,
        max_tokens: config.max_tokens,
        context: inputs.context,
      });
    } else {
      outputs = plannedTransition(hook, config);
      effects = simulated(hook, config);
    }

    assertDebugVariablesBounded(variables);
    return sanitizeDebugResult({
      status: "completed",
      inputs,
      outputs,
      variables,
      simulatedEffects: effects,
      metadata: { input_sources: sources, runtime_hook: hook },
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "debug_variables_too_large"
    ) {
      throw error;
    }
    return sanitizeDebugResult({
      status: "error",
      inputs,
      outputs: {},
      variables,
      simulatedEffects: [],
      metadata: { input_sources: sources, runtime_hook: hook },
      error: {
        code: "debug_execution_failed",
        message: error instanceof Error ? error.message : "Execution failed",
      },
    });
  }
}

export function editDebugVariables(
  declarations: readonly FlowVariableDeclaration[],
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const declaredKeys = new Set(
    declarations.map((declaration) => declaration.key),
  );
  const unknownKey = Object.keys(patch).find(
    (key) => !declaredKeys.has(key),
  );
  if (unknownKey) {
    throw new Error(`unknown debug variable "${unknownKey}"`);
  }
  const next = structuredClone(current);
  for (const declaration of declarations) {
    if (!Object.hasOwn(patch, declaration.key)) continue;
    if (declaration.type === "contact" || declaration.type === "message") {
      continue;
    }
    const coerced = coerceDeclaredValue(
      declaration.type,
      patch[declaration.key],
    );
    if (!coerced.ok) {
      throw new Error(`variable "${declaration.key}" ${coerced.reason}`);
    }
    next[declaration.key] = coerced.value;
  }
  return next;
}

function sanitizeInner(value: unknown, depth: number): unknown {
  if (depth >= MAX_DEBUG_DEPTH) return "[TRUNCATED]";
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }
  if (typeof value === "string") {
    return value.length > 4_096 ? `${value.slice(0, 4_096)}…` : value;
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_DEBUG_COLLECTION)
      .map((entry) => sanitizeInner(entry, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, MAX_DEBUG_COLLECTION)
        .map(([key, entry]) => [
          key,
          SECRET_KEY.test(key)
            ? "[REDACTED]"
            : sanitizeInner(entry, depth + 1),
        ]),
    );
  }
  return String(value);
}

export function sanitizeDebugValue(value: unknown): unknown {
  const sanitized = sanitizeInner(value, 0);
  const encoded = JSON.stringify(sanitized);
  if (encoded.length <= MAX_DEBUG_JSON_BYTES) return sanitized;
  return {
    truncated: true,
    preview: encoded.slice(0, MAX_DEBUG_JSON_BYTES),
  };
}

export function sanitizeDebugSession(
  session: Record<string, unknown>,
): Record<string, unknown> {
  const publicSession = { ...session };
  const graph = session.graph_snapshot as FlowVersionGraph | undefined;
  if (
    Array.isArray(graph?.variable_schema) &&
    Array.isArray(graph.nodes) &&
    graph.nodes.every(
      (node) =>
        typeof node?.node_key === "string" &&
        typeof node.node_type === "string",
    )
  ) {
    publicSession.manifest = buildDebugManifest(graph);
  }
  delete publicSession.graph_snapshot;
  delete publicSession.node_outputs;
  delete publicSession.source_node_outputs;
  delete publicSession.snapshot_hash;
  const sanitized = Object.fromEntries(
    Object.entries(publicSession).map(([key, value]) => [
      key,
      sanitizeDebugValue(value),
    ]),
  );
  for (const requiredField of ["variables", "manifest"]) {
    const value = sanitized[requiredField];
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (value as Record<string, unknown>).truncated === true
    ) {
      throw new Error("debug_response_too_large");
    }
  }
  return sanitized;
}

export function buildDebugManifest(graph: FlowVersionGraph): DebugManifest {
  const safePort = (port: {
    id: string;
    label: string;
    type: string;
    cardinality: "one" | "many";
    required?: boolean;
  }) => ({
    id: port.id,
    label: port.label,
    type: port.type,
    cardinality: port.cardinality,
    ...(port.required ? { required: true } : {}),
  });
  return {
    variable_schema: structuredClone(graph.variable_schema),
    nodes: graph.nodes.map((node) => {
      const descriptor = getNodeDescriptor(node.node_type);
      return {
        node_key: node.node_key,
        node_type: node.node_type,
        label: descriptor?.label ?? node.node_type,
        inputs: (descriptor?.inputs ?? [])
          .filter((port) => port.type !== "control")
          .map(safePort),
        outputs: (descriptor?.outputs ?? [])
          .filter((port) => port.type !== "control")
          .map(safePort),
      };
    }),
  };
}
