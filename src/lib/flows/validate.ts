/**
 * Flow activation validation.
 *
 * Descriptor schemas and descriptor validators own node-local rules. This
 * module owns only flow/trigger compatibility checks and graph topology:
 * entry, duplicate keys, edge targets, and reachability.
 */

import type { ZodIssue } from "zod";
import type { FlowVariableDeclaration } from "./runtime-primitives";
import { arePortTypesCompatible } from "./connection-validation";
import { deriveCanvasEdges, type CanvasEdge } from "./edges";

import {
  getCompatibilityFlowTriggerDescriptor,
  getDeterministicSuccessEdgeTarget,
  getNodeDescriptor,
  type PartialNodeExecutionPolicy,
  type NodeValidationConsumer,
} from "./registry";

export interface ValidationIssue {
  severity: "error" | "warning";
  scope: "flow" | "trigger" | "node";
  node_key?: string;
  field?: string;
  message: string;
}

interface FlowInput {
  name: string;
  trigger_type: "keyword" | "first_inbound_message" | "manual";
  trigger_config: Record<string, unknown>;
  entry_node_id: string | null;
  fallback_policy?: {
    execution?: PartialNodeExecutionPolicy;
  };
  variable_schema?: FlowVariableDeclaration[];
}

interface NodeInput {
  node_key: string;
  node_type: string;
  config: Record<string, unknown>;
}

interface ValidationOptions {
  consumer?: NodeValidationConsumer;
}

export function validateFlowForActivation(
  flow: FlowInput,
  nodes: NodeInput[],
  options: ValidationOptions = {},
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const consumer = options.consumer ?? "flow";

  if (!flow.name?.trim()) {
    issues.push({
      severity: "error",
      scope: "flow",
      field: "name",
      message: "Flow name is required.",
    });
  }
  issues.push(...validateTrigger(flow.trigger_type, flow.trigger_config));
  for (const variable of flow.variable_schema ?? []) {
    if (variable.required && variable.default === undefined) {
      issues.push({
        severity: "error",
        scope: "flow",
        field: `variable_schema.${variable.key}.default`,
        message: `Required variable "${variable.key}" needs an initial value.`,
      });
    }
  }

  if (!flow.entry_node_id) {
    issues.push({
      severity: "error",
      scope: "flow",
      field: "entry_node_id",
      message: "Pick an entry node before activating.",
    });
  }

  if (nodes.length === 0) {
    issues.push({
      severity: "error",
      scope: "flow",
      message: "A flow needs at least one node before activation.",
    });
  }

  const keys = new Set(nodes.map((node) => node.node_key));
  if (flow.entry_node_id && !keys.has(flow.entry_node_id)) {
    issues.push({
      severity: "error",
      scope: "flow",
      field: "entry_node_id",
      message: `Entry node "${flow.entry_node_id}" doesn't exist.`,
    });
  }

  const seen = new Set<string>();
  for (const node of nodes) {
    if (seen.has(node.node_key)) {
      issues.push({
        severity: "error",
        scope: "node",
        node_key: node.node_key,
        message: `Duplicate node_key "${node.node_key}".`,
      });
    }
    seen.add(node.node_key);
  }
  issues.push(...validateDataPortBindings(nodes));

  for (const node of nodes) {
    issues.push(
      ...validateNodeConfig(
        node,
        keys,
        consumer,
        flow.fallback_policy?.execution,
      ),
    );
    issues.push(...validateEdgeTargets(node, keys));
    issues.push(...validateVariableReferences(node, flow.variable_schema ?? []));
  }
  issues.push(...validateStructuredCycles(nodes));

  if (flow.entry_node_id && keys.has(flow.entry_node_id)) {
    const reached = reachableFromEntry(flow.entry_node_id, nodes);
    for (const node of nodes) {
      if (!reached.has(node.node_key)) {
        issues.push({
          severity: "warning",
          scope: "node",
          node_key: node.node_key,
          message: `Node "${node.node_key}" is unreachable from the entry node.`,
        });
      }
    }
  }

  return issues;
}

