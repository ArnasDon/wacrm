import { createLinearNodeDescriptor } from "../registry/factories";
import { variableSetConfigSchema } from "../registry/schemas";

export const variableSetNodeDescriptor = createLinearNodeDescriptor({
  id: "variable_set",
  label: "Set variables",
  category: "logic",
  icon: "message-square-code",
  configSchema: variableSetConfigSchema,
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
