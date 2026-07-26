import type { ZodType } from "zod";

import {
  CONTROL_INPUT,
  CONTROL_OUTPUT,
  NO_PORTS,
  defineNodeDescriptor,
  executionPolicyEdgeTargets,
  nextNodeEdgeTargets,
  noValidation,
  terminalEdgeTargets,
  type NodeCategory,
  type NodeFormDescriptor,
  type NodeIconId,
  type NodePortDescriptor,
  type NodeRuntimeKind,
  type NodeUiDescriptor,
  type OutgoingEdgeTarget,
} from "./types";
import { withCommonExecutionPolicy } from "./schemas";

interface CommonOptions<Id extends string> {
  id: Id;
  label: string;
  category: NodeCategory;
  icon: NodeIconId;
  configSchema: ZodType<Record<string, unknown>>;
  flowConfigSchema?: ZodType<Record<string, unknown>>;
  supportsFlowRuntime?: boolean;
  compatibilityFlowTriggerType?: "keyword" | "first_inbound_message" | "manual";
  runtimeHook?: string;
  runtimeKind?: NodeRuntimeKind;
  supportsExecutionPolicy?: boolean;
  supportsDefaultValue?: boolean;
  inputs?: readonly NodePortDescriptor[];
  outputs?: readonly NodePortDescriptor[];
  form?: NodeFormDescriptor;
  visible?: boolean;
  defaultConfig?: Record<string, unknown>;
  ui: NodeUiDescriptor;
  outgoingEdges?: (config: Record<string, unknown>) => readonly string[];
  outgoingEdgeTargets?: (
    config: Record<string, unknown>,
  ) => readonly OutgoingEdgeTarget[];
  resolveOutput?: (
    config: Record<string, unknown>,
    portId: string,
    vars: Readonly<Record<string, unknown>>,
  ) => unknown;
  resolveDebugInput?: (
    config: Record<string, unknown>,
    portId: string,
    vars: Readonly<Record<string, unknown>>,
  ) => unknown;
}

export function createLinearNodeDescriptor<const Id extends string>(
  options: CommonOptions<Id>,
) {
  const baseOutgoingEdgeTargets =
    options.outgoingEdgeTargets ?? nextNodeEdgeTargets;
  const runtimeKind = options.runtimeKind ?? "auto";
  const supportsFlowRuntime =
    options.supportsFlowRuntime ?? runtimeKind !== "legacy";
  const supportsExecutionPolicy =
    options.supportsExecutionPolicy ??
    (supportsFlowRuntime && options.id !== "start");
  const outgoingEdgeTargets = (config: Record<string, unknown>) => [
    ...baseOutgoingEdgeTargets(config),
    ...(supportsExecutionPolicy ? executionPolicyEdgeTargets(config) : []),
  ];
  return defineNodeDescriptor({
    ...options,
    configSchema: supportsExecutionPolicy
      ? withCommonExecutionPolicy(options.configSchema)
      : options.configSchema,
    flowConfigSchema: supportsExecutionPolicy
      ? withCommonExecutionPolicy(
          options.flowConfigSchema ?? options.configSchema,
        )
      : (options.flowConfigSchema ?? options.configSchema),
    supportsFlowRuntime,
    supportsExecutionPolicy,
    supportsDefaultValue:
      supportsExecutionPolicy && (options.supportsDefaultValue ?? true),
    inputs: options.inputs ?? CONTROL_INPUT,
    outputs: options.outputs ?? CONTROL_OUTPUT,
    validate: noValidation,
    runtimeKind,
    runtimeHook: options.runtimeHook ?? options.id,
    form: options.form ?? { kind: "fields", fields: [] },
    builder: {
      visible: options.visible ?? false,
      defaultConfig: options.defaultConfig ?? { next_node_key: "" },
    },
    outgoingEdges:
      options.outgoingEdges ??
      ((config) => outgoingEdgeTargets(config).map(({ target }) => target)),
    outgoingEdgeTargets,
  });
}

export function createTerminalNodeDescriptor<const Id extends string>(
  options: CommonOptions<Id>,
) {
  const baseOutgoingEdgeTargets =
    options.outgoingEdgeTargets ?? terminalEdgeTargets;
  const runtimeKind = options.runtimeKind ?? "terminal";
  const supportsFlowRuntime =
    options.supportsFlowRuntime ?? runtimeKind !== "legacy";
  const supportsExecutionPolicy =
    options.supportsExecutionPolicy ??
    (supportsFlowRuntime && options.id !== "end");
  const outgoingEdgeTargets = (config: Record<string, unknown>) => [
    ...baseOutgoingEdgeTargets(config),
    ...(supportsExecutionPolicy ? executionPolicyEdgeTargets(config) : []),
  ];
  return defineNodeDescriptor({
    ...options,
    configSchema: supportsExecutionPolicy
      ? withCommonExecutionPolicy(options.configSchema)
      : options.configSchema,
    flowConfigSchema: supportsExecutionPolicy
      ? withCommonExecutionPolicy(
          options.flowConfigSchema ?? options.configSchema,
        )
      : (options.flowConfigSchema ?? options.configSchema),
    supportsFlowRuntime,
    supportsExecutionPolicy,
    supportsDefaultValue: false,
    inputs: options.inputs ?? CONTROL_INPUT,
    outputs: options.outputs ?? NO_PORTS,
    validate: noValidation,
    runtimeKind,
    runtimeHook: options.runtimeHook ?? options.id,
    form: options.form ?? { kind: "fields", fields: [] },
    builder: {
      visible: options.visible ?? false,
      defaultConfig: options.defaultConfig ?? {},
    },
    outgoingEdges:
      options.outgoingEdges ??
      ((config) => outgoingEdgeTargets(config).map(({ target }) => target)),
    outgoingEdgeTargets,
  });
}

export function createTriggerNodeDescriptor<const Id extends string>(
  options: CommonOptions<Id>,
) {
  const outgoingEdgeTargets =
    options.outgoingEdgeTargets ?? nextNodeEdgeTargets;
  return defineNodeDescriptor({
    ...options,
    flowConfigSchema: options.flowConfigSchema ?? options.configSchema,
    supportsFlowRuntime: false,
    supportsExecutionPolicy: false,
    supportsDefaultValue: false,
    inputs: options.inputs ?? NO_PORTS,
    outputs: options.outputs ?? CONTROL_OUTPUT,
    validate: noValidation,
    runtimeKind: "trigger",
    runtimeHook: options.runtimeHook ?? options.id,
    form: options.form ?? { kind: "fields", fields: [] },
    builder: {
      visible: false,
      defaultConfig: options.defaultConfig ?? { next_node_key: "" },
    },
    outgoingEdges:
      options.outgoingEdges ??
      ((config) => outgoingEdgeTargets(config).map(({ target }) => target)),
    outgoingEdgeTargets,
  });
}
