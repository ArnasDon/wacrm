import {
  CONTROL_INPUT,
  defineNodeDescriptor,
  executionPolicyEdgeTargets,
} from "../registry/types";
import {
  eachConfigSchema,
  withCommonExecutionPolicy,
} from "../registry/schemas";

function targets(config: Record<string, unknown>) {
  return [
    ...(typeof config.body_next === "string" && config.body_next
      ? [{ target: config.body_next, field: "body_next" }]
      : []),
    ...(typeof config.done_next === "string" && config.done_next
      ? [{ target: config.done_next, field: "done_next" }]
      : []),
    ...executionPolicyEdgeTargets(config),
  ];
}

export const eachNodeDescriptor = defineNodeDescriptor({
  id: "each",
  label: "For each",
  category: "logic",
  icon: "list-checks",
  inputs: [
    ...CONTROL_INPUT,
    { id: "continue", label: "Continue", type: "control", cardinality: "many" },
  ],
  outputs: [
    { id: "body", label: "Body", type: "control", cardinality: "one", required: true },
    { id: "done", label: "Done", type: "control", cardinality: "one", required: true },
  ],
  configSchema: withCommonExecutionPolicy(eachConfigSchema),
  flowConfigSchema: withCommonExecutionPolicy(eachConfigSchema),
  supportsFlowRuntime: true,
  supportsExecutionPolicy: true,
  supportsDefaultValue: false,
  validate: () => [],
  runtimeKind: "auto",
  runtimeHook: "each",
  form: { kind: "specialized", component: "each" },
  builder: {
    visible: true,
    defaultConfig: {
      array_variable: "",
      item_variable: "item",
      index_variable: "index",
      max_iterations: 100,
      body_next: "",
      done_next: "",
    },
  },
  ui: {
    color: "text-amber-400",
    blurb: "Iterates a bounded array durably",
    hue: { l: 0.72, c: 0.15, h: 75 },
  },
  outgoingEdges: (config) => targets(config).map(({ target }) => target),
  outgoingEdgeTargets: targets,
});
