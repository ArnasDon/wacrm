import { createLinearNodeDescriptor } from "../registry/factories";
import { variableSetConfigSchema } from "../registry/schemas";
import { CONTROL_INPUT, CONTROL_OUTPUT } from "../registry/types";

export const variableSetNodeDescriptor = createLinearNodeDescriptor({
  id: "variable_set",
  label: "Set variables",
  category: "logic",
  icon: "message-square-code",
  configSchema: variableSetConfigSchema,
  inputs: [
    ...CONTROL_INPUT,
    {
      id: "value",
      label: "Value",
      type: "any",
      cardinality: "one",
    },
  ],
  outputs: [
    ...CONTROL_OUTPUT,
    {
      id: "variables",
      label: "Variables",
      type: "json",
      cardinality: "many",
    },
  ],
  runtimeKind: "auto",
  runtimeHook: "variable_set",
  visible: true,
  form: {
    kind: "specialized",
    component: "variable_set",
  },
  defaultConfig: {
    assignments: [{ key: "value", type: "string", value: "" }],
    next_node_key: "",
  },
  ui: {
    color: "text-violet-400",
    blurb: "Writes typed flow variables",
    hue: { l: 0.66, c: 0.15, h: 295 },
  },
});