function validateDataPortBindings(nodes: NodeInput[]): ValidationIssue[] {
  const byKey = new Map(nodes.map((node) => [node.node_key, node]));
  const issues: ValidationIssue[] = [];
  const sourceUsage = new Map<string, number>();
  for (const target of nodes) {
    const bindings =
      target.config._data_inputs &&
      typeof target.config._data_inputs === "object" &&
      !Array.isArray(target.config._data_inputs)
        ? (target.config._data_inputs as Record<
            string,
            Record<string, unknown>
          >)
        : {};
    const targetDescriptor = getNodeDescriptor(target.node_type);
    for (const [targetHandle, binding] of Object.entries(bindings)) {
      const sourceKey =
        typeof binding.source_node_key === "string"
          ? binding.source_node_key
          : "";
      const sourceHandle =
        typeof binding.source_handle === "string" ? binding.source_handle : "";
      const source = byKey.get(sourceKey);
      const sourceDescriptor = source
        ? getNodeDescriptor(source.node_type)
        : undefined;
      const sourcePort = sourceDescriptor?.outputs.find(
        (port) => port.id === sourceHandle && port.type !== "control",
      );
      const targetPort = targetDescriptor?.inputs.find(
        (port) => port.id === targetHandle && port.type !== "control",
      );
      const field = `_data_inputs.${targetHandle}`;
      if (!source || !sourcePort || !targetPort) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: target.node_key,
          field,
          message: "Data binding references an unknown typed port.",
        });
        continue;
      }
      if (!arePortTypesCompatible(sourcePort.type, targetPort.type)) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: target.node_key,
          field,
          message: `Data port types ${sourcePort.type} and ${targetPort.type} are incompatible.`,
        });
      }
      const usageKey = `${sourceKey}:${sourceHandle}`;
      const usage = (sourceUsage.get(usageKey) ?? 0) + 1;
      sourceUsage.set(usageKey, usage);
      if (sourcePort.cardinality === "one" && usage > 1) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: target.node_key,
          field,
          message: `Data output "${sourceHandle}" accepts only one connection.`,
        });
      }
    }
  }
  return issues;
}

