import {
  CONTROL_INPUT,
  defineNodeDescriptor,
  executionPolicyEdgeTargets,
} from "../registry/types";
import {
  loopConfigSchema,
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

export const loopNodeDescriptor = defineNodeDescriptor({
  id: "loop",
  label: "Loop until",
  category: "logic",
  icon: "workflow",
  inputs: [
    ...CONTROL_INPUT,
    { id: "continue", label: "Continue", type: "control", cardinality: "many" },
    { id: "subject", label: "Subject", type: "any", cardinality: "one" },
  ],
  outputs: [
    { id: "body", label: "Body", type: "control", cardinality: "one", required: true },
    { id: "done", label: "Done", type: "control", cardinality: "one", required: true },
  ],
  configSchema: withCommonExecutionPolicy(loopConfigSchema),
  flowConfigSchema: withCommonExecutionPolicy(loopConfigSchema),
  supportsFlowRuntime: true,
  supportsExecutionPolicy: true,
  supportsDefaultValue: false,
  validate: () => [],
  runtimeKind: "auto",
  runtimeHook: "loop",
  resolveDebugInput: (config, portId, vars) =>
    portId === "subject" &&
    config.subject === "var" &&
    typeof config.subject_key === "string"
      ? vars[config.subject_key]
      : undefined,
  form: { kind: "specialized", component: "loop" },
  builder: {
    visible: true,
    defaultConfig: {
      subject: "var",
      subject_key: "",
      operator: "equals",
      value: "",
      max_iterations: 10,
      body_next: "",
      done_next: "",
    },
  },
  ui: {
    color: "text-orange-400",
    blurb: "Repeats a branch with a hard stop",
    hue: { l: 0.7, c: 0.16, h: 50 },
  },
  outgoingEdges: (config) => targets(config).map(({ target }) => target),
  outgoingEdgeTargets: targets,
});
