import { createLinearNodeDescriptor } from "../registry/factories";
import { collectInputConfigSchema } from "../registry/schemas";

export const collectInputNodeDescriptor = createLinearNodeDescriptor({
  id: "collect_input",
  label: "Collect input",
  category: "logic",
  icon: "inbox",
  configSchema: collectInputConfigSchema,
  runtimeKind: "suspend",
  visible: true,
  form: {
    kind: "fields",
    fields: [
      { kind: "textarea", key: "prompt_text", label: "Prompt to customer", rows: 2 },
      { kind: "text", key: "var_key", label: "Variable key" },
      {
        kind: "next-node",
        key: "next_node_key",
        label: "Advance after capture",
      },
    ],
  },
  defaultConfig: { prompt_text: "", var_key: "answer", next_node_key: "" },
  ui: {
    color: "text-teal-400",
    blurb: "Asks a question, saves the reply",
    hue: { l: 0.65, c: 0.1, h: 185 },
  },
});
