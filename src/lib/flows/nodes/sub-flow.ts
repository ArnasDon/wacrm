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
  resolveDebugInput: (config, portId, vars) => {
    if (portId !== "inputs" || !Array.isArray(config.input_mapping)) {
      return undefined;
    }
    return Object.fromEntries(
      config.input_mapping.flatMap((entry) => {
        if (
          !entry ||
          typeof entry !== "object" ||
          !("parent_key" in entry) ||
          !("child_key" in entry) ||
          typeof entry.parent_key !== "string" ||
          typeof entry.child_key !== "string" ||
          !Object.hasOwn(vars, entry.parent_key)
        ) {
          return [];
        }
        return [[entry.child_key, structuredClone(vars[entry.parent_key])]];
      }),
    );
  },
  resolveOutput: (config, portId, vars) => {
    if (portId !== "outputs") return undefined;
    const mappings = Array.isArray(config.output_mapping)
      ? config.output_mapping
      : [];
    return Object.fromEntries(
      mappings.flatMap((entry) => {
        if (
          !entry ||
          typeof entry !== "object" ||
          !("child_key" in entry) ||
          !("parent_key" in entry) ||
          typeof entry.child_key !== "string" ||
          typeof entry.parent_key !== "string" ||
          !Object.hasOwn(vars, entry.parent_key)
        ) {
          return [];
        }
        return [
          [entry.child_key, structuredClone(vars[entry.parent_key])],
        ];
      }),
    );
  },
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