function validateVariableReferences(
  node: NodeInput,
  schema: readonly FlowVariableDeclaration[],
): ValidationIssue[] {
  const declarations = new Map(schema.map((entry) => [entry.key, entry]));
  const issue = (field: string, message: string): ValidationIssue => ({
    severity: "error",
    scope: "node",
    node_key: node.node_key,
    field,
    message,
  });
  if (node.node_type === "variable_set") {
    const assignments = Array.isArray(node.config.assignments)
      ? (node.config.assignments as Array<Record<string, unknown>>)
      : [];
    return assignments.flatMap((assignment, index) => {
      const key = typeof assignment.key === "string" ? assignment.key : "";
      const declaration = declarations.get(key);
      if (!declaration) {
        return [
          issue(
            `assignments.${index}.key`,
            `Variable "${key}" is not declared by this flow.`,
          ),
        ];
      }
      if (assignment.type !== declaration.type) {
        return [
          issue(
            `assignments.${index}.type`,
            `Variable "${key}" is declared as ${declaration.type}.`,
          ),
        ];
      }
      return [];
    });
  }
  if (node.node_type === "each") {
    const references = [
      {
        key: node.config.array_variable,
        expected: "json",
        field: "array_variable",
      },
      {
        key: node.config.item_variable,
        expected: undefined,
        field: "item_variable",
      },
      ...(typeof node.config.index_variable === "string"
        ? [
            {
              key: node.config.index_variable,
              expected: "number",
              field: "index_variable",
            },
          ]
        : []),
    ];
    return references.flatMap(({ key, expected, field }) => {
      if (typeof key !== "string") return [];
      const declaration = declarations.get(key);
      if (!declaration) {
        return [
          issue(field, `Variable "${key}" is not declared by this flow.`),
        ];
      }
      if (expected && declaration.type !== expected) {
        return [
          issue(field, `Variable "${key}" must be declared as ${expected}.`),
        ];
      }
      return [];
    });
  }
  if (node.node_type === "ai_reply") {
    const inputVariables = Array.isArray(node.config.input_variables)
      ? node.config.input_variables
      : [];
    const references = [
      ...inputVariables.map((key, index) => ({
        key,
        expected: undefined,
        field: `input_variables.${index}`,
      })),
      {
        key: node.config.output_variable,
        expected: "string",
        field: "output_variable",
      },
    ];
    return references.flatMap(({ key, expected, field }) => {
      if (typeof key !== "string") return [];
      const declaration = declarations.get(key);
      if (!declaration) {
        return [
          issue(field, `Variable "${key}" is not declared by this flow.`),
        ];
      }
      if (expected && declaration.type !== expected) {
        return [
          issue(field, `Variable "${key}" must be declared as ${expected}.`),
        ];
      }
      return [];
    });
  }
  if (node.node_type === "sub_flow") {
    const inputMappings = Array.isArray(node.config.input_mapping)
      ? node.config.input_mapping
      : [];
    const outputMappings = Array.isArray(node.config.output_mapping)
      ? node.config.output_mapping
      : [];
    return [...inputMappings, ...outputMappings].flatMap((mapping, index) => {
      if (!mapping || typeof mapping !== "object") return [];
      const key = (mapping as Record<string, unknown>).parent_key;
      if (typeof key !== "string") return [];
      if (declarations.has(key)) return [];
      return [
        issue(
          `${index < inputMappings.length ? "input" : "output"}_mapping.${
            index < inputMappings.length ? index : index - inputMappings.length
          }.parent_key`,
          `Variable "${key}" is not declared by this flow.`,
        ),
      ];
    });
  }
  if (node.node_type === "loop") {
    if (node.config.subject !== "var") {
      if (
        [
          "greater_than",
          "greater_or_equal",
          "less_than",
          "less_or_equal",
        ].includes(String(node.config.operator))
      ) {
        return [
          issue(
            "operator",
            "Numeric loop operators require a declared number variable.",
          ),
        ];
      }
      return [];
    }
    const key = node.config.subject_key;
    if (typeof key !== "string") return [];
    const declaration = declarations.get(key);
    if (!declaration) {
      return [
        issue("subject_key", `Variable "${key}" is not declared by this flow.`),
      ];
    }
    if (
      [
        "greater_than",
        "greater_or_equal",
        "less_than",
        "less_or_equal",
      ].includes(String(node.config.operator)) &&
      declaration.type !== "number"
    ) {
      return [
        issue(
          "subject_key",
          `Variable "${key}" must be declared as number for this operator.`,
        ),
      ];
    }
    return [];
  }
  const reference =
    node.node_type === "collect_input"
      ? { key: node.config.var_key, expected: "string", field: "var_key" }
      : node.node_type === "http_request" || node.node_type === "http_fetch"
        ? {
            key: node.config.response_var,
            expected: "json",
            field: "response_var",
          }
        : (node.node_type === "switch" || node.node_type === "condition") &&
            node.config.subject === "var"
          ? {
              key: node.config.subject_key,
              expected: undefined,
              field: "subject_key",
            }
          : null;
  if (!reference || typeof reference.key !== "string") return [];
  const declaration = declarations.get(reference.key);
  if (!declaration) {
    return [
      issue(
        reference.field,
        `Variable "${reference.key}" is not declared by this flow.`,
      ),
    ];
  }
  if (reference.expected && declaration.type !== reference.expected) {
    return [
      issue(
        reference.field,
        `Variable "${reference.key}" must be declared as ${reference.expected}.`,
      ),
    ];
  }
  return [];
}

