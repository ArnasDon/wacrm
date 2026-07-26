import { createLinearNodeDescriptor } from "../registry/factories";
import { subFlowConfigSchema } from "../registry/schemas";
import { CONTROL_INPUT, CONTROL_OUTPUT } from "../registry/types";

export const subFlowNodeDescriptor = createLinearNodeDescriptor({
  id: "sub_flow",
  label: "Sub-flow",
  category: "flow",
  icon: "workflow",
  configSchema: subFlowConfigSchema,
  inputs: [
    ...CONTROL_INPUT,
    { id: "inputs", label: "Inputs", type: "json", cardinality: "one" },
  ],
  outputs: [
    ...CONTROL_OUTPUT,
    { id: "outputs", label: "Outputs", type: "json", cardinality: "many" },
  ],
  supportsDefaultValue: false,
  runtimeHook: "sub_flow",
  visible: true,
  form: { kind: "specialized", component: "sub_flow" },
  defaultConfig: {
    flow_id: "",
    input_mapping: [],
    output_mapping: [],
    max_depth: 8,
    next_node_key: "",
  },
  ui: {
    color: "text-indigo-400",
    blurb: "Runs a pinned published flow",
    hue: { l: 0.65, c: 0.16, h: 275 },
  },
});
