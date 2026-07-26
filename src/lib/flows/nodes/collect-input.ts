import { createLinearNodeDescriptor } from "../registry/factories";
import { collectInputConfigSchema } from "../registry/schemas";
import { CONTROL_INPUT, CONTROL_OUTPUT } from "../registry/types";

export const collectInputNodeDescriptor = createLinearNodeDescriptor({
  id: "collect_input",
  label: "Collect input",
  category: "logic",
  icon: "inbox",
  configSchema: collectInputConfigSchema,
  inputs: CONTROL_INPUT,
  outputs: [
    ...CONTROL_OUTPUT,
    {
      id: "value",
      label: "Captured value",
      type: "string",
      cardinality: "many",
    },
  ],
  runtimeKind: "suspend",
  resolveOutput: (config, portId, vars) =>
    portId === "value" && typeof config.var_key === "string"
      ? vars[config.var_key]
      : undefined,
  visible: true,
  form: {
    kind: "fields",
    fields: [
      {
        kind: "textarea",
        key: "prompt_text",
        label: "Prompt to customer",
        rows: 2,
      },
      { kind: "text", key: "var_key", label: "Variable key" },
      {
        kind: "select",
        key: "validation",
        label: "Validation",
        options: [
          { value: "any", label: "Any non-empty text" },
          { value: "email", label: "Email" },
          { value: "phone", label: "Phone" },
          { value: "regex", label: "Regular expression" },
        ],
      },
      { kind: "text", key: "regex", label: "Regex pattern" },
      {
        kind: "next-node",
        key: "next_node_key",
        label: "Advance after capture",
      },
    ],
  },
  defaultConfig: {
    prompt_text: "",
    var_key: "answer",
    validation: "any",
    next_node_key: "",
  },
  ui: {
    color: "text-teal-400",
    blurb: "Asks a question, saves the reply",
    hue: { l: 0.65, c: 0.1, h: 185 },
  },
});
