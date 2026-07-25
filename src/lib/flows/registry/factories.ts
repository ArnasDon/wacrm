import type { ZodType } from "zod";

import {
  CONTROL_INPUT,
  CONTROL_OUTPUT,
  NO_PORTS,
  defineNodeDescriptor,
  nextNodeEdges,
  noValidation,
  terminalEdges,
  type NodeCategory,
  type NodeFormDescriptor,
  type NodeIconId,
  type NodeRuntimeKind,
  type NodeUiDescriptor,
} from "./types";

interface CommonOptions<Id extends string> {
  id: Id;
  label: string;
  category: NodeCategory;
  icon: NodeIconId;
  configSchema: ZodType<Record<string, unknown>>;
  runtimeHook?: string;
  runtimeKind?: NodeRuntimeKind;
  form?: NodeFormDescriptor;
  visible?: boolean;
  defaultConfig?: Record<string, unknown>;
  ui: NodeUiDescriptor;
  outgoingEdges?: (
    config: Record<string, unknown>,
  ) => readonly string[];
}

export function createLinearNodeDescriptor<const Id extends string>(
  options: CommonOptions<Id>,
) {
  return defineNodeDescriptor({
    ...options,
    inputs: CONTROL_INPUT,
    outputs: CONTROL_OUTPUT,
    validate: noValidation,
    runtimeKind: options.runtimeKind ?? "auto",
    runtimeHook: options.runtimeHook ?? options.id,
    form: options.form ?? { kind: "fields", fields: [] },
    builder: {
      visible: options.visible ?? false,
      defaultConfig: options.defaultConfig ?? { next_node_key: "" },
    },
    outgoingEdges: options.outgoingEdges ?? nextNodeEdges,
  });
}

export function createTerminalNodeDescriptor<const Id extends string>(
  options: CommonOptions<Id>,
) {
  return defineNodeDescriptor({
    ...options,
    inputs: CONTROL_INPUT,
    outputs: NO_PORTS,
    validate: noValidation,
    runtimeKind: options.runtimeKind ?? "terminal",
    runtimeHook: options.runtimeHook ?? options.id,
    form: options.form ?? { kind: "fields", fields: [] },
    builder: {
      visible: options.visible ?? false,
      defaultConfig: options.defaultConfig ?? {},
    },
    outgoingEdges: options.outgoingEdges ?? terminalEdges,
  });
}

export function createTriggerNodeDescriptor<const Id extends string>(
  options: CommonOptions<Id>,
) {
  return defineNodeDescriptor({
    ...options,
    inputs: NO_PORTS,
    outputs: CONTROL_OUTPUT,
    validate: noValidation,
    runtimeKind: "trigger",
    runtimeHook: options.runtimeHook ?? options.id,
    form: options.form ?? { kind: "fields", fields: [] },
    builder: {
      visible: false,
      defaultConfig: options.defaultConfig ?? { next_node_key: "" },
    },
    outgoingEdges: options.outgoingEdges ?? nextNodeEdges,
  });
}