function validateStructuredCycles(nodes: NodeInput[]): ValidationIssue[] {
  const byKey = new Map(nodes.map((node) => [node.node_key, node]));
  let edges = deriveCanvasEdges(nodes as never[]).filter(
    (edge) => edge.targetHandle === "in" || edge.targetHandle === "continue",
  );
  const issues: ValidationIssue[] = [];

  const stronglyConnectedComponents = (
    activeEdges: readonly CanvasEdge[],
  ): string[][] => {
    const adjacency = new Map<string, string[]>(
      nodes.map((node) => [node.node_key, []]),
    );
    for (const edge of activeEdges) {
      adjacency.get(edge.source)?.push(edge.target);
    }
    let nextIndex = 0;
    const indexes = new Map<string, number>();
    const lowLinks = new Map<string, number>();
    const stack: string[] = [];
    const onStack = new Set<string>();
    const result: string[][] = [];
    const connect = (key: string) => {
      indexes.set(key, nextIndex);
      lowLinks.set(key, nextIndex);
      nextIndex += 1;
      stack.push(key);
      onStack.add(key);
      for (const target of adjacency.get(key) ?? []) {
        if (!indexes.has(target)) {
          connect(target);
          lowLinks.set(
            key,
            Math.min(lowLinks.get(key)!, lowLinks.get(target)!),
          );
        } else if (onStack.has(target)) {
          lowLinks.set(
            key,
            Math.min(lowLinks.get(key)!, indexes.get(target)!),
          );
        }
      }
      if (lowLinks.get(key) !== indexes.get(key)) return;
      const component: string[] = [];
      let member: string;
      do {
        member = stack.pop()!;
        onStack.delete(member);
        component.push(member);
      } while (member !== key);
      result.push(component);
    };
    for (const node of nodes) {
      if (!indexes.has(node.node_key)) connect(node.node_key);
    }
    return result;
  };

  const cyclicComponents = (): string[][] =>
    stronglyConnectedComponents(edges).filter(
      (component) =>
        component.length > 1 ||
        edges.some(
          (edge) =>
            edge.source === component[0] && edge.target === component[0],
        ),
    );

  while (true) {
    const cyclic = cyclicComponents();
    if (cyclic.length === 0) return issues;
    let reduced = false;
    for (const component of cyclic) {
      const members = new Set(component);
      const controllers = component.flatMap((key) => {
        const node = byKey.get(key);
        if (node?.node_type !== "each" && node?.node_type !== "loop") return [];
        const body = node.config.body_next;
        const done = node.config.done_next;
        return typeof body === "string" &&
          typeof done === "string" &&
          members.has(body) &&
          !members.has(done)
          ? [node]
          : [];
      });
      if (controllers.length > 1) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: controllers[0].node_key,
          message:
            "Structured cycle is ambiguous because multiple each/loop controllers own the same cycle.",
        });
        return issues;
      }
      if (controllers.length === 0) {
        const controllerWithDoneInside = component
          .map((key) => byKey.get(key))
          .find(
            (node) =>
              (node?.node_type === "each" || node?.node_type === "loop") &&
              typeof node.config.body_next === "string" &&
              members.has(node.config.body_next) &&
              typeof node.config.done_next === "string" &&
              members.has(node.config.done_next),
          );
        issues.push({
          severity: "error",
          scope: "node",
          node_key: controllerWithDoneInside?.node_key ?? component[0],
          field: controllerWithDoneInside ? "done_next" : undefined,
          message: controllerWithDoneInside
            ? "A structured loop done branch must stay outside its controlled cycle."
            : "Cycles must be owned by one structured each or loop controller.",
        });
        return issues;
      }

      const controller = controllers[0];
      const backEdges = edges.filter(
        (edge) =>
          members.has(edge.source) &&
          edge.target === controller.node_key,
      );
      if (
        backEdges.length === 0 ||
        backEdges.some((edge) => edge.targetHandle !== "continue")
      ) {
        issues.push({
          severity: "error",
          scope: "node",
          node_key: controller.node_key,
          message:
            "Every structured loop back-edge must return through the controller continue input.",
        });
        return issues;
      }
      const removed = new Set(backEdges.map((edge) => edge.id));
      edges = edges.filter((edge) => !removed.has(edge.id));
      reduced = true;
    }
    if (!reduced) return issues;
  }
}

function validateTrigger(
  triggerType: FlowInput["trigger_type"],
  triggerConfig: Record<string, unknown>,
): ValidationIssue[] {
  const descriptor = getCompatibilityFlowTriggerDescriptor(triggerType);
  if (!descriptor) return [];

  const parsed = descriptor.configSchema.safeParse({
    ...triggerConfig,
    next_node_key: "__entry__",
  });
  if (parsed.success) return [];

  const blanks =
    triggerType === "keyword" && Array.isArray(triggerConfig.keywords)
      ? triggerConfig.keywords.filter(
          (keyword) => typeof keyword !== "string" || !keyword.trim(),
        ).length
      : 0;
  const issues = parsed.error.issues
    .flatMap(flattenSchemaIssue)
    .filter(
      (issue) =>
        !(blanks > 0 && issue.path[0] === "keywords") &&
        issue.path[0] !== "next_node_key",
    )
    .map<ValidationIssue>((issue) => ({
      severity: "error",
      scope: "trigger",
      field: `trigger_config.${issue.path.map(String).join(".")}`,
      message: issue.message,
    }));

  if (blanks > 0) {
    issues.push({
      severity: "warning",
      scope: "trigger",
      field: "trigger_config.keywords",
      message: `${blanks} keyword${blanks === 1 ? " is" : "s are"} blank — they won't match anything.`,
    });
  }
  return issues;
}

