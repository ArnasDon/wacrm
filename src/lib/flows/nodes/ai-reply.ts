import { createLinearNodeDescriptor } from "../registry/factories";
import { aiReplyConfigSchema } from "../registry/schemas";
import { CONTROL_INPUT, CONTROL_OUTPUT } from "../registry/types";

export const aiReplyNodeDescriptor = createLinearNodeDescriptor({
  id: "ai_reply",
  label: "AI reply",
  category: "messaging",
  icon: "message-circle",
  configSchema: aiReplyConfigSchema,
  inputs: [
    ...CONTROL_INPUT,
    { id: "context", label: "Context", type: "any", cardinality: "one" },
  ],
  outputs: [
    ...CONTROL_OUTPUT,
    { id: "reply", label: "Reply", type: "string", cardinality: "many" },
  ],
  runtimeHook: "ai_reply",
  resolveDebugInput: (config, portId, vars) =>
    portId === "context" && Array.isArray(config.input_variables)
      ? Object.fromEntries(
          config.input_variables.flatMap((key) =>
            typeof key === "string" && Object.hasOwn(vars, key)
              ? [[key, structuredClone(vars[key])]]
              : [],
          ),
        )
      : undefined,
  resolveOutput: (config, portId, vars) =>
    portId === "reply" && typeof config.output_variable === "string"
      ? vars[config.output_variable]
      : undefined,
  visible: true,
  form: { kind: "specialized", component: "ai_reply" },
  defaultConfig: {
    system_prompt: "",
    prompt: "",
    input_variables: [],
    output_variable: "ai_reply",
    max_tokens: 256,
    next_node_key: "",
  },
  ui: {
    color: "text-fuchsia-400",
    blurb: "Generates a bounded AI response",
    hue: { l: 0.68, c: 0.18, h: 320 },
  },
});
