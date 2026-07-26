import {
  CONTROL_INPUT,
  defineNodeDescriptor,
  executionPolicyEdgeTargets,
} from "../registry/types";
import {
  switchConfigSchema,
  withCommonExecutionPolicy,
} from "../registry/schemas";

export const switchNodeDescriptor = defineNodeDescriptor({
  id: "switch",
  label: "Switch",
  category: "logic",
  icon: "git-fork",
  inputs: CONTROL_INPUT,
  outputs: [
    {
      id: "case",
      label: "Case",
      type: "control",
      cardinality: "one",
      required: true,
      handlePrefix: "case:",
    },
    {
      id: "default",
      label: "Default",
      type: "control",
      cardinality: "one",
      required: true,
    },
  ],
  configSchema: withCommonExecutionPolicy(switchConfigSchema),
  flowConfigSchema: withCommonExecutionPolicy(switchConfigSchema),
  supportsFlowRuntime: true,
  supportsExecutionPolicy: true,
  supportsDefaultValue: false,
  validate: () => [],
  runtimeKind: "auto",
  runtimeHook: "switch",
  form: { kind: "specialized", component: "switch" },
  builder: {
    visible: true,
    defaultConfig: {
      subject: "var",
      subject_key: "",
      cases: [
        {
          id: "case_1",
          label: "Case 1",
          operator: "equals",
          value: "",
          next: "",
        },
      ],
      default_next: "",
    },
  },
  ui: {
    color: "text-pink-400",
    blurb: "Routes through the first matching case",
    hue: { l: 0.7, c: 0.16, h: 340 },
  },
  outgoingEdges: (config) =>
    [
      ...(Array.isArray(config.cases)
        ? config.cases.map((entry) =>
            entry && typeof entry === "object"
              ? (entry as Record<string, unknown>).next
              : undefined,
          )
        : []),
      config.default_next,
      ...executionPolicyEdgeTargets(config).map(({ target }) => target),
    ].filter((value): value is string => typeof value === "string" && !!value),
  outgoingEdgeTargets: (config) => [
    ...(Array.isArray(config.cases)
      ? config.cases.flatMap((entry, index) =>
          entry &&
          typeof entry === "object" &&
          typeof (entry as Record<string, unknown>).next === "string" &&
          (entry as Record<string, unknown>).next
            ? [
                {
                  target: (entry as Record<string, unknown>).next as string,
                  field: `cases.${index}.next`,
                },
              ]
            : [],
        )
      : []),
    ...(typeof config.default_next === "string" && config.default_next
      ? [{ target: config.default_next, field: "default_next" }]
      : []),
    ...executionPolicyEdgeTargets(config),
  ],
});