function validateNodeConfig(
  node: NodeInput,
  knownNodeKeys: ReadonlySet<string>,
  consumer: NodeValidationConsumer,
  globalExecutionPolicy?: PartialNodeExecutionPolicy,
): ValidationIssue[] {
  const descriptor = getNodeDescriptor(node.node_type);
  if (!descriptor) {
    return [
      {
        severity: "error",
        scope: "node",
        node_key: node.node_key,
        message: `Unknown node type "${node.node_type}".`,
      },
    ];
  }

  const issues: ValidationIssue[] = [];
  if (consumer === "flow" && !descriptor.supportsFlowRuntime) {
    issues.push({
      severity: "error",
      scope: "node",
      node_key: node.node_key,
      field: "node_type",
      message: `Node type "${node.node_type}" is not supported by the flow runtime.`,
    });
  }

  const schema =
    consumer === "flow"
      ? descriptor.flowConfigSchema
      : descriptor.configSchema;
  const parsed = schema.safeParse(node.config);
  const schemaIssues = parsed.success
    ? []
    : parsed.error.issues.flatMap(flattenSchemaIssue);
  issues.push(
    ...schemaIssues.map((issue) => ({
      severity: "error" as const,
      scope: "node" as const,
      node_key: node.node_key,
      field: issue.path.map(String).join(".") || undefined,
      message: issue.message,
    })),
  );

  issues.push(
    ...descriptor
      .validate(node, { knownNodeKeys, consumer })
      .map((issue) => ({
        severity: issue.severity ?? "error",
        scope: "node" as const,
        node_key: node.node_key,
        field: issue.field,
        message: issue.message,
      })),
  );
  const effectiveOnError =
    node.config.on_error ?? globalExecutionPolicy?.on_error;
  if (
    effectiveOnError === "default_value" &&
    !getDeterministicSuccessEdgeTarget(node.node_type, node.config)
  ) {
    issues.push({
      severity: "error",
      scope: "node",
      node_key: node.node_key,
      field: "default_value",
      message:
        "A default value requires exactly one deterministic success edge.",
    });
  }
  return issues;
}

function flattenSchemaIssue(issue: ZodIssue): ZodIssue[] {
  if (issue.code !== "invalid_union") return [issue];
  return issue.errors.flatMap((branch) => branch.flatMap(flattenSchemaIssue));
}

function validateEdgeTargets(
  node: NodeInput,
  knownNodeKeys: ReadonlySet<string>,
): ValidationIssue[] {
  const descriptor = getNodeDescriptor(node.node_type);
  if (!descriptor) return [];

  const issues: ValidationIssue[] = [];
  for (const edge of descriptor.outgoingEdgeTargets(node.config)) {
    if (!knownNodeKeys.has(edge.target)) {
      issues.push({
        severity: "error",
        scope: "node",
        node_key: node.node_key,
        field: edge.field,
        message: `Edge points to non-existent node "${edge.target}".`,
      });
    }
  }
  return issues;
}

export function reachableFromEntry(
  entryKey: string,
  nodes: NodeInput[],
): Set<string> {
  const byKey = new Map(nodes.map((node) => [node.node_key, node]));
  const visited = new Set<string>();
  const queue = [entryKey];

  while (queue.length > 0) {
    const key = queue.shift()!;
    if (visited.has(key)) continue;
    visited.add(key);
    const node = byKey.get(key);
    if (!node) continue;
    const descriptor = getNodeDescriptor(node.node_type);
    if (!descriptor) continue;
    for (const target of descriptor.outgoingEdges(node.config)) {
      if (!visited.has(target)) queue.push(target);
    }
  }
  return visited;
}
